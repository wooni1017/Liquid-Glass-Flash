// ============================================================================
// Analytic Vector Bézier Signed Distance Field Compute Shader (Rgba16Float)
// Zero bitmap EDT, zero decoupled normal blur, zero w_ridge heuristics.
// Computes exact continuous signed distance `d_inward` from vector outlines
// (line segments + quadratic Bézier curves) via Cardano analytic distance +
// exact winding-number parity, then writes `R = d_inward` and `G,B = eps=1.0`
// central finite-difference normal of that EXACT SAME field.
// ============================================================================

struct BezierUniforms {
    dims: vec2<u32>,
    seg_count: u32,
    _pad0: u32,
};

// Each segment is either:
//   is_quad == 0: Line segment p0 -> p2
//   is_quad == 1: Quadratic Bézier p0 -> p1 -> p2
struct CurveSeg {
    p0: vec2<f32>,
    p1: vec2<f32>,
    p2: vec2<f32>,
    is_quad: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> bu: BezierUniforms;
@group(0) @binding(1) var<storage, read> segs: array<CurveSeg>;
@group(0) @binding(2) var sdf_out: texture_storage_2d<rgba16float, write>;

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 {
    return a.x * b.y - a.y * b.x;
}

fn dist_sq_line(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    let d = pa - ba * h;
    return dot(d, d);
}

// Exact Inigo Quilez analytic squared distance to a quadratic Bézier (A, B, C)
fn dist_sq_quad(pos: vec2<f32>, A: vec2<f32>, B: vec2<f32>, C: vec2<f32>) -> f32 {
    let a = B - A;
    let b = A - 2.0 * B + C;
    let c = a * 2.0;
    let d = A - pos;

    let bb = dot(b, b);
    if (bb < 1e-6) {
        return dist_sq_line(pos, A, C);
    }

    let kk = 1.0 / bb;
    let kx = kk * dot(a, b);
    let ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    let kz = kk * dot(d, a);

    let p = ky - kx * kx;
    let p3 = p * p * p;
    let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    var h = q * q + 4.0 * p3;

    var res: f32;
    if (h >= 0.0) {
        h = sqrt(h);
        let x = (vec2<f32>(h, -h) - q) * 0.5;
        let uv = sign(x) * pow(abs(x), vec2<f32>(1.0 / 3.0));
        let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        let qv = d + (c + b * t) * t;
        res = dot(qv, qv);
    } else {
        let z = sqrt(-p);
        let v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
        let m = cos(v);
        let n = sin(v) * 1.732050808;
        let t = clamp(vec3<f32>(m + m, -n - m, n - m) * z - kx, vec3<f32>(0.0), vec3<f32>(1.0));
        let q0 = d + (c + b * t.x) * t.x;
        let q1 = d + (c + b * t.y) * t.y;
        let q2 = d + (c + b * t.z) * t.z;
        res = min(dot(q0, q0), min(dot(q1, q1), dot(q2, q2)));
    }
    return res;
}

// Winding contribution for horizontal +X ray from `p` across line segment a -> b
fn winding_line(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> i32 {
    if ((a.y <= p.y && b.y > p.y) || (b.y <= p.y && a.y > p.y)) {
        let t = (p.y - a.y) / (b.y - a.y);
        if (mix(a.x, b.x, t) > p.x) {
            return select(-1, 1, b.y > a.y);
        }
    }
    return 0;
}

// Exact winding contribution for horizontal +X ray across quadratic Bézier A -> B -> C
fn winding_quad(p: vec2<f32>, A: vec2<f32>, B: vec2<f32>, C: vec2<f32>) -> i32 {
    let ay = A.y - 2.0 * B.y + C.y;
    let by = 2.0 * (B.y - A.y);
    let cy = A.y - p.y;

    if (abs(ay) < 1e-5) {
        if ((A.y <= p.y && C.y > p.y) || (C.y <= p.y && A.y > p.y)) {
            let t = clamp((p.y - A.y) / (C.y - A.y), 0.0, 1.0);
            let omt = 1.0 - t;
            let x = omt * omt * A.x + 2.0 * omt * t * B.x + t * t * C.x;
            if (x > p.x) { return select(-1, 1, C.y > A.y); }
        }
        return 0;
    }
    let disc = by * by - 4.0 * ay * cy;
    if (disc <= 0.0) { return 0; }
    let s = sqrt(disc);
    var w = 0;
    let roots = array<f32, 2>((-by - s) / (2.0 * ay), (-by + s) / (2.0 * ay));
    for (var i = 0; i < 2; i = i + 1) {
        let t = roots[i];
        let dy = 2.0 * ay * t + by;
        let inside = select(t > 0.0 && t <= 1.0, t >= 0.0 && t < 1.0, dy > 0.0);
        if (inside && abs(dy) > 1e-6) {
            let omt = 1.0 - t;
            let x = omt * omt * A.x + 2.0 * omt * t * B.x + t * t * C.x;
            if (x > p.x) {
                w += select(-1, 1, dy > 0.0);
            }
        }
    }
    return w;
}

fn eval_analytic_d(p: vec2<f32>) -> f32 {
    var min_d2 = 1e20;
    var winding = 0;
    for (var i = 0u; i < bu.seg_count; i = i + 1u) {
        let s = segs[i];
        if (s.is_quad > 0.5) {
            min_d2 = min(min_d2, dist_sq_quad(p, s.p0, s.p1, s.p2));
            winding += winding_quad(p, s.p0, s.p1, s.p2);
        } else {
            min_d2 = min(min_d2, dist_sq_line(p, s.p0, s.p2));
            winding += winding_line(p, s.p0, s.p2);
        }
    }
    let dist = sqrt(min_d2);
    return select(-dist, dist, winding != 0);
}

@compute @workgroup_size(8, 8, 1)
fn cs_bezier_sdf(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= bu.dims.x || gid.y >= bu.dims.y) { return; }
    let p = vec2<f32>(gid.xy) + vec2<f32>(0.5);
    let d_c = eval_analytic_d(p);

    // Exact eps = 1.0 central finite difference of the EXACT SAME analytic field
    let d_px = eval_analytic_d(p + vec2<f32>(1.0, 0.0));
    let d_mx = eval_analytic_d(p - vec2<f32>(1.0, 0.0));
    let d_py = eval_analytic_d(p + vec2<f32>(0.0, 1.0));
    let d_my = eval_analytic_d(p - vec2<f32>(0.0, 1.0));
    let grad = vec2<f32>(d_px - d_mx, d_py - d_my) * 0.5;
    let gl = length(grad);
    let n_sdf = select(vec2<f32>(0.0, 1.0), grad / gl, gl > 1e-5);

    textureStore(sdf_out, vec2<i32>(gid.xy), vec4<f32>(d_c, n_sdf.x, n_sdf.y, 1.0));
}
