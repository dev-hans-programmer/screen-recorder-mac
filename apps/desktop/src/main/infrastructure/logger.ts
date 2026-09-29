import type { Logger } from '@screen-recorder/application';

export function createConsoleLogger(): Logger {
  return {
    debug: (message, context) => console.debug(`[screen-recorder] ${message}`, context ?? ''),
    info: (message, context) => console.info(`[screen-recorder] ${message}`, context ?? ''),
    warn: (message, context) => console.warn(`[screen-recorder] ${message}`, context ?? ''),
    error: (message, context) => console.error(`[screen-recorder] ${message}`, context ?? ''),
  };
}
