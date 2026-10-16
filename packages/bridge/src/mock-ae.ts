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

export class MockItem {
  label = 0;
  comment = '';
  selected = false;
  parentFolder!: MockFolderItem;
  project: MockProject | null = null;

  constructor(
    readonly id: number,
    public name: string,
  ) {}

  remove(): void {
    this.project?.removeItem(this);
  }
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
  private nextId = 100;

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

  readonly layers = new MockLayerCollection(this);
  readonly markerProperty = new MockMarkerPropertyGroup('Marker', 'ADBE Marker');

  get numLayers(): number {
    return this.layerList.length;
  }

  layer(index: number): MockLayer | null {
    return this.layerList[index - 1] ?? null;
  }

  addLayer<T extends MockLayer>(layer: T): T {
    layer.index = this.layerList.length + 1;
    layer.containingComp = this;
    this.layerList.push(layer);
    return layer;
  }

  removeLayerAt(index: number): MockLayer | null {
    const removed = this.layerList.splice(index - 1, 1)[0] ?? null;
    this.reindexLayers();
    return removed;
  }

  insertLayerAt(index: number, layer: MockLayer): void {
    layer.containingComp = this;
    this.layerList.splice(index - 1, 0, layer);
    this.reindexLayers();
  }

  private reindexLayers(): void {
    this.layerList.forEach((layer, i) => {
      layer.index = i + 1;
    });
  }

  nextLayerId(): number {
    this.nextId += 1;
    return this.nextId;
  }

  property(indexOrName: number | string): MockProperty | MockPropertyGroup | null {
    if (indexOrName === 'Marker' || indexOrName === 'ADBE Marker') {
      return this.markerProperty;
    }
    return null;
  }

  duplicate(): MockCompItem {
    const id = this.project ? this.project.allocateId() : this.id;
    const copy = new MockCompItem(id, `${this.name} Copy`, this.width, this.height, this.frameRate, this.duration);
    copy.pixelAspect = this.pixelAspect;
    copy.bgColor = [this.bgColor[0], this.bgColor[1], this.bgColor[2]];
    if (this.project) {
      this.project.add(copy);
    }
    for (const layer of this.layerList) {
      const clone = Object.create(Object.getPrototypeOf(layer)) as MockLayer;
      Object.assign(clone, layer);
      copy.addLayer(clone);
    }
    return copy;
  }

  // Ref: https://developer.adobe.com/after-effects/uxp/after-effects-api/compitem
  saveFrameToPng(time: number, file: MockFile): void {
    file.open('w');
    file.write(`PNG:${this.name}:${time}`);
    file.close();
  }
}

export class MockKeyframeEase {
  constructor(
    public speed: number,
    public influence: number,
  ) {}
}

// Ref: https://ae-scripting.docsforadobe.dev/property/property/#keyframeinterpolationtype
export const MockKeyframeInterpolationType = { LINEAR: 1, BEZIER: 2, HOLD: 3 };

export class MockProperty {
  expressionEnabled = false;
  expression = '';
  readonly keys: { time: number; value: unknown }[] = [];
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyselectedkeys
  selectedKeys: number[] = [];

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

  setValueAtTime(time: number, value: unknown): void {
    const existing = this.keys.find((entry) => entry.time === time);
    if (existing) {
      existing.value = value;
      return;
    }
    const entry = { time, value };
    const at = this.keys.findIndex((k) => k.time > time);
    if (at === -1) {
      this.keys.push(entry);
    } else {
      this.keys.splice(at, 0, entry);
    }
  }

