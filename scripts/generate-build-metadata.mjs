import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const outputPath = path.resolve(process.argv[2] ?? '.ci/build-metadata.json');
const artifactDirectory = path.resolve(process.argv[3] ?? 'apps/desktop/out/make');

function command(commandName, arguments_) {
  const result = spawnSync(commandName, arguments_, { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function filesRecursively(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
const desktopPackageJson = JSON.parse(
  await readFile(path.resolve('apps/desktop/package.json'), 'utf8'),
);
const lockfilePath = path.resolve('pnpm-lock.yaml');
const artifactPaths = (await filesRecursively(artifactDirectory))
  .filter((filePath) => ['.dmg', '.zip'].includes(path.extname(filePath).toLowerCase()))
  .sort((left, right) => left.localeCompare(right));
const artifacts = [];
for (const artifactPath of artifactPaths) {
  artifacts.push({
    path: path.relative(process.cwd(), artifactPath).split(path.sep).join('/'),
    sizeBytes: (await stat(artifactPath)).size,
    sha256: await sha256(artifactPath),
  });
}

const commitSha = process.env['GITHUB_SHA'] ?? command('git', ['rev-parse', 'HEAD']) ?? 'unknown';
const sourceDateEpoch =
  process.env['SOURCE_DATE_EPOCH'] ?? command('git', ['show', '-s', '--format=%ct', commitSha]);
const metadata = {
  schemaVersion: 2,
  application: {
    name: packageJson.name,
    version: packageJson.version,
    electronVersion: desktopPackageJson.devDependencies.electron,
    reactVersion: desktopPackageJson.dependencies.react,
    nativeServiceVersion: packageJson.version,
  },
  source: {
    commitSha,
    ref: process.env['GITHUB_REF'] ?? command('git', ['branch', '--show-current']) ?? 'unknown',
    event: process.env['GITHUB_EVENT_NAME'] ?? 'local',
    repository: process.env['GITHUB_REPOSITORY'] ?? 'local',
  },
  build: {
    generatedAt: new Date().toISOString(),
    sourceDateEpoch: sourceDateEpoch === undefined ? null : Number(sourceDateEpoch),
    runnerOs: process.env['RUNNER_OS'] ?? process.platform,
    runnerArchitecture: process.env['RUNNER_ARCH'] ?? process.arch,
    signingConfigured: process.env['CI_SIGNING_CONFIGURED'] === 'true',
    notarizationConfigured: process.env['CI_NOTARIZATION_CONFIGURED'] === 'true',
    runId: process.env['GITHUB_RUN_ID'] ?? null,
    runAttempt: process.env['GITHUB_RUN_ATTEMPT'] ?? null,
  },
  toolchain: {
    node: process.version,
    pnpm: command('pnpm', ['--version']) ?? 'unavailable',
    swift: command('swift', ['--version'])?.split('\n')[0] ?? 'unavailable',
    xcode: command('xcodebuild', ['-version'])?.replaceAll('\n', '; ') ?? 'unavailable',
    macos: command('sw_vers', ['-productVersion']) ?? 'unavailable',
  },
  dependencies: {
    lockfile: 'pnpm-lock.yaml',
    lockfileSha256: existsSync(lockfilePath) ? await sha256(lockfilePath) : null,
  },
  artifacts,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote build metadata to ${outputPath}.\n`);
