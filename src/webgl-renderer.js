// ============================================================================
// Figma Liquid Glass — Standalone WebGL2 Runtime Renderer (Zero Dependencies)
// Drop-in browser engine for React (<GlassScene>) & Vanilla JS.
// Implements the exact 6 calibrated Figma physical laws (MAE 0.000 on original
// 6 primitives), pole-free Gooey/Morph/Boolean SDFs, and Analytic Bézier SDF
// with Topological Boundary Extraction (∂Ω) + Sculpted / Plate video profiles.
// ============================================================================

import {
  extractBoundarySegments,
  fitSegmentsWithBounds,
  parseSvgPathToSegments,
  openTypeCommandsToSegments,
} from './bezier-sdf.js';

const MAX_SEGS = 2048;

const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 v_uv;
void main() { v_uv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform vec2 u_dir;
uniform float u_sigma;
void main() {
  vec2 texel = 1.0 / u_res;
  float sigma = max(u_sigma, 0.65);
  int radius = int(ceil(sigma * 3.0));
  float inv2s2 = 0.5 / (sigma * sigma);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = -128; k <= 128; k++) {
    if (k < -radius || k > radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) * inv2s2);
    vec2 suv = clamp(v_uv + u_dir * fk * texel, vec2(0.0), vec2(1.0));
    acc += texture(u_src, suv) * w;
    wsum += w;
  }
  fragColor = acc / max(wsum, 1e-6);
}
`;

const FS_BEZIER_SDF = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_segs;
uniform vec2 u_sdf_res;
uniform int u_seg_count;

float dist_sq_line(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  vec2 d = pa - ba * h;
  return dot(d, d);
}
float dist_sq_quad(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float bb = dot(b, b);
  if (bb < 1e-5) return dist_sq_line(pos, A, C);
  float kk = 1.0 / bb;
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx, p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) * 0.5;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 qv = d + (c + b * t) * t;
    return dot(qv, qv);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v), n = sin(v) * 1.732050808;
  vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
  vec2 q0 = d + (c + b * t.x) * t.x;
  vec2 q1 = d + (c + b * t.y) * t.y;
  vec2 q2 = d + (c + b * t.z) * t.z;
  return min(dot(q0, q0), min(dot(q1, q1), dot(q2, q2)));
}
int wind_line(vec2 p, vec2 a, vec2 b) {
  if ((a.y <= p.y && b.y > p.y) || (b.y <= p.y && a.y > p.y)) {
    float t = (p.y - a.y) / (b.y - a.y);
    if (mix(a.x, b.x, t) > p.x) return (b.y > a.y) ? 1 : -1;
  }
  return 0;
}
int wind_quad(vec2 p, vec2 A, vec2 B, vec2 C) {
  float ay = A.y - 2.0 * B.y + C.y, by = 2.0 * (B.y - A.y), cy = A.y - p.y;
  if (abs(ay) < 1e-5) {
    if ((A.y <= p.y && C.y > p.y) || (C.y <= p.y && A.y > p.y)) {
      float t = clamp((p.y - A.y) / (C.y - A.y), 0.0, 1.0), omt = 1.0 - t;
      if (omt*omt*A.x + 2.0*omt*t*B.x + t*t*C.x > p.x) return (C.y > A.y) ? 1 : -1;
    }
    return 0;
  }
  float disc = by * by - 4.0 * ay * cy;
  if (disc <= 0.0) return 0;
  float s = sqrt(disc);
  int w = 0;
  float r0 = (-by - s) / (2.0 * ay), r1 = (-by + s) / (2.0 * ay);
  float dy0 = 2.0 * ay * r0 + by;
  if (((dy0 > 0.0) ? (r0 >= 0.0 && r0 < 1.0) : (r0 > 0.0 && r0 <= 1.0)) && abs(dy0) > 1e-6) {
    float omt = 1.0 - r0;
    if (omt*omt*A.x + 2.0*omt*r0*B.x + r0*r0*C.x > p.x) w += (dy0 > 0.0) ? 1 : -1;
  }
  float dy1 = 2.0 * ay * r1 + by;
  if (((dy1 > 0.0) ? (r1 >= 0.0 && r1 < 1.0) : (r1 > 0.0 && r1 <= 1.0)) && abs(dy1) > 1e-6) {
    float omt = 1.0 - r1;
    if (omt*omt*A.x + 2.0*omt*r1*B.x + r1*r1*C.x > p.x) w += (dy1 > 0.0) ? 1 : -1;
  }
  return w;
}
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_sdf_res;
  float min_d2 = 1e20;
  int winding = 0;
  for (int i = 0; i < ${MAX_SEGS}; i++) {
    if (i >= u_seg_count) break;
    vec4 s0 = texelFetch(u_segs, ivec2(i, 0), 0);
    vec4 s1 = texelFetch(u_segs, ivec2(i, 1), 0);
    if (s1.z > 0.5) {
      min_d2 = min(min_d2, dist_sq_quad(p, s0.xy, s0.zw, s1.xy));
      winding += wind_quad(p, s0.xy, s0.zw, s1.xy);
    } else {
      min_d2 = min(min_d2, dist_sq_line(p, s0.xy, s1.xy));
      winding += wind_line(p, s0.xy, s1.xy);
    }
  }
  float d = sqrt(min_d2);
  fragColor = vec4((winding != 0) ? d : -d, 0.0, 0.0, 1.0);
}
`;

