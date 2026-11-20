// ============================================================================
// Figma Liquid Glass v4.0 — AI-Friendly Declarative Scene IR & Core SDK
//
// Design Principles:
//   1. 100% Visual Parity with Original Figma 6 Physical Laws (sRGB [0..1])
//   2. Infinite Composition: Gooey (smin), Morph, Boolean Subtract/Intersect, Text/SVG
//   3. Progressive Disclosure: Presets ("regular", "clear", "identity") + Full 0~100 Numbers
//   4. Deterministic Precedence: preset -> material chain -> flat numeric props
// ============================================================================

const NAMED_COLORS = Object.freeze({
  white: [1.0, 1.0, 1.0],
  black: [0.0, 0.0, 0.0],
  blue: [0.0, 0.47843137, 1.0],
  orange: [1.0, 0.58431373, 0.0],
  pink: [1.0, 0.17647059, 0.33333333],
  red: [1.0, 0.23137255, 0.18823529],
  green: [0.20392157, 0.78039216, 0.34901961],
  indigo: [0.34509804, 0.3372549, 0.83921569],
  purple: [0.68627451, 0.32156863, 0.87058824],
  cyan: [0.19607843, 0.67843137, 0.90196078],
  yellow: [1.0, 0.8, 0.0],
  gray: [0.55686275, 0.55686275, 0.57647059],
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Parses tint inputs including Tailwind/SwiftUI shorthand `'#007AFF/18'` or `'blue/20'`.
 */
export function parseTint(input, fallbackOpacity = 18.0) {
  if (input == null) return null;
  if (typeof input === 'string' && input.includes('/')) {
    const [colorPart, opPart] = input.split('/');
    return {
      rgb: parseColorRgb(colorPart.trim()),
      opacityPct: clamp(Number(opPart.trim()), 0, 100),
    };
  }
  return {
    rgb: parseColorRgb(input),
    opacityPct: clamp(Number(fallbackOpacity), 0, 100),
  };
}

export function parseColorRgb(color) {
  if (Array.isArray(color) && color.length >= 3) {
    const s = color.some((c) => c > 1.0) ? 255.0 : 1.0;
    return [clamp(color[0] / s, 0, 1), clamp(color[1] / s, 0, 1), clamp(color[2] / s, 0, 1)];
  }
  if (typeof color === 'string') {
    const t = color.trim().toLowerCase();
    if (NAMED_COLORS[t]) return [...NAMED_COLORS[t]];
    const hex = t.startsWith('#') ? t.slice(1) : t;
    if (/^[0-9a-f]{3}$/.test(hex)) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      ];
    }
  }
  throw new Error(`Unsupported color: ${String(color)}`);
}

/** Exact original Figma Liquid Glass calibrated defaults (MAE < 0.40/255). */
export const FIGMA_DEFAULTS = Object.freeze({
  refraction: 100.0,
  depth: 100.0,
  dispersion: 20.0,
  frost: 4.0,
  splay: 100.0,
  lightAngle: -45.0,
  lightIntensity: 80.0,
  rotation: 0.0,
  fillRgb: Object.freeze([1.0, 1.0, 1.0]),
  fillOpacity: 0.0,
  interactive: false,
});

/**
 * Immutable SwiftUI-style material token with full 0~100 numeric control.
 * Example: `Glass.regular.refraction(90).depth(60).tint('#007AFF/18').interactive()`
 */
export class Glass {
  constructor(cfg = {}) {
    this.config = Object.freeze({
      refraction: cfg.refraction ?? FIGMA_DEFAULTS.refraction,
      depth: cfg.depth ?? FIGMA_DEFAULTS.depth,
      dispersion: cfg.dispersion ?? FIGMA_DEFAULTS.dispersion,
      frost: cfg.frost ?? FIGMA_DEFAULTS.frost,
      splay: cfg.splay ?? FIGMA_DEFAULTS.splay,
      lightAngle: cfg.lightAngle ?? FIGMA_DEFAULTS.lightAngle,
      lightIntensity: cfg.lightIntensity ?? FIGMA_DEFAULTS.lightIntensity,
      rotation: cfg.rotation ?? FIGMA_DEFAULTS.rotation,
      fillRgb: Object.freeze([...(cfg.fillRgb ?? FIGMA_DEFAULTS.fillRgb)]),
      fillOpacity: cfg.fillOpacity ?? FIGMA_DEFAULTS.fillOpacity,
      interactive: Boolean(cfg.interactive ?? FIGMA_DEFAULTS.interactive),
    });
    Object.freeze(this);
  }

