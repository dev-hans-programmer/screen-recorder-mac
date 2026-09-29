export type RuntimeLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface RuntimeConfig {
  readonly logLevel: RuntimeLogLevel;
  readonly openDevTools: boolean;
}

const supportedLogLevels: readonly RuntimeLogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];

function isRuntimeLogLevel(value: string | undefined): value is RuntimeLogLevel {
  return value !== undefined && supportedLogLevels.includes(value as RuntimeLogLevel);
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const requestedLogLevel = environment.SCREEN_RECORDER_LOG_LEVEL;

  return {
    logLevel: isRuntimeLogLevel(requestedLogLevel) ? requestedLogLevel : 'info',
    openDevTools: environment.SCREEN_RECORDER_DEVTOOLS === '1',
  };
}
