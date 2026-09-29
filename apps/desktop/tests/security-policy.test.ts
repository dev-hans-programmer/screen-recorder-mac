import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  contentSecurityPolicy,
  isAllowedRendererUrl,
} from '../src/main/security/security-policy';

describe('Electron renderer security policy', () => {
  it('allows only the packaged file URL or the configured development origin', () => {
    expect(
      isAllowedRendererUrl('file:///app/renderer/index.html', undefined, 'file:///app/renderer/'),
    ).toBe(true);
    expect(isAllowedRendererUrl('file:///tmp/other.html', undefined, 'file:///app/renderer/')).toBe(
      false,
    );
    expect(isAllowedRendererUrl('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isAllowedRendererUrl('https://example.com/', 'http://localhost:5173/')).toBe(false);
    expect(isAllowedRendererUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
  });

  it('disables object, framing, form, and non-self script sources', () => {
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("form-action 'none'");
  });

  it('allows the Vite preamble only in development', () => {
    expect(buildContentSecurityPolicy(true)).toContain("script-src 'self' 'unsafe-inline'");
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
