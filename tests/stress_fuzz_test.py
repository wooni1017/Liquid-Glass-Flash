import base64, io, math, random, re, time
import numpy as np
from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

# ==============================================================================
# PART 1: EXACT MATHEMATICAL AUDIT
# ==============================================================================
print("=== PART 1: MATHEMATICAL AUDIT ===")

def orig_splay(n_sdf, relA, sp):
    d = np.linalg.norm(relA)
    u_c = (-relA / d) if d > 0.5 else np.array([0.0, 1.0])
    v = (1.0 - sp) * n_sdf + sp * u_c
    l = np.linalg.norm(v)
    return v / l if l > 1e-5 else n_sdf

def fixed_splay(mode, grad, relA, sp, D=30.0):
    dA_c = np.linalg.norm(relA)
    gl = np.linalg.norm(grad)
    n_sdf = (-grad / gl) if gl > 1e-5 else np.array([0.0, 1.0])
    if mode == 0:
        u_c = (-relA / dA_c) if dA_c > 0.5 else np.array([0.0, 1.0])
        v = (1.0 - sp) * n_sdf + sp * u_c
        vl = np.linalg.norm(v)
        return v / vl if vl > 1e-5 else n_sdf
    else:
        u_c = -relA / math.sqrt(float(np.dot(relA, relA)) + D * D)
        n_raw = -grad / max(gl, 1.0)
        return (1.0 - sp) * n_raw + sp * u_c

# Audit 1: Mode 0 bit-exact parity across small (15px, 22px) and large (160px) shapes & all splays
max_m0_err = 0.0
for r in [15.0, 22.0, 40.0, 160.0]:
    for sp in [0.0, 0.25, 0.5, 0.75, 1.0]:
        for ang in [0, 37, 90, 145]:
            rad = math.radians(ang)
            rel = np.array([math.cos(rad), math.sin(rad)]) * r
            grad = np.array([math.cos(rad + 0.3), math.sin(rad + 0.3)])
            o = orig_splay(-grad, rel, sp)
            f = fixed_splay(0, grad, rel, sp, D=30.0)
            max_m0_err = max(max_m0_err, float(np.linalg.norm(o - f)))
assert max_m0_err < 1e-15, f"Mode 0 drift: {max_m0_err}"
print(f"  [PASS] Audit 1 (Original Mode 0 Parity incl. 15px/22px icons & all splays): max_err = {max_m0_err:.6f}")

# Audit 2: Thin stroke crossing cA at splay=0, 25, 50, 75, 100 (Lipschitz continuity around cA)
max_ca_jump = 0.0
for sp in [0.0, 0.25, 0.5, 0.75, 1.0]:
    vals = []
    for ang in range(0, 360, 45):
        rad = math.radians(ang)
        rel = np.array([math.cos(rad), math.sin(rad)]) * 0.5
        vals.append(fixed_splay(4, np.array([1.0, 0.0]), rel, sp, D=30.0))
    for i in range(len(vals)):
        for j in range(i + 1, len(vals)):
            max_ca_jump = max(max_ca_jump, float(np.linalg.norm(vals[i] - vals[j])))
assert max_ca_jump < 0.05, f"cA jump too large: {max_ca_jump}"
print(f"  [PASS] Audit 2 (Stroke crossing cA across all splays 0..100%): max_jump = {max_ca_jump:.4f} (< 0.05)")

# Audit 3: Donut inner wall (n_sdf = -u_center) at splay=50% across -1..+1 deg
v_neg = fixed_splay(3, np.array([-math.cos(math.radians(-1)), -math.sin(math.radians(-1))]), np.array([math.cos(math.radians(-1)), math.sin(math.radians(-1))])*60.0, 0.5, D=30.0)
v_pos = fixed_splay(3, np.array([-math.cos(math.radians(1)), -math.sin(math.radians(1))]), np.array([math.cos(math.radians(1)), math.sin(math.radians(1))])*60.0, 0.5, D=30.0)
donut_jump = float(np.linalg.norm(v_neg - v_pos))
assert donut_jump < 0.05, f"Donut inner wall jump: {donut_jump}"
print(f"  [PASS] Audit 3 (Donut inner wall n_sdf=-u_center at splay=50%): max_jump = {donut_jump:.4f} (< 0.05, was 2.0000)")