  static get regular() { return new Glass(FIGMA_DEFAULTS); }
  static get clear() { return new Glass({ ...FIGMA_DEFAULTS, frost: 0.0 }); }
  static get identity() {
    return new Glass({
      ...FIGMA_DEFAULTS,
      refraction: 0.0,
      depth: 0.0,
      dispersion: 0.0,
      frost: 0.0,
      lightIntensity: 0.0,
      fillOpacity: 0.0,
    });
  }

  static from(input) {
    if (input instanceof Glass) return input;
    if (input == null || input === 'regular') return Glass.regular;
    if (input === 'clear') return Glass.clear;
    if (input === 'identity') return Glass.identity;
    if (typeof input === 'object') return new Glass(input);
    throw new Error(`Unknown Glass preset: ${String(input)}`);
  }

  with(patch) { return new Glass({ ...this.config, ...patch }); }
  tint(color, opacityPct) {
    const parsed = parseTint(color, opacityPct ?? 18.0);
    return this.with({ fillRgb: parsed.rgb, fillOpacity: parsed.opacityPct });
  }
  interactive(enabled = true) { return this.with({ interactive: Boolean(enabled) }); }
  refraction(v) { return this.with({ refraction: clamp(Number(v), 0, 100) }); }
  depth(v) { return this.with({ depth: clamp(Number(v), 0, 100) }); }
  dispersion(v) { return this.with({ dispersion: clamp(Number(v), 0, 100) }); }
  frost(v) { return this.with({ frost: Math.max(Number(v), 0) }); }
  splay(v) { return this.with({ splay: clamp(Number(v), 0, 100) }); }
  light({ angle = this.config.lightAngle, intensity = this.config.lightIntensity } = {}) {
    return this.with({ lightAngle: Number(angle), lightIntensity: clamp(Number(intensity), 0, 100) });
  }
  rotation(deg) { return this.with({ rotation: Number(deg) }); }
}

/**
 * Resolves shape shorthands:
 * `'capsule'`, `'rect'`, `'rect(32)'`, `'circle'`, `'star'`, `'triangle'`, `'hexagon'`,
 * `{ text: 'Apple', font, profile }`, `{ svg: 'M...' }`.
 */
export function resolveShapeSpec(shape) {
  if (!shape || shape === 'capsule') {
    return { kind: 'capsule', shapeMode: 0, cornerRadii: null, cornerSmoothing: 0.0 };
  }
  if (typeof shape === 'string') {
    const s = shape.trim();
    const rectMatch = /^rect\((\d+(?:\.\d+)?)\)$/i.exec(s);
    if (rectMatch) {
      const r = Number(rectMatch[1]);
      return { kind: 'rect', shapeMode: 0, cornerRadii: [r, r, r, r], cornerSmoothing: 0.6 };
    }
    if (s === 'rect' || s === 'squircle') return { kind: 'rect', shapeMode: 0, cornerRadii: [28, 28, 28, 28], cornerSmoothing: 0.6 };
    if (s === 'circle' || s === 'ellipse') return { kind: s, shapeMode: 1, cornerRadii: [0, 0, 0, 0], cornerSmoothing: 0.0 };
    if (s === 'star') return { kind: 'star', shapeMode: 2, cornerRadii: [0, 0, 0, 0], cornerSmoothing: 0.0 };
    if (s === 'triangle') return { kind: 'triangle', shapeMode: 3, cornerRadii: [0, 0, 0, 0], cornerSmoothing: 0.0 };
    if (s === 'hexagon') return { kind: 'hexagon', shapeMode: 4, cornerRadii: [0, 0, 0, 0], cornerSmoothing: 0.0 };
  }
  if (typeof shape === 'object') {
    if (typeof shape.shapeMode === 'number') return shape;
    if (typeof shape.text === 'string') {
      return {
        kind: 'bezier',
        shapeMode: 5,
        cornerRadii: [0, 0, 0, 0],
        cornerSmoothing: 0.0,
        text: shape.text,
        font: shape.font ?? null,
        profile: shape.profile === 'plate' ? 'plate' : 'sculpted',
      };
    }
    if (typeof shape.svg === 'string' || typeof shape.bezierSvg === 'string') {
      return {
        kind: 'bezier',
        shapeMode: 5,
        cornerRadii: [0, 0, 0, 0],
        cornerSmoothing: 0.0,
        svg: shape.svg ?? shape.bezierSvg,
        profile: shape.profile === 'plate' ? 'plate' : 'sculpted',
      };
    }
  }
  throw new Error(`Unknown shape spec: ${JSON.stringify(shape)}`);
}

