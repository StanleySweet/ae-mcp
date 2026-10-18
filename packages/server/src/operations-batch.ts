import type { OperationDefinition } from '@ae-mcp/protocol';

// batch.status (#279). Answered by the server from <root>/batches.jsonl; the bridge is never
// called. ae_do in server.ts dispatches it (batch-log.ts batchStatus).
export function registerBatchOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'batch.status',
    category: 'batch',
    description: 'Report whether a batch.run batchId applied, failed (with step and message), or is unknown.',
    readOnly: true,
    destructive: false,
    schema: { batchId: { type: 'string' } },
    required: ['batchId'],
  });
}
