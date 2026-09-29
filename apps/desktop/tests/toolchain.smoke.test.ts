import { describe, expect, it } from 'vitest';

import { appMetadata } from '../src/shared/app-metadata';

describe('Phase 1 toolchain', () => {
  it('exposes the expected application foundation metadata', () => {
    expect(appMetadata.name).toBe('Screen Recorder');
    expect(appMetadata.version).toBe('0.1.0');
    expect(appMetadata.platform).toBe('macOS 15+');
  });
});