const FS_MAIN = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src_tex;
uniform sampler2D u_raw_tex;
uniform sampler2D u_bezier_sdf;
uniform vec2 u_res;
uniform int u_scene_mode;     // 0=Original 6 shapes, 1=Gooey, 2=Morph, 3=Subtract, 4=Bezier
uniform int u_shape_mode;     // 0=Rect/Capsule, 1=Circle, 2=Star, 3=Triangle, 4=Hexagon
uniform int u_bezier_profile; // 0=Sculpted, 1=Plate
uniform vec4 u_vec_box;
uniform vec4 u_boxA;
uniform vec4 u_boxB;
uniform vec4 u_radii;
uniform float u_smoothing;
uniform float u_gooey_k;
uniform int u_morph_from;
uniform int u_morph_to;
uniform float u_morph_t;
uniform float u_rotation_rad;

uniform float u_refraction;
uniform float u_depth;
uniform float u_dispersion;
uniform float u_splay;
uniform float u_light_angle;
uniform float u_light_intensity;
uniform vec3 u_fill_a;
uniform float u_fill_op_a;
uniform vec3 u_fill_b;
uniform float u_fill_op_b;

vec2 safe_norm(vec2 v, vec2 fb) { float l = length(v); return (l > 1e-5) ? (v / l) : fb; }
float safe_pow(float x, float p) { return (x > 0.0) ? pow(x, p) : 0.0; }
vec2 rotate2d(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }

