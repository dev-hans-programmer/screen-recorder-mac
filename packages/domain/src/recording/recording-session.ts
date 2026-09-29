import type { RecordingArtifact } from '../library/recording-artifact';
import { DomainError } from '../errors/domain-error';
import {
  createRecordingStatistics,
  emptyRecordingStatistics,
  type RecordingStatistics,
} from './recording-statistics';

export type RecordingSessionState =
  'idle' | 'preparing' | 'capturing' | 'paused' | 'stopping' | 'completed' | 'failed';

export interface RecordingSessionSnapshot {
  readonly id: string;
  readonly state: RecordingSessionState;
  readonly createdAt: number;
  readonly startedAt: number | undefined;
  readonly pausedAt: number | undefined;
  readonly pausedDurationMs: number;
  readonly stoppedAt: number | undefined;
  readonly completedAt: number | undefined;
  readonly engineHandleId: string | undefined;
  readonly artifact: RecordingArtifact | undefined;
  readonly failureReason: string | undefined;
  readonly statistics: RecordingStatistics;
}

export class RecordingSession {
  private snapshot: RecordingSessionSnapshot;

  private constructor(snapshot: RecordingSessionSnapshot) {
    this.snapshot = snapshot;
  }

  public static create(id: string, createdAt: number): RecordingSession {
    if (id.trim().length === 0 || !Number.isFinite(createdAt)) {
      throw new DomainError('INVALID_VALUE', 'A recording session requires a valid id and time.');
    }

    return new RecordingSession({
      id,
      state: 'idle',
      createdAt,
      startedAt: undefined,
      pausedAt: undefined,
      pausedDurationMs: 0,
      stoppedAt: undefined,
      completedAt: undefined,
      engineHandleId: undefined,
      artifact: undefined,
      failureReason: undefined,
      statistics: emptyRecordingStatistics,
    });
  }

  public static restore(snapshot: RecordingSessionSnapshot): RecordingSession {
    return new RecordingSession({ ...snapshot });
  }

  public get id(): string {
    return this.snapshot.id;
  }

  public get state(): RecordingSessionState {
    return this.snapshot.state;
  }

  public toSnapshot(): RecordingSessionSnapshot {
    return { ...this.snapshot };
  }

  public prepare(at: number): void {
    this.transition('preparing', ['idle'], at);
  }

  public start(at: number, engineHandleId: string): void {
    if (engineHandleId.trim().length === 0) {
      throw new DomainError('INVALID_VALUE', 'A recording engine handle id cannot be empty.');
    }

    this.transition('capturing', ['preparing'], at, {
      startedAt: at,
      engineHandleId,
    });
  }

  public pause(at: number): void {
    this.transition('paused', ['capturing'], at, { pausedAt: at });
  }

  public resume(at: number): void {
    if (this.snapshot.state !== 'paused' || this.snapshot.pausedAt === undefined) {
      throw new DomainError(
        'INVALID_RECORDING_STATE',
        `Cannot resume a recording in the ${this.snapshot.state} state.`,
      );
    }

    this.transition('capturing', ['paused'], at, {
      pausedAt: undefined,
      pausedDurationMs: this.snapshot.pausedDurationMs + Math.max(0, at - this.snapshot.pausedAt),
    });
  }

  public stop(at: number): void {
    const pausedDurationMs =
      this.snapshot.state === 'paused' && this.snapshot.pausedAt !== undefined
        ? this.snapshot.pausedDurationMs + Math.max(0, at - this.snapshot.pausedAt)
        : this.snapshot.pausedDurationMs;

    this.transition('stopping', ['capturing', 'paused'], at, {
      pausedAt: undefined,
      pausedDurationMs,
      stoppedAt: at,
    });
  }

  public complete(at: number, artifact: RecordingArtifact): void {
    this.transition('completed', ['stopping'], at, {
      completedAt: at,
      artifact,
    });
  }

  public fail(at: number, reason: string): void {
    if (this.snapshot.state === 'completed' || this.snapshot.state === 'failed') {
      throw new DomainError(
        'INVALID_RECORDING_STATE',
        `Cannot fail a recording in the ${this.snapshot.state} state.`,
      );
    }

    this.transition('failed', [this.snapshot.state], at, {
      failureReason: reason,
    });
  }

  public updateStatistics(statistics: RecordingStatistics): void {
    if (!['capturing', 'paused', 'stopping'].includes(this.snapshot.state)) {
      throw new DomainError(
        'INVALID_RECORDING_STATE',
        `Cannot update statistics for a recording in the ${this.snapshot.state} state.`,
      );
    }

    this.snapshot = {
      ...this.snapshot,
      statistics: createRecordingStatistics(statistics),
    };
  }

  private transition(
    nextState: RecordingSessionState,
    allowedStates: readonly RecordingSessionState[],
    at: number,
    changes: Partial<RecordingSessionSnapshot> = {},
  ): void {
    if (!Number.isFinite(at)) {
      throw new DomainError('INVALID_VALUE', 'Recording session timestamps must be finite.');
    }

    if (!allowedStates.includes(this.snapshot.state)) {
      throw new DomainError(
        'INVALID_RECORDING_STATE',
        `Cannot transition a recording from ${this.snapshot.state} to ${nextState}.`,
      );
    }

    this.snapshot = {
      ...this.snapshot,
      ...changes,
      state: nextState,
    };
  }
}
