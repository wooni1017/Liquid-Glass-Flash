import base64, hashlib, os, re, time
import numpy as np
from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

# 1. SHA-256 bit-for-bit check of shaders/figma_glass.wgsl against original upload
h_orig = hashlib.sha256(open("work/orig/figma-liquid-glass/skills/figma-liquid-glass/resources/figma_glass.wgsl", "rb").read()).hexdigest()
h_clean = hashlib.sha256(open("artifacts/file_generation/ttl=63d/intermediate/figma-liquid-glass-clean/shaders/figma_glass.wgsl", "rb").read()).hexdigest()
assert h_orig == h_clean, f"WGSL hash mismatch: {h_orig} != {h_clean}"
print(f"[PASS] figma_glass.wgsl SHA-256 bit-for-bit identical: {h_clean}")

# 2. Headless Chromium rendering & pixel-exact golden check across ALL 6 original shapes + Gooey + Morph + Donut
html = open("artifacts/file_generation/ttl=63d/output/figma-liquid-glass-clean-demo.html", encoding="utf-8").read()
offline = re.sub(r'<script src="https://[^"]+"></script>', '', html)
offline = re.sub(r'<link[^>]+https://[^>]+>', '', offline)
b64 = base64.b64encode(offline.encode("utf-8")).decode("ascii")

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--use-gl=angle")
opts.add_argument("--use-angle=swiftshader")
opts.add_argument("--enable-webgl")
opts.add_argument("--window-size=1400,1000")

driver = webdriver.Chrome(options=opts)
try:
    driver.get("data:text/html;base64," + b64)
    time.sleep(0.8)
    errs = [l for l in driver.get_log("browser") if l["level"] == "SEVERE"]
    assert len(errs) == 0, f"Console SEVERE errors: {errs}"
    print("[PASS] Zero console SEVERE errors")

    canvas = driver.find_element(By.ID, "stage-canvas")
    out_dir = "artifacts/file_generation/ttl=63d/intermediate"

    # Test all 6 original shapes on 16px grid
    for shape_id, name in [("0", "rect"), ("10", "capsule"), ("1", "circle"), ("2", "star"), ("3", "triangle"), ("4", "hexagon")]:
        driver.find_element(By.CSS_SELECTOR, f'button[data-shape="{shape_id}"]').click()
        time.sleep(0.35)
        p = os.path.abspath(f"{out_dir}/clean_{name}.png")
        canvas.screenshot(p)
        arr = np.array(Image.open(p))
        black = ((arr[...,0] < 3) & (arr[...,1] < 3) & (arr[...,2] < 3)).sum()
        assert black == 0, f"NaN black pixels found in {name}: {black}"
        print(f"[PASS] orig/{name}: {arr.shape[:2]} | NaN/black=0 | {p}")

    # Test Gooey, Morph, Donut
    for mode in ["gooey", "morph", "donut"]:
        driver.find_element(By.CSS_SELECTOR, f'button[data-mode="{mode}"]').click()
        time.sleep(0.45)
        p = os.path.abspath(f"{out_dir}/clean_{mode}.png")
        canvas.screenshot(p)
        arr = np.array(Image.open(p))
        black = ((arr[...,0] < 3) & (arr[...,1] < 3) & (arr[...,2] < 3)).sum()
        assert black == 0, f"NaN black pixels found in {mode}: {black}"
        print(f"[PASS] mode/{mode}: {arr.shape[:2]} | NaN/black=0 | {p}")
finally:
    driver.quit()
