// MCP progress for ae_render (#235). aerender's frame count becomes
// notifications/progress, but only when the client sent a progressToken. The
// value only ever goes up, and nothing is sent once the render has finished.

export interface RenderProgressParams {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export interface RenderProgress {
  /** Reports the frames rendered so far (aerender's count). Repeats and lower values are dropped. */
  report(rendered: number): void;
  /** Ends reporting. Call it before the job is marked finished. */
  stop(): void;
}

export function createRenderProgress(options: {
  token: string | number;
  total?: number;
  send: (params: RenderProgressParams) => Promise<void>;
}): RenderProgress {
  let last = 0;
  let stopped = false;
  return {
    report(rendered: number): void {
      if (stopped || rendered <= last) {
        return;
      }
      last = rendered;
      const params: RenderProgressParams = {
        progressToken: options.token,
        progress: rendered,
        message: `${rendered} frame(s) rendered`,
      };
      if (options.total !== undefined) {
        params.total = options.total;
      }
      // A client that went away must not fail the render.
      options.send(params).catch(() => undefined);
    },
    stop(): void {
      stopped = true;
    },
  };
}