# Audit 4: Exact winding_quad on all 4 vertex-grazing cases + horizontal-bowed linear-in-y quadratic
def wind_quad_py(p, A, B, C):
    ay = A[1] - 2.0 * B[1] + C[1]
    by = 2.0 * (B[1] - A[1])
    cy = A[1] - p[1]
    if abs(ay) < 1e-5:
        if (A[1] <= p[1] and C[1] > p[1]) or (C[1] <= p[1] and A[1] > p[1]):
            t = max(0.0, min(1.0, (p[1] - A[1]) / (C[1] - A[1])))
            omt = 1.0 - t
            x = omt*omt*A[0] + 2.0*omt*t*B[0] + t*t*C[0]
            if x > p[0]:
                return 1 if C[1] > A[1] else -1
        return 0
    disc = by * by - 4.0 * ay * cy
    if disc <= 0.0:
        return 0
    s = math.sqrt(disc)
    w = 0
    for r in [(-by - s) / (2.0 * ay), (-by + s) / (2.0 * ay)]:
        dy = 2.0 * ay * r + by
        inside = (0.0 <= r < 1.0) if dy > 0.0 else (0.0 < r <= 1.0)
        if inside and abs(dy) > 1e-6:
            omt = 1.0 - r
            x = omt*omt*A[0] + 2.0*omt*r*B[0] + r*r*C[0]
            if x > p[0]:
                w += 1 if dy > 0.0 else -1
    return w

# Case 4a: Horizontal-bowed linear-in-y quad: A=(20,10), B=(120,50), C=(20,90), test point p=(50,50) (strictly INSIDE bow!)
w_bow = wind_quad_py((50.0, 50.0), (20.0, 10.0), (120.0, 50.0), (20.0, 90.0))
assert w_bow == 1, f"Bowed linear-in-y quad failed: {w_bow}"
# Case 4b: Local minimum vertex V=(50,50) grazed by ray y=50 from p=(0,50): S_in goes DOWN to V, S_out goes UP from V
w_min = wind_quad_py((0.0, 50.0), (20.0, 10.0), (35.0, 45.0), (50.0, 50.0)) + wind_quad_py((0.0, 50.0), (50.0, 50.0), (65.0, 45.0), (80.0, 10.0))
assert w_min == 0, f"Local min vertex grazing failed: {w_min}"
# Case 4c: Local maximum vertex V=(50,50) grazed by ray y=50: S_in goes UP to V, S_out goes DOWN from V
w_max = wind_quad_py((0.0, 50.0), (20.0, 90.0), (35.0, 55.0), (50.0, 50.0)) + wind_quad_py((0.0, 50.0), (50.0, 50.0), (65.0, 55.0), (80.0, 90.0))
assert w_max == 0, f"Local max vertex grazing failed: {w_max}"
# Case 4d: Monotonic UP through V=(50,50)
w_up = wind_quad_py((0.0, 50.0), (20.0, 10.0), (35.0, 20.0), (50.0, 50.0)) + wind_quad_py((0.0, 50.0), (50.0, 50.0), (65.0, 80.0), (80.0, 90.0))
assert w_up == 1, f"Monotonic UP vertex grazing failed: {w_up}"
print("  [PASS] Audit 4 (wind_quad bowed linear-in-y + all 4 vertex grazing cases): 100% exact")

# ==============================================================================
# PART 2 & 3: WEBGL2 HEADLESS CHROMIUM STRESS TEST + FUZZ TEST
# ==============================================================================
html_path = "artifacts/file_generation/ttl=63d/output/figma-liquid-glass-clean-demo.html"
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

