# Figma Liquid Glass — Drop-In Framework

Rust 빌드 없이 **폴더 하나만 프로젝트에 넣으면** SwiftUI처럼 선언형 태그 한 줄로 바로 렌더링되는 Liquid Glass 프레임워크입니다.

- **원본 100% 비트 동치 (`MAE = 0.000`)**: `shaders/figma_glass.wgsl` 원본 6대 물리 법칙 그대로 유지
- **가변 폰트·SVG 완벽 지원**: 해석적 2차 베지어 SDF + 위상 경계 추출($\partial\Omega$)로 Google Sans·Inter·Pretendard 겹침/맞닿음/자기교차 이음새 제거
- **2가지 텍스트 프로필**: `profile="sculpted"` (입체 3D 유리) / `profile="plate"` (피그마 평면·영상 자막용)
- **60/120 FPS 영상 지원**: `<video>` 백드롭 자동 동기화 + Dirty-Cached 2-Pass 가우시안 블러

## 1. React 빠른 시작 (폴더 복사만으로 즉시 실행)

```jsx
import { useRef } from 'react';
import { GlassScene, Glass, GlassGroup } from './figma-liquid-glass-clean/src/react.js';

export function App() {
  const videoRef = useRef(null);
  return (
    <>
      <video ref={videoRef} src="/bg.mp4" autoPlay loop muted playsInline hidden />
      <GlassScene backdrop={videoRef} width={960} height={540} fps={120}>
        <Glass shape="capsule" x={240} y={180} width={480} height={180} preset="regular" />
      </GlassScene>
    </>
  );
}
```

## 2. Vanilla JS 빠른 시작

```js
import { compileSceneIR } from './figma-liquid-glass-clean/src/index.js';
import { createGlassRenderer } from './figma-liquid-glass-clean/src/webgl-renderer.js';

const renderer = createGlassRenderer(document.querySelector('canvas'));
const ir = compileSceneIR([
  { shape: 'rect(32)', x: 240, y: 110, width: 480, height: 320, preset: 'regular' },
]);
renderer.render(ir, backdropImageOrVideo);
```

## 3. 패키지 구성
- `src/react.js`: `<GlassScene>`, `<GlassGroup gooey>`, `<Glass>` (WebGL2 렌더러 자동 내장)
- `src/webgl-renderer.js`: 무의존성 브라우저 WebGL2 런타임 렌더러
- `src/index.js` / `src/index.d.ts`: 선언형 프리셋·수치 병합기 & TypeScript 타입 정의
- `src/bezier-sdf.js`: SVG/폰트 파서 + 위상 경계 추출(`extractBoundarySegments`)
- `shaders/figma_glass.wgsl` / `shaders/bezier_sdf.wgsl` / `src/lib.rs`: 네이티브·WebGPU용 Rust/WGSL 코어
