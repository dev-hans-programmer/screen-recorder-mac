import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const targetDirectory = path.resolve(process.argv[2] ?? 'apps/desktop/out/make');
const verify = process.argv.includes('--verify');
const checksumPath = path.join(targetDirectory, 'SHA256SUMS');

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

if (verify) {
  const lines = (await readFile(checksumPath, 'utf8')).trim().split('\n').filter(Boolean);
  if (lines.length === 0) throw new Error('SHA256SUMS contains no artifacts.');
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) throw new Error(`Invalid checksum entry: ${line}`);
    const [, expected, relativePath] = match;
    const actual = await sha256(path.join(targetDirectory, relativePath));
    if (actual !== expected) throw new Error(`Checksum mismatch: ${relativePath}`);
    process.stdout.write(`verified  ${relativePath}\n`);
  }
  process.exit(0);
}

const artifacts = (await filesRecursively(targetDirectory))
  .filter((filePath) => ['.dmg', '.zip'].includes(path.extname(filePath).toLowerCase()))
  .sort((left, right) => left.localeCompare(right));
if (artifacts.length === 0) {
  throw new Error(`No DMG or ZIP artifacts were found under ${targetDirectory}.`);
}

const lines = [];
for (const artifact of artifacts) {
  const relativePath = path.relative(targetDirectory, artifact).split(path.sep).join('/');
  lines.push(`${await sha256(artifact)}  ${relativePath}`);
}
await writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`Wrote ${lines.length} checksums to ${checksumPath}.\n`);
