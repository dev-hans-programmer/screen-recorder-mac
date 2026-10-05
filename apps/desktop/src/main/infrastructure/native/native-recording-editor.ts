import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import {
  createDurationMs,
  createRecordingArtifact,
  createRecordingFilePath,
  DomainError,
  isRecordingProfileId,
  type FrameRate,
  type RecordingCodec,
} from '@screen-recorder/domain';
import type {
  RecordingEditorExportRequest,
  RecordingEditorExportResult,
  RecordingEditorPort,
} from '@screen-recorder/application';

import { parseNativeEditedRecordingResult, toNativeDomainError } from './native-mappers';
import { NativeServiceSupervisor } from './native-service-supervisor';

interface NativeRecordingEditorOptions {
  readonly supervisor: NativeServiceSupervisor;
  readonly outputDirectory: () => Promise<string>;
  readonly thumbnailStagingDirectory: string;
}

const editorTimeoutMs = 60 * 60 * 1_000;

export class NativeRecordingEditor implements RecordingEditorPort {
  public constructor(private readonly options: NativeRecordingEditorOptions) {}

  public async exportRecording(
    request: RecordingEditorExportRequest,
  ): Promise<RecordingEditorExportResult> {
    const operationId = `editor:${request.outputId}`;
    this.options.supervisor.reserveEditor(operationId);

    try {
      const outputDirectory = await this.options.outputDirectory();
      await Promise.all([
        mkdir(outputDirectory, { recursive: true }),
        mkdir(this.options.thumbnailStagingDirectory, { recursive: true }),
      ]);
      const extension = request.source.profileId === 'master' ? 'mov' : 'mp4';
      const outputPath = path.join(outputDirectory, `edited-${request.outputId}.${extension}`);
      const thumbnailPath = path.join(
        this.options.thumbnailStagingDirectory,
        `${request.outputId}.png`,
      );

      const nativeResult = parseNativeEditedRecordingResult(
        await this.options.supervisor.request(
          'exportRecording',
          {
            inputPath: request.source.filePath,
            outputPath,
            thumbnailPath,
            profileId: request.source.profileId,
            codec: request.source.codec,
            frameRate: request.source.frameRate,
            hasSystemAudio: request.source.hasSystemAudio,
            hasMicrophone: request.source.hasMicrophone,
            trimStartMs: request.plan.trimStartMs,
            trimEndMs: request.plan.trimEndMs,
            crop: request.plan.crop,
            rotation: request.plan.rotation,
            mutedRanges: request.plan.mutedRanges,
            posterTimeMs: request.plan.posterTimeMs,
            project: request.plan.project,
          },
          { timeoutMs: editorTimeoutMs },
        ),
      );

      if (!isRecordingProfileId(nativeResult.profileId)) {
        throw new DomainError('NATIVE_SERVICE_FAILURE', 'Editor returned an unknown profile.');
      }
      const codec = requireCodec(nativeResult.codec);
      const frameRate = requireFrameRate(nativeResult.frameRate);
      return {
        artifact: createRecordingArtifact({
          id: request.outputId,
          filePath: createRecordingFilePath(nativeResult.filePath),
          title: request.plan.title,
          createdAt: request.createdAt,
          durationMs: createDurationMs(nativeResult.durationMs),
          width: nativeResult.width,
          height: nativeResult.height,
          frameRate,
          profileId: nativeResult.profileId,
          codec,
          hasSystemAudio: nativeResult.hasSystemAudio,
          hasMicrophone: nativeResult.hasMicrophone,
          fileSizeBytes: nativeResult.fileSizeBytes,
        }),
        thumbnailPath: nativeResult.thumbnailPath ?? undefined,
      };
    } catch (error) {
      throw toNativeDomainError(error);
    } finally {
      this.options.supervisor.releaseEditor(operationId);
    }
  }
}

function requireCodec(value: string): RecordingCodec {
  if (value === 'h264' || value === 'hevc' || value === 'prores422') return value;
  throw new DomainError('NATIVE_SERVICE_FAILURE', 'Editor returned an unknown codec.');
}

function requireFrameRate(value: number): FrameRate {
  if (value === 30 || value === 60) return value;
  throw new DomainError('NATIVE_SERVICE_FAILURE', 'Editor returned an invalid frame rate.');
}
