import { DomainError } from '../errors/domain-error';

/** Milliseconds are used at the domain boundary so native timestamps can be normalized once. */
export type DurationMs = number & { readonly __brand: 'DurationMs' };

export function createDurationMs(value: number): DurationMs {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainError('INVALID_VALUE', 'Duration must be a finite, non-negative number.', {
      value,
    });
  }

  return value as DurationMs;
}
