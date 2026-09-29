import { z } from 'zod';

export const protocolVersion = 1 as const;

export const ipcChannels = Object.freeze({
  command: 'screen-recorder:command',
  event: 'screen-recorder:event',
  regionSelection: 'screen-recorder:region-selection',
  shortcut: 'screen-recorder:shortcut',
});

const identifierSchema = z.string().min(1).max(128);
const protocolVersionSchema = z.literal(protocolVersion);

const pixelDimensionsSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const captureRegionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(2),
    height: z.number().finite().min(2),
  })
  .strict();

const captureSourceSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['display', 'window', 'application', 'region']),
    name: z.string().min(1),
    dimensions: pixelDimensionsSchema.nullable(),
    scaleFactor: z.number().positive().nullable(),
    isAvailable: z.boolean(),
  })
  .strict();

const capturePermissionsSchema = z
  .object({
    screenRecording: z.enum(['not-determined', 'granted', 'denied', 'restricted']),
    microphone: z.enum(['not-determined', 'granted', 'denied', 'restricted']),
  })
  .strict();

const audioCaptureRequestSchema = z
  .object({
    systemAudio: z.boolean(),
    microphone: z.boolean(),
    microphoneDeviceId: z.string().min(1).nullable(),
  })
  .strict();

const recordingRequestSchema = z
  .object({
    source: captureSourceSchema,
    region: captureRegionSchema.nullable(),
    profileId: z.enum(['compatible', 'balanced', 'master']),
    resolution: z.enum(['source', '1080p', '4k']),
    frameRate: z.union([z.literal(30), z.literal(60)]),
    audio: audioCaptureRequestSchema,
    showsCursor: z.boolean(),
    showsMouseClicks: z.boolean(),
  })
  .strict();

const recordingValidationWarningSchema = z
  .object({
    code: z.enum([
      'PROFILE_FALLBACK',
      'FRAME_RATE_FALLBACK',
      'SYSTEM_AUDIO_DISABLED',
      'MICROPHONE_DISABLED',
    ]),
    message: z.string().min(1),
  })
  .strict();

const validatedRecordingRequestSchema = z
  .object({
    requested: recordingRequestSchema,
    effective: recordingRequestSchema,
    outputDimensions: pixelDimensionsSchema,
    warnings: z.array(recordingValidationWarningSchema),
  })
  .strict();

const recordingStatisticsSchema = z
  .object({
    durationMs: z.number().finite().nonnegative(),
    capturedFrames: z.number().finite().nonnegative(),
    encodedFrames: z.number().finite().nonnegative(),
    droppedFrames: z.number().finite().nonnegative(),
    encodedBytes: z.number().finite().nonnegative(),
  })
  .strict();

const recordingArtifactSchema = z
  .object({
    id: identifierSchema,
    filePath: z.string().min(1),
    title: z.string(),
    createdAt: z.number().finite(),
    durationMs: z.number().finite().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.union([z.literal(30), z.literal(60)]),
    profileId: z.enum(['compatible', 'balanced', 'master']),
    codec: z.enum(['h264', 'hevc', 'prores422']),
    hasSystemAudio: z.boolean(),
    hasMicrophone: z.boolean(),
    fileSizeBytes: z.number().finite().nonnegative(),
  })
  .strict();

