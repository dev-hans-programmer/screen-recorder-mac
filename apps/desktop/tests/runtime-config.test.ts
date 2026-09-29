import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../src/main/infrastructure/runtime-config';

describe('runtime configuration', () => {
  it('uses safe defaults when optional environment variables are absent', () => {
    expect(loadRuntimeConfig({})).toEqual({
      logLevel: 'info',
      openDevTools: false,
    });
  });

  it('accepts supported development overrides', () => {
    expect(
      loadRuntimeConfig({
        SCREEN_RECORDER_LOG_LEVEL: 'debug',
        SCREEN_RECORDER_DEVTOOLS: '1',
      }),
    ).toEqual({
      logLevel: 'debug',
      openDevTools: true,
    });
  });

  it('falls back when a log level is invalid', () => {
    expect(loadRuntimeConfig({ SCREEN_RECORDER_LOG_LEVEL: 'trace' })).toEqual({
      logLevel: 'info',
      openDevTools: false,
    });
  });
});
