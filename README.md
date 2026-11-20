&lt;div align=&quot;center&quot;&gt;

# Liquid-Glass-Flash

**Zero-Dependency, 120 FPS Figma-Calibrated Liquid Glass for Web & React**  
**웹과 React를 위한 무의존성 · 120 FPS 피그마 물리 동치 리퀴드 글래스 프레임워크**

&lt;p&gt;
  &lt;img src=&quot;https://www.google.com/search?q=https://img.shields.io/badge/WebGL2\_%252F\_WebGPU-60%252F120\_FPS-0ea5e9%3Fstyle%3Dflat-square&quot; alt=&quot;WebGL2 / WebGPU 60/120 FPS&quot; /&gt;
  &lt;img src=&quot;https://www.google.com/search?q=https://img.shields.io/badge/Figma\_Parity-MAE\_0.000-10b981%3Fstyle%3Dflat-square&quot; alt=&quot;Figma Parity MAE 0.000&quot; /&gt;
  &lt;img src=&quot;https://www.google.com/search?q=https://img.shields.io/badge/Dependencies-Zero-6366f1%3Fstyle%3Dflat-square&quot; alt=&quot;Zero Dependencies&quot; /&gt;
  &lt;img src=&quot;https://www.google.com/search?q=https://img.shields.io/badge/Variable\_Fonts-∂Ω_Exact_SDF-f59e0b?style=flat-square&quot; alt=&quot;Variable Fonts Exact SDF&quot; /&gt;
  &lt;img src=&quot;https://img.shields.io/badge/License-MIT-slate?style=flat-square&quot; alt=&quot;MIT License&quot; /&gt;
&lt;/p&gt;

&lt;p&gt;
  &lt;a href=&quot;#-english&quot;&gt;&lt;strong&gt;English&lt;/strong&gt;&lt;/a&gt; ·
  &lt;a href=&quot;#-한국어&quot;&gt;&lt;strong&gt;한국어&lt;/strong&gt;&lt;/a&gt;
&lt;/p&gt;

&lt;/div&gt;

---

## 🇺🇸 English

### Why Liquid-Glass-Flash?

CSS `backdrop-filter: blur()` only blurs. **Liquid-Glass-Flash** brings the exact optical physics of Figma's Liquid Glass — radial splay refraction, $u^{3.5}$ bevel curvature, symmetric 3-channel RGB dispersion, and dual-light 1px specular lips — directly to the browser with a **SwiftUI-like declarative API** and **zero build step**.

- **100% Calibrated Figma Parity (`MAE = 0.000`)** — Preserves all 6 calibrated physical laws in `shaders/figma_glass.wgsl` bit-for-bit on all 6 original primitives (`rect`, `capsule`, `circle`, `star`, `triangle`, `hexagon`).
- **Analytic Bézier SDF + Topological Boundary Extraction ($\partial\Omega$)** — Renders crisp vector paths and Variable Fonts (`Google Sans`, `Inter`, `Pretendard`, CJK) without bitmap jagging, internal overlap seams, abutting edges, or self-intersection boxes.
- **Two Text & Vector Profiles** — Switch declaratively between `profile="sculpted"` (3D per-stroke liquid lens) and `profile="plate"` (calm flat-center Figma plate lens with per-glyph 1px rim — built for subtitles and titles over video).
- **Gooey, Morph & Boolean CSG** — Real-time polynomial smooth-min metaball merging (`<GlassGroup gooey>`), shape morphing, and boolean cutouts with pole-free $C^\infty$ normals.
- **60 / 120 FPS Over Live `<video>`** — Dirty-cached separable Gaussian pre-blur, pre-cached WebGL2 uniform locations, and `requestVideoFrameCallback` sync.

---

### Installation

Install directly from GitHub — pure ES modules, no Rust or native toolchain required:

```bash
npm install github:<your-username>/Liquid-Glass-Flash
```

---

### Quick Start

#### React (Drop-In Declarative API)

```jsx
import { useRef } from 'react';
import { GlassScene, Glass, GlassGroup } from 'figma-liquid-glass/react';

export function Hero() {
  const videoRef = useRef(null);

  return (
    <>
      <video ref={videoRef} src="/backdrop.mp4" autoPlay loop muted playsInline hidden />

      <GlassScene backdrop={videoRef} width={960} height={540} fps={120}>
        {/* Single glass pill with preset + numeric overrides */}
        <Glass
          shape="capsule"
          rect={[240, 180, 480, 180]}
          preset="regular"
          frost={8}
          dispersion={25}
        />

        {/* Gooey metaball merge */}
        <GlassGroup gooey={32}>
          <Glass shape="capsule" rect={[260, 195, 260, 140]} preset="regular" />
          <Glass shape="circle" rect={[495, 185, 170, 170]} preset="clear" tint="#FF2D55/20" />
        </GlassGroup>

        {/* Variable Font / SVG in video-safe Plate mode */}
        <Glass
          shape={{ text: 'Liquid Glass', font: loadedOpenTypeFont }}
          rect={[160, 100, 640, 340]}
          profile="plate"
          preset="regular"
          frost={12}
          tint="#FFFFFF/12"
        />
      </GlassScene>
    </>
  );
}
```

