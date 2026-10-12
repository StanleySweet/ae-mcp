export interface CompLayer {
  id: number;
  name: string;
  inPoint: number;
  outPoint: number;
}

export interface Comp {
  id: number;
  name: string;
  width: number;
  height: number;
  pixelAspect: number;
  frameRate: number;
  duration: number;
  bgColor: [number, number, number];
  layers: CompLayer[];
}

export interface CompOptions {
  pixelAspect?: number;
  duration?: number;
  bgColor?: [number, number, number];
}

export class FakeProject {
  private nextId = 1;
  comps: Comp[] = [];
  selection: CompLayer[] = [];

  newId(): number {
    return this.nextId++;
  }

  addComp(
    name: string,
    width: number,
    height: number,
    frameRate = 30,
    options: CompOptions = {},
  ): Comp {
    const comp: Comp = {
      id: this.newId(),
      name,
      width,
      height,
      pixelAspect: options.pixelAspect ?? 1,
      frameRate,
      duration: options.duration ?? 10,
      bgColor: options.bgColor
        ? [options.bgColor[0], options.bgColor[1], options.bgColor[2]]
        : [0, 0, 0],
      layers: [],
    };
    this.comps.push(comp);
    return comp;
  }

  addLayer(comp: Comp, name: string): CompLayer {
    const layer: CompLayer = { id: this.newId(), name, inPoint: 0, outPoint: comp.duration };
    comp.layers.push(layer);
    return layer;
  }
}