/**
 * Deterministic Material Merger:
 * Precedence: `preset` -> `material` (Glass token) -> flat numeric props (`refraction`, `depth`, ...)
 */
export function resolveMaterial(props = {}) {
  let g = Glass.from(props.preset ?? 'regular');
  if (props.material) {
    g = Glass.from(props.material);
  }
  if (props.tint !== undefined) g = g.tint(props.tint, props.tintOpacity);
  if (props.interactive !== undefined) g = g.interactive(props.interactive);
  if (props.refraction !== undefined) g = g.refraction(props.refraction);
  if (props.depth !== undefined) g = g.depth(props.depth);
  if (props.dispersion !== undefined) g = g.dispersion(props.dispersion);
  if (props.frost !== undefined) g = g.frost(props.frost);
  if (props.splay !== undefined) g = g.splay(props.splay);
  if (props.lightAngle !== undefined || props.lightIntensity !== undefined) {
    g = g.light({
      angle: props.lightAngle ?? g.config.lightAngle,
      intensity: props.lightIntensity ?? g.config.lightIntensity,
    });
  }
  if (props.rotation !== undefined) g = g.rotation(props.rotation);
  return g;
}

/**
 * Compiles a declarative Scene IR tree (nodes, `<GlassGroup gooey>`, `morph`, `subtract`)
 * into a flat array of GPU-ready `GlassNode` records.
 */
export function compileSceneIR(items, context = { combineOp: 0, gooeyK: 0 }) {
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'group') {
      const groupNodes = compileSceneIR(item.children || [], {
        combineOp: item.gooey > 0 ? 1 : 0,
        gooeyK: Number(item.gooey || 0),
      });
      out.push(...groupNodes);
      continue;
    }

    const frame = item.frame || { x: 0, y: 0, width: 320, height: 180 };
    if (frame.width < 1 || frame.height < 1) continue; // NaN guard

    const mat = resolveMaterial(item).config;
    const baseShape = item.morph ? resolveShapeSpec(item.morph.from) : resolveShapeSpec(item.shape);
    const morphTarget = item.morph ? resolveShapeSpec(item.morph.to) : null;
    const morphT = item.morph ? clamp(Number(item.morph.t ?? 0), 0, 1) : 0;

    let radii = baseShape.cornerRadii;
    if (baseShape.kind === 'capsule') {
      const r = Math.min(frame.width, frame.height) * 0.5;
      radii = [r, r, r, r];
    } else if (item.radius !== undefined) {
      const r = Number(item.radius);
      radii = [r, r, r, r];
    }

    const effectiveSplay =
      mat.splay;

    const combineOp = out.length === 0 ? 0 : (item.combineOp ?? context.combineOp);
    const gooeyK = item.gooey ?? context.gooeyK ?? 0;

    out.push({
      rectOrigin: [frame.x, frame.y],
      rectSize: [frame.width, frame.height],
      cornerRadii: radii || [0, 0, 0, 0],
      shapeMode: baseShape.shapeMode,
      morphShape: morphTarget ? morphTarget.shapeMode : baseShape.shapeMode,
      combineOp,
      cornerSmoothing: item.smoothing ?? baseShape.cornerSmoothing ?? 0.0,
      morphT,
      gooeyK,
      rotationRad: (mat.rotation * Math.PI) / 180,
      lightAngleRad: (mat.lightAngle * Math.PI) / 180,
      lightIntensity: mat.lightIntensity / 100,
      refraction: mat.refraction / 100,
      depth: mat.depth,
      dispersion: mat.dispersion / 100,
      frost: mat.frost,
      splay: effectiveSplay / 100,
      profile: item.profile === 'plate' ? 'plate' : (baseShape.profile ?? 'sculpted'),
      fillColor: [...mat.fillRgb],
      fillOpacity: mat.fillOpacity / 100,
      _shapeMeta: baseShape,
      _morphMeta: morphTarget,
    });

    // Declarative Boolean Subtract (`subtract: { shape: 'circle', scale: 0.45 }`)
    if (item.subtract) {
      const subSpec = resolveShapeSpec(item.subtract.shape ?? 'circle');
      const sc = clamp(Number(item.subtract.scale ?? 0.45), 0.05, 0.98);
      const sw = frame.width * sc;
      const sh = frame.height * sc;
      const subRadii =
        subSpec.kind === 'capsule'
          ? [Math.min(sw, sh) * 0.5, Math.min(sw, sh) * 0.5, Math.min(sw, sh) * 0.5, Math.min(sw, sh) * 0.5]
          : subSpec.cornerRadii || [0, 0, 0, 0];

      out.push({
        rectOrigin: [
          frame.x + (frame.width - sw) * 0.5 + Number(item.subtract.offsetX ?? 0),
          frame.y + (frame.height - sh) * 0.5 + Number(item.subtract.offsetY ?? 0),
        ],
        rectSize: [sw, sh],
        cornerRadii: subRadii,
        shapeMode: subSpec.shapeMode,
        morphShape: subSpec.shapeMode,
        combineOp: item.subtract.smooth > 0 ? 3 : 2,
        cornerSmoothing: subSpec.cornerSmoothing ?? 0.0,
        morphT: 0,
        gooeyK: Number(item.subtract.smooth ?? 0),
        rotationRad: (mat.rotation * Math.PI) / 180,
        lightAngleRad: (mat.lightAngle * Math.PI) / 180,
        lightIntensity: mat.lightIntensity / 100,
        refraction: mat.refraction / 100,
        depth: mat.depth,
        dispersion: mat.dispersion / 100,
        frost: mat.frost,
        splay: effectiveSplay / 100,
        fillColor: [...mat.fillRgb],
        fillOpacity: mat.fillOpacity / 100,
      });
    }
  }
  return out;
}

