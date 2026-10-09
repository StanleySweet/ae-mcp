import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

export const PROTOCOL_VERSION = 1 as const;

export const jobSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string(),
  tool: z.string(),
  args: z.unknown(),
  deadline: z.number(),
});

export const heartbeatSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  bridgeVersion: z.string(),
  aeVersion: z.string(),
  os: z.string(),
  capabilities: z.array(z.string()),
  busy: z.boolean(),
  transport: z.string(),
});

export const errorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  hint: z.string().optional(),
});

export const resultSchema = z.discriminatedUnion('ok', [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(false),
    error: errorSchema,
  }),
]);

export type JobMessage = z.infer<typeof jobSchema>;
export type HeartbeatMessage = z.infer<typeof heartbeatSchema>;
export type ResultMessage = z.infer<typeof resultSchema>;