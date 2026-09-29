import {
  createCaptureSource,
  createPixelDimensions,
  DomainError,
  isRecordingProfileId,
  type CapturePermissions,
  type CaptureSource,
} from '@screen-recorder/domain';

import { NativeServiceClientError } from './capture-service-client';

export interface NativeSourceDto {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly scaleFactor: number | null;
  readonly isAvailable: boolean;
}

export interface NativePermissionsDto {
  readonly screenRecording: string;
  readonly microphone: string;
}

export interface NativeCapabilitiesDto {
  readonly maxOutputWidth: number;
  readonly maxOutputHeight: number;
  readonly supportedProfileIds: readonly string[];
  readonly supportedFrameRates: readonly number[];
  readonly supportsSystemAudio: boolean;
  readonly supportsMicrophone: boolean;
  readonly supportsHDR: boolean;
  readonly hardwareEncoderProfileIds?: readonly string[];
}

export interface NativeRecordingStartDto {
  readonly profileId: string;
  readonly codec: string;
  readonly container: string;
  readonly hardwareEncoder: boolean;
  readonly partialOutputPath: string;
}

export interface NativeRecordingResultDto {
  readonly status: string;
  readonly filePath: string;
  readonly profileId: string;
  readonly codec: string;
  readonly container: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationMs: number;
  readonly pausedDurationMs: number;
  readonly fileSizeBytes: number;
  readonly hasSystemAudio: boolean;
  readonly hasMicrophone: boolean;
  readonly hardwareEncoder: boolean;
}

export interface NativeHealthDto {
  readonly state: string;
  readonly lastHeartbeatAt: number;
  readonly droppedFrames: number;
  readonly lateSamples: number;
  readonly pendingVideoSamples: number;
  readonly pendingAudioSamples: number;
  readonly encodedFrames: number;
  readonly processedSampleBytes: number;
  readonly pausedDurationMs: number;
  readonly writerError: string | null;
  readonly partialOutputPath: string | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new DomainError('NATIVE_SERVICE_FAILURE', `Native ${label} response was not an object.`);
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new DomainError('NATIVE_SERVICE_FAILURE', `Native response field ${label} was invalid.`);
  }

  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DomainError('NATIVE_SERVICE_FAILURE', `Native response field ${label} was invalid.`);
  }

  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('NATIVE_SERVICE_FAILURE', `Native response field ${label} was invalid.`);
  }

  return value;
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  // Swift Codable omits nil optional properties by default, while some native versions emit null.
  // Treat both representations as the same absent metadata value at this boundary.
  return value === null || value === undefined ? null : finiteNumber(value, label);
}

export function parseNativeSources(value: unknown): readonly NativeSourceDto[] {
  if (!Array.isArray(value)) {
    throw new DomainError('NATIVE_SERVICE_FAILURE', 'Native source response was not an array.');
  }

  return value.map((item) => {
    const source = record(item, 'source');
    return {
      id: stringValue(source.id, 'source.id'),
      kind: stringValue(source.kind, 'source.kind'),
      name: stringValue(source.name, 'source.name'),
      width: nullableFiniteNumber(source.width, 'source.width'),
      height: nullableFiniteNumber(source.height, 'source.height'),
      scaleFactor: nullableFiniteNumber(source.scaleFactor, 'source.scaleFactor'),
      isAvailable: booleanValue(source.isAvailable, 'source.isAvailable'),
    };
  });
}

export function mapNativeSource(source: NativeSourceDto): CaptureSource {
  const dimensions =
    source.width !== null && source.height !== null
      ? createPixelDimensions(source.width, source.height)
      : undefined;

  if (!['display', 'window', 'application', 'region'].includes(source.kind)) {
    throw new DomainError(
      'INVALID_CAPTURE_SOURCE',
      `Unsupported native source kind: ${source.kind}.`,
    );
  }

  return createCaptureSource({
    id: source.id,
    kind: source.kind as CaptureSource['kind'],
    name: source.name,
    dimensions,
    scaleFactor: source.scaleFactor ?? undefined,
    isAvailable: source.isAvailable,
  });
}

export function parseNativePermissions(value: unknown): CapturePermissions {
  const permissions = record(value, 'permission');
  const screenRecording = stringValue(permissions.screenRecording, 'screenRecording');
  const microphone = stringValue(permissions.microphone, 'microphone');

  if (
    !['not-determined', 'granted', 'denied', 'restricted'].includes(screenRecording) ||
    !['not-determined', 'granted', 'denied', 'restricted'].includes(microphone)
  ) {
    throw new DomainError(
      'NATIVE_SERVICE_FAILURE',
      'Native permission response contained an unknown state.',
    );
  }

  return {
    screenRecording: screenRecording as CapturePermissions['screenRecording'],
    microphone: microphone as CapturePermissions['microphone'],
  };
}

export function parseNativeCapabilities(value: unknown): NativeCapabilitiesDto {
  const capabilities = record(value, 'capability');
  const supportedProfileIds = capabilities.supportedProfileIds;
  const supportedFrameRates = capabilities.supportedFrameRates;

  if (!Array.isArray(supportedProfileIds) || !Array.isArray(supportedFrameRates)) {
    throw new DomainError('NATIVE_SERVICE_FAILURE', 'Native capability lists were invalid.');
  }

  return {
    maxOutputWidth: finiteNumber(capabilities.maxOutputWidth, 'maxOutputWidth'),
    maxOutputHeight: finiteNumber(capabilities.maxOutputHeight, 'maxOutputHeight'),
    supportedProfileIds: supportedProfileIds.map((profileId) =>
      stringValue(profileId, 'profileId'),
    ),
    supportedFrameRates: supportedFrameRates.map((frameRate) =>
      finiteNumber(frameRate, 'frameRate'),
    ),
    supportsSystemAudio: booleanValue(capabilities.supportsSystemAudio, 'supportsSystemAudio'),
    supportsMicrophone: booleanValue(capabilities.supportsMicrophone, 'supportsMicrophone'),
    supportsHDR: booleanValue(capabilities.supportsHDR, 'supportsHDR'),
    hardwareEncoderProfileIds:
      capabilities.hardwareEncoderProfileIds === undefined
        ? undefined
        : Array.isArray(capabilities.hardwareEncoderProfileIds)
          ? capabilities.hardwareEncoderProfileIds.map((profileId) =>
              stringValue(profileId, 'hardwareEncoderProfileId'),
            )
          : undefined,
  };
}