  removeKey(index: number): void {
    this.keys.splice(index - 1, 1);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynumdimensions
  get numDimensions(): number {
    return Array.isArray(this.value) ? this.value.length : 1;
  }

  readonly interpolationTypes: { keyIndex: number; inType: number; outType: number }[] = [];
  readonly temporalEases: {
    keyIndex: number;
    inEase: MockKeyframeEase[];
    outEase: MockKeyframeEase[];
  }[] = [];

  setInterpolationTypeAtKey(keyIndex: number, inType: number, outType: number): void {
    this.interpolationTypes.push({ keyIndex, inType, outType });
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysettemporaleaseatkey
  setTemporalEaseAtKey(
    keyIndex: number,
    inEase: MockKeyframeEase[],
    outEase: MockKeyframeEase[],
  ): void {
    this.temporalEases.push({ keyIndex, inEase, outEase });
  }

  setValue(value: unknown): void {
    this.value = value;
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
      if (child.matchName === indexOrName || child.name === indexOrName) {
        return child;
      }
    }
    return null;
  }

  add<T extends MockProperty | MockPropertyGroup>(child: T): T {
    this.children.push(child);
    return child;
  }

  addProperty(matchName: string): MockEffect {
    return this.add(new MockEffect(matchName, matchName));
  }
}

export class MockEffect extends MockPropertyGroup {
  enabled = new MockProperty('enabled', 'ADBE Effect Enabled', true);
}

export class MockMarkerValue {
  duration = 0;

  constructor(public comment = '') {}
}

export class MockMarkerPropertyGroup extends MockPropertyGroup {
  private readonly markerKeys: { time: number; value: MockMarkerValue }[] = [];

  get numKeys(): number {
    return this.markerKeys.length;
  }

  setValueAtTime(time: number, value: MockMarkerValue): void {
    this.markerKeys.push({ time, value });
  }

  keyTime(index: number): number {
    return this.markerKeys[index - 1].time;
  }

  keyValue(index: number): MockMarkerValue {
    return this.markerKeys[index - 1].value;
  }
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
  containingComp: MockCompItem | null = null;
  adjustmentLayer = false;
  nullLayer = false;
  readonly presets: string[] = [];

  constructor(name: string, matchName: string) {
    super(name, matchName);
    this.add(new MockMarkerPropertyGroup('Marker', 'ADBE Marker'));
  }

  /** After Effects layers always carry an effect parade; create it on demand. */
  property(indexOrName: number | string): MockProperty | MockPropertyGroup | null {
    if (indexOrName === 'ADBE Effect Parade') {
      const existing = super.property(indexOrName);
      return existing ?? this.add(new MockPropertyGroup('Effects', 'ADBE Effect Parade'));
    }
    return super.property(indexOrName);
  }

  applyPreset(file: MockFile): void {
    this.presets.push(file.fsName);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerremove
  remove(): void {
    if (this.containingComp) this.containingComp.removeLayerAt(this.index);
  }
}

export class MockAVLayer extends MockLayer {
  width = 0;
  height = 0;
  hasVideo = true;
  hasAudio = false;
  threeDLayer = false;
  source: MockItem | null = null;

  private transformValue(matchName: string): number[] | null {
    const transform = this.property('ADBE Transform Group') as MockPropertyGroup | null;
    const prop = transform ? (transform.property(matchName) as MockProperty | null) : null;
    return prop && Array.isArray(prop.value) ? (prop.value as number[]) : null;
  }

  sourceRectAtTime(): { top: number; left: number; width: number; height: number } {
    return { top: -this.height / 2, left: -this.width / 2, width: this.width, height: this.height };
  }

  // Mock model: identity rotation/scale and no parent, so the layer-to-comp
  // mapping is a plain offset. Real AE also folds in rotation, scale and parenting.
  // Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayersourcepointtocomp
  sourcePointToComp(point: number[]): number[] {
    const anchor = this.transformValue('ADBE Anchor Point') || [0, 0];
    const pos = this.transformValue('ADBE Position') || [0, 0];
    return [pos[0] + (point[0] - anchor[0]), pos[1] + (point[1] - anchor[1])];
  }
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

export class MockLayerCollection {
  constructor(private readonly comp: MockCompItem) {}

  get length(): number {
    return this.comp.numLayers;
  }