float sd_rounded_box(vec2 p, vec2 hs, vec4 radii, float smoothing) {
  float r_top = (p.x > 0.0) ? radii.y : radii.x;
  float r_bot = (p.x > 0.0) ? radii.z : radii.w;
  float r = min((p.y > 0.0) ? r_bot : r_top, min(hs.x, hs.y));
  vec2 q = abs(p) - hs + vec2(r);
  vec2 ov = max(q, vec2(0.0));
  float pe = mix(2.0, 3.2, clamp(smoothing, 0.0, 1.0));
  float cd = safe_pow(safe_pow(ov.x, pe) + safe_pow(ov.y, pe), 1.0 / pe);
  return min(max(q.x, q.y), 0.0) + cd - r;
}
float sd_ellipse(vec2 p, vec2 ab) {
  float k0 = length(p / ab), k1 = length(p / (ab * ab));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
float sd_star5(vec2 p, vec2 hs, float round_r) {
  float ro = min(hs.x, hs.y) * 0.95, cr = min(round_r, ro * 0.2), re = max(ro - cr, 1.0);
  vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-k1.x, k1.y);
  vec2 pc = p; pc.x = abs(pc.x);
  pc -= 2.0 * max(dot(k1, pc), 0.0) * k1;
  pc -= 2.0 * max(dot(k2, pc), 0.0) * k2;
  pc.x = abs(pc.x); pc.y -= re;
  vec2 ba = 0.48 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(pc, ba) / dot(ba, ba), 0.0, re);
  return length(pc - ba * h) * sign(pc.y * ba.x - pc.x * ba.y) - cr;
}
float sd_tri(vec2 p, vec2 hs, float round_r) {
  float cr = min(round_r, min(hs.x, hs.y) * 0.25);
  vec2 q = vec2(hs.x * 0.95, hs.y * 1.8), pc = vec2(abs(p.x), p.y + hs.y * 0.7);
  vec2 a = pc - q * clamp(dot(pc, q) / dot(q, q), 0.0, 1.0);
  vec2 b = pc - q * vec2(clamp(pc.x / q.x, 0.0, 1.0), 1.0);
  float d = min(dot(a, a), dot(b, b));
  float s = max(pc.x * q.y - pc.y * q.x, pc.y - q.y);
  return sqrt(d) * sign(s) - cr;
}
float sd_hex(vec2 p, vec2 hs, float round_r) {
  float r = min(hs.x, hs.y) * 0.9, cr = min(round_r, r * 0.2), re = max(r - cr, 1.0);
  vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  vec2 pc = abs(p);
  pc -= 2.0 * min(dot(k.xy, pc), 0.0) * k.xy;
  pc -= vec2(clamp(pc.x, -k.z * re, k.z * re), re);
  return length(pc) * sign(pc.y) - cr;
}
float eval_prim(int mode, vec2 p_local, vec2 hs) {
  if (mode == 1) return sd_ellipse(p_local, hs);
  if (mode == 2) return sd_star5(p_local, hs, u_radii.x);
  if (mode == 3) return sd_tri(p_local, hs, u_radii.x);
  if (mode == 4) return sd_hex(p_local, hs, u_radii.x);
  return sd_rounded_box(p_local, hs, u_radii, u_smoothing);
}
vec2 smin_poly(float a, float b, float k) {
  float sk = max(k, 0.001);
  float h = clamp(0.5 + 0.5 * (b - a) / sk, 0.0, 1.0);
  return vec2(mix(b, a, h) - sk * h * (1.0 - h), 1.0 - h);
}

vec2 eval_field(vec2 px, out vec2 u_center_out) {
  vec2 cA = u_boxA.xy + u_boxA.zw * 0.5;
  vec2 relA = px - cA;
  vec2 p_loc = rotate2d(relA, -u_rotation_rad);
  vec2 hsA = max(u_boxA.zw * 0.5, vec2(1.0));
  float dA_c = length(relA);
  float D_pole = max(u_depth * 0.30, 1.0);
  u_center_out = (u_scene_mode == 0)
    ? ((dA_c > 0.5) ? (-relA / dA_c) : vec2(0.0, 1.0))
    : (-relA / sqrt(dot(relA, relA) + D_pole * D_pole));

  if (u_scene_mode == 1) {
    float sdA = eval_prim(u_shape_mode, p_loc, hsA);
    vec2 cB = u_boxB.xy + u_boxB.zw * 0.5, relB = px - cB;
    float sdB = sd_ellipse(relB, max(u_boxB.zw * 0.5, vec2(1.0)));
    vec2 sm = smin_poly(sdA, sdB, u_gooey_k);
    vec2 uB = -relB / sqrt(dot(relB, relB) + D_pole * D_pole);
    u_center_out = mix(u_center_out, uB, sm.y);
    return sm;
  }
  if (u_scene_mode == 2) {
    return vec2(mix(eval_prim(u_morph_from, p_loc, hsA), eval_prim(u_morph_to, p_loc, hsA), clamp(u_morph_t, 0.0, 1.0)), 0.0);
  }
  if (u_scene_mode == 3) {
    float sdO = eval_prim(u_shape_mode, p_loc, hsA);
    vec2 cB = u_boxB.xy + u_boxB.zw * 0.5;
    float sdH = sd_ellipse(px - cB, max(u_boxB.zw * 0.5, vec2(1.0)));
    return vec2(max(sdO, -sdH), 0.0);
  }
  if (u_scene_mode == 4) {
    vec2 uvl = (p_loc + hsA) / max(u_boxA.zw, vec2(1.0));
    if (uvl.x < 0.0 || uvl.x > 1.0 || uvl.y < 0.0 || uvl.y > 1.0) return vec2(1000.0, 0.0);
    return vec2(-texture(u_bezier_sdf, vec2(uvl.x, 1.0 - uvl.y)).r, 0.0);
  }
  return vec2(eval_prim(u_shape_mode, p_loc, hsA), 0.0);
}

