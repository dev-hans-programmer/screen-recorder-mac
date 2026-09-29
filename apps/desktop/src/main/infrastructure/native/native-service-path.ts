import fs from 'node:fs';
import path from 'node:path';

export interface NativeServicePathOptions {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly workingDirectory: string;
  readonly moduleDirectory: string;
  readonly architecture: string;
  readonly platform?: string;
  readonly exists?: (filePath: string) => boolean;
}

function nativeBuildCandidates(options: NativeServicePathOptions): readonly string[] {
  const swiftArchitecture = options.architecture === 'x64' ? 'x86_64' : options.architecture;
  const targetDirectory = `${swiftArchitecture}-apple-macosx`;
  const relativeBuildPath = path.join('native', 'CaptureService', '.build', targetDirectory);

  return [
    path.join(options.workingDirectory, relativeBuildPath, 'release', 'CaptureService'),
    path.join(options.workingDirectory, relativeBuildPath, 'debug', 'CaptureService'),
    path.resolve(
      options.moduleDirectory,
      '..',
      '..',
      '..',
      '..',
      relativeBuildPath,
      'release',
      'CaptureService',
    ),
    path.resolve(
      options.moduleDirectory,
      '..',
      '..',
      '..',
      '..',
      relativeBuildPath,
      'debug',
      'CaptureService',
    ),
  ];
}

/** Resolves the helper without making the rest of the app aware of SwiftPM's build layout. */
export function resolveCaptureServicePath(options: NativeServicePathOptions): string {
  if (options.platform !== undefined && options.platform !== 'darwin') {
    throw new Error('The native capture service is currently supported only on macOS.');
  }

  const candidates = options.isPackaged
    ? [
        path.join(options.resourcesPath, 'CaptureService'),
        path.join(options.resourcesPath, 'native', 'CaptureService'),
      ]
    : nativeBuildCandidates(options);
  const exists = options.exists ?? fs.existsSync;
  const resolved = candidates.find((candidate) => exists(candidate));

  if (resolved !== undefined) {
    return resolved;
  }

  throw new Error(
    `CaptureService helper was not found. Build it with “pnpm native:build”. Searched: ${candidates.join(', ')}`,
  );
}