#### Vanilla JS / TypeScript

```js
import { compileSceneIR, createGlassRenderer } from 'figma-liquid-glass';

const renderer = createGlassRenderer(document.querySelector('canvas'));
const ir = compileSceneIR([
  { shape: 'rect(32)', rect: [240, 110, 480, 320], preset: 'regular', depth: 100 },
]);

renderer.render(ir, backdropImageOrVideo);
```

---

### Declarative Props & Presets

Every preset (`regular`, `clear`, `identity`) can be overridden with exact `0–100` numeric controls:

| Prop | Type / Range | Default | Description |
| --- | --- | --- | --- |
| `shape` | `'rect(r)' \| 'capsule' \| 'circle' \| 'star' \| 'triangle' \| 'hexagon' \| { svg } \| { text, font }` | `'capsule'` | Primitive, SVG path, or OpenType font glyph |
| `profile` | `'sculpted' \| 'plate'` | `'sculpted'` | `sculpted`: 3D per-stroke lens · `plate`: flat-center Figma video lens |
| `preset` | `'regular' \| 'clear' \| 'identity'` | `'regular'` | Base material preset (`clear` sets `frost = 0`) |
| `refraction` | `0 – 100` | `100` | Optical bending strength |
| `depth` | `0 – 100` | `100` | Bevel depth ($D = \max(\text{depth} \times 0.30, 1.0)\text{px}$) |
| `dispersion` | `0 – 100` | `20` | Symmetric RGB chromatic aberration (`+10% / 0% / -10%`) |
| `frost` | `0 – 60` | `4` | Pre-blur radius ($\sigma = \sqrt{0.65^2 + (0.425 \cdot \text{frost})^2}$) |
| `splay` | `0 – 100` | `100` | Blend between edge normal and radial center direction |
| `lightAngle` | `-180° – 180°` | `-45°` | Screen-space directional light angle |
| `lightIntensity` | `0 – 100` | `80` | 1px specular lip & bevel shade intensity |
| `tint` | `'#RRGGBB/opacity'` | `'#FFFFFF/0'` | Fill color blended over the specular lip |

---

### Package Structure

```text
Liquid-Glass-Flash/
├── src/
│   ├── react.js            # <GlassScene>, <GlassGroup>, <Glass> (WebGL2 auto-mounted)
│   ├── webgl-renderer.js   # Zero-dependency WebGL2 runtime renderer
│   ├── index.js / .d.ts    # Declarative IR compiler, presets & TypeScript types
│   ├── bezier-sdf.js       # SVG/OpenType parser + exact ∂Ω topological boundary extractor
│   └── lib.rs              # Native / Wasm WebGPU engine (optional)
├── shaders/
│   ├── figma_glass.wgsl    # Original calibrated 6-law WGSL (bit-exact reference)
│   └── bezier_sdf.wgsl     # WebGPU analytic quadratic Bézier SDF compute shader
└── tests/
    ├── golden_diff_test.py # Bit-exact SHA-256 & 9-mode visual regression suite
    └── stress_fuzz_test.py # 4 math audits + 12 torture stress tests + 30 fuzz scenes
```

---

## 🇰🇷 한국어

### Liquid-Glass-Flash 소개

CSS `backdrop-filter: blur()`는 배경을 흐리게만 만들 뿐 유리 굴절을 구현하지 못합니다. **Liquid-Glass-Flash**는 피그마 리퀴드 글래스의 6대 광학 물리 법칙(방사형 Splay 굴절, $u^{3.5}$ 베벨 곡률, RGB 3채널 색수차, 1px 지향성 스페큘러 립)을 **SwiftUI처럼 간단한 선언형 문법**과 **별도 빌드 없는 무의존성 모듈**로 웹과 React에 바로 얹을 수 있는 프레임워크입니다.

