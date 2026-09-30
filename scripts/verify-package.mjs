import { constants, accessSync, existsSync, readdirSync, statSync } from 'node:fs';
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

const iconNameResult = spawnSync(
  '/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleIconFile', infoPlistPath],
  { encoding: 'utf8' },
);
if (iconNameResult.status !== 0) {
  throw new Error(iconNameResult.stderr || 'The packaged app icon is not declared.');
}
const declaredIconName = iconNameResult.stdout.trim();
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
