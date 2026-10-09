import { z } from 'zod';

export const errorCodes = [
  'AE_NOT_RUNNING',
  'BRIDGE_NOT_LOADED',
  'UNKNOWN_TOOL',
  'INVALID_MESSAGE',
  'INVALID_ARGS',
  'SCRIPT_ERROR',
  'TIMEOUT',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorCodeSchema = z.enum(errorCodes);

export const errorHints: Record<ErrorCode, string> = {
  AE_NOT_RUNNING: 'Launch After Effects, then retry.',
  BRIDGE_NOT_LOADED: 'Restart After Effects so the startup loader runs, then retry.',
  UNKNOWN_TOOL: 'Call ae_catalog to list the available tools.',
  INVALID_MESSAGE: 'Client and server protocol versions differ; restart the client after upgrading.',
  INVALID_ARGS: 'Check the tool description for the expected arguments.',
  SCRIPT_ERROR: 'Open Window > Console in After Effects for the script error.',
  TIMEOUT: 'The job exceeded its deadline and was cancelled.',
};

export function makeError(
  code: ErrorCode,
  message: string,
): { code: ErrorCode; message: string; hint: string } {
  return { code, message, hint: errorHints[code] };
}