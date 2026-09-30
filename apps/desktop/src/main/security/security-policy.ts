export function buildContentSecurityPolicy(isDevelopment: boolean): string {
  const scriptSource = isDevelopment ? "'self' 'unsafe-inline'" : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' screen-recorder-media:",
    "connect-src 'self' ws://localhost:5173 http://localhost:5173",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

export const contentSecurityPolicy = buildContentSecurityPolicy(false);

export function isAllowedRendererUrl(
  url: string,
  developmentServerUrl: string | undefined,
  packagedRendererRootUrl: string | undefined = undefined,
): boolean {
  if (url.startsWith('file://')) {
    return packagedRendererRootUrl !== undefined && url.startsWith(packagedRendererRootUrl);
  }

  if (developmentServerUrl === undefined) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(developmentServerUrl).origin;
  } catch {
    return false;
  }
}
