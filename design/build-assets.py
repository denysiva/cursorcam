"""Turn the raw generated art/audio in design/raw into the files the game ships.

Run from the repo root:  python3 design/build-assets.py
Needs Pillow, numpy and ffmpeg. design/raw is not committed (≈45 MB of PNG);
the prompts that produced it are in design/README.md.
"""
import subprocess, re
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
IMG = ROOT.parent / "app/public/img"
SFX = ROOT.parent / "app/public/sfx"
IMG.mkdir(parents=True, exist_ok=True)
SFX.mkdir(parents=True, exist_ok=True)

def webp(src, dst, size, q=84):
    im = Image.open(RAW / src).convert("RGB")
    im = im.resize(size, Image.LANCZOS)
    im.save(IMG / dst, "WEBP", quality=q, method=6)

for name in ["sun", "moon", "bot", "ban"]:
    webp(f"{name}.png", f"card-{name}.webp", (512, 512))
for name in ["oracle-sun", "oracle-moon"]:
    webp(f"{name}.png", f"{name}.webp", (720, 720))
webp("hero.png", "hero.webp", (960, 1200), 82)

# Share image: 1200x630 crop of the wide key art.
cover = Image.open(RAW / "cover.png").convert("RGB")
w, h = cover.size
ch = round(w * 630 / 1200)
top = (h - ch) // 2
cover.crop((0, top, w, top + ch)).resize((1200, 630), Image.LANCZOS).save(IMG / "og.jpg", quality=86)

# Avatars: 16 medallions on a transparent sheet -> one tight 4x4 sprite.
sheet = Image.open(RAW / "avatars.png").convert("RGBA")
alpha = np.array(sheet)[:, :, 3] > 128
# The sheet is an even 4x4 grid: take each quarter cell and crop it to the
# medallion's own bounding box, so every avatar fills its tile edge to edge.
CELL = 168
H, W = alpha.shape
sprite = Image.new("RGBA", (CELL * 4, CELL * 4), (0, 0, 0, 0))
for r in range(4):
    for c in range(4):
        x0, x1 = c * W // 4, (c + 1) * W // 4
        y0, y1 = r * H // 4, (r + 1) * H // 4
        ys, xs = np.where(alpha[y0:y1, x0:x1])
        assert len(xs), (r, c)
        box = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)
        tile = sheet.crop(box).resize((CELL, CELL), Image.LANCZOS)
        sprite.paste(tile, (c * CELL, r * CELL))
sprite.save(IMG / "avatars.webp", "WEBP", quality=86, method=6)

icon = Image.open(RAW / "icon.png").convert("RGB")
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (64, "favicon.png")]:
    icon.resize((size, size), Image.LANCZOS).save(IMG / name, optimize=True)

def peak(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.search(r"max_volume: (-?[\d.]+) dB", out).group(1))

for src in sorted(RAW.glob("*.mp3")):
    music = src.stem == "music"
    target = -3.0 if music else -1.5
    gain = target - peak(src)
    chain = f"volume={gain:.1f}dB"
    if not music:
        chain += ",silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.005"
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", chain]
    args += ["-ac", "2", "-b:a", "112k"] if music else ["-ac", "1", "-b:a", "80k"]
    subprocess.run(args + [str(SFX / src.name)], check=True)

print("assets built")