const recordingMetadataSchema = recordingArtifactSchema
  .extend({
    schemaVersion: z.literal(1),
    availability: z.enum(['available', 'missing']),
    failure: z
      .object({
        reason: z.string().min(1),
        occurredAt: z.number().finite(),
        recoverable: z.boolean(),
      })
      .strict()
      .nullable(),
    recovery: z
      .object({
        recoveredAt: z.number().finite(),
        originalFilePath: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

const recordingSessionSnapshotSchema = z
  .object({
    id: identifierSchema,
    state: z.enum(['idle', 'preparing', 'capturing', 'paused', 'stopping', 'completed', 'failed']),
    createdAt: z.number().finite(),
    startedAt: z.number().finite().nullable(),
    pausedAt: z.number().finite().nullable(),
    pausedDurationMs: z.number().finite().nonnegative(),
    stoppedAt: z.number().finite().nullable(),
    completedAt: z.number().finite().nullable(),
    engineHandleId: identifierSchema.nullable(),
    artifact: recordingArtifactSchema.nullable(),
    failureReason: z.string().nullable(),
    statistics: recordingStatisticsSchema,
  })
  .strict();

const shortcutPreferencesSchema = z
  .object({
    startStop: z.string().min(1),
    pauseResume: z.string().min(1),
  })
  .strict();

const appPreferencesSchema = z
  .object({
    outputDirectory: z.string(),
    defaultProfileId: z.enum(['compatible', 'balanced', 'master']),
    defaultResolution: z.enum(['source', '1080p', '4k']),
    defaultFrameRate: z.union([z.literal(30), z.literal(60)]),
    systemAudioEnabled: z.boolean(),
    microphoneEnabled: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
    shortcuts: shortcutPreferencesSchema,
  })
  .strict();

const appPreferencesPatchSchema = z
  .object({
    outputDirectory: z.string().optional(),
    defaultProfileId: z.enum(['compatible', 'balanced', 'master']).optional(),
    defaultResolution: z.enum(['source', '1080p', '4k']).optional(),
    defaultFrameRate: z.union([z.literal(30), z.literal(60)]).optional(),
    systemAudioEnabled: z.boolean().optional(),
    microphoneEnabled: z.boolean().optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    shortcuts: shortcutPreferencesSchema.partial().optional(),
  })
  .strict();

const emptyPayloadSchema = z.object({}).strict();
const sessionIdPayloadSchema = z.object({ sessionId: identifierSchema }).strict();
const recordingRequestPayloadSchema = z.object({ request: recordingRequestSchema }).strict();
const selectRegionPayloadSchema = z.object({ displayId: identifierSchema }).strict();
const recordingIdPayloadSchema = z.object({ recordingId: identifierSchema }).strict();
const recordingTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !/[/:\0]/u.test(value), 'Recording names cannot contain “/” or “:”.');

export const shortcutMessageSchema = z
  .object({
    action: z.enum(['toggle-start-stop', 'toggle-pause-resume']),
  })
  .strict();

export const regionSelectionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('selected'), region: captureRegionSchema }).strict(),
  z.object({ type: z.literal('cancelled') }).strict(),
]);

const requestSchema = <C extends string, T extends z.ZodType>(command: C, payload: T) =>
  z
    .object({
      protocolVersion: protocolVersionSchema,
      requestId: identifierSchema,
      command: z.literal(command),
      payload,
    })
    .strict();

export const ipcRequestSchema = z.discriminatedUnion('command', [
  requestSchema('capture.list-sources', emptyPayloadSchema),
  requestSchema('capture.get-permissions', emptyPayloadSchema),
  requestSchema('capture.request-permissions', z.object({ microphone: z.boolean() }).strict()),
  requestSchema('capture.select-region', selectRegionPayloadSchema),
  requestSchema('recording.validate-request', recordingRequestPayloadSchema),
  requestSchema('recording.start', recordingRequestPayloadSchema),
  requestSchema('recording.pause', sessionIdPayloadSchema),
  requestSchema('recording.resume', sessionIdPayloadSchema),
  requestSchema('recording.stop', sessionIdPayloadSchema),
  requestSchema('library.list', emptyPayloadSchema),
  requestSchema('library.thumbnail', recordingIdPayloadSchema),
  requestSchema(
    'library.rename',
    z.object({ recordingId: identifierSchema, title: recordingTitleSchema }).strict(),
  ),
  requestSchema('library.open', recordingIdPayloadSchema),
  requestSchema('library.reveal', recordingIdPayloadSchema),
  requestSchema('library.delete', recordingIdPayloadSchema),
  requestSchema('library.open-folder', emptyPayloadSchema),
  requestSchema('preferences.get', emptyPayloadSchema),
  requestSchema('preferences.update', z.object({ patch: appPreferencesPatchSchema }).strict()),
]);

export type IpcRequest = z.infer<typeof ipcRequestSchema>;
export type IpcCommandName = IpcRequest['command'];

export const ipcErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const responseDataSchemas = {
  'capture.list-sources': z.array(captureSourceSchema),
  'capture.get-permissions': capturePermissionsSchema,
  'capture.request-permissions': capturePermissionsSchema,
  'capture.select-region': captureRegionSchema.nullable(),
  'recording.validate-request': validatedRecordingRequestSchema,
  'recording.start': z
    .object({
      session: recordingSessionSnapshotSchema,
      validation: validatedRecordingRequestSchema,
    })
    .strict(),
  'recording.pause': z.null(),
  'recording.resume': z.null(),
  'recording.stop': recordingArtifactSchema,
  'library.list': z.array(recordingMetadataSchema),
  'library.thumbnail': z.string().startsWith('data:image/').nullable(),
  'library.rename': recordingMetadataSchema,
  'library.open': z.null(),
  'library.reveal': z.null(),
  'library.delete': z.null(),
  'library.open-folder': z.null(),
  'preferences.get': appPreferencesSchema,
  'preferences.update': appPreferencesSchema,
} as const;