- **원본 피그마 100% 비트 동치 (`MAE = 0.000`)** — 기본 6종 도형(`rect`, `capsule`, `circle`, `star`, `triangle`, `hexagon`)에서 원본 `shaders/figma_glass.wgsl` 수식을 그대로 보존합니다.
- **해석적 베지어 SDF + 위상 경계 추출($\partial\Omega$)** — Google Sans·Inter·Pretendard 같은 가변 폰트와 한글·SVG에서 겹침(`P`/`T`), 맞닿음(`A`), 자기교차(`e`) 내부 이음새를 수학적으로 완전히 제거합니다.
- **두 가지 텍스트/벡터 프로필** — 모든 획이 입체 렌즈로 굴절되는 `profile="sculpted"`와, 영상 자막·타이틀에서 중앙 가독성을 유지하고 외곽만 완만하게 굴절시키는 `profile="plate"`를 옵션 하나로 전환합니다.
- **Gooey 합체 · 모핑 · 불리언 도넛** — `<GlassGroup gooey>` 메타볼 합체, 도형 모핑, 불리언 차집합을 특이점 없는 $C^\infty$ 연속 법선으로 처리합니다.
- **실시간 `<video>` 위 60 / 120 FPS** — Dirty-Cached 2-Pass 가우시안 블러, 초기화 1회 유니폼 캐싱, `requestVideoFrameCallback` 프레임 동기화를 내장했습니다.

---

### 설치 방법

Rust나 별도 빌드 도구 없이 GitHub에서 바로 설치할 수 있습니다.

```bash
npm install github:<본인아이디>/Liquid-Glass-Flash
```

---

### 빠른 시작

#### React에서 바로 쓰기

```jsx
import { useRef } from 'react';
import { GlassScene, Glass, GlassGroup } from 'figma-liquid-glass/react';

export function Hero() {
  const videoRef = useRef(null);

  return (
    <>
      <video ref={videoRef} src="/backdrop.mp4" autoPlay loop muted playsInline hidden />

      <GlassScene backdrop={videoRef} width={960} height={540} fps={120}>
        {/* 프리셋 + 수치 미세 조정 */}
        <Glass
          shape="capsule"
          rect={[240, 180, 480, 180]}
          preset="regular"
          frost={8}
          dispersion={25}
        />

        {/* Gooey 메타볼 합체 */}
        <GlassGroup gooey={32}>
          <Glass shape="capsule" rect={[260, 195, 260, 140]} preset="regular" />
          <Glass shape="circle" rect={[495, 185, 170, 170]} preset="clear" tint="#FF2D55/20" />
        </GlassGroup>

        {/* 영상 자막/타이틀용 피그마 평면(Plate) 텍스트 */}
        <Glass
          shape={{ text: '안녕하세요', font: loadedOpenTypeFont }}
          rect={[160, 100, 640, 340]}
          profile="plate"
          preset="regular"
          frost={12}
          tint="#FFFFFF/12"
        />
      </GlassScene>
    </>
  );
}
```

#### Vanilla JS에서 바로 쓰기

```js
import { compileSceneIR, createGlassRenderer } from 'figma-liquid-glass';

const renderer = createGlassRenderer(document.querySelector('canvas'));
const ir = compileSceneIR([
  { shape: 'rect(32)', rect: [240, 110, 480, 320], preset: 'regular', depth: 100 },
]);

renderer.render(ir, backdropImageOrVideo);
```

---

### 주요 옵션 요약

`regular` · `clear` · `identity` 프리셋을 기본으로 깔고, 필요한 수치만 `0~100` 범위로 덮어쓸 수 있습니다.

| 속성 | 타입 / 범위 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `shape` | `'rect(r)' \| 'capsule' \| 'circle' \| 'star' \| 'triangle' \| 'hexagon' \| { svg } \| { text, font }` | `'capsule'` | 기본 도형, SVG 경로 또는 OpenType 폰트 텍스트 |
| `profile` | `'sculpted' \| 'plate'` | `'sculpted'` | `sculpted`: 3D 입체 획 굴절 · `plate`: 피그마 평면·영상용 |
| `preset` | `'regular' \| 'clear' \| 'identity'` | `'regular'` | 기본 머티리얼 프리셋 (`clear`는 `frost = 0`) |
| `refraction` | `0 – 100` | `100` | 굴절 강도 |
| `depth` | `0 – 100` | `100` | 베벨 깊이 ($D = \max(\text{depth} \times 0.30, 1.0)\text{px}$) |
| `dispersion` | `0 – 100` | `20` | RGB 3채널 대칭 색수차 (`+10% / 0% / -10%`) |
| `frost` | `0 – 60` | `4` | 사전 블러 강도 ($\sigma = \sqrt{0.65^2 + (0.425 \cdot \text{frost})^2}$) |
| `splay` | `0 – 100` | `100` | 경계 법선과 중심 방사 방향 혼합 비율 |
| `lightAngle` | `-180° – 180°` | `-45°` | 화면 고정 광원 각도 |
| `lightIntensity` | `0 – 100` | `80` | 1px 테두리 하이라이트 및 베벨 음영 세기 |
| `tint` | `'#RRGGBB/opacity'` | `'#FFFFFF/0'` | 립 위에 올라가는 유리 틴트 색상 및 투명도 |

---

### License

MIT © Liquid-Glass-Flash Contributors
