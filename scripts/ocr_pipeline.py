#!/usr/bin/env python3
"""
Valorant Scoreboard OCR Pipeline — v2
Local-only: OpenCV + Pillow + Tesseract (no external AI/Vision API)

Changes from v1:
  - Row detection replaced with deterministic boundary detection from
    actual measured row Y positions (validated against real screenshot)
  - Column geometry re-measured from actual pixel data
  - HSV ranges tuned to the real scoreboard colors
  - Per-field preprocessing and PSM tuning
  - Proper team classification per row (not per band)

Usage:
    python scripts/ocr_pipeline.py <image_path> [--debug] [--debug-dir debug/vision]

Outputs canonical JSON to stdout.
"""

import sys
import os
import json
import time
import re
import argparse
import traceback

import cv2
import numpy as np
from PIL import Image, ImageEnhance
import pytesseract

# ──────────────────────────────────────────────
# TESSERACT
# ──────────────────────────────────────────────
TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
]

def find_tesseract():
    for path in TESSERACT_PATHS:
        if os.path.isfile(path):
            return path
    import shutil
    return shutil.which("tesseract")

TESSERACT_CMD = find_tesseract()
if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

# ──────────────────────────────────────────────
# GEOMETRY CONFIG
# All coordinates normalized 0.0–1.0 of image width.
# Derived from pixel measurements of 984×607 Valorant scoreboard.
#
# Measured column separator positions (vertical lines at R=236,G=232,B=225):
#   Agent icon area:  x=0    – x=62   (icon)
#   Name+agent text:  x=62   – x=271  (27.5%)
#   ACS column:       x=271  – x=413  (41.9%)  — center ~x=340 holds "335"
#   KDA column:       x=413  – x=527  (53.6%)  — "32 / 14 / 5" spans ~x=432-498
#   ECON column:      x=527  – x=635  (64.5%)  — center ~x=574-584
#   FB column:        x=635  – x=747  (75.9%)  — center ~x=690
#   PLT column:       x=747  – x=860  (87.4%)  — center ~x=806
#   DEF column:       x=860  – x=984  (100%)   — center ~x=918
#
# Row boundaries (from vertical scan at x=400 of actual screenshot):
#   Header:   y=0  –y=55
#   Row 0 A:  y=56 –y=108   (HCL7)
#   Row 1 B:  y=110–y=162   (ATMAN FPS)
#   Row 2 A:  y=164–y=216   (White Tiger)
#   Row 3 A:  y=218–y=270   (cHiRu)
#   Row 4 B:  y=272–y=324   (kunty)
#   Row 5 B:  y=326–y=378   (F0rSakeN)
#   Row 6 A:  y=380–y=432   (Neeel)
#   Row 7 B:  y=434–y=486   (Venomnom)
#   Row 8 B:  y=488–y=540   (Ciggy)
#   Row 9 A:  y=542–y=594   (MTPX Kinesis)
# ──────────────────────────────────────────────

# Column geometry: (x_start_norm, x_end_norm)
# All boundaries empirically calibrated against Valorant_scoreboard.png (984×607).
#
# v3 final calibration:
#   name   left = 0.071 (70px):
#     x=62-70 contains icon border pixels that bleed white noise into OCR.
#     x=70 is the first clean name-region pixel. Fixes '-White Tiger' leading dash.
#
#   kda    right = 0.540 (531px):
#     Despite the separator cluster at x=495-501, reducing the right boundary
#     further (to 504px) does NOT fix the F0rSakeN/Venomnom/Ciggy contamination.
#     The trailing digit comes from Tesseract reading the KDA column separator line
#     as an extra digit. It is handled in parse_kda() via regex.
#
#   econ   left = 0.575 (565px):
#     x=531 works for 9/10 rows. x=565 also fixes Ciggy (55, not 95) without
#     breaking other rows. Venomnom (43) and others confirmed correct at 565.
#     F0rSakeN ECON reads '96' at both x=531 and x=565 — this is a Tesseract
#     5→9 glyph confusion, not a boundary problem.
#
#   defuses right = 0.994 (978px): trims the black right-edge artifact.
COLUMN_DEFS = {
    "name":        (0.071,  0.270),   # 70px  – 266px
    "agent":       (0.071,  0.270),   # same crop region, agent = 2nd OCR line
    "acs":         (0.275,  0.415),   # 271px – 408px
    "kda":         (0.415,  0.540),   # 408px – 531px  (trailing digit cleaned in parser)
    "econ":        (0.575,  0.645),   # 565px – 635px
    "firstBloods": (0.645,  0.755),   # 635px – 743px
    "plants":      (0.755,  0.865),   # 743px – 851px
    "defuses":     (0.869,  0.994),   # 855px – 978px
}

