import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const openInQuickTime = args.includes('--quicktime');
const recordingPath = args.find((argument) => !argument.startsWith('--'));
const optionNumber = (name) => {
  const value = args.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
  return value === undefined ? undefined : Number(value);
};
const expectedWidth = optionNumber('expect-width');
const expectedHeight = optionNumber('expect-height');
const expectedFrameRate = optionNumber('expect-fps');
const expectedAudioTracks =
  Number(args.includes('--expect-system-audio')) + Number(args.includes('--expect-microphone'));

if (!recordingPath || !existsSync(recordingPath)) {
  console.error('Usage: pnpm quality:validate <recording-path> [--quicktime]');
  process.exit(64);
}

const absolutePath = path.resolve(recordingPath);
const native = spawnSync(
  'swift',
  [
    'run',
    '-c',
    'release',
    '--package-path',
    'native/CaptureService',
    'MediaInspector',
    absolutePath,
  ],
  { cwd: process.cwd(), encoding: 'utf8' },
);
const nativeLine = native.stdout.trim().split('\n').at(-1);
if (!nativeLine) {
  console.error(native.stderr || 'AVFoundation inspection produced no result.');
  process.exit(1);
}

let avFoundation;
try {
  avFoundation = JSON.parse(nativeLine);
} catch {
  console.error(`AVFoundation inspection returned invalid JSON: ${nativeLine}`);
  process.exit(1);
}

const ffprobe = spawnSync(
  'ffprobe',
  ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absolutePath],
  { encoding: 'utf8' },
);
if (ffprobe.error?.code === 'ENOENT') {
  console.error('ffprobe is required as the independent demuxer/player compatibility check.');
  process.exit(1);
}

let independent;
try {
  independent = JSON.parse(ffprobe.stdout);
} catch {
  console.error(ffprobe.stderr || 'ffprobe returned invalid JSON.');
  process.exit(1);
}

const independentVideo =
  independent.streams?.filter((stream) => stream.codec_type === 'video') ?? [];
const independentAudio =
  independent.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
const errors = [...avFoundation.validationErrors];
if (independentVideo.length === 0) errors.push('ffprobe could not find a video track.');
if (!(Number.parseFloat(independent.format?.duration ?? '0') > 0)) {
  errors.push('ffprobe reported an invalid duration.');
}
const independentDurationMs = Number.parseFloat(independent.format?.duration ?? '0') * 1_000;
if (Math.abs(independentDurationMs - avFoundation.durationMs) > 250) {
  errors.push(
    `AVFoundation/ffprobe duration differs by more than 250 ms (${avFoundation.durationMs} vs ${independentDurationMs}).`,
  );
}
if (expectedWidth !== undefined && avFoundation.width !== expectedWidth) {
  errors.push(`Expected width ${expectedWidth}, received ${avFoundation.width}.`);
}
if (expectedHeight !== undefined && avFoundation.height !== expectedHeight) {
  errors.push(`Expected height ${expectedHeight}, received ${avFoundation.height}.`);
}
if (
  expectedFrameRate !== undefined &&
  Math.abs((avFoundation.nominalFrameRate ?? 0) - expectedFrameRate) > 0.5
) {
  errors.push(
    `Expected nominal frame rate ${expectedFrameRate}, received ${avFoundation.nominalFrameRate}.`,
  );
}
if (avFoundation.audioTrackCount < expectedAudioTracks) {
  errors.push(
    `Expected ${expectedAudioTracks} audio track(s), received ${avFoundation.audioTrackCount}.`,
  );
}

const result = {
  schemaVersion: 1,
  recording: path.basename(absolutePath),
  avFoundation,
  independentProbe: {
    durationMs: independentDurationMs,
    videoTrackCount: independentVideo.length,
    audioTrackCount: independentAudio.length,
    width: independentVideo[0]?.width ?? null,
    height: independentVideo[0]?.height ?? null,
    frameRate: independentVideo[0]?.avg_frame_rate ?? null,
    codecs: independent.streams?.map((stream) => stream.codec_name) ?? [],
  },
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (openInQuickTime) {
  const quickTime = spawn('open', ['-a', 'QuickTime Player', absolutePath], {
    detached: true,
    stdio: 'ignore',
  });
  quickTime.unref();
}
process.exit(errors.length === 0 && native.status === 0 && ffprobe.status === 0 ? 0 : 1);
