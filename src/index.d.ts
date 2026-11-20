export type PresetName = 'regular' | 'clear' | 'identity';
export type ShapeInput =
  | 'capsule'
  | 'rect'
  | `rect(${number})`
  | 'circle'
  | 'ellipse'
  | 'star'
  | 'triangle'
  | 'hexagon'
  | { text: string; font?: string; profile?: 'sculpted' | 'plate' }
  | { svg: string; profile?: 'sculpted' | 'plate' };

export interface GlassProps {
  preset?: PresetName;
  material?: Glass;
  shape?: ShapeInput;
  morph?: { from: ShapeInput; to: ShapeInput; t: number };
  subtract?: { shape?: ShapeInput; scale?: number; offsetX?: number; offsetY?: number; smooth?: number };
  frame?: { x: number; y: number; width: number; height: number };
  radius?: number;
  smoothing?: number;
  refraction?: number;
  depth?: number;
  dispersion?: number;
  frost?: number;
  splay?: number;
  lightAngle?: number;
  lightIntensity?: number;
  rotation?: number;
  tint?: string | [number, number, number];
  tintOpacity?: number;
  interactive?: boolean;
}

export interface GlassGroupSpec {
  type: 'group';
  gooey?: number;
  children: Array<GlassProps | GlassGroupSpec>;
}

export declare class Glass {
  readonly config: Readonly<{
    refraction: number;
    depth: number;
    dispersion: number;
    frost: number;
    splay: number;
    lightAngle: number;
    lightIntensity: number;
    rotation: number;
    fillRgb: readonly [number, number, number];
    fillOpacity: number;
    interactive: boolean;
  }>;
  static readonly regular: Glass;
  static readonly clear: Glass;
  static readonly identity: Glass;
  static from(input?: Glass | PresetName): Glass;
  tint(color: string | [number, number, number], opacityPct?: number): Glass;
  interactive(enabled?: boolean): Glass;
  refraction(v: number): Glass;
  depth(v: number): Glass;
  dispersion(v: number): Glass;
  frost(v: number): Glass;
  splay(v: number): Glass;
  light(opts?: { angle?: number; intensity?: number }): Glass;
  rotation(deg: number): Glass;
}

export declare function parseTint(input: string | [number, number, number], fallbackOpacity?: number): { rgb: [number, number, number]; opacityPct: number } | null;
export declare function resolveShapeSpec(shape?: ShapeInput): any;
export declare function resolveMaterial(props?: GlassProps): Glass;
export declare function compileSceneIR(items: Array<GlassProps | GlassGroupSpec>): any[];
export declare function resolveBlurTier(frost: number, w: number, h: number): { width: number; height: number; sigma: number; tier: 'full-1:1' | 'nyquist-half' };
export declare function bindVideoFrameSync(videoEl: HTMLVideoElement, onNewFrame: (v: HTMLVideoElement) => void): () => void;

export interface GlassRenderer {
  render(irNodes: CompiledGlassNode[], backdropSource?: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null, forceBlurRefresh?: boolean): void;
  buildBezierSdf(segs: unknown[], boxW?: number, boxH?: number): void;
  markBackdropDirty(): void;
  destroy(): void;
}
export function createGlassRenderer(canvas: HTMLCanvasElement, options?: { preserveDrawingBuffer?: boolean }): GlassRenderer;