# Expected row periodicity (normalized)
# From measurements: each row is ~52px tall in a 607px image
EXPECTED_ROW_HEIGHT_RATIO = 52.0 / 607.0   # ≈ 0.0857

# ──────────────────────────────────────────────
# HSV COLOR RANGES for team detection
# OpenCV HSV: H=0-180, S=0-255, V=0-255
#
# Team A (dark red/maroon): from scan: R=105-116, G=56-60, B=71-80
#   → in HSV: H≈345-10°→170-5 in OCV scale, S moderate, V moderate
# Team B (teal):            from scan: R=20-29, G=140-149, B=124-131
#   → in HSV: H≈168-175°→84-87 OCV, S high, V moderate
#
# Key: classify based on the LEFT colored panel only (x=62–270)
# not the full row width (which is mostly dark gray)
# ──────────────────────────────────────────────
TEAM_A_HSV = [
    # Dark red/maroon rows
    ((0,   30,  40),  (10,  200, 150)),   # H near 0 (red)
    ((165, 30,  40),  (180, 200, 150)),   # H near 180 (red wraps)
]
TEAM_B_HSV = [
    # Teal rows
    ((78,  80,  60),  (95,  230, 160)),   # H=78-95 in OCV (≈156-190° real)
]

# ──────────────────────────────────────────────
# UTILITIES
# ──────────────────────────────────────────────
def eprint(*args):
    print(*args, file=sys.stderr)

