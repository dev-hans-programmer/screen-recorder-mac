import {
  createCaptureRegion,
  createCaptureSource,
  createRecordingArtifact,
  createRecordingRequest,
  type AppPreferences,
  type AppPreferencesPatch,
  type RecordingRequest,
  type RecordingEditPlanInput,
} from '@screen-recorder/domain';
import {
  IpcProtocolError,
  protocolVersion,
  type AppPreferencesDto,
  type AppPreferencesPatchDto,
  type CapturePermissionsDto,
  type CaptureSourceDto,
  type IpcError,
  type IpcEvent,
  type RecordingArtifactDto,
  type RecordingEditRequestDto,
  type RecordingMetadataDto,
  type RecordingRequestDto,
  type RecordingSessionSnapshotDto,
} from '@screen-recorder/contracts';
import type { ApplicationEvent, ValidatedRecordingRequest } from '@screen-recorder/application';

import { DomainError } from '@screen-recorder/domain';

export function toCaptureSourceDto(source: {
  readonly id: string;
  readonly kind: CaptureSourceDto['kind'];
  readonly name: string;
  readonly dimensions: { readonly width: number; readonly height: number } | undefined;
  readonly scaleFactor: number | undefined;
  readonly isAvailable: boolean;
}): CaptureSourceDto {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    dimensions: source.dimensions ?? null,
    scaleFactor: source.scaleFactor ?? null,
    isAvailable: source.isAvailable,
  };
}

export function toCapturePermissionsDto(permissions: {
  readonly screenRecording: CapturePermissionsDto['screenRecording'];
  readonly microphone: CapturePermissionsDto['microphone'];
  readonly screenRecordingRequiresRestart: boolean;
}): CapturePermissionsDto {
  return { ...permissions };
}

export function toRecordingRequest(dto: RecordingRequestDto): RecordingRequest {
  const source = createCaptureSource({
    id: dto.source.id,
    kind: dto.source.kind,
    name: dto.source.name,
    dimensions: dto.source.dimensions ?? undefined,
    scaleFactor: dto.source.scaleFactor ?? undefined,
    isAvailable: dto.source.isAvailable,
  });
  const region =
    dto.region === null
      ? undefined
      : createCaptureRegion(dto.region.x, dto.region.y, dto.region.width, dto.region.height);

  return createRecordingRequest({
    source,
    region,
    profileId: dto.profileId,
    resolution: dto.resolution,
    frameRate: dto.frameRate,
    audio: {
      systemAudio: dto.audio.systemAudio,
      microphone: dto.audio.microphone,
      microphoneDeviceId: dto.audio.microphoneDeviceId ?? undefined,
    },
    showsCursor: dto.showsCursor,
    showsMouseClicks: dto.showsMouseClicks,
  });
}

export function toRecordingEditPlanInput(dto: RecordingEditRequestDto): RecordingEditPlanInput {
  return {
    recordingId: dto.recordingId,
    title: dto.title,
    trimStartMs: dto.trimStartMs,
    trimEndMs: dto.trimEndMs,
    crop: { ...dto.crop },
    rotation: dto.rotation,
    mutedRanges: dto.mutedRanges.map((range) => ({ ...range })),
    posterTimeMs: dto.posterTimeMs,
  };
}

export function toRecordingRequestDto(request: RecordingRequest): RecordingRequestDto {
  return {
    source: toCaptureSourceDto(request.source),
    region: request.region ?? null,
    profileId: request.profileId,
    resolution: request.resolution,
    frameRate: request.frameRate,
    audio: {
      systemAudio: request.audio.systemAudio,
      microphone: request.audio.microphone,
      microphoneDeviceId: request.audio.microphoneDeviceId ?? null,
    },
    showsCursor: request.showsCursor,
    showsMouseClicks: request.showsMouseClicks,
  };
}

export function toValidatedRecordingRequestDto(validation: ValidatedRecordingRequest): {
  readonly requested: RecordingRequestDto;
  readonly effective: RecordingRequestDto;
  readonly outputDimensions: { readonly width: number; readonly height: number };
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
} {
  return {
    requested: toRecordingRequestDto(validation.requested),
    effective: toRecordingRequestDto(validation.effective),
    outputDimensions: validation.outputDimensions,
    warnings: validation.warnings,
  };
}

export function toRecordingArtifactDto(artifact: {
  readonly id: string;
  readonly filePath: string;
  readonly title: string;
  readonly createdAt: number;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: 30 | 60;
  readonly profileId: 'compatible' | 'balanced' | 'master';
  readonly codec: 'h264' | 'hevc' | 'prores422';
  readonly hasSystemAudio: boolean;
  readonly hasMicrophone: boolean;
  readonly fileSizeBytes: number;
}): RecordingArtifactDto {
  return { ...artifact };
}

export function toRecordingMetadataDto(recording: {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly filePath: string;
  readonly title: string;
  readonly createdAt: number;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: 30 | 60;
  readonly profileId: 'compatible' | 'balanced' | 'master';
  readonly codec: 'h264' | 'hevc' | 'prores422';
  readonly hasSystemAudio: boolean;
  readonly hasMicrophone: boolean;
  readonly fileSizeBytes: number;
  readonly availability: 'available' | 'missing';
  readonly failure:
    | { readonly reason: string; readonly occurredAt: number; readonly recoverable: boolean }
    | undefined;
  readonly recovery:
    { readonly recoveredAt: number; readonly originalFilePath: string } | undefined;
}): RecordingMetadataDto {
  return {
    ...recording,
    failure: recording.failure ?? null,
    recovery: recording.recovery ?? null,
  };
}

export function toRecordingSessionSnapshotDto(snapshot: {
  readonly id: string;
  readonly state: RecordingSessionSnapshotDto['state'];
  readonly createdAt: number;
  readonly startedAt: number | undefined;
  readonly pausedAt: number | undefined;
  readonly pausedDurationMs: number;
  readonly stoppedAt: number | undefined;
  readonly completedAt: number | undefined;
  readonly engineHandleId: string | undefined;
  readonly artifact: Parameters<typeof createRecordingArtifact>[0] | undefined;
  readonly failureReason: string | undefined;
  readonly statistics: RecordingSessionSnapshotDto['statistics'];
}): RecordingSessionSnapshotDto {
  return {
    id: snapshot.id,
    state: snapshot.state,
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt ?? null,
    pausedAt: snapshot.pausedAt ?? null,
    pausedDurationMs: snapshot.pausedDurationMs,
    stoppedAt: snapshot.stoppedAt ?? null,
    completedAt: snapshot.completedAt ?? null,
    engineHandleId: snapshot.engineHandleId ?? null,
    artifact: snapshot.artifact === undefined ? null : toRecordingArtifactDto(snapshot.artifact),
    failureReason: snapshot.failureReason ?? null,
    statistics: snapshot.statistics,
  };
}

export function toPreferencesDto(preferences: AppPreferences): AppPreferencesDto {
  return { ...preferences, shortcuts: { ...preferences.shortcuts } };
}

export function toPreferencesPatch(dto: AppPreferencesPatchDto): AppPreferencesPatch {
  return dto;
}

export function toIpcEvent(event: ApplicationEvent, eventId: string): IpcEvent {
  const base = { protocolVersion, eventId, version: event.version };

  if ('sessionId' in event) {
    return { ...base, ...event, sessionId: event.sessionId ?? null } as IpcEvent;
  }

  return { ...base, ...event } as IpcEvent;
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (error instanceof IpcProtocolError) {
    return {
      code: error.code === 'IPC_PROTOCOL_ERROR' ? 'INVALID_IPC_REQUEST' : error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected application error occurred.',
  };
}