export const ipcResponseEnvelopeSchema = z.discriminatedUnion('ok', [
  z
    .object({
      protocolVersion: protocolVersionSchema,
      requestId: identifierSchema,
      command: z.string().min(1),
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      requestId: identifierSchema,
      command: z.string().min(1),
      ok: z.literal(false),
      error: ipcErrorSchema,
    })
    .strict(),
]);

export type IpcError = z.infer<typeof ipcErrorSchema>;
export type IpcResponseEnvelope = z.infer<typeof ipcResponseEnvelopeSchema>;

export const ipcEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.state-changed'),
      sessionId: identifierSchema,
      state: recordingSessionSnapshotSchema.shape.state,
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.completed'),
      sessionId: identifierSchema,
      artifact: recordingArtifactSchema,
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.failed'),
      sessionId: identifierSchema,
      reason: z.string().min(1),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.warning'),
      sessionId: identifierSchema.nullable(),
      code: z.string().min(1),
      message: z.string().min(1),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.progress'),
      sessionId: identifierSchema,
      durationMs: z.number().finite().nonnegative(),
      encodedBytes: z.number().finite().nonnegative(),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.dropped-frames'),
      sessionId: identifierSchema,
      droppedFrames: z.number().finite().nonnegative(),
      totalFrames: z.number().finite().nonnegative(),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('recording.disk-space-warning'),
      sessionId: identifierSchema.nullable(),
      availableBytes: z.number().finite().nonnegative(),
      estimatedRequiredBytes: z.number().finite().nonnegative(),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('permissions.changed'),
      screenRecording: z.string().min(1),
      microphone: z.string().min(1),
      occurredAt: z.number().finite(),
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      eventId: identifierSchema,
      version: z.literal(1),
      type: z.literal('native-service.failed'),
      sessionId: identifierSchema.nullable(),
      operation: z.string().min(1),
      message: z.string().min(1),
      occurredAt: z.number().finite(),
    })
    .strict(),
]);

export type IpcEvent = z.infer<typeof ipcEventSchema>;

export class IpcProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'IpcProtocolError';
  }
}

export function parseIpcRequest(value: unknown): IpcRequest {
  const result = ipcRequestSchema.safeParse(value);

  if (!result.success) {
    throw new IpcProtocolError(`Invalid IPC request: ${result.error.message}`);
  }

  return result.data;
}

export function parseIpcResponse<C extends IpcCommandName>(
  command: C,
  value: unknown,
): IpcResponse<C> {
  const envelope = ipcResponseEnvelopeSchema.safeParse(value);

  if (!envelope.success || envelope.data.command !== command) {
    throw new IpcProtocolError('Invalid IPC response envelope.');
  }

  if (!envelope.data.ok) {
    throw new IpcProtocolError(envelope.data.error.message);
  }

  const data = responseDataSchemas[command as keyof typeof responseDataSchemas].safeParse(
    envelope.data.data,
  );

  if (!data.success) {
    throw new IpcProtocolError(`Invalid IPC response data: ${data.error.message}`);
  }

  return {
    ...envelope.data,
    data: data.data,
  } as IpcResponse<C>;
}

export type IpcResponse<C extends IpcCommandName> = Extract<IpcResponseByCommand, { command: C }>;

type IpcResponseByCommand = {
  [C in IpcCommandName]: {
    readonly protocolVersion: typeof protocolVersion;
    readonly requestId: string;
    readonly command: C;
    readonly ok: true;
    readonly data: z.infer<(typeof responseDataSchemas)[C & keyof typeof responseDataSchemas]>;
  };
}[IpcCommandName];

export function parseIpcEvent(value: unknown): IpcEvent {
  const result = ipcEventSchema.safeParse(value);

  if (!result.success) {
    throw new IpcProtocolError(`Invalid IPC event: ${result.error.message}`);
  }

  return result.data;
}

export type CaptureSourceDto = z.infer<typeof captureSourceSchema>;
export type CaptureRegionDto = z.infer<typeof captureRegionSchema>;
export type CapturePermissionsDto = z.infer<typeof capturePermissionsSchema>;
export type RecordingRequestDto = z.infer<typeof recordingRequestSchema>;
export type AppPreferencesDto = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatchDto = z.infer<typeof appPreferencesPatchSchema>;
export type RecordingArtifactDto = z.infer<typeof recordingArtifactSchema>;
export type RecordingMetadataDto = z.infer<typeof recordingMetadataSchema>;
export type RecordingSessionSnapshotDto = z.infer<typeof recordingSessionSnapshotSchema>;
export type ShortcutAction = z.infer<typeof shortcutMessageSchema>['action'];
