import { chmodSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const workspace = process.cwd();
const packagePath = path.join(workspace, 'native/CaptureService');
const buildRoot = path.join(packagePath, '.build');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function buildArchitecture(architecture) {
  const scratchPath = path.join(buildRoot, `universal-${architecture}`);
  const commonArguments = [
    '-c',
    'release',
    '--product',
    'CaptureService',
    '--package-path',
    packagePath,
    '--scratch-path',
    scratchPath,
    '--triple',
    `${architecture}-apple-macosx15.0`,
  ];
  process.stdout.write(`Building CaptureService for ${architecture}...\n`);
  run('swift', ['build', ...commonArguments]);
  const binaryDirectory = run('swift', ['build', '--show-bin-path', ...commonArguments])
    .split('\n')
    .at(-1);
  return path.join(binaryDirectory, 'CaptureService');
}

const arm64Binary = buildArchitecture('arm64');
const x86Binary = buildArchitecture('x86_64');
const outputDirectory = path.join(buildRoot, 'universal-apple-macosx/release');
const outputBinary = path.join(outputDirectory, 'CaptureService');
mkdirSync(outputDirectory, { recursive: true });
run('lipo', ['-create', arm64Binary, x86Binary, '-output', outputBinary]);
chmodSync(outputBinary, 0o755);

const architectures = run('lipo', ['-archs', outputBinary]).split(/\s+/u).sort();
if (architectures.join(',') !== ['arm64', 'x86_64'].sort().join(',')) {
  throw new Error(`Universal helper has unexpected architectures: ${architectures.join(', ')}.`);
}
process.stdout.write(`Created Universal 2 CaptureService: ${outputBinary}\n`);
