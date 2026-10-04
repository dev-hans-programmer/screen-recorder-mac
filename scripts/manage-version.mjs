import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const packageFiles = [
  'package.json',
  'apps/desktop/package.json',
  'packages/application/package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json',
];
const nativeVersionFile = 'native/CaptureService/Sources/CaptureService/NativeProtocol.swift';
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u;

async function readPackage(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

async function readNativeVersion() {
  const source = await readFile(path.join(repositoryRoot, nativeVersionFile), 'utf8');
  const match = source.match(/let nativeServiceVersion = "([^"]+)"/u);
  if (match?.[1] === undefined)
    throw new Error('Native service version declaration was not found.');
  return match[1];
}

async function checkVersions() {
  const rootPackage = await readPackage('package.json');
  const expectedVersion = rootPackage.version;
  if (typeof expectedVersion !== 'string' || !semverPattern.test(expectedVersion)) {
    throw new Error(
      `Root package version is not valid semantic versioning: ${String(expectedVersion)}`,
    );
  }

  const versions = new Map();
  for (const relativePath of packageFiles) {
    versions.set(relativePath, (await readPackage(relativePath)).version);
  }
  versions.set(nativeVersionFile, await readNativeVersion());

  const mismatches = [...versions].filter(([, version]) => version !== expectedVersion);
  if (mismatches.length > 0) {
    const details = mismatches.map(([file, version]) => `${file}: ${String(version)}`).join('\n');
    throw new Error(`Expected every release component to be ${expectedVersion}:\n${details}`);
  }

  process.stdout.write(`All release components report version ${expectedVersion}.\n`);
}

async function setVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  for (const relativePath of packageFiles) {
    const filePath = path.join(repositoryRoot, relativePath);
    const packageJson = await readPackage(relativePath);
    packageJson.version = version;
    await writeFile(filePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  }

  const nativePath = path.join(repositoryRoot, nativeVersionFile);
  const nativeSource = await readFile(nativePath, 'utf8');
  const updatedNativeSource = nativeSource.replace(
    /let nativeServiceVersion = "[^"]+"/u,
    `let nativeServiceVersion = "${version}"`,
  );
  if (updatedNativeSource === nativeSource) {
    throw new Error('Native service version declaration was not updated.');
  }
  await writeFile(nativePath, updatedNativeSource, 'utf8');

  process.stdout.write(`Set application and native helper versions to ${version}.\n`);
  process.stdout.write('Update CHANGELOG.md, then run “pnpm version:check” before committing.\n');
}

const [command = 'check', version] = process.argv.slice(2);
if (command === 'check') {
  await checkVersions();
} else if (command === 'set' && version !== undefined) {
  await setVersion(version);
  await checkVersions();
} else {
  throw new Error('Usage: node scripts/manage-version.mjs check | set <major.minor.patch>');
}
