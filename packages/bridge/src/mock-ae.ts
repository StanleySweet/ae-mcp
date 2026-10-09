import vm from 'node:vm';

interface MockTask {
  id: number;
  fn: () => void;
  dueAt: number;
  delay: number;
  repeat: boolean;
}

export interface MockUndoGroup {
  name: string | undefined;
  start: number;
  end: number;
}

export class MockAE {
  readonly undoGroups: MockUndoGroup[] = [];
  readonly alerts: string[] = [];
  private clock = 0;
  private undoDepth = 0;
  private nextTaskId = 1;
  private readonly tasks = new Map<number, MockTask>();

  app = {
    exitCode: 0,
    beginUndoGroup: (name?: string): void => {
      this.undoDepth += 1;
      this.undoGroups.push({ name, start: this.clock, end: -1 });
    },
    endUndoGroup: (): void => {
      if (this.undoDepth === 0) {
        throw new Error('endUndoGroup without beginUndoGroup');
      }
      this.undoDepth -= 1;
      const current = this.undoGroups[this.undoGroups.length - 1];
      if (current) {
        current.end = this.clock;
      }
    },
    inUndoGroup: (): boolean => this.undoDepth > 0,
    scheduleTask: (fn: () => void, delay: number, repeat: boolean): number => {
      const id = this.nextTaskId;
      this.nextTaskId += 1;
      this.tasks.set(id, { id, fn, dueAt: this.clock + delay, delay, repeat });
      return id;
    },
    cancelTask: (id: number): void => {
      this.tasks.delete(id);
    },
    alert: (message: string): void => {
      this.alerts.push(message);
    },
  };

  $ = {
    hiresTimer: (): number => this.clock,
    os: 'MockAE',
  };

  now(): number {
    return this.clock;
  }

  advance(ms: number): void {
    const target = this.clock + ms;
    for (let guard = 0; guard < 1000; guard += 1) {
      const due = [...this.tasks.values()]
        .filter((t) => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt);
      if (due.length === 0) break;
      this.clock = due[0].dueAt;
      for (const task of due) {
        this.tasks.delete(task.id);
        task.fn();
        if (task.repeat) {
          this.tasks.set(task.id, {
            ...task,
            dueAt: task.dueAt + task.delay,
          });
        }
      }
    }
    this.clock = target;
  }
}

export function runInMockAE(code: string, ae: MockAE): vm.Context {
  const sandbox: Record<string, unknown> = {
    app: ae.app,
    $: ae.$,
    JSON: undefined,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context);
  return context;
}