struct PlateField { float d_inward; float D; vec2 u_splay; };
PlateField eval_plate_field(vec2 px, float sp) {
  vec2 cP = u_vec_box.xy + u_vec_box.zw * 0.5;
  vec2 hsP = max(u_vec_box.zw * 0.5, vec2(1.0));
  vec2 relP = px - cP;
  vec2 pP = rotate2d(relP, -u_rotation_rad);
  float rP = min(hsP.x, hsP.y) * 0.5;
  float sdP = sd_rounded_box(pP, hsP, vec4(rP), 0.6);
  float D_p = max(min(hsP.x, hsP.y) * 0.85 * (u_depth / 100.0), 1.0);
  vec2 gPloc = vec2(
    sd_rounded_box(pP + vec2(1.0, 0.0), hsP, vec4(rP), 0.6) - sd_rounded_box(pP - vec2(1.0, 0.0), hsP, vec4(rP), 0.6),
    sd_rounded_box(pP + vec2(0.0, 1.0), hsP, vec4(rP), 0.6) - sd_rounded_box(pP - vec2(0.0, 1.0), hsP, vec4(rP), 0.6)
  ) * 0.5;
  vec2 nP = safe_norm(-rotate2d(gPloc, u_rotation_rad), vec2(0.0, 1.0));
  vec2 uP = -relP / sqrt(dot(relP, relP) + D_p * D_p);
  return PlateField(max(-sdP, 0.0), D_p, mix(nP, uP, sp));
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 px = uv * u_res;
  vec2 texel = 1.0 / u_res;

  vec2 u_center;
  vec2 res = eval_field(px, u_center);
  float d_inward = -res.x;

  float aa = clamp(d_inward + 0.5, 0.0, 1.0);
  if (aa <= 0.001) {
    fragColor = texture(u_raw_tex, v_uv);
    return;
  }

  vec2 tmp;
  vec2 grad = vec2(
    eval_field(px + vec2(1.0, 0.0), tmp).x - eval_field(px - vec2(1.0, 0.0), tmp).x,
    eval_field(px + vec2(0.0, 1.0), tmp).x - eval_field(px - vec2(0.0, 1.0), tmp).x
  ) * 0.5;
  vec2 n_raw = -grad / max(length(grad), 1.0);
  vec2 n_sdf = safe_norm(-grad, vec2(0.0, 1.0));

  float sp = clamp(u_splay, 0.0, 1.0);
  float D = max(u_depth * 0.30, 1.0);
  float d_refr = d_inward;
  vec2 u_splay_v;
  if (u_scene_mode == 4 && u_bezier_profile == 1) {
    PlateField pf = eval_plate_field(px, sp);
    d_refr = pf.d_inward;
    D = pf.D;
    u_splay_v = pf.u_splay;
  } else if (u_scene_mode == 0) {
    u_splay_v = safe_norm(mix(n_sdf, u_center, sp), n_sdf);
  } else {
    u_splay_v = mix(n_raw, u_center, sp);
  }

  float d_eff = max(d_refr - 0.5, 0.0);
  float u_b = clamp(1.0 - d_eff / D, 0.0, 1.0);
  float u35 = u_b * u_b * u_b * sqrt(u_b);
  float disp_mag = D * clamp(u_refraction, 0.0, 1.0) * u35;

  vec2 off_uv = vec2(u_splay_v.x, -u_splay_v.y) * disp_mag * texel;
  float df = 0.10 * clamp(u_dispersion, 0.0, 1.0);
  vec3 glass_rgb = vec3(
    texture(u_src_tex, clamp(v_uv + off_uv * (1.0 + df), 0.0, 1.0)).r,
    texture(u_src_tex, clamp(v_uv + off_uv,              0.0, 1.0)).g,
    texture(u_src_tex, clamp(v_uv + off_uv * (1.0 - df), 0.0, 1.0)).b
  );

  vec2 lray = vec2(-sin(u_light_angle), cos(u_light_angle));
  if (u_light_intensity > 0.001) {
    float lip_mask = clamp(1.25 - d_inward, 0.0, 1.0);
    float ca = dot(n_sdf, lray);
    float lf = safe_pow(max(ca, 0.0), 1.6) * (112.0 / 255.0);
    float lb = safe_pow(max(-ca, 0.0), 1.6) * (85.5 / 255.0);
    float lip = u_light_intensity * (lf + lb) * lip_mask;
    float bevel = -(12.5 / 255.0) * u_light_intensity * dot(u_splay_v, lray) * (u_b * u_b) * (1.0 - lip_mask);
    glass_rgb = clamp(glass_rgb + vec3(lip + bevel), 0.0, 1.0);
  }

  vec3 fill_col = mix(u_fill_a, u_fill_b, res.y);
  float fill_op = mix(u_fill_op_a, u_fill_op_b, res.y);
  glass_rgb = mix(glass_rgb, fill_col, clamp(fill_op, 0.0, 1.0));
  fragColor = vec4(mix(texture(u_raw_tex, v_uv).rgb, glass_rgb, aa), 1.0);
}
`;

function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`LiquidGlass shader compile error: ${msg}`);
    }
    return sh;
  };
  const prog = gl.createProgram();
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`LiquidGlass link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

