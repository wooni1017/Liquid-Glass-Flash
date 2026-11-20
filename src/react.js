// ============================================================================
// Figma Liquid Glass — React Drop-In Declarative Components (Zero Setup)
// Just drop this folder into your project and render:
//   <GlassScene backdrop={videoRef} fps={120}>
//     <GlassGroup gooey={28}>
//       <Glass shape="capsule" preset="regular" />
//       <Glass shape="circle" preset="clear" tint="#FF2D55/20" />
//     </GlassGroup>
//     <Glass shape={{ text: '안녕하세요', font }} profile="plate" frost={12} />
//   </GlassScene>
// ============================================================================

import React, { createContext, useContext, useEffect, useId, useMemo, useRef } from 'react';
import { Glass as GlassToken, compileSceneIR, bindVideoFrameSync } from './index.js';
import { createGlassRenderer } from './webgl-renderer.js';

export { GlassToken as GlassMaterial, compileSceneIR, createGlassRenderer };

const SceneCtx = createContext(null);
const GroupCtx = createContext({ combineOp: 0, gooeyK: 0 });

export function GlassScene({ backdrop, fps = 120, width = 960, height = 540, onCompile, children, className, style }) {
  const nodesMapRef = useRef(new Map());
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const backdropRef = useRef(backdrop);
  backdropRef.current = backdrop;

  const drawNow = useMemo(() => (forceBlur = false) => {
    const ir = compileSceneIR(Array.from(nodesMapRef.current.values()));
    if (onCompile) onCompile(ir);
    if (rendererRef.current && ir.length) {
      const el = backdropRef.current?.current ?? backdropRef.current ?? null;
      rendererRef.current.render(ir, el, forceBlur);
    }
  }, [onCompile]);

  const registry = useMemo(() => ({
    upsert(id, spec) {
      nodesMapRef.current.set(id, spec);
      drawNow(false);
    },
    remove(id) {
      nodesMapRef.current.delete(id);
      drawNow(false);
    },
  }), [drawNow]);

  // Mount standalone WebGL2 renderer automatically on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = createGlassRenderer(canvas);
    rendererRef.current = renderer;
    drawNow(true);

    let rafId = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = backdropRef.current?.current ?? backdropRef.current ?? null;
      if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
        drawNow(true);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [width, height, drawNow]);

  // Video frame-exact sync when requestVideoFrameCallback is supported
  useEffect(() => {
    const el = backdrop?.current ?? backdrop;
    if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
      return bindVideoFrameSync(el, () => drawNow(true));
    }
    drawNow(true);
    return undefined;
  }, [backdrop, fps, drawNow]);

  return React.createElement(
    SceneCtx.Provider,
    { value: registry },
    React.createElement(
      'div',
      {
        className,
        style: { position: 'relative', display: 'inline-grid', width, height, overflow: 'hidden', ...style },
      },
      React.createElement('canvas', {
        ref: canvasRef,
        width,
        height,
        style: { gridArea: '1 / 1', width: '100%', height: '100%', display: 'block' },
      }),
      React.createElement(
        'div',
        { style: { gridArea: '1 / 1', position: 'relative', zIndex: 1 } },
        children
      )
    )
  );
}

export function GlassGroup({ gooey = 24, children }) {
  const ctxVal = useMemo(() => ({ combineOp: gooey > 0 ? 1 : 0, gooeyK: Number(gooey) }), [gooey]);
  return React.createElement(GroupCtx.Provider, { value: ctxVal }, children);
}

export function Glass(props) {
  const id = useId();
  const scene = useContext(SceneCtx);
  const group = useContext(GroupCtx);

  useEffect(() => {
    if (!scene) return undefined;
    scene.upsert(id, { ...props, combineOp: props.combineOp ?? group.combineOp, gooey: props.gooey ?? group.gooeyK });
    return () => scene.remove(id);
  }, [scene, id, group, props]);

  return props.children ? React.createElement('div', { style: { pointerEvents: 'none' } }, props.children) : null;
}
