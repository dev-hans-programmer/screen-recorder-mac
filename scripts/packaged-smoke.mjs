import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const skipRecording = process.argv.includes('--skip-recording');
const explicitApp = process.argv.find((argument) => argument.endsWith('.app'));

function findPackagedApp() {
  if (explicitApp) return path.resolve(explicitApp);
  const out = path.resolve('apps/desktop/out');
  if (!existsSync(out)) return undefined;
  const directories = readdirSync(out, { withFileTypes: true }).sort((left, right) => {
    const leftPriority = left.name.includes('darwin-universal') ? 0 : 1;
    const rightPriority = right.name.includes('darwin-universal') ? 0 : 1;
    return leftPriority - rightPriority || left.name.localeCompare(right.name);
  });
  for (const directory of directories) {
    const candidate = path.join(out, directory.name, 'Screen Recorder.app');
    if (directory.isDirectory() && existsSync(candidate)) return candidate;
  }
  return undefined;
}

const appPath = findPackagedApp();
if (!appPath) {
  console.error('Packaged app not found. Run “pnpm package” first.');
  process.exit(1);
}

const executable = path.join(appPath, 'Contents/MacOS/Screen Recorder');
const helper = path.join(appPath, 'Contents/Resources/CaptureService');
if (!existsSync(executable) || !existsSync(helper)) {
  console.error('The packaged executable or CaptureService helper is missing.');
  process.exit(1);
}

const testDirectory = mkdtempSync(path.join(tmpdir(), 'screen-recorder-packaged-smoke-'));
const reportPath = path.join(testDirectory, 'report.json');
const launch = spawnSync(executable, [], {
  env: {
    ...process.env,
    SCREEN_RECORDER_PACKAGED_SMOKE_REPORT: reportPath,
    SCREEN_RECORDER_PACKAGED_SMOKE_USER_DATA: path.join(testDirectory, 'user-data'),
    SCREEN_RECORDER_PACKAGED_SMOKE_RECORD: skipRecording ? '0' : '1',
  },
  encoding: 'utf8',
  timeout: 60_000,
});

if (launch.error?.code === 'ETIMEDOUT') {
  console.error('Packaged app did not complete its smoke probe within 60 seconds.');
  process.exit(1);
}
if (!existsSync(reportPath)) {
  console.error(launch.stderr || 'Packaged app exited without writing a smoke report.');
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
console.log(JSON.stringify(report, null, 2));
if (report.error) {
  console.error(`Packaged smoke test failed: ${report.error}`);
  if (/permission|restart/i.test(report.error)) {
    console.error('Grant Screen Recording permission to the packaged app, relaunch it, and retry.');
  }
  process.exit(1);
}
if (!report.rendererLoaded || !report.helperDiscovered) process.exit(1);

if (!skipRecording) {
  const validation = spawnSync('node', ['scripts/validate-recording.mjs', report.outputPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (validation.status !== 0) process.exit(validation.status ?? 1);
}