/**
 * Creates a zero-dependency WebGL2 Liquid Glass renderer attached to `canvas`.
 * Used automatically by `<GlassScene>` in `react.js`, or directly in Vanilla JS.
 */
export function createGlassRenderer(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer) });
  if (!gl) throw new Error('WebGL2 is required for Figma Liquid Glass.');

  const blurProg = compileProgram(gl, VS, FS_BLUR);
  const mainProg = compileProgram(gl, VS, FS_MAIN);
  const bezierProg = compileProgram(gl, VS, FS_BEZIER_SDF);
  const vao = gl.createVertexArray();

  const cacheUniforms = (prog, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  const U_BLUR = cacheUniforms(blurProg, ['u_src', 'u_res', 'u_dir', 'u_sigma']);
  const U_BEZ = cacheUniforms(bezierProg, ['u_segs', 'u_sdf_res', 'u_seg_count']);
  const U_MAIN = cacheUniforms(mainProg, [
    'u_src_tex', 'u_raw_tex', 'u_bezier_sdf', 'u_res', 'u_scene_mode', 'u_shape_mode',
    'u_bezier_profile', 'u_vec_box', 'u_boxA', 'u_boxB', 'u_radii', 'u_smoothing',
    'u_gooey_k', 'u_morph_from', 'u_morph_to', 'u_morph_t', 'u_rotation_rad',
    'u_refraction', 'u_depth', 'u_dispersion', 'u_splay', 'u_light_angle',
    'u_light_intensity', 'u_fill_a', 'u_fill_op_a', 'u_fill_b', 'u_fill_op_b',
  ]);

  let W = canvas.width || 960;
  let H = canvas.height || 540;
  const makeTex = (w, h, internal = gl.RGBA8, type = gl.UNSIGNED_BYTE, filter = gl.LINEAR) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    return t;
  };
  const makeFbo = (tex) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return f;
  };

  gl.getExtension('EXT_color_buffer_float');
  let rawTex = makeTex(W, H);
  let tempTex = makeTex(W, H);
  let preTex = makeTex(W, H);
  let fboTemp = makeFbo(tempTex);
  let fboPre = makeFbo(preTex);

  const bezW = 640, bezH = 340;
  const bezierSdfTex = makeTex(bezW, bezH, gl.RGBA16F, gl.FLOAT, gl.LINEAR);
  const fboBezier = makeFbo(bezierSdfTex);
  const segTex = makeTex(1, 2, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let cachedSigma = -1;
  let blurDirty = true;
  let lastBezierKey = '';
  let vecTightBox = [28, 28, bezW - 56, bezH - 56];

  // Fallback gradient backdrop when no backdrop element is provided
  const fallbackCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (fallbackCanvas) {
    fallbackCanvas.width = W;
    fallbackCanvas.height = H;
    const ctx = fallbackCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ff2d55'); g.addColorStop(0.5, '#4f46e5'); g.addColorStop(1, '#06b6d4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function buildBezierSdf(segs, boxW = bezW, boxH = bezH) {
    if (!segs || !segs.length) return;
    const boundary = extractBoundarySegments(segs);
    const { segments, tightBox } = fitSegmentsWithBounds(boundary, boxW, boxH, 28);
    vecTightBox = tightBox;

    const n = Math.min(segments.length, MAX_SEGS);
    const data = new Float32Array(n * 2 * 4);
    for (let i = 0; i < n; i++) {
      const s = segments[i];
      data[i * 4 + 0] = s.p0[0]; data[i * 4 + 1] = s.p0[1];
      data[i * 4 + 2] = s.p1[0]; data[i * 4 + 3] = s.p1[1];
      data[(n + i) * 4 + 0] = s.p2[0]; data[(n + i) * 4 + 1] = s.p2[1];
      data[(n + i) * 4 + 2] = s.isQuad; data[(n + i) * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, segTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, data);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboBezier);
    gl.viewport(0, 0, bezW, bezH);
    gl.useProgram(bezierProg);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, segTex);
    gl.uniform1i(U_BEZ.u_segs, 0);
    gl.uniform2f(U_BEZ.u_sdf_res, bezW, bezH);
    gl.uniform1i(U_BEZ.u_seg_count, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function uploadBackdrop(source) {
    const src = source || fallbackCanvas;
    if (!src) return false;
    if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
      if (src.readyState < 2) return false;
      blurDirty = true;
    }
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return true;
  }

  function render(irNodes, backdropSource = null, forceBlurRefresh = false) {
    if (!irNodes || !irNodes.length) return;
    if (forceBlurRefresh) blurDirty = true;
    if (backdropSource || cachedSigma < 0) uploadBackdrop(backdropSource);

    const a = irNodes[0];
    const b = irNodes[1] || null;
    const frost = a.frost ?? 4.0;
    const sigma = Math.sqrt(0.65 * 0.65 + (0.425 * frost) * (0.425 * frost));

    // Pass 1: Dirty-cached separable Gaussian Pre-Blur
    if (blurDirty || Math.abs(sigma - cachedSigma) > 1e-4) {
      gl.useProgram(blurProg);
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, W, H);
      gl.uniform2f(U_BLUR.u_res, W, H);
      gl.uniform1f(U_BLUR.u_sigma, sigma);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboTemp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rawTex);
      gl.uniform1i(U_BLUR.u_src, 0);
      gl.uniform2f(U_BLUR.u_dir, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboPre);
      gl.bindTexture(gl.TEXTURE_2D, tempTex);
      gl.uniform2f(U_BLUR.u_dir, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      blurDirty = false;
      cachedSigma = sigma;
    }

    // Resolve scene mode from compiled IR
    let sceneMode = 0;
    if (a.shapeMode === 5) {
      sceneMode = 4;
      const meta = a._shapeMeta || {};
      const key = `${meta.svg || ''}|${meta.text || ''}|${Boolean(meta.font)}`;
      if (key !== lastBezierKey) {
        lastBezierKey = key;
        if (meta.svg) buildBezierSdf(parseSvgPathToSegments(meta.svg));
        else if (meta.text && meta.font && typeof meta.font.getPath === 'function') {
          buildBezierSdf(openTypeCommandsToSegments(meta.font.getPath(meta.text, 0, 120, 120).commands));
        }
      }
    } else if (b && (a.combineOp === 1 || b.combineOp === 1)) {
      sceneMode = 1;
    } else if (a.morphT > 0.001 && a.morphShape !== a.shapeMode) {
      sceneMode = 2;
    } else if (b && (a.combineOp === 2 || b.combineOp === 2)) {
      sceneMode = 3;
    }

    const boxA = [a.rectOrigin[0], a.rectOrigin[1], a.rectSize[0], a.rectSize[1]];
    const boxB = b ? [b.rectOrigin[0], b.rectOrigin[1], b.rectSize[0], b.rectSize[1]] : [0, 0, 1, 1];
    const rA = a.cornerRadii || [28, 28, 28, 28];

    // Pass 2: Main 6-Law Figma Liquid Glass Shader
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(mainProg);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, preTex); gl.uniform1i(U_MAIN.u_src_tex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rawTex); gl.uniform1i(U_MAIN.u_raw_tex, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bezierSdfTex); gl.uniform1i(U_MAIN.u_bezier_sdf, 2);

    gl.uniform2f(U_MAIN.u_res, W, H);
    gl.uniform1i(U_MAIN.u_scene_mode, sceneMode);
    gl.uniform1i(U_MAIN.u_shape_mode, a.shapeMode);
    gl.uniform1i(U_MAIN.u_bezier_profile, a.profile === 'plate' ? 1 : 0);
    gl.uniform4f(U_MAIN.u_vec_box, boxA[0] + vecTightBox[0], boxA[1] + vecTightBox[1], vecTightBox[2], vecTightBox[3]);
    gl.uniform4f(U_MAIN.u_boxA, boxA[0], boxA[1], boxA[2], boxA[3]);
    gl.uniform4f(U_MAIN.u_boxB, boxB[0], boxB[1], boxB[2], boxB[3]);
    gl.uniform4f(U_MAIN.u_radii, rA[0], rA[1], rA[2], rA[3]);
    gl.uniform1f(U_MAIN.u_smoothing, a.cornerSmoothing ?? 0.6);
    gl.uniform1f(U_MAIN.u_gooey_k, (b?.gooeyK ?? a.gooeyK) || 28);
    gl.uniform1i(U_MAIN.u_morph_from, a.shapeMode);
    gl.uniform1i(U_MAIN.u_morph_to, a.morphShape ?? a.shapeMode);
    gl.uniform1f(U_MAIN.u_morph_t, a.morphT ?? 0);
    gl.uniform1f(U_MAIN.u_rotation_rad, a.rotationRad ?? 0);

    gl.uniform1f(U_MAIN.u_refraction, a.refraction ?? 1.0);
    gl.uniform1f(U_MAIN.u_depth, a.depth ?? 100.0);
    gl.uniform1f(U_MAIN.u_dispersion, a.dispersion ?? 0.2);
    gl.uniform1f(U_MAIN.u_splay, a.splay ?? 1.0);
    gl.uniform1f(U_MAIN.u_light_angle, a.lightAngleRad ?? -Math.PI * 0.25);
    gl.uniform1f(U_MAIN.u_light_intensity, a.lightIntensity ?? 0.8);
    gl.uniform3f(U_MAIN.u_fill_a, a.fillColor[0], a.fillColor[1], a.fillColor[2]);
    gl.uniform1f(U_MAIN.u_fill_op_a, a.fillOpacity ?? 0.0);
    const fbCol = b ? b.fillColor : a.fillColor;
    gl.uniform3f(U_MAIN.u_fill_b, fbCol[0], fbCol[1], fbCol[2]);
    gl.uniform1f(U_MAIN.u_fill_op_b, b ? (b.fillOpacity ?? 0.0) : (a.fillOpacity ?? 0.0));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    [rawTex, tempTex, preTex, bezierSdfTex, segTex].forEach((t) => gl.deleteTexture(t));
    [fboTemp, fboPre, fboBezier].forEach((f) => gl.deleteFramebuffer(f));
    [blurProg, mainProg, bezierProg].forEach((p) => gl.deleteProgram(p));
    gl.deleteVertexArray(vao);
  }

  return { render, buildBezierSdf, markBackdropDirty: () => { blurDirty = true; }, destroy };
}
