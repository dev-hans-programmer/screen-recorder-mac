import { describe, expect, it, vi } from 'vitest';

import { createLifecycleManager } from '../src/main/infrastructure/lifecycle-manager';

describe('main-process lifecycle manager', () => {
  it('runs cleanup once even when shutdown is requested concurrently', async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const manager = createLifecycleManager(dispose);

    await Promise.all([manager.shutdown(), manager.shutdown()]);

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
