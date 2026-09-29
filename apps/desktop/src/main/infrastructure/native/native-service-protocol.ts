export const nativeProtocolVersion = 1 as const;

export type NativeCommand =
  | 'hello'
  | 'getCapabilities'
  | 'listSources'
  | 'getPermissions'
  | 'requestPermissions'
  | 'configureCapture'
  | 'startCapture'
  | 'pauseCapture'
  | 'resumeCapture'
  | 'stopCapture'
  | 'getHealth'
  | 'heartbeat'
  | 'shutdown';

export interface NativeRequest {
  readonly protocolVersion: typeof nativeProtocolVersion;
  readonly requestId: string;
  readonly command: NativeCommand;
  readonly payload: unknown;
}

export interface NativeErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface NativeSuccessResponse {
  readonly protocolVersion: typeof nativeProtocolVersion;
  readonly serviceVersion: string;
  readonly requestId: string;
  readonly command: NativeCommand;
  readonly ok: true;
  readonly data: unknown;
}

export interface NativeFailureResponse {
  readonly protocolVersion: typeof nativeProtocolVersion;
  readonly serviceVersion: string;
  readonly requestId: string;
  readonly command: NativeCommand | string;
  readonly ok: false;
  readonly error: NativeErrorEnvelope;
}

export type NativeResponse = NativeSuccessResponse | NativeFailureResponse;

export interface NativeEvent {
  readonly protocolVersion: typeof nativeProtocolVersion;
  readonly serviceVersion: string;
  readonly eventId: string;
  readonly type: string;
  readonly data: unknown;
}

export class NativeProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NativeProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NativeProtocolError(`Native protocol field ${label} must be a non-empty string.`);
  }

  return value;
}

export function parseNativeLine(line: string): NativeResponse | NativeEvent {
  let value: unknown;

  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new NativeProtocolError('Native service emitted invalid JSON.');
  }

  if (!isRecord(value)) {
    throw new NativeProtocolError('Native service emitted a non-object message.');
  }

  if (value.protocolVersion !== nativeProtocolVersion) {
    throw new NativeProtocolError('Native service emitted an unsupported protocol version.');
  }

  const serviceVersion = requireString(value.serviceVersion, 'serviceVersion');

  if ('eventId' in value) {
    return {
      protocolVersion: nativeProtocolVersion,
      serviceVersion,
      eventId: requireString(value.eventId, 'eventId'),
      type: requireString(value.type, 'type'),
      data: value.data,
    };
  }

  const requestId = requireString(value.requestId, 'requestId');
  const command = requireString(value.command, 'command');

  if (value.ok === true) {
    return {
      protocolVersion: nativeProtocolVersion,
      serviceVersion,
      requestId,
      command: command as NativeCommand,
      ok: true,
      data: value.data,
    };
  }

  if (value.ok === false && isRecord(value.error)) {
    return {
      protocolVersion: nativeProtocolVersion,
      serviceVersion,
      requestId,
      command,
      ok: false,
      error: {
        code: requireString(value.error.code, 'error.code'),
        message: requireString(value.error.message, 'error.message'),
        ...(value.error.details === undefined
          ? {}
          : { details: value.error.details as Readonly<Record<string, unknown>> }),
      },
    };
  }

  throw new NativeProtocolError('Native service emitted an invalid response envelope.');
}

export function isNativeEvent(value: NativeResponse | NativeEvent): value is NativeEvent {
  return 'eventId' in value;
}
