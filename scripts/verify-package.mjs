import { constants, accessSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

function findPackagedApp() {
  const explicitApp = process.argv.find((argument) => argument.endsWith('.app'));
  if (explicitApp) return path.resolve(explicitApp);
  const outputDirectory = path.resolve('apps/desktop/out');
  if (!existsSync(outputDirectory)) return undefined;
  const entries = readdirSync(outputDirectory, { withFileTypes: true }).sort((left, right) => {
    const leftPriority = left.name.includes('darwin-universal') ? 0 : 1;
    const rightPriority = right.name.includes('darwin-universal') ? 0 : 1;
    return leftPriority - rightPriority || left.name.localeCompare(right.name);
  });
  for (const entry of entries) {
    const candidate = path.join(outputDirectory, entry.name, 'Screen Recorder.app');
    if (entry.isDirectory() && existsSync(candidate)) return candidate;
  }
  return undefined;
}

const appPath = findPackagedApp();
if (!appPath) throw new Error('Packaged app not found. Run “pnpm package” first.');
const expectedVersion = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version;

const resources = path.join(appPath, 'Contents/Resources');
const asarPath = path.join(resources, 'app.asar');
const helperPath = path.join(resources, 'CaptureService');
const executablePath = path.join(appPath, 'Contents/MacOS/Screen Recorder');
const infoPlistPath = path.join(appPath, 'Contents/Info.plist');
if (!existsSync(asarPath)) throw new Error('Packaged renderer/main ASAR is missing.');
if (!existsSync(helperPath) || !statSync(helperPath).isFile()) {
  throw new Error('CaptureService is not packaged as an external resource.');
}
accessSync(helperPath, constants.X_OK);

function plistValue(key) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `Unable to read ${key} from Info.plist.`);
  return result.stdout.trim();
}

const bundleVersion = plistValue('CFBundleShortVersionString');
const buildVersion = plistValue('CFBundleVersion');
if (bundleVersion !== expectedVersion || buildVersion !== expectedVersion) {
  throw new Error(
    `Packaged version mismatch: expected=${expectedVersion} bundle=${bundleVersion} build=${buildVersion}`,
  );
}

const helperHandshake = spawnSync(helperPath, [], {
  encoding: 'utf8',
  input: `${JSON.stringify({
    protocolVersion: 1,
    requestId: 'package-version-check',
    command: 'hello',
    payload: { clientVersion: expectedVersion },
  })}\n`,
  timeout: 5_000,
});
if (helperHandshake.status !== 0) {
  throw new Error(helperHandshake.stderr || 'Packaged CaptureService handshake failed.');
}
const helperResponse = JSON.parse(helperHandshake.stdout.trim().split('\n')[0]);
if (helperResponse.serviceVersion !== expectedVersion) {
  throw new Error(
    `Packaged helper version mismatch: expected=${expectedVersion} helper=${String(helperResponse.serviceVersion)}`,
  );
}

const declaredIconName = plistValue('CFBundleIconFile');
const iconFileName =
  path.extname(declaredIconName) === '' ? `${declaredIconName}.icns` : declaredIconName;
const iconPath = path.join(resources, iconFileName);
if (!existsSync(iconPath) || !statSync(iconPath).isFile()) {
  throw new Error(`The packaged app icon is missing: ${iconFileName}.`);
}

function architecturesFor(binaryPath) {
  const result = spawnSync('lipo', ['-archs', binaryPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to inspect architecture: ${binaryPath}`);
  }
  return result.stdout.trim().split(/\s+/u).sort();
}

const appArchitectures = architecturesFor(executablePath);
const helperArchitectures = architecturesFor(helperPath);
if (appArchitectures.join(',') !== helperArchitectures.join(',')) {
  throw new Error(
    `Architecture mismatch: app=${appArchitectures.join(',')} helper=${helperArchitectures.join(',')}`,
  );
}
const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
  encoding: 'utf8',
});
if (signature.status !== 0) {
  throw new Error(signature.stderr || 'The packaged app signature is invalid.');
}

process.stdout.write(
  `${JSON.stringify(
    {
      appPath,
      applicationVersion: bundleVersion,
      nativeServiceVersion: helperResponse.serviceVersion,
      asarPresent: true,
      helperOutsideAsar: true,
      helperExecutable: true,
      appIcon: iconFileName,
      appArchitectures,
      helperArchitectures,
      codeSignatureValid: true,
    },
    null,
    2,
  )}\n`,
);