def save_debug(img_bgr_or_gray, rel_path, debug_dir):
    if not debug_dir:
        return
    full = os.path.join(debug_dir, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    cv2.imwrite(full, img_bgr_or_gray)

# ──────────────────────────────────────────────
# STAGE 1 — LOAD & VALIDATE
# ──────────────────────────────────────────────
def load_and_validate(image_path):
    if not os.path.isfile(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"OpenCV could not decode image: {image_path}")
    h, w = img.shape[:2]
    if w < 400 or h < 200:
        raise ValueError(f"Image too small ({w}×{h}). Minimum 400×200.")
    eprint(f"[PIPELINE] Loaded: {w}×{h}px  path={image_path}")
    return img

# ──────────────────────────────────────────────
# STAGE 2 — DETERMINISTIC ROW DETECTION
#
# Strategy: scan the left-panel region (x=62 to x=270) vertically.
# The left panel is solidly red or teal for each player row.
# Find contiguous bands of consistent hue in this region.
# Each band is one player row.
# ──────────────────────────────────────────────
def classify_pixel_team(h_val, s_val, v_val):
    """Return 'A', 'B', or None given OpenCV HSV values."""
    for (lo, hi) in TEAM_A_HSV:
        if lo[0] <= h_val <= hi[0] and lo[1] <= s_val <= hi[1] and lo[2] <= v_val <= hi[2]:
            return 'A'
    for (lo, hi) in TEAM_B_HSV:
        if lo[0] <= h_val <= hi[0] and lo[1] <= s_val <= hi[1] and lo[2] <= v_val <= hi[2]:
            return 'B'
    return None

def detect_rows(img, debug_dir=None):
    """
    Detect all 10 player rows using the left-panel colored strip.

    Scans multiple X positions in the left panel (x=80 to x=240) per row,
    voting on team classification per Y scanline.
    Then finds contiguous Y bands = player rows.

    Returns list of dicts: {y, height, team, confidence, row_index}
    """
    h, w = img.shape[:2]
    img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # X positions to sample in left panel
    sample_xs = list(range(80, 241, 10))  # 17 sample columns
    n_samples = len(sample_xs)

    # Per-Y vote
    y_team = []   # 'A', 'B', or None per y
    y_conf = []   # fraction of samples that agreed

    for y in range(h):
        votes = {'A': 0, 'B': 0}
        for x in sample_xs:
            hsv = img_hsv[y, x]
            t = classify_pixel_team(int(hsv[0]), int(hsv[1]), int(hsv[2]))
            if t:
                votes[t] += 1
        total = votes['A'] + votes['B']
        if total == 0:
            y_team.append(None)
            y_conf.append(0.0)
        else:
            winner = 'A' if votes['A'] >= votes['B'] else 'B'
            conf = max(votes['A'], votes['B']) / n_samples
            if conf >= 0.15:   # at least 15% of samples must agree
                y_team.append(winner)
                y_conf.append(conf)
            else:
                y_team.append(None)
                y_conf.append(0.0)

    # Find contiguous bands
    MIN_ROW_H = max(20, int(h * EXPECTED_ROW_HEIGHT_RATIO * 0.4))
    MAX_ROW_H = int(h * EXPECTED_ROW_HEIGHT_RATIO * 1.8)

    bands = []
    in_band = False
    band_start = 0
    band_team = None
    band_conf_sum = 0.0

    for y in range(h):
        t = y_team[y]
        c = y_conf[y]

        if t is not None and not in_band:
            in_band = True
            band_start = y
            band_team = t
            band_conf_sum = c

        elif t is not None and in_band:
            if t != band_team:
                # team changed mid-band — close current, start new
                band_h = y - band_start
                if band_h >= MIN_ROW_H:
                    bands.append({
                        'y': band_start,
                        'height': band_h,
                        'team': band_team,
                        'conf_sum': band_conf_sum,
                        'px_count': band_h,
                    })
                in_band = True
                band_start = y
                band_team = t
                band_conf_sum = c
            else:
                band_conf_sum += c

        elif t is None and in_band:
            band_h = y - band_start
            if band_h >= MIN_ROW_H:
                bands.append({
                    'y': band_start,
                    'height': band_h,
                    'team': band_team,
                    'conf_sum': band_conf_sum,
                    'px_count': band_h,
                })
            in_band = False

    if in_band:
        band_h = h - band_start
        if band_h >= MIN_ROW_H:
            bands.append({
                'y': band_start,
                'height': band_h,
                'team': band_team,
                'conf_sum': band_conf_sum,
                'px_count': band_h,
            })

    # Split oversized bands (merged rows)
    EXPECTED_ROW_H = h * EXPECTED_ROW_HEIGHT_RATIO
    split_bands = []
    for band in bands:
        bh = band['height']
        if bh > MAX_ROW_H:
            # Split into sub-rows of ~EXPECTED_ROW_H using valley detection in Y votes
            n_sub = round(bh / EXPECTED_ROW_H)
            if n_sub < 2:
                n_sub = 2
            eprint(f"[ROWS] Splitting band y={band['y']} h={bh} into {n_sub} sub-rows")

            # Find lowest-confidence Y within band to use as split points
            confs = y_conf[band['y']:band['y'] + bh]
            sub_h = bh // n_sub
            for i in range(n_sub):
                y0 = band['y'] + i * sub_h
                y1 = band['y'] + (i + 1) * sub_h if i < n_sub - 1 else band['y'] + bh
                actual_h = y1 - y0
                if actual_h >= MIN_ROW_H:
                    sub_conf = sum(confs[i*sub_h: (i+1)*sub_h]) / max(1, actual_h)
                    split_bands.append({
                        'y': y0,
                        'height': actual_h,
                        'team': band['team'],
                        'conf_sum': sub_conf * actual_h,
                        'px_count': actual_h,
                    })
        else:
            split_bands.append(band)

    # Sort by Y position (scoreboard order)
    split_bands.sort(key=lambda b: b['y'])

    # Build final row list with confidence
    rows = []
    for i, band in enumerate(split_bands):
        conf = band['conf_sum'] / max(1, band['px_count'])
        rows.append({
            'row_index': i,
            'x': 0,
            'y': int(band['y']),
            'width': w,
            'height': int(band['height']),
            'team': band['team'],
            'confidence': round(float(conf), 3),
        })

    team_a = [r for r in rows if r['team'] == 'A']
    team_b = [r for r in rows if r['team'] == 'B']
    eprint(f"[ROWS] Total rows: {len(rows)} | Team A: {len(team_a)} | Team B: {len(team_b)}")

    if debug_dir:
        annotated = img.copy()
        for r in rows:
            color = (50, 50, 220) if r['team'] == 'A' else (200, 180, 0)
            label = f"{r['team']}{team_a.index(r)+1 if r['team']=='A' else team_b.index(r)+1} y={r['y']}"
            cv2.rectangle(annotated,
                          (r['x'], r['y']),
                          (r['x'] + r['width'], r['y'] + r['height']),
                          color, 2)
            cv2.putText(annotated, label, (5, r['y'] + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        save_debug(annotated, 'annotated/scoreboard_v2.png', debug_dir)

        # Save team masks (for left panel only)
        mask_a = np.zeros(img.shape[:2], dtype=np.uint8)
        mask_b = np.zeros(img.shape[:2], dtype=np.uint8)
        for y in range(h):
            if y_team[y] == 'A':
                mask_a[y, :] = 255
            elif y_team[y] == 'B':
                mask_b[y, :] = 255
        save_debug(cv2.cvtColor(mask_a, cv2.COLOR_GRAY2BGR), 'annotated/mask_teamA_v2.png', debug_dir)
        save_debug(cv2.cvtColor(mask_b, cv2.COLOR_GRAY2BGR), 'annotated/mask_teamB_v2.png', debug_dir)

    return rows

# ──────────────────────────────────────────────
# STAGE 3 — CROP COLUMN FROM ROW
# ──────────────────────────────────────────────
def crop_column(row_crop, col_key):
    """Extract a column slice using normalized COLUMN_DEFS."""
    w = row_crop.shape[1]
    x0 = int(w * COLUMN_DEFS[col_key][0])
    x1 = int(w * COLUMN_DEFS[col_key][1])
    return row_crop[:, x0:x1]

# ──────────────────────────────────────────────
# STAGE 4 — PREPROCESSING FOR OCR
# ──────────────────────────────────────────────
def preprocess_dark_bg(region, upscale=3.5):
    """
    For: name, agent — light text on colored (red/teal) background.
    Invert so text becomes dark on white for Tesseract.
    """
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    gray = cv2.resize(gray, (int(w * upscale), int(h * upscale)),
                      interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    gray = clahe.apply(gray)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    binary = cv2.medianBlur(binary, 3)
    return binary

def preprocess_dark_stat(region, upscale=4.0):
    """
    For: ACS, ECON, FB, PLT, DEF — light text on dark gray background.
    BINARY (not INV) because Otsu correctly identifies light text as foreground
    when background is dark. Adding white border is counterproductive — omit it.
    """
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    if h < 5 or w < 5:
        return gray
    gray = cv2.resize(gray, (int(w * upscale), int(h * upscale)),
                      interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2, 2))
    gray = clahe.apply(gray)
    # BINARY: digits are lighter than the dark background → Otsu puts them in foreground
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = cv2.medianBlur(binary, 3)
    return binary

def preprocess_kda(region, upscale=4.0):
    """KDA uses same pipeline as numeric stats."""
    return preprocess_dark_stat(region, upscale)

# ──────────────────────────────────────────────
# STAGE 5 — OCR CALLS
# ──────────────────────────────────────────────
def run_tess(binary_img, psm, whitelist=None):
    """Run Tesseract on a binary image and return stripped string."""
    config = f"--psm {psm}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    pil = Image.fromarray(binary_img)
    return pytesseract.image_to_string(pil, lang="eng", config=config).strip()

NAME_WHITELIST   = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-. "
AGENT_WHITELIST  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
NUM_WHITELIST    = "0123456789"
KDA_WHITELIST    = "0123456789/ "

def ocr_name_agent(row_crop, debug_dir=None, label=""):
    col = crop_column(row_crop, "name")
    proc = preprocess_dark_bg(col)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_name_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_name_proc.png", debug_dir)
    # PSM 6 = assume uniform block of text → reads multiple lines (name + agent label)
    raw = run_tess(proc, psm=6, whitelist=NAME_WHITELIST + "\n")
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    name  = lines[0] if len(lines) >= 1 else ""
    agent = lines[1] if len(lines) >= 2 else ""
    # Agent label is ALL-CAPS letters only (e.g. REYNA, SKYE, BRIMSTONE)
    agent = re.sub(r"[^A-Z]", "", agent.upper()) if agent else ""
    return name.strip(), agent, raw

def ocr_number(row_crop, col_key, debug_dir=None, label=""):
    """OCR for ACS, ECON, PLT — moderate-width numeric columns."""
    col = crop_column(row_crop, col_key)
    proc = preprocess_dark_stat(col)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_{col_key}_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_{col_key}_proc.png", debug_dir)
    # PSM 7 confirmed empirically better than PSM 8 for these crop widths.
    # No white border padding — it breaks Tesseract on small crops.
    raw = run_tess(proc, psm=7, whitelist=NUM_WHITELIST)
    return raw.strip()

def ocr_fb(row_crop, debug_dir=None, label=""):
    """OCR for First Bloods — single digit, sometimes low contrast.
    PSM 6 (uniform block) outperforms PSM 7 for very small/sparse digit cells.
    """
    col = crop_column(row_crop, "firstBloods")
    proc = preprocess_dark_stat(col)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_firstBloods_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_firstBloods_proc.png", debug_dir)
    raw = run_tess(proc, psm=6, whitelist=NUM_WHITELIST)
    return raw.strip()

def ocr_defuses(row_crop, debug_dir=None, label=""):
    """OCR for Defuses — rightmost column, very small digit.
    Uses upscale=5 (higher than other fields) because the digit is only ~3-4px wide.
    PSM 6 handles sparse single-character cells better than PSM 7.
    """
    col = crop_column(row_crop, "defuses")
    # Custom preprocessing with higher upscale
    gray = cv2.cvtColor(col, cv2.COLOR_BGR2GRAY)
    gh, gw = gray.shape
    if gh < 3 or gw < 3:
        return ""
    gray_up = cv2.resize(gray, (gw * 5, gh * 5), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=5.0, tileGridSize=(2, 2))
    gray_up = clahe.apply(gray_up)
    _, binary = cv2.threshold(gray_up, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = cv2.medianBlur(binary, 3)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_defuses_raw.png", debug_dir)
        save_debug(binary, f"row_crops/{label}_defuses_proc.png", debug_dir)
    raw = run_tess(binary, psm=6, whitelist=NUM_WHITELIST)
    return raw.strip()

def ocr_kda(row_crop, debug_dir=None, label=""):
    col = crop_column(row_crop, "kda")
    proc = preprocess_kda(col)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_kda_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_kda_proc.png", debug_dir)
    # PSM 7 = single text line; KDA whitelist avoids non-numeric/slash noise
    raw = run_tess(proc, psm=7, whitelist=KDA_WHITELIST)
    return raw.strip()

# ──────────────────────────────────────────────
# STAGE 6 — PARSE & NORMALIZE
# ──────────────────────────────────────────────
def parse_int(raw, field):
    clean = re.sub(r"[^\d]", "", raw)
    if clean:
        return int(clean), None
    return 0, f"{field}: unreadable raw='{raw}'"

def parse_kda(raw):
    import re as _re
    clean = _re.sub(r"\s+", " ", raw.strip())

    # 1. Primary standard K/D/A pattern (e.g. "20/19/6" or "17/17/73")
    m = _re.search(r"(\d+)\s*/\s*(\d+)\s*/\s*(\d+)", clean)
    if m:
        k, d, a = m.group(1), m.group(2), m.group(3)
        # Artifact: the column separator line is consistently read as '7' by Tesseract
        # when it immediately precedes the final assist digit (confirmed empirically).
        # Signature: last component is exactly 2 digits AND starts with '7'.
        # Legitimate 2-digit assists (e.g. 12, 15) start with '1' or '2', never '7'.
        if len(a) == 2 and a[0] == '7':
            a_stripped = a[1:]
            return f"{k}/{d}/{a_stripped}", f"kda: stripped leading separator-glyph '7' from '{raw}'"
        return f"{k}/{d}/{a}", None

    # 2. Secondary recovery pattern: second slash misread as '7' or merged (e.g. "16/1975" -> 16/19/5)
    # Signature: K / (1 or 2 digits Deaths) + ('7' separator misread) + (1 or 2 digits Assists)
    m2 = _re.search(r"(\d+)\s*/\s*(\d{1,2})\s*7\s*(\d{1,2})", clean)
    if m2:
        k, d, a = m2.group(1), m2.group(2), m2.group(3)
        return f"{k}/{d}/{a}", f"kda: recovered missing slash from separator artifact in '{raw}'"

    # 3. Unreadable KDA: return empty string so frontend exposes empty field for manual correction
    return "", f"kda: unreadable raw='{raw}'"

def normalize_name(raw):
    return re.sub(r"\s+", " ", raw.strip()).strip("|. ")

# ──────────────────────────────────────────────
# STAGE 7 — PROCESS ONE ROW
# ──────────────────────────────────────────────
def process_row(img, row, row_label, debug_dir=None):
    y0 = row['y']
    y1 = y0 + row['height']
    row_crop = img[y0:y1, :]

    if debug_dir:
        save_debug(row_crop, f"row_crops/{row_label}_full.png", debug_dir)

    warnings = []

    name, agent, raw_name_full = ocr_name_agent(row_crop, debug_dir, row_label)
    name = normalize_name(name)

    raw_acs  = ocr_number(row_crop, "acs",    debug_dir, row_label)
    raw_econ = ocr_number(row_crop, "econ",   debug_dir, row_label)
    raw_fb   = ocr_fb(row_crop,               debug_dir, row_label)  # PSM 6, wider
    raw_plt  = ocr_number(row_crop, "plants", debug_dir, row_label)
    raw_def  = ocr_defuses(row_crop,          debug_dir, row_label)  # upscale=5, PSM 6
    raw_kda  = ocr_kda(row_crop,              debug_dir, row_label)

    acs,  w1 = parse_int(raw_acs,  "acs")
    econ, w2 = parse_int(raw_econ, "econ")
    fb,   w3 = parse_int(raw_fb,   "firstBloods")
    plt,  w4 = parse_int(raw_plt,  "plants")
    defs, w5 = parse_int(raw_def,  "defuses")
    kda,  w6 = parse_kda(raw_kda)

    for w in [w1, w2, w3, w4, w5, w6]:
        if w:
            warnings.append(w)

    return {
        "name": name,
        "agent": agent if agent else "UNRESOLVED",
        "acs": acs, "kda": kda, "econ": econ,
        "firstBloods": fb, "plants": plt, "defuses": defs,
        "_raw": {
            "name_full_ocr": raw_name_full,
            "name": name, "agent": agent,
            "acs": raw_acs, "kda": raw_kda, "econ": raw_econ,
            "firstBloods": raw_fb, "plants": raw_plt, "defuses": raw_def,
        },
        "_warnings": warnings,
    }

# ──────────────────────────────────────────────
# MAIN PIPELINE
# ──────────────────────────────────────────────
def run_pipeline(image_path, debug_dir=None):
    t0 = time.time()

    if not TESSERACT_CMD:
        raise RuntimeError(
            "Tesseract not found. Install from https://github.com/UB-Mannheim/tesseract/wiki"
        )

    img = load_and_validate(image_path)
    h, w = img.shape[:2]

    # ── Row detection ──
    rows = detect_rows(img, debug_dir)

    team_a_rows = [r for r in rows if r['team'] == 'A']
    team_b_rows = [r for r in rows if r['team'] == 'B']
    total_rows = len(rows)

    if total_rows != 10:
        eprint(f"[WARNING] Expected 10 rows, detected {total_rows}")
    if len(team_a_rows) != 5:
        eprint(f"[WARNING] Expected 5 Team A rows, got {len(team_a_rows)}")
    if len(team_b_rows) != 5:
        eprint(f"[WARNING] Expected 5 Team B rows, got {len(team_b_rows)}")

    # ── OCR all rows in scoreboard order ──
    all_players = []
    for row in rows:
        team_label = row['team']
        team_idx = (team_a_rows.index(row) + 1 if team_label == 'A'
                    else team_b_rows.index(row) + 1)
        row_label = f"team{team_label}_p{team_idx}"
        eprint(f"[OCR] Row {row['row_index']} y={row['y']} team={team_label} → {row_label}")
        player = process_row(img, row, row_label, debug_dir)
        player['_team'] = team_label
        player['_row_index'] = row['row_index']
        all_players.append(player)

    players_a = [p for p in all_players if p['_team'] == 'A']
    players_b = [p for p in all_players if p['_team'] == 'B']

    elapsed = round(time.time() - t0, 2)
    eprint(f"[PIPELINE] Done in {elapsed}s")

    def clean(p):
        return {k: v for k, v in p.items() if not k.startswith('_')}

    output = {
        "teamA": {
            "detectedColor": "red",
            "players": [clean(p) for p in players_a],
        },
        "teamB": {
            "detectedColor": "teal",
            "players": [clean(p) for p in players_b],
        },
        "_diagnostics": {
            "imageDimensions": {"width": w, "height": h},
            "rowDetection": {
                "totalRows": total_rows,
                "teamA": {"rowsDetected": len(team_a_rows), "rows": team_a_rows},
                "teamB": {"rowsDetected": len(team_b_rows), "rows": team_b_rows},
                "allRowsInOrder": rows,
            },
            "processingTimeSeconds": elapsed,
            "rawOCR": {
                "teamA": [p["_raw"] for p in players_a],
                "teamB": [p["_raw"] for p in players_b],
            },
            "warnings": {
                "teamA": [p["_warnings"] for p in players_a],
                "teamB": [p["_warnings"] for p in players_b],
            },
        },
    }
    return output


# ──────────────────────────────────────────────
# ENTRY POINT
# ──────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Valorant Scoreboard OCR Pipeline")
    parser.add_argument("image_path", nargs="?", default=None, help="Path to input scoreboard image")
    parser.add_argument("--image", dest="image_opt", default=None, help="Path to input scoreboard image")
    parser.add_argument("--debug", action="store_true", help="Enable debug crops saving")
    parser.add_argument("--debug-dir", default="debug/vision", help="Directory for debug outputs")
    args = parser.parse_args()

    image_path = args.image_opt or args.image_path
    if not image_path:
        sys.stderr.write("Error: Image path required. Usage: python scripts/ocr_pipeline.py --image <path>\n")
        sys.exit(1)

    debug_dir = args.debug_dir if args.debug else None

    try:
        result = run_pipeline(image_path, debug_dir)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(0)
    except Exception as e:
        sys.stderr.write(f"Error executing OCR pipeline: {str(e)}\n{traceback.format_exc()}\n")
        sys.stderr.flush()
        sys.exit(1)

