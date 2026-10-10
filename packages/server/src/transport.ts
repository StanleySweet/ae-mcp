import type { JobMessage, ResultMessage } from '@ae-mcp/protocol';

export interface Transport {
  readonly name: string;
  call(job: JobMessage): Promise<ResultMessage>;
}