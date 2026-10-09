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

function homeOf(ae: MockAE): string {
  return ae.env.HOME ?? '';
}

export class MockFile {
  private opened: 'r' | 'w' | null = null;
  private buffer = '';
  readonly path: string;

  constructor(
    private readonly ae: MockAE,
    path: string,
  ) {
    this.path = path.replace(/^~/, homeOf(ae));
  }

  get exists(): boolean {
    return this.ae.fs.has(this.path);
  }

  get fsName(): string {
    return this.path;
  }

  get name(): string {
    const i = this.path.lastIndexOf('/');
    return i >= 0 ? this.path.slice(i + 1) : this.path;
  }

  open(mode: 'r' | 'w'): boolean {
    if (mode === 'r' && !this.ae.fs.has(this.path)) {
      return false;
    }
    this.opened = mode;
    return true;
  }

  read(): string {
    return this.ae.fs.get(this.path) ?? '';
  }

  write(text: string): void {
    this.buffer += text;
  }

  close(): void {
    if (this.opened === 'w') {
      this.ae.fs.set(this.path, this.buffer);
    }
    this.opened = null;
  }

  remove(): void {
    this.ae.fs.delete(this.path);
  }
}

export class MockFolder {
  readonly path: string;

  constructor(
    private readonly ae: MockAE,
    path: string,
  ) {
    this.path = path.replace(/^~/, homeOf(ae));
  }

  get exists(): boolean {
    return this.ae.dirs.has(this.path);
  }

  create(): boolean {
    this.ae.dirs.add(this.path);
    return true;
  }

  getFiles(mask: string): MockFile[] {
    const out: MockFile[] = [];
    for (const path of this.ae.fs.keys()) {
      const rest = path.slice(this.path.length + 1);
      if (path.startsWith(`${this.path}/`) && !rest.includes('/') && globMatch(rest, mask)) {
        out.push(new MockFile(this.ae, path));
      }
    }
    return out;
  }
}

function globMatch(name: string, mask: string): boolean {
  const escaped = mask.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(name);
}

export class MockAE {
  readonly undoGroups: MockUndoGroup[] = [];
  readonly alerts: string[] = [];
  readonly fs = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly env: Record<string, string> = {};
  evalFileCalls = 0;
  private clock = 0;
  private undoDepth = 0;
  private nextTaskId = 1;
  private readonly tasks = new Map<number, MockTask>();

  app = {
    exitCode: 0,
    version: 'MockAE-25',
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

  $: {
    hiresTimer: () => number;
    os: string;
    getenv: (name: string) => string | undefined;
    evalFile?: (path: string) => unknown;
  } = {
    hiresTimer: () => this.clock,
    os: 'MockAE-OS',
    getenv: (name: string) => this.env[name],
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
    File: function (path: string): MockFile {
      return new MockFile(ae, path);
    },
    Folder: function (path: string): MockFolder {
      return new MockFolder(ae, path);
    },
  };
  const context = vm.createContext(sandbox);
  ae.$.evalFile = (path: string): unknown => {
    ae.evalFileCalls += 1;
    const content = ae.fs.get(path);
    if (content === undefined) {
      throw new Error(`file not found: ${path}`);
    }
    return vm.runInContext(content, context);
  };
  vm.runInContext(code, context);
  return context;
}