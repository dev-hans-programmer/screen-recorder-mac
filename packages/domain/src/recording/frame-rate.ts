import { DomainError } from '../errors/domain-error';

export type FrameRate = 30 | 60;

export function createFrameRate(value: number): FrameRate {
  if (value !== 30 && value !== 60) {
    throw new DomainError('INVALID_VALUE', 'Frame rate must be either 30 or 60 FPS.', { value });
  }

  return value;
}
