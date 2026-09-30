import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import process from 'node:process';

const suite = process.argv.includes('--performance')
  ? 'performance'
  : process.argv.includes('--compatibility')
    ? 'compatibility'
    : 'probe';
const includeLong = process.argv.includes('--include-long');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;

const build = spawnSync(
  'swift',
  ['build', '-c', 'release', '--package-path', 'native/CaptureService'],
  { encoding: 'utf8' },
);
if (build.status !== 0) {
  console.error(build.stderr);
  process.exit(build.status ?? 1);
}
const binPath = spawnSync(
  'swift',
  ['build', '-c', 'release', '--show-bin-path', '--package-path', 'native/CaptureService'],
  { encoding: 'utf8' },
);
if (binPath.status !== 0) {
  console.error(binPath.stderr);
  process.exit(binPath.status ?? 1);
}
const binary = path.join(binPath.stdout.trim().split('\n').at(-1), 'CaptureService');

class NativeClient {
  constructor(executable) {
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = [];
    this.process = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        message.ok
          ? pending.resolve(message.data)
          : pending.reject(
              Object.assign(new Error(message.error?.message), { code: message.error?.code }),
            );
      } catch (error) {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      }
    });
    createInterface({ input: this.process.stderr }).on('line', (line) => this.stderr.push(line));
  }

  request(command, payload = null, timeoutMs = 30_000) {
    const requestId = `validation-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${command} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(
        `${JSON.stringify({ protocolVersion: 1, requestId, command, payload })}\n`,
      );
    });
  }

  async close() {
    try {
      await this.request('shutdown');
    } catch {
      this.process.kill();
    }
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const machine = {
  model: spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout.trim(),
  memoryBytes: Number.parseInt(
    spawnSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).stdout.trim(),
    10,
  ),
  macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
  architecture: process.arch,
};

async function record(client, source, options) {
  const width = Math.max(2, options.width - (options.width % 2));
  const height = Math.max(2, options.height - (options.height % 2));
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'screen-recorder-validation-'));
  const audioFixturePath = path.join(outputDirectory, 'system-audio-fixture.wav');
  if (options.systemAudio) {
    const fixture = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=48000',
        '-t',
        String(options.durationMs / 1_000),
        audioFixturePath,
      ],
      { encoding: 'utf8' },
    );
    if (fixture.status !== 0) {
      throw new Error(fixture.stderr || 'Unable to generate the system-audio fixture.');
    }
  }
  await client.request('configureCapture', {
    sourceId: source.id,
    sourceKind: options.kind ?? source.kind,
    region: options.region ?? null,
    width,
    height,
    frameRate: options.frameRate,
    profileId: options.profileId ?? 'compatible',
    outputDirectory,
    showsCursor: true,
    showsMouseClicks: false,
    systemAudio: options.systemAudio ?? false,
    microphone: options.microphone ?? false,
    microphoneDeviceId: null,
  });
  await client.request('startCapture');
  const audioPlayback = options.systemAudio
    ? spawn('afplay', [audioFixturePath], { stdio: 'ignore' })
    : undefined;
  await wait(options.durationMs);
  audioPlayback?.kill();
  const health = await client.request('getHealth');
  const result = await client.request('stopCapture', null, 60_000);
  const qualityArguments = [
    'scripts/validate-recording.mjs',
    result.filePath,
    `--expect-width=${width}`,
    `--expect-height=${height}`,
    ...(options.systemAudio ? ['--expect-system-audio'] : []),
    ...(options.microphone ? ['--expect-microphone'] : []),
  ];
  const quality = spawnSync('node', qualityArguments, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const qualityResult = (() => {
    try {
      return JSON.parse(quality.stdout);
    } catch {
      return undefined;
    }
  })();
  const totalFrames = Math.max(1, result.encodedFrames + result.droppedFrames);
  const droppedFramePercent = (result.droppedFrames / totalFrames) * 100;
  const performancePassed =
    options.maxDroppedFramePercent === undefined ||
    droppedFramePercent <= options.maxDroppedFramePercent;
  return {
    name: options.name,
    status: quality.status === 0 && performancePassed ? 'pass' : 'fail',
    requested: {
      width,
      height,
      frameRate: options.frameRate,
      systemAudio: options.systemAudio ?? false,
      microphone: options.microphone ?? false,
    },
    actual: {
      width: result.width,
      height: result.height,
      frameRate: result.frameRate,
      codec: result.codec,
      durationMs: result.durationMs,
      fileSizeBytes: result.fileSizeBytes,
    },
    droppedFrames: result.droppedFrames,
    droppedFramePercent,
    encodedFrames: result.encodedFrames,
    pendingSamples: { video: health.pendingVideoSamples, audio: health.pendingAudioSamples },
    qualityValidated: quality.status === 0,
    mediaTracks:
      qualityResult === undefined
        ? undefined
        : {
            video: qualityResult.avFoundation.videoTrackCount,
            audio: qualityResult.avFoundation.audioTrackCount,
          },
    error:
      quality.status !== 0
        ? qualityResult?.errors?.join(' ') || quality.stderr.trim() || 'Media validation failed.'
        : performancePassed
          ? undefined
          : `Dropped-frame rate ${droppedFramePercent.toFixed(3)}% exceeded the ${options.maxDroppedFramePercent}% target.`,
  };
}

const client = new NativeClient(binary);
let report;
try {
  await client.request('hello', { clientVersion: 'phase-12-validation' });
  const [permissions, capabilities, sources] = await Promise.all([
    client.request('getPermissions'),
    client.request('getCapabilities'),
    client.request('listSources'),
  ]);
  report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    suite,
    machine,
    permissions,
    capabilities,
    inventory: {
      displays: sources.filter((source) => source.kind === 'display').length,
      windows: sources.filter((source) => source.kind === 'window').length,
      applications: sources.filter((source) => source.kind === 'application').length,
      retinaDisplays: sources.filter(
        (source) => source.kind === 'display' && source.scaleFactor > 1,
      ).length,
    },
    results: [],
  };

  if (suite !== 'probe') {
    if (permissions.screenRecording !== 'granted' || permissions.screenRecordingRequiresRestart) {
      throw new Error(
        'Screen Recording permission must be granted to CaptureService before running hardware suites.',
      );
    }
    const display = sources.find((source) => source.kind === 'display' && source.isAvailable);
    if (!display) throw new Error('No display source is available.');

    const scenarios =
      suite === 'performance'
        ? [
            {
              name: '1080p60',
              width: 1920,
              height: 1080,
              frameRate: 60,
              durationMs: 10_000,
              maxDroppedFramePercent: 0.5,
            },
            ...(capabilities.maxOutputWidth >= 3840 && capabilities.maxOutputHeight >= 2160
              ? [
                  {
                    name: '4K30',
                    width: 3840,
                    height: 2160,
                    frameRate: 30,
                    durationMs: 10_000,
                    maxDroppedFramePercent: 0.5,
                  },
                  {
                    name: '4K60',
                    width: 3840,
                    height: 2160,
                    frameRate: 60,
                    durationMs: 10_000,
                    maxDroppedFramePercent: 1,
                  },
                ]
              : []),
            ...(includeLong
              ? [
                  {
                    name: 'long-duration-30m',
                    width: 1920,
                    height: 1080,
                    frameRate: 60,
                    durationMs: 30 * 60_000,
                  },
                ]
              : []),
          ]
        : [
            {
              name: 'display',
              width: Math.min(display.width, 1920),
              height: Math.min(display.height, 1080),
              frameRate: 30,
              durationMs: 3_000,
            },
            {
              name: 'region',
              kind: 'region',
              region: {
                x: 0,
                y: 0,
                width: Math.min(display.width, 1280),
                height: Math.min(display.height, 720),
              },
              width: 1280,
              height: 720,
              frameRate: 30,
              durationMs: 3_000,
            },
            {
              name: 'system-audio',
              width: 1280,
              height: 720,
              frameRate: 30,
              durationMs: 3_000,
              systemAudio: true,
            },
            ...(permissions.microphone === 'granted'
              ? [
                  {
                    name: 'microphone',
                    width: 1280,
                    height: 720,
                    frameRate: 30,
                    durationMs: 3_000,
                    microphone: true,
                  },
                  {
                    name: 'system-audio-and-microphone',
                    width: 1280,
                    height: 720,
                    frameRate: 30,
                    durationMs: 3_000,
                    systemAudio: true,
                    microphone: true,
                  },
                ]
              : []),
            ...['window', 'application'].flatMap((kind) => {
              const source = sources.find(
                (candidate) => candidate.kind === kind && candidate.isAvailable,
              );
              return source
                ? [
                    {
                      name: kind,
                      captureKind: kind,
                      width: Math.min(source.width ?? 1920, 1920),
                      height: Math.min(source.height ?? 1080, 1080),
                      frameRate: 30,
                      durationMs: 3_000,
                    },
                  ]
                : [];
            }),
          ];

    for (const scenario of scenarios) {
      try {
        const scenarioSource = scenario.captureKind
          ? (await client.request('listSources')).find(
              (candidate) => candidate.kind === scenario.captureKind && candidate.isAvailable,
            )
          : display;
        if (!scenarioSource) {
          throw new Error(`No live ${scenario.captureKind} source is available.`);
        }
        report.results.push(await record(client, scenarioSource, scenario));
      } catch (error) {
        report.results.push({
          name: scenario.name,
          status: 'fail',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
} catch (error) {
  report = {
    ...(report ?? {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      suite,
      machine,
      results: [],
    }),
    fatalError: error instanceof Error ? error.message : String(error),
  };
} finally {
  await client.close();
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
console.log(serialized);
if (outputPath) {
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  writeFileSync(path.resolve(outputPath), serialized, 'utf8');
}
process.exit(
  report.fatalError || report.results.some((result) => result.status === 'fail') ? 1 : 0,
);
