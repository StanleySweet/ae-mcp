import { z } from 'zod';

export const errorCodes = [
  'AE_NOT_RUNNING',
  'AE_BUSY',
  'BRIDGE_NOT_LOADED',
  'UNKNOWN_TOOL',
  'INVALID_MESSAGE',
  'INVALID_ARGS',
  'FORBIDDEN',
  'UNSAVED_PROJECT',
  'SCRIPT_ERROR',
  'TIMEOUT',
  'UNKNOWN_JOB',
  'AERENDER_NOT_FOUND',
  'UNKNOWN_PLAN',
  'PLAN_EXPIRED',
  'PLAN_CHANGED',
  'DIALOG_OPEN',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorCodeSchema = z.enum(errorCodes);

export const errorHints: Record<ErrorCode, string> = {
  AE_NOT_RUNNING: 'Launch After Effects, then retry.',
  AE_BUSY:
    'After Effects is running another script (a panel or the bridge); the bridge retries with backoff. If it persists, close the panel that is running a script.',
  BRIDGE_NOT_LOADED: 'Restart After Effects so the startup loader runs, then retry.',
  UNKNOWN_TOOL: 'Call ae_catalog to list the available tools.',
  INVALID_MESSAGE: 'Client and server protocol versions differ; restart the client after upgrading.',
  INVALID_ARGS: "Call ae_catalog for the operation's schema and required arguments.",
  FORBIDDEN: 'Adjust ~/.ae-mcp/settings.json or the environment override.',
  UNSAVED_PROJECT: 'Save the project once (File > Save) so Increment and Save can version it.',
  SCRIPT_ERROR: 'Open Window > Console in After Effects for the script error.',
  TIMEOUT: 'The job exceeded its deadline and was cancelled.',
  UNKNOWN_JOB: 'Poll job_status with the id returned when the job started.',
  AERENDER_NOT_FOUND: 'Install After Effects so its aerender executable is available.',
  UNKNOWN_PLAN: 'Call ae_plan again to preview the change and get a fresh planId.',
  PLAN_EXPIRED: 'Plans expire after 10 minutes; call ae_plan again and apply right away.',
  PLAN_CHANGED: 'The project changed since the plan was made; call ae_plan again to re-preview.',
  DIALOG_OPEN:
    'A dialog is open in After Effects; read it with ae_dialogs and dismiss it, or close it by hand, then retry.',
};

export function makeError(
  code: ErrorCode,
  message: string,
): { code: ErrorCode; message: string; hint: string } {
  return { code, message, hint: errorHints[code] };
}