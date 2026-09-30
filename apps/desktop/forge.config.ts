import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

const nativeBuildArchitecture =
  optionalEnvironmentValue('SCREEN_RECORDER_NATIVE_BUILD_ARCH') ??
  (process.arch === 'x64' ? 'x86_64' : process.arch);
if (!['arm64', 'x86_64', 'universal'].includes(nativeBuildArchitecture)) {
  throw new Error(`Unsupported native build architecture: ${nativeBuildArchitecture}.`);
}

const nativeServiceBinary = path.resolve(
  __dirname,
  `../../native/CaptureService/.build/${nativeBuildArchitecture}-apple-macosx/release/CaptureService`,
);

const signingIdentity = optionalEnvironmentValue('SCREEN_RECORDER_MACOS_SIGN_IDENTITY');
const notaryKeychainProfile = optionalEnvironmentValue('SCREEN_RECORDER_NOTARY_KEYCHAIN_PROFILE');
const notaryKeychain = optionalEnvironmentValue('SCREEN_RECORDER_NOTARY_KEYCHAIN');
const appleId = optionalEnvironmentValue('APPLE_ID');
const appleIdPassword = optionalEnvironmentValue('APPLE_APP_SPECIFIC_PASSWORD');
const appleTeamId = optionalEnvironmentValue('APPLE_TEAM_ID');
const hasPartialAppleCredentials = [appleId, appleIdPassword, appleTeamId].some(
  (value) => value !== undefined,
);

if (
  hasPartialAppleCredentials &&
  (appleId === undefined || appleIdPassword === undefined || appleTeamId === undefined)
) {
  throw new Error(
    'Notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID together.',
  );
}

const notarizationCredentials =
  notaryKeychainProfile !== undefined
    ? {
        keychainProfile: notaryKeychainProfile,
        ...(notaryKeychain === undefined ? {} : { keychain: notaryKeychain }),
      }
    : appleId !== undefined && appleIdPassword !== undefined && appleTeamId !== undefined
      ? { appleId, appleIdPassword, teamId: appleTeamId }
      : undefined;

if (notarizationCredentials !== undefined && signingIdentity === undefined) {
  throw new Error('Notarization was configured without SCREEN_RECORDER_MACOS_SIGN_IDENTITY.');
}

function removeCodeSignatureDirectories(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === '_CodeSignature') {
      rmSync(entryPath, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      removeCodeSignatureDirectories(entryPath);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Screen Recorder',
    executableName: 'Screen Recorder',
    appBundleId: 'com.screenrecorder.app',
    extraResource: [nativeServiceBinary],
    afterExtract: [
      (buildPath, _electronVersion, platform, _architecture, callback) => {
        try {
          // Electron's arm64 archive is pre-signed while its x64 archive is not. Strip those
          // source signatures before Universal 2 stitching, then sign the merged app once below.
          if (platform === 'darwin' && nativeBuildArchitecture === 'universal') {
            removeCodeSignatureDirectories(buildPath);
          }
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    ],
    extendInfo: {
      LSApplicationCategoryType: 'public.app-category.video',
      LSMinimumSystemVersion: '15.0',
      NSAudioCaptureUsageDescription:
        'Screen Recorder uses system audio only when you enable it for a recording.',
      NSMicrophoneUsageDescription:
        'Screen Recorder uses the microphone only when you enable it for a recording.',
      NSScreenCaptureUsageDescription:
        'Screen Recorder needs screen access to record the display, windows, applications, and selected regions.',
    },
    ...(signingIdentity === undefined
      ? nativeBuildArchitecture === 'universal'
        ? {
            // Apple Silicon executables require a valid code signature. An ad-hoc signature keeps
            // credential-free local/CI artifacts launchable without claiming trusted distribution.
            osxSign: {
              identity: '-',
              identityValidation: false,
              // Hardened runtime library validation cannot establish one trusted Team ID for an
              // ad-hoc identity. Developer ID builds keep osx-sign's hardened-runtime default.
              optionsForFile: () => ({ hardenedRuntime: false }),
              preAutoEntitlements: false,
              preEmbedProvisioningProfile: false,
            },
          }
        : {}
      : {
          osxSign: {
            identity: signingIdentity,
          },
        }),
    ...(notarizationCredentials === undefined ? {} : { osxNotarize: notarizationCredentials }),
  },
  rebuildConfig: {},
  makers: [new MakerDMG({}, ['darwin']), new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
