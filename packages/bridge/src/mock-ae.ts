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

// Mirrors File > Increment and Save: MyProject_v007.aep -> MyProject_v008.aep,
// and MyProject.aep -> MyProject_v001.aep when there is no version suffix.
function incrementProjectName(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : '';
  const match = /^(.*)_v(\d+)$/.exec(base);
  const next = match
    ? `${match[1]}_v${String(Number(match[2]) + 1).padStart(match[2].length, '0')}`
    : `${base}_v001`;
  return `${dir}${next}${ext}`;
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

export class MockItem {
  label = 0;
  comment = '';
  selected = false;
  parentFolder!: MockFolderItem;

  constructor(
    readonly id: number,
    public name: string,
  ) {}
}

export class MockFolderItem extends MockItem {
  readonly items: MockItem[] = [];

  add(item: MockItem): MockItem {
    item.parentFolder = this;
    this.items.push(item);
    return item;
  }
}

export class MockCompItem extends MockItem {
  pixelAspect = 1;
  bgColor: [number, number, number] = [0, 0, 0];
  motionBlur = false;
  workAreaStart = 0;
  workAreaDuration = 0;
  private readonly layerList: MockLayer[] = [];
  selectedLayers: MockLayer[] = [];

  constructor(
    id: number,
    name: string,
    public width: number,
    public height: number,
    public frameRate: number,
    public duration: number,
  ) {
    super(id, name);
  }

  get numLayers(): number {
    return this.layerList.length;
  }

  layer(index: number): MockLayer | null {
    return this.layerList[index - 1] ?? null;
  }

  addLayer(layer: MockLayer): MockLayer {
    layer.index = this.layerList.length + 1;
    this.layerList.push(layer);
    return layer;
  }
}

export class MockProperty {
  expressionEnabled = false;
  expression = '';
  readonly keys: { time: number; value: unknown }[] = [];

  constructor(
    readonly name: string,
    readonly matchName: string,
    public value: unknown = null,
  ) {}

  get numKeys(): number {
    return this.keys.length;
  }

  keyTime(index: number): number {
    return this.keys[index - 1].time;
  }

  keyValue(index: number): unknown {
    return this.keys[index - 1].value;
  }

  key(time: number, value: unknown): this {
    this.keys.push({ time, value });
    return this;
  }
}

export class MockPropertyGroup {
  protected readonly children: (MockProperty | MockPropertyGroup)[] = [];

  constructor(
    readonly name: string,
    readonly matchName: string,
  ) {}

  get numProperties(): number {
    return this.children.length;
  }

  property(indexOrName: number | string): MockProperty | MockPropertyGroup | null {
    if (typeof indexOrName === 'number') {
      return this.children[indexOrName - 1] ?? null;
    }
    for (const child of this.children) {
      if (child.matchName === indexOrName) {
        return child;
      }
    }
    return null;
  }

  add<T extends MockProperty | MockPropertyGroup>(child: T): T {
    this.children.push(child);
    return child;
  }
}

export class MockEffect extends MockPropertyGroup {
  enabled = new MockProperty('enabled', 'ADBE Effect Enabled', true);
}

export class MockLayer extends MockPropertyGroup {
  index = 1;
  id: number | null = null;
  enabled = true;
  solo = false;
  shy = false;
  locked = false;
  inPoint = 0;
  outPoint = 0;
  startTime = 0;
  stretch = 1;
  label = 0;
  parent: MockLayer | null = null;
}

export class MockAVLayer extends MockLayer {
  width = 0;
  height = 0;
  hasVideo = true;
  hasAudio = false;
  threeDLayer = false;
  source: MockItem | null = null;
}

export class MockTextLayer extends MockAVLayer {}

export class MockShapeLayer extends MockAVLayer {}

export class MockCameraLayer extends MockLayer {}

export class MockLightLayer extends MockLayer {}

export class MockFootageItem extends MockItem {
  pixelAspect = 1;
  frameRate = 0;
  duration = 0;
  footageMissing = false;
  file: MockFile | null = null;

  constructor(
    id: number,
    name: string,
    public width: number,
    public height: number,
  ) {
    super(id, name);
  }
}

export class MockProject {
  file: MockFile | null = null;
  bitsPerChannel = 8;
  activeItem: MockItem | null = null;
  selection: MockItem[] = [];
  readonly rootFolder = new MockFolderItem(0, 'Root');
  private readonly all: MockItem[] = [];

  get numItems(): number {
    return this.all.length;
  }

  item(index: number): MockItem | undefined {
    return this.all[index - 1];
  }

  add(item: MockItem, parent: MockFolderItem = this.rootFolder): MockItem {
    parent.add(item);
    this.all.push(item);
    return item;
  }
}

export class MockAE {
  readonly undoGroups: MockUndoGroup[] = [];
  readonly alerts: string[] = [];
  readonly fs = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly env: Record<string, string> = {};
  readonly project = new MockProject();
  readonly executedCommands: number[] = [];
  readonly menuCommandIds: Record<string, number> = { 'Increment and Save': 3088 };
  evalFileCalls = 0;
  context: vm.Context | null = null;
  private clock = 0;
  private undoDepth = 0;
  private nextTaskId = 1;
  private readonly tasks = new Map<number, MockTask>();

  app = {
    exitCode: 0,
    version: 'MockAE-25',
    project: this.project,
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
    findMenuCommandId: (name: string): number => this.menuCommandIds[name] ?? 0,
    executeCommand: (id: number): void => {
      this.executedCommands.push(id);
      if (id === this.menuCommandIds['Increment and Save'] && this.project.file) {
        this.project.file = new MockFile(this, incrementProjectName(this.project.file.path));
      }
    },
    // Real AE only accepts a string of code, evaluated later in the global scope.
    scheduleTask: (code: string, delay: number, repeat: boolean): number => {
      if (typeof code !== 'string') {
        throw new TypeError('app.scheduleTask: stringToExecute must be a string');
      }
      const context = this.context;
      if (context === null) {
        throw new Error('app.scheduleTask: no script context');
      }
      const id = this.nextTaskId;
      this.nextTaskId += 1;
      const fn = (): void => {
        vm.runInContext(code, context);
      };
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
    global?: unknown;
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
    for (let guard = 0; guard < 100000; guard += 1) {
      let next: MockTask | undefined;
      for (const task of this.tasks.values()) {
        if (task.dueAt <= target && (next === undefined || task.dueAt < next.dueAt)) {
          next = task;
        }
      }
      if (next === undefined) break;
      this.clock = next.dueAt;
      this.tasks.delete(next.id);
      next.fn();
      if (next.repeat) {
        this.tasks.set(next.id, { ...next, dueAt: next.dueAt + next.delay });
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
    CompItem: MockCompItem,
    FolderItem: MockFolderItem,
    FootageItem: MockFootageItem,
    AVLayer: MockAVLayer,
    TextLayer: MockTextLayer,
    ShapeLayer: MockShapeLayer,
    CameraLayer: MockCameraLayer,
    LightLayer: MockLightLayer,
    File: function (path: string): MockFile {
      return new MockFile(ae, path);
    },
    Folder: function (path: string): MockFolder {
      return new MockFolder(ae, path);
    },
  };
  const context = vm.createContext(sandbox);
  ae.context = context;
  ae.$.global = vm.runInContext('this', context);
  ae.$.evalFile = (path: string): unknown => {
    ae.evalFileCalls += 1;
    const content = ae.fs.get(path);
    if (content === undefined) {
      throw new Error(`file not found: ${path}`);
    }
    // Real AE evaluates the file in the caller's local scope: its var and function
    // declarations do not become globals. Mirror that so code must use $.global.
    return vm.runInContext(`(function () {\n${content}\n}).call(this);`, context);
  };
  vm.runInContext(code, context);
  return context;
}