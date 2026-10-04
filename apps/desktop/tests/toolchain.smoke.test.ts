import { describe, expect, it } from 'vitest';

import desktopPackage from '../package.json';
import { appMetadata } from '../src/shared/app-metadata';

describe('Phase 1 toolchain', () => {
  it('exposes the expected application foundation metadata', () => {
    expect(appMetadata.name).toBe('Screen Recorder');
    expect(appMetadata.version).toBe(desktopPackage.version);
    expect(appMetadata.nativeServiceVersion).toBe(desktopPackage.version);
    expect(appMetadata.platform).toBe('macOS 15+');
  });
});