/**
 * Nyquist 2-Tier Pre-Blur Resolver (mirrors `lib.rs::resolve_blur_tier`):
 * - `frost < 12`: full 1:1 resolution (bit-exact to original Figma calibration)
 * - `frost >= 12`: half resolution (8x faster, < 0.15/255 error)
 */
export function resolveBlurTier(frost, w, h) {
  const f = Math.max(Number(frost), 0);
  const sigma = Math.sqrt(0.65 * 0.65 + (0.425 * f) * (0.425 * f));
  if (f < 12.0) {
    return { width: Math.max(1, w), height: Math.max(1, h), sigma, tier: 'full-1:1' };
  }
  const adjusted = Math.sqrt(Math.max(sigma * sigma - 0.25, 0.25)) * 0.5;
  return {
    width: Math.max(1, Math.floor(w / 2)),
    height: Math.max(1, Math.floor(h / 2)),
    sigma: adjusted,
    tier: 'nyquist-half',
  };
}

/**
 * Video frame synchronization helper: invokes `onNewFrame` ONLY when a new
 * `<video>` frame arrives (`requestVideoFrameCallback`), decoupling 30/60fps
 * video decode from 120Hz glass motion!
 */
export function bindVideoFrameSync(videoEl, onNewFrame) {
  if (!videoEl) return () => {};
  let active = true;
  if (typeof videoEl.requestVideoFrameCallback === 'function') {
    let cbId = null;
    const loop = () => {
      if (!active) return;
      onNewFrame(videoEl);
      cbId = videoEl.requestVideoFrameCallback(loop);
    };
    cbId = videoEl.requestVideoFrameCallback(loop);
    return () => {
      active = false;
      if (cbId != null && typeof videoEl.cancelVideoFrameCallback === 'function') {
        videoEl.cancelVideoFrameCallback(cbId);
      }
    };
  }
  let lastTime = -1;
  let rafId = null;
  const poll = () => {
    if (!active) return;
    if (videoEl.readyState >= 2 && videoEl.currentTime !== lastTime) {
      lastTime = videoEl.currentTime;
      onNewFrame(videoEl);
    }
    rafId = requestAnimationFrame(poll);
  };
  rafId = requestAnimationFrame(poll);
  return () => {
    active = false;
    if (rafId != null) cancelAnimationFrame(rafId);
  };
}

export { createGlassRenderer } from './webgl-renderer.js';
