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

  get name(): string {
    const i = this.path.lastIndexOf('/');
    return i >= 0 ? this.path.slice(i + 1) : this.path;
  }

  // A folder also exists when some file lives under it.
  get exists(): boolean {
    if (this.ae.dirs.has(this.path)) {
      return true;
    }
    for (const path of this.ae.fs.keys()) {
      if (path.startsWith(`${this.path}/`)) {
        return true;
      }
    }
    return false;
  }

  create(): boolean {
    this.ae.dirs.add(this.path);
    return true;
  }

  // Mirrors Folder.getFiles: direct child files and sub-folders (as MockFolder
  // objects), both filtered by the optional name mask.
  getFiles(mask?: string): Array<MockFile | MockFolder> {
    const pattern = mask ?? '*';
    const out: Array<MockFile | MockFolder> = [];
    const subfolders = new Set<string>();
    for (const path of this.ae.fs.keys()) {
      const rest = path.slice(this.path.length + 1);
      if (!path.startsWith(`${this.path}/`)) {
        continue;
      }
      if (!rest.includes('/')) {
        if (globMatch(rest, pattern)) {
          out.push(new MockFile(this.ae, path));
        }
      } else {
        subfolders.add(rest.slice(0, rest.indexOf('/')));
      }
    }
    for (const dir of this.ae.dirs) {
      if (dir.startsWith(`${this.path}/`) && !dir.slice(this.path.length + 1).includes('/')) {
        subfolders.add(dir.slice(this.path.length + 1));
      }
    }
    for (const name of subfolders) {
      if (globMatch(name, pattern)) {
        out.push(new MockFolder(this.ae, `${this.path}/${name}`));
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
  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemresolutionfactor
  resolutionFactor: [number, number] = [1, 1];
  workAreaStart = 0;
  workAreaDuration = 0;
  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemtime (current time)
  time = 0;
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

  /** Takes `layer` out of the stack and puts it directly before `before` (null: at the end). */
  relocateLayer(layer: MockLayer, before: MockLayer | null): void {
    if (before === layer) return;
    const from = this.layerList.indexOf(layer);
    if (from < 0) return;
    this.layerList.splice(from, 1);
    const at = before ? this.layerList.indexOf(before) : this.layerList.length;
    if (at < 0) {
      this.layerList.splice(from, 0, layer);
      return;
    }
    this.layerList.splice(at, 0, layer);
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

  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemframeduration
  get frameDuration(): number {
    return 1 / this.frameRate;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemmotiongraphicstemplatename
  motionGraphicsTemplateName = '';
  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemrenderers (names are illustrative)
  readonly renderers = ['Classic 3D', 'Advanced 3D'];
  renderer = 'Classic 3D';
  // Essential graphics controls, by name, in panel order (added through Property.addToMotionGraphicsTemplateAs).
  readonly egpControls: string[] = [];
  // Each exportAsMotionGraphicsTemplate call, for tests (the mock writes no file).
  readonly mogrtExports: { overwrite: boolean; folder: string }[] = [];

  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemmotiongraphicstemplatecontrollercount
  get motionGraphicsTemplateControllerCount(): number {
    return this.egpControls.length;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemgetmotiongraphicstemplatecontrollername
  getMotionGraphicsTemplateControllerName(index: number): string {
    return this.egpControls[index - 1] ?? '';
  }

  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemexportasmotiongraphicstemplate
  exportAsMotionGraphicsTemplate(overwrite: boolean, folder?: string): boolean {
    this.mogrtExports.push({ overwrite, folder: folder ?? '' });
    return true;
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
      copy.addLayer(layer.cloneTree());
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
// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerblendingmode (a subset is enough for tests)
export const MockBlendingMode = { NORMAL: 5201, ADD: 5202, SCREEN: 5203, OVERLAY: 5204, MULTIPLY: 5205, SOFT_LIGHT: 5206 };

// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/#textdocumentjustification
export const MockParagraphJustification = {
  LEFT_JUSTIFY: 7413,
  RIGHT_JUSTIFY: 7414,
  CENTER_JUSTIFY: 7415,
  FULL_JUSTIFY_LASTLINE_LEFT: 7416,
  FULL_JUSTIFY_LASTLINE_RIGHT: 7417,
  FULL_JUSTIFY_LASTLINE_CENTER: 7418,
  FULL_JUSTIFY_LASTLINE_FULL: 7419,
  MULTIPLE_JUSTIFICATIONS: 7420,
};

// Only the members the bridge reads. Numeric values are placeholders; the code compares by name.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertypropertyvaluetype
export const PropertyValueType = {
  NO_VALUE: 0,
  OneD: 1,
  TwoD: 2,
  TwoD_SPATIAL: 3,
  ThreeD: 4,
  ThreeD_SPATIAL: 5,
} as const;

// Values are copied so a duplicate never shares an array or object with its source.
function mockCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mockCopyValue(item));
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      copy[key] = mockCopyValue((value as Record<string, unknown>)[key]);
    }
    return copy;
  }
  return value;
}

export const MOCK_BROKEN_EXPRESSION = '@broken';

export class MockProperty {
  // Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybaseenabled
  enabled = true;
  expressionEnabled = false;
  private storedExpression = '';
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionerror
  expressionError = '';
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpression
  // Mirrors the guide: a broken string sets expressionError and disables the
  // expression. The marker MOCK_BROKEN_EXPRESSION stands in for a syntax error.
  get expression(): string {
    return this.storedExpression;
  }
  set expression(value: string) {
    this.storedExpression = value;
    if (value.indexOf(MOCK_BROKEN_EXPRESSION) !== -1) {
      this.expressionError = 'Expression error: unexpected token (line 1)';
      this.expressionEnabled = false;
    } else {
      this.expressionError = '';
    }
  }
  readonly keys: {
    time: number;
    value: unknown;
    inType?: number;
    outType?: number;
    inEase?: MockKeyframeEase[];
    outEase?: MockKeyframeEase[];
    inTangent?: number[];
    outTangent?: number[];
  }[] = [];
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyisspatial
  isSpatial = false;
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyselectedkeys
  selectedKeys: number[] = [];

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertypropertyvaluetype
  propertyValueType: number = PropertyValueType.OneD;
  private storedValue: unknown;

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertycanaddtomotiongraphicstemplate
  // Mock accepts the documented kinds: a number (Numerical Slider) or a text document (Source Text).
  canAddToMotionGraphicsTemplate(comp: MockCompItem): boolean {
    void comp;
    const value = this.storedValue;
    if (typeof value === 'number') return true;
    return value !== null && typeof value === 'object' && !Array.isArray(value) && 'text' in (value as object);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyaddtomotiongraphicstemplateas
  addToMotionGraphicsTemplateAs(comp: MockCompItem, name: string): boolean {
    if (!this.canAddToMotionGraphicsTemplate(comp)) return false;
    comp.egpControls.push(name);
    return true;
  }

  constructor(
    readonly name: string,
    readonly matchName: string,
    value: unknown = null,
  ) {
    this.storedValue = value;
  }

  // Reading the value of a NO_VALUE property throws, as in After Effects.
  get value(): unknown {
    if (this.propertyValueType === PropertyValueType.NO_VALUE) {
      throw new Error("Impossible d'obtenir ou de définir une valeur à partir de cette propriété");
    }
    return this.storedValue;
  }

  set value(next: unknown) {
    this.storedValue = next;
  }

  get numKeys(): number {
    return this.keys.length;
  }

  keyTime(index: number): number {
    return this.keys[index - 1].time;
  }

  keyValue(index: number): unknown {
    return this.keys[index - 1].value;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyininterpolationtype
  keyInInterpolationType(index: number): number {
    return this.keys[index - 1].inType ?? MockKeyframeInterpolationType.LINEAR;
  }

  keyOutInterpolationType(index: number): number {
    return this.keys[index - 1].outType ?? MockKeyframeInterpolationType.LINEAR;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyintemporalease
  keyInTemporalEase(index: number): MockKeyframeEase[] {
    return this.keys[index - 1].inEase ?? [new MockKeyframeEase(0, 16.67)];
  }

  keyOutTemporalEase(index: number): MockKeyframeEase[] {
    return this.keys[index - 1].outEase ?? [new MockKeyframeEase(0, 16.67)];
  }

  // Spatial tangents exist only on spatial properties; other types throw, as in AE.
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyinspatialtangent
  keyInSpatialTangent(index: number): number[] {
    this.assertSpatial('keyInSpatialTangent');
    return [...(this.keys[index - 1].inTangent ?? this.zeroTangent())];
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyoutspatialtangent
  keyOutSpatialTangent(index: number): number[] {
    this.assertSpatial('keyOutSpatialTangent');
    return [...(this.keys[index - 1].outTangent ?? this.zeroTangent())];
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetspatialtangentsatkey
  setSpatialTangentsAtKey(keyIndex: number, inTangent: number[], outTangent: number[] = inTangent): void {
    this.assertSpatial('setSpatialTangentsAtKey');
    Object.assign(this.keys[keyIndex - 1], { inTangent: [...inTangent], outTangent: [...outTangent] });
  }

  private assertSpatial(method: string): void {
    if (!this.isSpatial) {
      throw new Error(`${method} applies only to spatial properties`);
    }
  }

  private zeroTangent(): number[] {
    return Array.from({ length: this.numDimensions }, () => 0);
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

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynearestkeyindex
  nearestKeyIndex(time: number): number {
    let best = 1;
    this.keys.forEach((k, i) => {
      if (Math.abs(k.time - time) < Math.abs(this.keys[best - 1].time - time)) best = i + 1;
    });
    return best;
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

  setInterpolationTypeAtKey(keyIndex: number, inType: number, outType: number = inType): void {
    this.interpolationTypes.push({ keyIndex, inType, outType });
    Object.assign(this.keys[keyIndex - 1], { inType, outType });
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysettemporaleaseatkey
  setTemporalEaseAtKey(
    keyIndex: number,
    inEase: MockKeyframeEase[],
    outEase: MockKeyframeEase[] = inEase,
  ): void {
    this.temporalEases.push({ keyIndex, inEase, outEase });
    Object.assign(this.keys[keyIndex - 1], { inEase, outEase });
  }

  // Step-wise: the last key at or before t, the first key before them all, or the static value without keys.
  // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime
  valueAtTime(time: number, preExpression: boolean): unknown {
    void preExpression;
    if (this.keys.length === 0) {
      return this.value;
    }
    let atOrBefore: (typeof this.keys)[number] | null = null;
    let earliest = this.keys[0];
    for (const key of this.keys) {
      if (key.time < earliest.time) earliest = key;
      if (key.time <= time && (atOrBefore === null || key.time > atOrBefore.time)) atOrBefore = key;
    }
    const best = atOrBefore ?? earliest;
    return best.value;
  }

  // Real AE refuses setValue on a keyframed property: "use setValueAtTime() or
  // setValueAtKey() instead" (found by the test drive).
  setValue(value: unknown): void {
    if (this.numKeys > 0) {
      throw new Error('mock AE: cannot call setValue() on a property with keyframes; use setValueAtTime()');
    }
    this.value = value;
  }
}

// Independent copy for a duplicated comp: real AE gives each duplicate its own properties.
function mockCloneProperty(prop: MockProperty): MockProperty {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(prop)), prop) as MockProperty;
  (copy as unknown as { keys: unknown[] }).keys = prop.keys.map((key) => ({ ...key, value: mockCopyValue(key.value) }));
  copy.selectedKeys = prop.selectedKeys.slice();
  (copy as unknown as { storedValue: unknown }).storedValue = mockCopyValue((prop as unknown as { storedValue: unknown }).storedValue);
  return copy;
}

export class MockPropertyGroup {
  protected readonly children: (MockProperty | MockPropertyGroup)[] = [];
  private parentGroup: MockPropertyGroup | null = null;

  constructor(
    readonly name: string,
    readonly matchName: string,
  ) {}

  get numProperties(): number {
    return this.children.length;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybasepropertyindex
  get propertyIndex(): number {
    return this.parentGroup ? this.parentGroup.children.indexOf(this) + 1 : 0;
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
    if (child instanceof MockPropertyGroup) {
      child.parentGroup = this;
    }
    return child;
  }

  /** An independent copy of this group and everything under it (see mockCloneProperty). */
  cloneTree(): this {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this) as this;
    (copy as unknown as { children: unknown[] }).children = [];
    for (const child of this.children) {
      copy.add(child instanceof MockPropertyGroup ? child.cloneTree() : mockCloneProperty(child));
    }
    return copy;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupcanaddproperty
  canAddProperty(name: string): boolean {
    void name;
    return true;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybasemoveto
  moveTo(newIndex: number): void {
    const parent = this.parentGroup;
    if (!parent) {
      throw new Error('mock AE: moveTo needs an indexed parent group');
    }
    parent.children.splice(parent.children.indexOf(this), 1);
    parent.children.splice(newIndex - 1, 0, this);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybaseremove
  remove(): void {
    const parent = this.parentGroup;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
  }

  addProperty(matchName: string): MockEffect {
    const effect = this.add(new MockEffect(matchName, matchName));
    // A Slider Control exposes its value as "ADBE Slider Control-0001".
    if (matchName === 'ADBE Slider Control') {
      effect.add(new MockProperty('Slider', 'ADBE Slider Control-0001', 0));
    }
    // The parameters the bridge sets on these effects, as the live probe named them.
    const params = MOCK_EFFECT_PARAMS[matchName];
    if (params) {
      for (const [param, value] of params) {
        effect.add(new MockProperty(param, param, value));
      }
    }
    return effect;
  }
}

// Parameter match names of the first-party effects the bridge sets (#225), read
// from a live probe of AE 26.5 fr_FR: docs/findings/2026-10-17-effect-param-matchnames.md.
// Each entry is [match name, default value]. Only the parameters the bridge uses.
const MOCK_EFFECT_PARAMS: Record<string, [string, unknown][]> = {
  'ADBE Linear Wipe': [['ADBE Linear Wipe-0001', 0]],
  'ADBE Glo2': [
    ['ADBE Glo2-0002', 0],
    ['ADBE Glo2-0003', 0],
    ['ADBE Glo2-0004', 0],
  ],
  'ADBE Gaussian Blur 2': [['ADBE Gaussian Blur 2-0001', 0]],
  'ADBE Noise': [['ADBE Noise-0001', 0]],
  'ADBE Drop Shadow': [
    ['ADBE Drop Shadow-0002', 0],
    ['ADBE Drop Shadow-0004', 0],
    ['ADBE Drop Shadow-0005', 0],
  ],
  'CS Vignette': [['CS Vignette-0001', 0]],
  'ADBE Tint': [
    ['ADBE Tint-0001', [0, 0, 0]],
    ['ADBE Tint-0002', [1, 1, 1]],
    ['ADBE Tint-0003', 0],
  ],
  'ADBE Turbulent Displace': [['ADBE Turbulent Displace-0002', 0]],
  'ADBE Brightness & Contrast 2': [
    ['ADBE Brightness & Contrast 2-0001', 0],
    ['ADBE Brightness & Contrast 2-0002', 0],
  ],
};

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

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovetobeginning
  moveToBeginning(): void {
    if (this.containingComp) this.containingComp.relocateLayer(this, this.containingComp.layer(1));
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovetoend
  moveToEnd(): void {
    if (this.containingComp) this.containingComp.relocateLayer(this, null);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovebefore
  moveBefore(layer: MockLayer): void {
    if (this.containingComp) this.containingComp.relocateLayer(this, layer);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermoveafter
  moveAfter(layer: MockLayer): void {
    if (!this.containingComp) return;
    this.containingComp.relocateLayer(this, this.containingComp.layer(layer.index + 1));
  }
}

export class MockAVLayer extends MockLayer {
  width = 0;
  height = 0;
  hasVideo = true;
  hasAudio = false;
  threeDLayer = false;
  blendingMode = MockBlendingMode.NORMAL;
  source: MockItem | null = null;

  private transformValue(matchName: string): number[] | null {
    const transform = this.property('ADBE Transform Group') as MockPropertyGroup | null;
    const prop = transform ? (transform.property(matchName) as MockProperty | null) : null;
    return prop && Array.isArray(prop.value) ? (prop.value as number[]) : null;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerreplacesource
  replaceSource(newSource: MockItem, fixExpressions: boolean): void {
    this.source = newSource;
    this.fixedExpressions = fixExpressions;
  }

  fixedExpressions = false;

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

export class MockTextLayer extends MockAVLayer {
  // Rough box model for fit-to-box tests (not real glyph metrics): a character is half the
  // font size wide and a line is 1.2 times the font size tall.
  // Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayersourcerectattime
  sourceRectAtTime(): { top: number; left: number; width: number; height: number } {
    const prop = this.property('Source Text') as MockProperty | null;
    const doc = prop ? (prop.value as { text: string; fontSize: number }) : { text: '', fontSize: 0 };
    const width = doc.text.length * doc.fontSize * 0.5;
    const height = doc.fontSize * 1.2;
    return { top: -height / 2, left: -width / 2, width, height };
  }

  // Real AE resolves `layer.property('Source Text')` into the text properties
  // group; mirror that shortcut so handlers can address it directly.
  property(indexOrName: number | string): MockProperty | MockPropertyGroup | null {
    if (indexOrName === 'Source Text' || indexOrName === 'ADBE Text Document') {
      const text = super.property('ADBE Text Properties') as MockPropertyGroup | null;
      return text ? text.property(indexOrName) : null;
    }
    return super.property(indexOrName);
  }
}

// Shape-layer contents. Real AE 26.5 segfaults on `addProperty` with an unknown
// match name (docs/findings/2026-10-16-shape-path-matchname-crash.md); the mock
// throws instead so tests catch a bad name.
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/
const VECTOR_ITEMS: Record<string, string> = {
  'ADBE Vector Group': 'Group',
  'ADBE Vector Shape - Group': 'Path',
  'ADBE Vector Shape - Rect': 'Rectangle',
  'ADBE Vector Shape - Ellipse': 'Ellipse',
  'ADBE Vector Shape - Star': 'Polystar',
  'ADBE Vector Graphic - Fill': 'Fill',
  'ADBE Vector Graphic - Stroke': 'Stroke',
};

// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/
function vectorGroupTransform(): MockPropertyGroup {
  const transform = new MockPropertyGroup('Transform', 'ADBE Vector Transform Group');
  transform.add(new MockProperty('Anchor Point', 'ADBE Vector Anchor', [0, 0]));
  transform.add(new MockProperty('Position', 'ADBE Vector Position', [0, 0]));
  transform.add(new MockProperty('Scale', 'ADBE Vector Scale', [100, 100]));
  transform.add(new MockProperty('Rotation', 'ADBE Vector Rotation', 0));
  transform.add(new MockProperty('Opacity', 'ADBE Vector Group Opacity', 100));
  return transform;
}

export class MockVectorsGroup extends MockPropertyGroup {
  canAddProperty(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(VECTOR_ITEMS, name);
  }

  // Typed MockEffect to satisfy the base signature; only the group shape matters.
  addProperty(matchName: string): MockEffect {
    if (!this.canAddProperty(matchName)) {
      throw new Error('mock AE: cannot add unknown vector item ' + matchName);
    }
    const item = this.add(new MockEffect(VECTOR_ITEMS[matchName], matchName));
    if (matchName === 'ADBE Vector Group') {
      item.add(new MockVectorsGroup('Contents', 'ADBE Vectors Group'));
      // Every Vector Group carries its own Transform group; it is never addProperty'd.
      item.add(vectorGroupTransform());
    } else if (matchName === 'ADBE Vector Shape - Group') {
      item.add(new MockProperty('Path', 'ADBE Vector Shape', null));
    } else if (matchName === 'ADBE Vector Shape - Rect') {
      item.add(new MockProperty('Size', 'ADBE Vector Rect Size', [100, 100]));
      item.add(new MockProperty('Position', 'ADBE Vector Rect Position', [0, 0]));
      item.add(new MockProperty('Roundness', 'ADBE Vector Rect Roundness', 0));
    } else if (matchName === 'ADBE Vector Shape - Ellipse') {
      item.add(new MockProperty('Size', 'ADBE Vector Ellipse Size', [100, 100]));
      item.add(new MockProperty('Position', 'ADBE Vector Ellipse Position', [0, 0]));
    } else if (matchName === 'ADBE Vector Graphic - Fill') {
      item.add(new MockProperty('Color', 'ADBE Vector Fill Color', [1, 0, 0, 1]));
      item.add(new MockProperty('Opacity', 'ADBE Vector Fill Opacity', 100));
    } else if (matchName === 'ADBE Vector Graphic - Stroke') {
      item.add(new MockProperty('Color', 'ADBE Vector Stroke Color', [1, 1, 1, 1]));
      item.add(new MockProperty('Stroke Width', 'ADBE Vector Stroke Width', 2));
      item.add(new MockProperty('Opacity', 'ADBE Vector Stroke Opacity', 100));
    }
    return item;
  }
}

// A layer's Masks group with the display names fr_FR AE 26.5 reported live
// ("Masques", "Masque 1", "Tracé du masque"), so a handler that looks masks up
// by English display name fails here as it would there. Match names were read
// from live AE: the scripting guide lists only ADBE Mask Parade.
export class MockMaskParade extends MockPropertyGroup {
  constructor() {
    super('Masques', 'ADBE Mask Parade');
  }

  canAddProperty(name: string): boolean {
    return name === 'ADBE Mask Atom';
  }

  // Typed MockEffect to satisfy the base signature; only the group shape matters.
  addProperty(matchName: string): MockEffect {
    if (!this.canAddProperty(matchName)) {
      throw new Error('mock AE: cannot add ' + matchName + ' to the mask parade');
    }
    const atom = this.add(new MockEffect('Masque ' + (this.numProperties + 1), 'ADBE Mask Atom'));
    atom.add(new MockProperty('Tracé du masque', 'ADBE Mask Shape', new MockShape()));
    return atom;
  }
}

// Ref: https://ae-scripting.docsforadobe.dev/other/shape/
export class MockShape {
  vertices: number[][] = [];
  inTangents: number[][] = [];
  outTangents: number[][] = [];
  closed = true;
}

/** Real AE layers always carry a Transform group; give shape/text layers Position and Opacity. */
export class MockShapeLayer extends MockAVLayer {
  constructor(name: string, matchName: string) {
    super(name, matchName);
    withTransform(this);
    this.add(new MockVectorsGroup('Contents', 'ADBE Root Vectors Group'));
  }
}

export class MockCameraLayer extends MockLayer {}

export class MockLightLayer extends MockLayer {
  lightType = 0;
  // Ref: https://ae-scripting.docsforadobe.dev/layer/lightlayer/#lightlayerlightsource
}

// Ref: https://ae-scripting.docsforadobe.dev/layer/lightlayer/#lightlayerlighttype
export const MockLightType = { PARALLEL: 1, SPOT: 2, POINT: 3, AMBIENT: 4, ENVIRONMENT: 5 };

// Ref: https://ae-scripting.docsforadobe.dev/sources/solidsource/
export class MockSolidSource {
  constructor(public color: number[]) {}
}

// Ref: https://ae-scripting.docsforadobe.dev/sources/filesource/
export class MockFileSource {
  constructor(
    public file: MockFile | null,
    public missingFootagePath = '',
  ) {}
}

export class MockFootageItem extends MockItem {
  mainSource: MockSolidSource | MockFileSource | null = null;
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

  // FootageItem.replace(file): swaps the main source for the given file.
  // Ref: https://ae-scripting.docsforadobe.dev/item/footageitem/#footageitemreplace
  replace(file: MockFile): void {
    this.file = file;
    this.mainSource = new MockFileSource(file);
    this.footageMissing = false;
  }
}

// Ref: https://ae-scripting.docsforadobe.dev/other/importoptions/
export class MockImportOptions {
  constructor(public file: MockFile | null = null) {}
}

// Every real layer carries the Transform group; layers made through the
// collection get one so handlers can set position, scale, rotation and opacity.
function withTransform<T extends MockLayer>(layer: T): T {
  const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
  transform.add(new MockProperty('Anchor Point', 'ADBE Anchor Point', [0, 0, 0]));
  // A 2D layer's Position is TwoD_SPATIAL and Scale is ThreeD; Rotation and Opacity are OneD.
  const position = new MockProperty('Position', 'ADBE Position', [0, 0, 0]);
  position.propertyValueType = PropertyValueType.ThreeD_SPATIAL;
  transform.add(position);
  const scale = new MockProperty('Scale', 'ADBE Scale', [100, 100, 100]);
  scale.propertyValueType = PropertyValueType.ThreeD;
  transform.add(scale);
  transform.add(new MockProperty('Rotation', 'ADBE Rotate Z', 0));
  transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
  layer.add(transform);
  return layer;
}

export class MockLayerCollection {
  constructor(private readonly comp: MockCompItem) {}

  // Real AE's LayerCollection.add* puts the new layer at index 1; the mock
  // appends unless the project opts in (older tests rely on append order).
  private addOnTop<T extends MockLayer>(layer: T): T {
    if (this.comp.project?.newLayersOnTop) {
      this.comp.insertLayerAt(1, layer);
      return layer;
    }
    return this.comp.addLayer(layer);
  }

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
    return this.addOnTop(withTransform(layer));
  }

  addShape(): MockShapeLayer {
    const layer = new MockShapeLayer('Shape', 'Layer');
    layer.id = this.comp.nextLayerId();
    return this.addOnTop(layer);
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
    source.mainSource = new MockSolidSource(color);
    return this.addOnTop(withTransform(layer));
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddcamera
  addCamera(name: string, centerPoint: number[]): MockCameraLayer {
    void centerPoint;
    const layer = new MockCameraLayer(name, 'Layer');
    layer.id = this.comp.nextLayerId();
    return this.comp.addLayer(layer);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddlight
  addLight(name: string, centerPoint: number[]): MockLightLayer {
    void centerPoint;
    const layer = new MockLightLayer(name, 'Layer');
    layer.id = this.comp.nextLayerId();
    return this.comp.addLayer(layer);
  }

  addNull(duration?: number): MockAVLayer {
    const layer = new MockAVLayer('Null', 'Layer');
    layer.id = this.comp.nextLayerId();
    layer.nullLayer = true;
    layer.outPoint = duration ?? 0;
    return this.addOnTop(withTransform(layer));
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
        fontFamily: 'Arial',
        fontStyle: 'Regular',
        justification: MockParagraphJustification.LEFT_JUSTIFY,
        tracking: 0,
        leading: 0,
        fillColor: [1, 1, 1],
      }),
    );
    layer.add(textProperties);
    return this.addOnTop(withTransform(layer));
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
  readonly templates = ['Best Settings', 'Draft Settings'];
  private readonly first: MockOutputModule = new MockOutputModule();

  constructor(
    readonly comp: MockItem,
    private readonly queue: MockRenderQueue | null = null,
  ) {}

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

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemremove
  remove(): void {
    this.removed = true;
    this.queue?.drop(this);
  }
}

export class MockRenderQueue {
  private readonly list: MockRenderQueueItem[] = [];
  rendering = false;

  // Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/
  readonly items = {
    add: (comp: MockItem): MockRenderQueueItem => {
      const item = new MockRenderQueueItem(comp, this);
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

  /** Takes an item out of the queue; the items after it move up one index. */
  drop(item: MockRenderQueueItem): void {
    const at = this.list.indexOf(item);
    if (at >= 0) this.list.splice(at, 1);
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
  // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectdirty
  dirty = false;
  newLayersOnTop = false;
  readonly closed: number[] = [];
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

  // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectimportfile
  importFile(options: MockImportOptions): MockFootageItem {
    if (!options.file || !options.file.exists) {
      throw new Error('mock AE: unable to import ' + (options.file ? options.file.path : 'no file'));
    }
    const item = new MockFootageItem(this.allocateId(), options.file.name, 1920, 1080);
    item.file = options.file;
    this.add(item);
    return item;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectreduceproject
  // Removes every item not in `keep` and returns how many were removed.
  reduceProject(keep: MockItem[]): number {
    const kept = new Set<MockItem>(keep);
    const doomed = this.all.filter((item) => !kept.has(item));
    for (const item of doomed) {
      this.removeItem(item);
    }
    return doomed.length;
  }

  // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectconsolidatefootage
  // Mock keeps no duplicate footage, so nothing is consolidated.
  consolidateFootage(): number {
    return 0;
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

  // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectclose
  close(options: number): boolean {
    this.closed.push(options);
    this.file = null;
    this.dirty = false;
    return true;
  }

  // What app.newProject() leaves behind: an empty, unsaved, clean project.
  // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appnewproject
  reset(): void {
    this.file = null;
    this.dirty = false;
    this.all.length = 0;
    this.activeItem = null;
    this.selection = [];
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

// Ref: https://ae-scripting.docsforadobe.dev/text/fontobject/
export class MockFontObject {
  constructor(
    readonly familyName: string,
    readonly styleName: string,
    readonly postScriptName: string,
  ) {}

  get fullName(): string {
    return this.familyName + ' ' + this.styleName;
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
  // Commands run while an undo group is open; real AE warns "Undo group mismatch" for Undo (#195).
  readonly commandsInUndoGroup: number[] = [];
  readonly opened: string[] = [];
  readonly menuCommandIds: Record<string, number> = { 'Increment and Save': 3088 };
  // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appeffects
  readonly effects = [
    { displayName: 'Slider Control', matchName: 'ADBE Slider Control', category: 'Expression Controls', version: '1.0' },
    { displayName: 'Glow', matchName: 'ADBE Glo2', category: 'Stylize', version: '1.0' },
  ];
  evalFileCalls = 0;
  context: vm.Context | null = null;
  private clock = 0;
  private undoDepth = 0;
  private suppressDepth = 0;
  /** Error dialogs AE would have shown (an error raised while dialogs were not suppressed). */
  readonly errorDialogs: string[] = [];
  private nextTaskId = 1;
  private readonly tasks = new Map<number, MockTask>();

  /** An AE API reporting an error: onError hears it; unsuppressed, it is also a modal. */
  simulateError(message: string, severity = 'problem'): void {
    const handler = this.app.onError;
    if (typeof handler === 'function') (handler as (m: string, s: string) => void)(message, severity);
    if (this.suppressDepth === 0) this.errorDialogs.push(message);
  }

  // Ref: https://ae-scripting.docsforadobe.dev/text/fontsobject/#fontsobjectallfonts
  // Family groups: each entry is an array of the FontObjects of one family.
  readonly fontFamilies: MockFontObject[][] = [];

  app = {
    exitCode: 0,
    version: 'MockAE-25',
    project: this.project,
    effects: this.effects,
    // Ref: https://ae-scripting.docsforadobe.dev/text/fontsobject/
    fonts: { allFonts: this.fontFamilies },
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
    // Ref: https://ae-scripting.docsforadobe.dev/general/application/#apponerror
    onError: null as unknown,
    // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appbeginsuppressdialogs
    beginSuppressDialogs: (): void => {
      this.suppressDepth += 1;
    },
    // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appendsuppressdialogs
    endSuppressDialogs: (alert: boolean): void => {
      void alert;
      this.suppressDepth = Math.max(0, this.suppressDepth - 1);
    },
    // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appopen
    open: (file: MockFile): MockProject | null => {
      if (!file.exists) return null;
      this.project.file = file;
      this.project.dirty = false;
      this.opened.push(file.fsName);
      return this.project;
    },
    // Ref: https://ae-scripting.docsforadobe.dev/general/application/#appnewproject
    newProject: (): MockProject => {
      this.project.reset();
      return this.project;
    },
    findMenuCommandId: (name: string): number => this.menuCommandIds[name] ?? 0,
    executeCommand: (id: number): void => {
      if (this.undoDepth > 0) this.commandsInUndoGroup.push(id);
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
  /** Lines written with the global `writeLn` (the Info panel). */
  readonly consoleLines: string[] = [];

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

// Real AE (test drive, #200/#209): a ShapeLayer is not `instanceof AVLayer` in
// ExtendScript, and TextLayer is not treated as one either. Mirror that so
// `instanceof AVLayer` in handlers sees the same hierarchy as AE.
const MockAVLayerInSandbox = {
  [Symbol.hasInstance]: (value: unknown): boolean =>
    value instanceof MockAVLayer && !(value instanceof MockShapeLayer) && !(value instanceof MockTextLayer),
};

// `new Folder(path)` yields a MockFolder; `instanceof Folder` must match it too.
function folderConstructorFor(ae: MockAE): unknown {
  const ctor = function (path: string): MockFolder {
    return new MockFolder(ae, path);
  };
  Object.defineProperty(ctor, Symbol.hasInstance, {
    value: (value: unknown): boolean => value instanceof MockFolder,
  });
  return ctor;
}

export function runInMockAE(code: string, ae: MockAE): vm.Context {
  const folderConstructor = folderConstructorFor(ae);
  const sandbox: Record<string, unknown> = {
    app: ae.app,
    $: ae.$,
    // Ref: https://ae-scripting.docsforadobe.dev/general/globals/#writeln
    writeLn: (text: string): void => {
      ae.consoleLines.push(text);
    },
    JSON: undefined,
    CompItem: MockCompItem,
    FolderItem: MockFolderItem,
    FootageItem: MockFootageItem,
    ImportOptions: MockImportOptions,
    SolidSource: MockSolidSource,
    CloseOptions: { DO_NOT_SAVE_CHANGES: 1612, PROMPT_TO_SAVE_CHANGES: 1613, SAVE_CHANGES: 1614 },
    AVLayer: MockAVLayerInSandbox,
    TextLayer: MockTextLayer,
    ShapeLayer: MockShapeLayer,
    Shape: MockShape,
    CameraLayer: MockCameraLayer,
    LightLayer: MockLightLayer,
    LightType: MockLightType,
    MarkerValue: MockMarkerValue,
    KeyframeEase: MockKeyframeEase,
    KeyframeInterpolationType: MockKeyframeInterpolationType,
    BlendingMode: MockBlendingMode,
    ParagraphJustification: MockParagraphJustification,
    PropertyValueType,
    RQItemStatus,
    File: function (path: string): MockFile {
      return new MockFile(ae, path);
    },
    Folder: folderConstructor,
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