  add(item: MockItem): MockAVLayer {
    const layer = new MockAVLayer(item.name, 'Layer');
    layer.id = this.comp.nextLayerId();
    layer.source = item;
    if (item instanceof MockFootageItem) {
      layer.width = item.width;
      layer.height = item.height;
    }
    return this.comp.addLayer(layer);
  }

  addShape(): MockShapeLayer {
    const layer = new MockShapeLayer('Shape', 'Layer');
    layer.id = this.comp.nextLayerId();
    return this.comp.addLayer(layer);
  }

  addSolid(color: number[], name: string, width: number, height: number, pixelAspect: number, duration?: number): MockAVLayer {
    const source = new MockFootageItem(this.comp.project ? this.comp.project.allocateId() : 0, name, width, height);
    source.pixelAspect = pixelAspect;
    source.duration = duration ?? 0;
    const layer = new MockAVLayer(name, 'Layer');
    layer.id = this.comp.nextLayerId();
    layer.source = source;
    layer.width = width;
    layer.height = height;
    void color;
    return this.comp.addLayer(layer);
  }

  addNull(duration?: number): MockAVLayer {
    const layer = new MockAVLayer('Null', 'Layer');
    layer.id = this.comp.nextLayerId();
    layer.nullLayer = true;
    layer.outPoint = duration ?? 0;
    return this.comp.addLayer(layer);
  }

  addText(sourceText?: string): MockTextLayer {
    const layer = new MockTextLayer(sourceText || 'Text', 'Layer');
    layer.id = this.comp.nextLayerId();
    const textProperties = new MockPropertyGroup('Text', 'ADBE Text Properties');
    textProperties.add(
      new MockProperty('Source Text', 'ADBE Text Document', {
        text: sourceText ?? '',
        fontSize: 72,
        font: 'ArialMT',
        fillColor: [1, 1, 1],
      }),
    );
    layer.add(textProperties);
    return this.comp.addLayer(layer);
  }

  precompose(indices: number[], name: string, moveAllAttributes = true): MockCompItem {
    const source = this.comp;
    const project = source.project;
    const comp = new MockCompItem(
      project ? project.allocateId() : 0,
      name,
      source.width,
      source.height,
      source.frameRate,
      source.duration,
    );
    comp.pixelAspect = source.pixelAspect;
    comp.bgColor = [source.bgColor[0], source.bgColor[1], source.bgColor[2]];
    if (project) {
      project.add(comp);
    }
    const sorted = [...indices].sort((a, b) => a - b);
    const moved: MockLayer[] = [];
    for (const index of sorted) {
      const layer = source.layer(index);
      if (layer) {
        moved.push(layer);
      }
    }
    for (const layer of moved) {
      comp.addLayer(layer);
    }
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      source.removeLayerAt(sorted[i]!);
    }
    const holder = new MockAVLayer(name, 'Layer');
    holder.id = source.nextLayerId();
    holder.outPoint = source.duration;
    source.insertLayerAt(sorted[0]!, holder);
    void moveAllAttributes;
    return comp;
  }
}

export class MockItemCollection {
  constructor(private readonly project: MockProject) {}

  addComp(name: string, width: number, height: number, pixelAspect: number, duration: number, frameRate?: number): MockCompItem {
    const comp = new MockCompItem(this.project.allocateId(), name, width, height, frameRate ?? 24, duration);
    comp.pixelAspect = pixelAspect;
    this.project.add(comp);
    return comp;
  }

  addFolder(name: string): MockFolderItem {
    const folder = new MockFolderItem(this.project.allocateId(), name);
    this.project.add(folder);
    return folder;
  }
}

// Render queue item status enum, mirroring AE's RQItemStatus global.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemstatus
export const RQItemStatus = {
  QUEUED: 1,
  UNQUEUED: 2,
  RENDERING: 3,
  DONE: 4,
  ERR_STOPPED: 5,
  USER_STOPPED: 6,
  NEEDS_OUTPUT: 7,
  WILL_CONTINUE: 8,
};

export class MockOutputModule {
  file: MockFile | null = null;
  template: string | null = null;
  removed = false;
  readonly name = 'Lossless';
  readonly templates = ['PNG Sequence', 'Lossless'];

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/
  applyTemplate(name: string): void {
    this.template = name;
  }