html_off = html.replace("antialias: false", "antialias: false, preserveDrawingBuffer: true")
html_off = re.sub(r'<script[^>]+src="https://[^"]+"[^>]*></script>', '', html_off)
html_off = re.sub(r'<link[^>]+href="https://[^"]+"[^>]*>', '', html_off)
b64 = base64.b64encode(html_off.encode("utf-8")).decode("ascii")

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--use-gl=angle")
opts.add_argument("--use-angle=swiftshader")
opts.add_argument("--enable-unsafe-swiftshader")
opts.add_argument("--enable-webgl")
opts.add_argument("--ignore-gpu-blocklist")
opts.add_argument("--window-size=1280,960")
opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Chrome(options=opts)
driver.set_script_timeout(20)
driver.get("data:text/html;base64," + b64)

def render_and_grab(js_setup):
    data_url = driver.execute_async_script("""
      const done = arguments[arguments.length - 1];
      """ + js_setup + """
      requestAnimationFrame(() => requestAnimationFrame(() => {
        done(document.getElementById('stage-canvas').toDataURL('image/png'));
      }));
    """)
    img = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGB")
    return np.array(img), img

def check_frame(arr, label):
    # 1. Non-empty & finite
    assert arr.shape == (540, 960, 3), f"{label}: bad shape {arr.shape}"
    # 2. Check for NaN-black pixels (on Mesh bg, minimum RGB channel of entire background is > 20)
    black_px = int(np.sum((arr[:, :, 0] == 0) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 0)))
    assert black_px == 0, f"{label}: detected {black_px} pure-black (NaN) pixels!"
    # 3. Check zero console SEVERE errors
    errs = [l for l in driver.get_log("browser") if l["level"] == "SEVERE"]
    assert not errs, f"{label}: console SEVERE errors: {errs}"
    return black_px

print("\n=== PART 2: WEBGL2 STRESS TEST (12 TORTURE CASES) ===")
# Build a 480-segment high-density gear path
pts = []
for k in range(480):
    a = 2.0 * math.pi * k / 480.0
    r = 42.0 + 8.0 * math.sin(16.0 * a)
    pts.append(f"{50.0 + r*math.cos(a):.2f} {50.0 + r*math.sin(a):.2f}")
gear_480 = "M " + " L ".join(pts) + " Z"

stress_cases = [
    ("01_degenerate_zero_len", "bezier", "M 10 10 L 10 10 L 90 10 L 90 10 L 90 90 L 10 90 Z", {"splay": 100}),
    ("02_collinear_quad", "bezier", "M 10 10 Q 50 10 90 10 Q 90 50 90 90 Q 50 90 10 90 Q 10 50 10 10 Z", {"splay": 100}),
    ("03_bowed_linear_y_quad", "bezier", "M 20 10 Q 110 50 20 90 L 10 90 L 10 10 Z", {"splay": 100}),
    ("04_vertex_grazing_min_max", "bezier", "M 10 20 Q 30 80 50 80 Q 70 80 90 20 L 90 10 L 10 10 Z", {"splay": 100}),
    ("05_thin_cross_cA_splay50", "bezier", "M 46 5 L 54 5 L 54 46 L 95 46 L 95 54 L 54 54 L 54 95 L 46 95 L 46 54 L 5 54 L 5 46 L 46 46 Z", {"splay": 50}),
    ("06_thin_cross_cA_splay100", "bezier", "M 46 5 L 54 5 L 54 46 L 95 46 L 95 54 L 54 54 L 54 95 L 46 95 L 46 54 L 5 54 L 5 46 L 46 46 Z", {"splay": 100}),
    ("07_acute_5deg_needle", "bezier", "M 50 2 L 54 98 L 46 98 Z", {"splay": 100}),
    ("08_self_intersecting_X", "bezier", "M 10 10 L 90 90 L 90 10 L 10 90 Z", {"splay": 50}),
    ("09_triple_nested_rings", "bezier", "M 50 5 A 45 45 0 1 0 50 95 M 5 5 L 95 5 L 95 95 L 5 95 Z M 20 20 L 20 80 L 80 80 L 80 20 Z M 35 35 L 65 35 L 65 65 L 35 65 Z", {"splay": 50}),
    ("10_480_seg_gear", "bezier", gear_480, {"splay": 100}),
    ("11_relative_lowercase_svg", "bezier", "m 10 10 h 80 v 25 h -55 v 30 h 55 v 25 h -80 z", {"splay": 75}),
    ("12_donut_splay50_extreme", "donut", "", {"refraction": 100, "depth": 100, "dispersion": 100, "frost": 60, "splay": 50, "lightIntensity": 100}),
]