export function parseNativeRecordingStart(value: unknown): NativeRecordingStartDto {
  const start = record(value, 'recording start');
  return {
    profileId: stringValue(start.profileId, 'profileId'),
    codec: stringValue(start.codec, 'codec'),
    container: stringValue(start.container, 'container'),
    hardwareEncoder: booleanValue(start.hardwareEncoder, 'hardwareEncoder'),
    partialOutputPath: stringValue(start.partialOutputPath, 'partialOutputPath'),
  };
}

export function parseNativeRecordingResult(value: unknown): NativeRecordingResultDto {
  const result = record(value, 'recording result');
  return {
    status: stringValue(result.status, 'status'),
    filePath: stringValue(result.filePath, 'filePath'),
    profileId: stringValue(result.profileId, 'profileId'),
    codec: stringValue(result.codec, 'codec'),
    container: stringValue(result.container, 'container'),
    width: finiteNumber(result.width, 'width'),
    height: finiteNumber(result.height, 'height'),
    frameRate: finiteNumber(result.frameRate, 'frameRate'),
    durationMs: finiteNumber(result.durationMs, 'durationMs'),
    pausedDurationMs: finiteNumber(result.pausedDurationMs, 'pausedDurationMs'),
    fileSizeBytes: finiteNumber(result.fileSizeBytes, 'fileSizeBytes'),
    hasSystemAudio: booleanValue(result.hasSystemAudio, 'hasSystemAudio'),
    hasMicrophone: booleanValue(result.hasMicrophone, 'hasMicrophone'),
    hardwareEncoder: booleanValue(result.hardwareEncoder, 'hardwareEncoder'),
  };
}

export function parseNativeHealth(value: unknown): NativeHealthDto {
  const health = record(value, 'health');
  return {
    state: stringValue(health.state, 'state'),
    lastHeartbeatAt: finiteNumber(health.lastHeartbeatAt, 'lastHeartbeatAt'),
    droppedFrames: finiteNumber(health.droppedFrames, 'droppedFrames'),
    lateSamples: finiteNumber(health.lateSamples, 'lateSamples'),
    pendingVideoSamples: finiteNumber(health.pendingVideoSamples, 'pendingVideoSamples'),
    pendingAudioSamples: finiteNumber(health.pendingAudioSamples, 'pendingAudioSamples'),
    encodedFrames: finiteNumber(health.encodedFrames, 'encodedFrames'),
    processedSampleBytes: finiteNumber(health.processedSampleBytes, 'processedSampleBytes'),
    pausedDurationMs: finiteNumber(health.pausedDurationMs, 'pausedDurationMs'),
    writerError:
      health.writerError === null ? null : stringValue(health.writerError, 'writerError'),
    partialOutputPath:
      health.partialOutputPath === null
        ? null
        : stringValue(health.partialOutputPath, 'partialOutputPath'),
  };
}

export function toNativeDomainError(error: unknown): DomainError {
  if (error instanceof DomainError) {
    return error;
  }

  if (!(error instanceof NativeServiceClientError)) {
    return new DomainError(
      'NATIVE_SERVICE_FAILURE',
      error instanceof Error ? error.message : 'The native capture service failed.',
    );
  }

  switch (error.code) {
    case 'PERMISSION_DENIED':
      return new DomainError(
        error.message.toLowerCase().includes('microphone')
          ? 'UNSUPPORTED_AUDIO'
          : 'SCREEN_RECORDING_PERMISSION_REQUIRED',
        error.message,
        error.details,
      );
    case 'SOURCE_UNAVAILABLE':
      return new DomainError('INVALID_CAPTURE_SOURCE', error.message, error.details);
    case 'INVALID_CONFIGURATION':
      return new DomainError('INVALID_VALUE', error.message, error.details);
    case 'ENCODING_UNAVAILABLE':
      return new DomainError('UNSUPPORTED_CODEC', error.message, error.details);
    case 'FILE_FINALIZATION_FAILED':
      return new DomainError('RECORDING_FINALIZATION_FAILURE', error.message, error.details);
    case 'RECORDING_INTERRUPTED':
      return new DomainError('RECOVERY_REQUIRED', error.message, error.details);
    case 'HELPER_FAILURE':
      return new DomainError('HELPER_FAILURE', error.message, error.details);
    default:
      return new DomainError('NATIVE_SERVICE_FAILURE', error.message, {
        nativeCode: error.code,
        ...error.details,
      });
  }
}

export function toCaptureCapabilities(value: NativeCapabilitiesDto) {
  const supportedProfileIds = value.supportedProfileIds.filter(isRecordingProfileId);
  const supportedFrameRates = value.supportedFrameRates.filter(
    (frameRate): frameRate is 30 | 60 => frameRate === 30 || frameRate === 60,
  );

  return {
    maxOutputDimensions: createPixelDimensions(value.maxOutputWidth, value.maxOutputHeight),
    supportedProfileIds,
    supportedFrameRates,
    supportsSystemAudio: value.supportsSystemAudio,
    supportsMicrophone: value.supportsMicrophone,
  };
}