  remove(): void {
    this.removed = true;
  }
}

export class MockRenderQueueItem {
  timeSpanStart = 0;
  timeSpanDuration = 0;
  removed = false;
  render = true;
  rendered = false;
  startTime: Date | null = null;
  elapsedSeconds: number | null = null;
  renderTemplate: string | null = null;
  readonly templates: string[] = [];
  private readonly first: MockOutputModule = new MockOutputModule();

  constructor(readonly comp: MockItem) {}

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/
  get status(): number {
    if (this.rendered) {
      return RQItemStatus.DONE;
    }
    return this.render ? RQItemStatus.QUEUED : RQItemStatus.UNQUEUED;
  }

  get numOutputModules(): number {
    return 1;
  }

  get statusName(): string {
    return this.rendered ? 'DONE' : this.render ? 'QUEUED' : 'UNQUEUED';
  }

  applyTemplate(name: string): void {
    this.renderTemplate = name;
  }

  outputModule(index: number): MockOutputModule | null {
    return index === 1 ? this.first : null;
  }

  get outputModules(): MockOutputModule[] {
    return [this.first];
  }

  remove(): void {
    this.removed = true;
  }
}

export class MockRenderQueue {
  private readonly list: MockRenderQueueItem[] = [];
  rendering = false;

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/
  readonly items = {
    add: (comp: MockItem): MockRenderQueueItem => {
      const item = new MockRenderQueueItem(comp);
      this.list.push(item);
      return item;
    },
  };

  get numItems(): number {
    return this.list.length;
  }

  item(index: number): MockRenderQueueItem | null {
    return this.list[index - 1] ?? null;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/
  render(): void {
    this.rendering = true;
    for (const item of this.list) {
      if (item.removed || !item.render) {
        continue;
      }
      const file = item.outputModule(1)?.file;
      if (file) {
        file.open('w');
        file.write(`PNG:${item.comp.name}:${item.timeSpanStart}`);
        file.close();
      }
      item.rendered = true;
      item.startTime = new Date(0);
      item.elapsedSeconds = 0;
    }
    this.rendering = false;
  }
}

export class MockProject {
  file: MockFile | null = null;
  bitsPerChannel = 8;
  activeItem: MockItem | null = null;
  selection: MockItem[] = [];
  readonly rootFolder = new MockFolderItem(0, 'Root');
  private readonly all: MockItem[] = [];
  private idCounter = 0;

  readonly items = new MockItemCollection(this);
  readonly renderQueue = new MockRenderQueue();

  get numItems(): number {
    return this.all.length;
  }

  item(index: number): MockItem | undefined {
    return this.all[index - 1];
  }

  allocateId(): number {
    this.idCounter += 1;
    return 1000 + this.idCounter;
  }

  add(item: MockItem, parent: MockFolderItem = this.rootFolder): MockItem {
    item.project = this;
    parent.add(item);
    this.all.push(item);
    return item;
  }

  // app.project.save([file]) — "Pass a File object to save a project to a new
  // file without prompting." https://ae-scripting.docsforadobe.dev/general/project/#projectsave
  save(file?: MockFile): void {
    if (file) {
      this.file = file;
    }
  }

  removeItem(item: MockItem): void {
    const index = this.all.indexOf(item);
    if (index >= 0) {
      this.all.splice(index, 1);
    }
    if (item.parentFolder && item.parentFolder.items) {
      const folderIndex = item.parentFolder.items.indexOf(item);
      if (folderIndex >= 0) {
        item.parentFolder.items.splice(folderIndex, 1);
      }
    }
    item.project = null;
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
    MarkerValue: MockMarkerValue,
    KeyframeEase: MockKeyframeEase,
    KeyframeInterpolationType: MockKeyframeInterpolationType,
    RQItemStatus,
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