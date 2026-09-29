export interface LifecycleManager {
  shutdown(): Promise<void>;
}

export function createLifecycleManager(dispose: () => Promise<void>): LifecycleManager {
  let shutdownPromise: Promise<void> | undefined;

  return {
    shutdown: () => {
      shutdownPromise ??= dispose();
      return shutdownPromise;
    },
  };
}
