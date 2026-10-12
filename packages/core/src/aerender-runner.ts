import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { parseAerenderLine, type AerenderEvent } from './aerender-progress.js';

export type AerenderVerbose = 'ERRORS' | 'ERRORS_AND_PROGRESS';
export type AerenderClose = 'DO_NOT_SAVE_CHANGES' | 'SAVE_CHANGES' | 'DO_NOT_CLOSE';

/** A readable stream we only need the `data` event from. */
export interface AerenderStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

/** The subset of a spawned process the runner drives; a test seam. */
export interface AerenderProcess {
  stdout: AerenderStream | null;
  stderr: AerenderStream | null;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnAerender = (command: string, args: string[]) => AerenderProcess;

export interface AerenderRunOptions {
  /** Absolute path to the aerender executable. */
  aerender: string;
  /** Project file to open. */
  project: string;
  comp?: string;
  rqindex?: number;
  rsTemplate?: string;
  omTemplate?: string;
  output?: string;
  startFrame?: number;
  endFrame?: number;
  increment?: number;
  verbose?: AerenderVerbose;
  close?: AerenderClose;
  reuse?: boolean;
  onEvent?: (event: AerenderEvent) => void;
  signal?: AbortSignal;
  spawn?: SpawnAerender;
}

export interface AerenderResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** stdout lines, in order. */
  output: string[];
  /** stderr lines, in order. */
  errors: string[];
  cancelled: boolean;
}

export interface AerenderRunHandle {
  result: Promise<AerenderResult>;
  cancel: () => void;
}

/**
 * Builds the aerender command-line arguments.
 *   https://helpx.adobe.com/after-effects/desktop/render-and-export/automate-rendering/automated-rendering-network-rendering.html
 */
export function buildAerenderArgs(options: AerenderRunOptions): string[] {
  const args: string[] = [];
  if (options.reuse === true) {
    args.push('-reuse');
  }
  args.push('-project', options.project);
  if (options.comp !== undefined) {
    args.push('-comp', options.comp);
  }
  if (options.rqindex !== undefined) {
    args.push('-rqindex', String(options.rqindex));
  }
  if (options.rsTemplate !== undefined) {
    args.push('-RStemplate', options.rsTemplate);
  }
  if (options.omTemplate !== undefined) {
    args.push('-OMtemplate', options.omTemplate);
  }
  if (options.output !== undefined) {
    args.push('-output', options.output);
  }
  if (options.startFrame !== undefined) {
    args.push('-s', String(options.startFrame));
  }
  if (options.endFrame !== undefined) {
    args.push('-e', String(options.endFrame));
  }
  if (options.increment !== undefined) {
    args.push('-i', String(options.increment));
  }
  args.push('-v', options.verbose ?? 'ERRORS_AND_PROGRESS');
  args.push('-close', options.close ?? 'DO_NOT_SAVE_CHANGES');
  return args;
}

const defaultSpawn: SpawnAerender = (command, args) =>
  spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as AerenderProcess;

/** Splits a stream into lines, returning a flush for any trailing partial line. */
function attachLines(
  stream: AerenderStream | null,
  onLine: (line: string) => void,
): () => void {
  if (stream === null) {
    return () => undefined;
  }
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      onLine(buffer.slice(0, index).replace(/\r$/, ''));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  });
  return () => {
    if (buffer !== '') {
      onLine(buffer.replace(/\r$/, ''));
      buffer = '';
    }
  };
}

/**
 * Runs aerender, streaming its output and parsed progress events. The returned
 * handle's `cancel` kills the process; the `signal` option cancels the same way.
 */
export function runAerender(options: AerenderRunOptions): AerenderRunHandle {
  const spawnFn = options.spawn ?? defaultSpawn;
  const child = spawnFn(options.aerender, buildAerenderArgs(options));
  const output: string[] = [];
  const errors: string[] = [];
  let cancelled = false;
  let settled = false;

  const emit = (line: string, sink: string[]): void => {
    sink.push(line);
    const event = parseAerenderLine(line);
    if (event !== null) {
      options.onEvent?.(event);
    }
  };
  const flushOutput = attachLines(child.stdout, (line) => emit(line, output));
  const flushErrors = attachLines(child.stderr, (line) => emit(line, errors));

  const result = new Promise<AerenderResult>((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      flushOutput();
      flushErrors();
      resolve({ code, signal, output, errors, cancelled });
    };
    child.on('error', (error) => {
      errors.push(error.message);
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });

  const cancel = (): void => {
    if (settled) {
      return;
    }
    cancelled = true;
    child.kill('SIGTERM');
  };

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      cancel();
    } else {
      options.signal.addEventListener('abort', cancel, { once: true });
    }
  }

  return { result, cancel };
}
