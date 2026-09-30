import { appendFile, chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Logger, LogLevel } from '@screen-recorder/application';

import type { RuntimeLogLevel } from './runtime-config';

export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

interface StructuredFileLoggerOptions {
  readonly directory: string;
  readonly minimumLevel: RuntimeLogLevel;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
  readonly mirrorToConsole?: boolean;
  readonly now?: () => number;
}

const levelPriority: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveContextKey = /(?:path|directory|file(?:name)?|title|sourceName|deviceName)/i;

/** Newline-delimited JSON logger with bounded rotation and recursive privacy redaction. */
export class StructuredFileLogger implements Logger {
  private readonly filePath: string;
  private readonly minimumLevel: RuntimeLogLevel;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly mirrorToConsole: boolean;
  private readonly now: () => number;
  private writeChain: Promise<void> = Promise.resolve();
  private currentSize: number | undefined;

  public constructor(options: StructuredFileLoggerOptions) {
    this.filePath = path.join(options.directory, 'main.jsonl');
    this.minimumLevel = options.minimumLevel;
    this.maxFileBytes = Math.max(512, options.maxFileBytes ?? 2 * 1024 * 1024);
    this.maxFiles = Math.max(2, options.maxFiles ?? 5);
    this.mirrorToConsole = options.mirrorToConsole ?? false;
    this.now = options.now ?? Date.now;
  }

  public debug(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('error', message, context);
  }

  public async flush(): Promise<void> {
    await this.writeChain;
  }

  public async readRecentErrors(limit: number): Promise<readonly StructuredLogEntry[]> {
    await this.flush();
    const entries: StructuredLogEntry[] = [];

    for (const candidate of this.logFilesOldestFirst()) {
      try {
        const lines = (await readFile(candidate, 'utf8')).split('\n');
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          const parsed = JSON.parse(line) as StructuredLogEntry;
          if (parsed.level === 'error') entries.push(parsed);
        }
      } catch {
        // Diagnostics export remains useful even if one old rotated file is unreadable.
      }
    }

    return entries.slice(-Math.max(0, Math.floor(limit)));
  }

  private log(level: LogLevel, message: string, context?: Readonly<Record<string, unknown>>): void {
    if (!this.shouldLog(level)) return;
    const entry: StructuredLogEntry = {
      timestamp: new Date(this.now()).toISOString(),
      level,
      message: redactString(message),
      ...(context === undefined ? {} : { context: sanitizeContext(context) }),
    };
    const line = `${JSON.stringify(entry)}\n`;

    if (this.mirrorToConsole) this.writeToConsole(entry);

    const write = this.writeChain.then(() => this.writeLine(line));
    this.writeChain = write.catch(() => {
      // Logging must not crash recording. Avoid printing the rejected entry or filesystem path.
      console.error('[screen-recorder] A structured log entry could not be written.');
    });
  }

  private writeToConsole(entry: StructuredLogEntry): void {
    const payload = entry.context ?? '';
    if (entry.level === 'debug') console.debug(`[screen-recorder] ${entry.message}`, payload);
    else if (entry.level === 'info') console.info(`[screen-recorder] ${entry.message}`, payload);
    else if (entry.level === 'warn') console.warn(`[screen-recorder] ${entry.message}`, payload);
    else console.error(`[screen-recorder] ${entry.message}`, payload);
  }

  private shouldLog(level: LogLevel): boolean {
    return (
      this.minimumLevel !== 'silent' &&
      levelPriority[level] >= levelPriority[this.minimumLevel as LogLevel]
    );
  }

  private async writeLine(line: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    if (this.currentSize === undefined) {
      this.currentSize = await stat(this.filePath)
        .then((value) => value.size)
        .catch((error: unknown) => {
          if (isMissingFile(error)) return 0;
          throw error;
        });
      await chmod(this.filePath, 0o600).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error;
      });
    }
    const lineBytes = Buffer.byteLength(line);
    if (this.currentSize > 0 && this.currentSize + lineBytes > this.maxFileBytes) {
      await this.rotate();
    }
    await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    this.currentSize += lineBytes;
  }

  private async rotate(): Promise<void> {
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source = index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const destination = `${this.filePath}.${index}`;
      await rm(destination, { force: true });
      try {
        await rename(source, destination);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    this.currentSize = 0;
  }

  private logFilesOldestFirst(): readonly string[] {
    const files: string[] = [];
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      files.push(`${this.filePath}.${index}`);
    }
    files.push(this.filePath);
    return files;
  }
}

function sanitizeContext(
  context: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const seen = new WeakSet<object>();
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sensitiveContextKey.test(key) ? '[redacted]' : sanitizeValue(value, seen, 0),
    ]),
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, seen, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          sensitiveContextKey.test(key) ? '[redacted]' : sanitizeValue(item, seen, depth + 1),
        ]),
    );
  }
  return String(value);
}

function redactString(value: string): string {
  if (path.isAbsolute(value) || value.startsWith('file://')) return '[redacted-path]';
  return value
    .replace(/file:\/\/\/[^\s"']+/g, '[redacted-path]')
    .replace(/(^|[\s(])\/[^,\n)]+/g, '$1[redacted-path]')
    .slice(0, 2_000);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