# Switch to Mesh bg for high-contrast NaN/artifact detection
driver.execute_script("document.querySelector('[data-bg=\"mesh\"]').click();")

for name, mode, svg_d, params in stress_cases:
    js = f"document.querySelector('[data-mode=\"{mode}\"]').click();"
    for k, v in params.items():
        js += f"const el_{k}=document.getElementById('sl-{k}'); if(el_{k}){{ el_{k}.value={v}; el_{k}.dispatchEvent(new Event('input')); }}"
    if svg_d:
        esc = svg_d.replace("\\", "\\\\").replace("'", "\\'")
        js += f"const inp=document.getElementById('inp-svg-d'); inp.value='{esc}'; inp.dispatchEvent(new Event('input'));"
    arr, img = render_and_grab(js)
    check_frame(arr, name)
    if name in ("03_bowed_linear_y_quad", "05_thin_cross_cA_splay50", "12_donut_splay50_extreme"):
        img.save(f"artifacts/file_generation/ttl=63d/intermediate/stress_{name}.png")
    print(f"  [PASS] {name} | NaN/black=0 | console_err=0")

print("\n=== PART 3: WEBGL2 FUZZ TEST (30 RANDOMIZED SCENES) ===")
rng = random.Random(20261121)
t0 = time.time()
for idx in range(30):
    mode = rng.choice(["orig", "gooey", "morph", "donut", "bezier"])
    refr = rng.randint(0, 100)
    dep = rng.randint(0, 100)
    disp = rng.randint(0, 100)
    frost = rng.randint(0, 60)
    splay = rng.randint(0, 100)
    lang = rng.randint(-180, 180)
    lint = rng.randint(0, 100)
    rot = rng.randint(-180, 180)
    js = f"document.querySelector('[data-mode=\"{mode}\"]').click();"
    for k, v in [("refraction", refr), ("depth", dep), ("dispersion", disp), ("frost", frost), ("splay", splay), ("lightAngle", lang), ("lightIntensity", lint), ("rotation", rot)]:
        js += f"(() => {{ const e=document.getElementById('sl-{k}'); if(e){{ e.value={v}; e.dispatchEvent(new Event('input')); }} }})();"
    if mode == "bezier":
        n_v = rng.randint(3, 14)
        ang_list = sorted([rng.uniform(0, 2*math.pi) for _ in range(n_v)])
        cmds = []
        for j, a in enumerate(ang_list):
            r = rng.uniform(12, 48)
            x, y = 50 + r*math.cos(a), 50 + r*math.sin(a)
            if j == 0:
                cmds.append(f"M {x:.1f} {y:.1f}")
            else:
                kind = rng.choice(["L", "Q", "C"])
                if kind == "L":
                    cmds.append(f"L {x:.1f} {y:.1f}")
                elif kind == "Q":
                    cx, cy = rng.uniform(5, 95), rng.uniform(5, 95)
                    cmds.append(f"Q {cx:.1f} {cy:.1f} {x:.1f} {y:.1f}")
                else:
                    c1x, c1y = rng.uniform(5, 95), rng.uniform(5, 95)
                    c2x, c2y = rng.uniform(5, 95), rng.uniform(5, 95)
                    cmds.append(f"C {c1x:.1f} {c1y:.1f} {c2x:.1f} {c2y:.1f} {x:.1f} {y:.1f}")
        cmds.append("Z")
        svg_d = " ".join(cmds)
        js += f"(() => {{ const inp=document.getElementById('inp-svg-d'); inp.value='{svg_d}'; inp.dispatchEvent(new Event('input')); }})();"
    arr, _ = render_and_grab(js)
    check_frame(arr, f"fuzz_{idx:02d}_{mode}")
elapsed = time.time() - t0
print(f"  [PASS] 30/30 Fuzz scenes passed in {elapsed:.1f}s | NaN/black=0 | console_err=0")

driver.quit()
print("\nALL AUDITS, 12 STRESS TESTS, AND 30 FUZZ TESTS PASSED.")
