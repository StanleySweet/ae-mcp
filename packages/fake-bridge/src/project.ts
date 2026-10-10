export interface CompLayer {
  id: number;
  name: string;
}

export interface Comp {
  id: number;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  layers: CompLayer[];
}

export class FakeProject {
  private nextId = 1;
  comps: Comp[] = [];
  selection: CompLayer[] = [];

  addComp(name: string, width: number, height: number, frameRate = 30): Comp {
    const comp: Comp = {
      id: this.nextId++,
      name,
      width,
      height,
      frameRate,
      layers: [],
    };
    this.comps.push(comp);
    return comp;
  }

  addLayer(comp: Comp, name: string): CompLayer {
    const layer: CompLayer = { id: this.nextId++, name };
    comp.layers.push(layer);
    return layer;
  }
}