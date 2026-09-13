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
CROPPED_COLUMN_DEFS = {
    "name":        (0.071,  0.270),   # 70px  – 266px
    "agent":       (0.071,  0.270),   # same crop region, agent = 2nd OCR line
    "acs":         (0.275,  0.415),   # 271px – 408px
    "kda":         (0.415,  0.540),   # 408px – 531px  (trailing digit cleaned in parser)
    "econ":        (0.575,  0.645),   # 565px – 635px
    "firstBloods": (0.645,  0.755),   # 635px – 743px
    "plants":      (0.755,  0.865),   # 743px – 851px
    "defuses":     (0.869,  0.994),   # 855px – 978px
}

FULL_COLUMN_DEFS = {
    "name":        (0.138,  0.280),
    "agent":       (0.138,  0.280),
    "acs":         (0.280,  0.400),
    "kda":         (0.390,  0.520),
    "econ":        (0.520,  0.600),
    "firstBloods": (0.600,  0.680),
    "plants":      (0.680,  0.760),
    "defuses":     (0.760,  0.860),
}

COLUMN_DEFS = CROPPED_COLUMN_DEFS

# Expected row periodicity (normalized)
# From measurements: each row is ~52px tall in a 607px image
EXPECTED_ROW_HEIGHT_RATIO = 52.0 / 607.0   # ≈ 0.0857

# ──────────────────────────────────────────────
# HSV COLOR RANGES for team detection and row segmentation
# OpenCV HSV: H=0-180, S=0-255, V=0-255
#
# Team A (dark red/maroon): H near 0 (0-16) or high wrap (125-180)
# Team B (teal/cyan):       H=70-110
# Highlighted MVP / Party:  H=17-69 (Gold / Yellow / Amber / Olive)
# ──────────────────────────────────────────────
RED_HSV = [
    ((0,   20,  25),  (16,  255, 180)),
    ((125, 20,  25),  (180, 255, 180)),
]
TEAL_HSV = [
    ((70,  20,  25),  (110, 255, 180)),
]
GOLD_HSV = [
    ((17,  20,  25),  (69,  255, 180)),
]

def get_pixel_color_type(h_val, s_val, v_val):
    """Classify pixel into RED, TEAL, GOLD, or None."""
    for (lo, hi) in RED_HSV:
        if lo[0] <= h_val <= hi[0] and lo[1] <= s_val <= hi[1] and lo[2] <= v_val <= hi[2]:
            return 'RED'
    for (lo, hi) in TEAL_HSV:
        if lo[0] <= h_val <= hi[0] and lo[1] <= s_val <= hi[1] and lo[2] <= v_val <= hi[2]:
            return 'TEAL'
    for (lo, hi) in GOLD_HSV:
        if lo[0] <= h_val <= hi[0] and lo[1] <= s_val <= hi[1] and lo[2] <= v_val <= hi[2]:
            return 'GOLD'
    return None

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
# Strategy:
# 1. Detect all 10 player rows across RED, TEAL, and GOLD/MVP row types.
# 2. Normalize sampling X coordinates to width (handles any resolution).
# 3. Classify rows into Team A (RED) vs Team B (TEAL) with structural
#    team-side resolution for highlighted/gold rows.
# ──────────────────────────────────────────────
def detect_rows(img, debug_dir=None):
    """
    Detect all 10 player rows and assign them to Team A (RED) and Team B (TEAL).
    Handles special highlighted MVP / gold rank rows reliably.
    """
    h, w = img.shape[:2]
    img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # 1. Search start: skip top tabs in full 16:9 screenshots
    search_y_start = 200 if h >= 700 else 45

    # Normalized sample X positions across left colored strip
    sample_xs = [int(w * frac) for frac in np.linspace(0.08, 0.24, 17)]
    n_samples = len(sample_xs)

    y_is_player_row = np.zeros(h, dtype=bool)

    for y in range(search_y_start, h):
        votes = {'RED': 0, 'TEAL': 0, 'GOLD': 0}
        for x in sample_xs:
            hsv = img_hsv[y, x]
            c = get_pixel_color_type(int(hsv[0]), int(hsv[1]), int(hsv[2]))
            if c:
                votes[c] += 1
        total = sum(votes.values())
        if total >= 2:
            y_is_player_row[y] = True

    # 2. Find contiguous Y bands
    MIN_ROW_H = 20
    if h <= 650:
        EXPECTED_ROW_H = 54.0 * (h / 607.0)
    elif h <= 850:
        EXPECTED_ROW_H = 53.5
    elif h <= 950:
        EXPECTED_ROW_H = 54.5
    else:
        EXPECTED_ROW_H = h * (64.5 / 1080.0)

    bands = []
    in_b = False
    b_start = 0
    for y in range(search_y_start, h):
        if y_is_player_row[y] and not in_b:
            in_b = True
            b_start = y
        elif not y_is_player_row[y] and in_b:
            in_b = False
            bh = y - b_start
            if bh >= MIN_ROW_H:
                bands.append({'y': b_start, 'height': bh})
    if in_b:
        bh = h - b_start
        if bh >= MIN_ROW_H:
            bands.append({'y': b_start, 'height': bh})

    # 3. Subdivide merged blocks into individual rows using expected row height
    split_rows = []
    for b in bands:
        bh = b['height']
        if bh > 75:
            n_sub = int(round(bh / EXPECTED_ROW_H))
            if n_sub < 2:
                n_sub = 2
            for i in range(n_sub):
                y0 = int(round(b['y'] + i * EXPECTED_ROW_H))
                y1 = int(round(b['y'] + (i + 1) * EXPECTED_ROW_H))
                if y0 < h:
                    split_rows.append({'y': y0, 'height': min(y1 - y0, h - y0)})
        else:
            split_rows.append(b)

    split_rows.sort(key=lambda b: b['y'])

    # Keep exactly the 10 scoreboard rows
    if len(split_rows) > 10:
        split_rows = split_rows[:10]

    # 4. Classify each row's team color
    raw_rows = []
    for i, r in enumerate(split_rows):
        y0 = r['y']
        y1 = min(h, y0 + r['height'])
        crop_hsv = img_hsv[y0:y1, int(w*0.07):int(w*0.25)]

        c_votes = {'RED': 0, 'TEAL': 0, 'GOLD': 0}
        for yr in range(crop_hsv.shape[0]):
            for xr in range(crop_hsv.shape[1]):
                c = get_pixel_color_type(int(crop_hsv[yr, xr, 0]), int(crop_hsv[yr, xr, 1]), int(crop_hsv[yr, xr, 2]))
                if c:
                    c_votes[c] += 1

        if c_votes['RED'] > c_votes['TEAL'] and c_votes['RED'] > c_votes['GOLD']:
            dominant = 'RED'
        elif c_votes['TEAL'] > c_votes['RED'] and c_votes['TEAL'] > c_votes['GOLD']:
            dominant = 'TEAL'
        elif c_votes['GOLD'] > 0:
            dominant = 'GOLD'
        else:
            dominant = 'UNKNOWN'

        raw_rows.append({
            'row_index': i,
            'x': 0,
            'y': y0,
            'width': w,
            'height': r['height'],
            'dominant': dominant,
            'confidence': 0.95,
        })

    # 5. Team Assignment:
    # Stage 1: Deterministic classification of clear RED and TEAL rows
    for r in raw_rows:
        if r['dominant'] == 'RED':
            r['team'] = 'A'
        elif r['dominant'] == 'TEAL':
            r['team'] = 'B'
        else:
            r['team'] = 'UNKNOWN'

    red_count = sum(1 for r in raw_rows if r['team'] == 'A')
    teal_count = sum(1 for r in raw_rows if r['team'] == 'B')

    # Stage 2: Resolve YELLOW/GOLD highlighted or ambiguous rows using 5-player balancing rule
    # Only assign when one team has reached 5 players and the other has fewer than 5.
    for r in raw_rows:
        if r['team'] == 'UNKNOWN' and r['dominant'] in ('GOLD', 'UNKNOWN'):
            if red_count >= 5 and teal_count < 5:
                r['team'] = 'B'
                teal_count += 1
            elif teal_count >= 5 and red_count < 5:
                r['team'] = 'A'
                red_count += 1
            # If both teams already have >= 5 or both have < 5, leave as UNKNOWN

    team_a = [r for r in raw_rows if r['team'] == 'A']
    team_b = [r for r in raw_rows if r['team'] == 'B']
    eprint(f"[ROWS] Total rows: {len(raw_rows)} | Team A (RED): {len(team_a)} | Team B (TEAL): {len(team_b)}")

    if debug_dir:
        annotated = img.copy()
        for r in raw_rows:
            color = (50, 50, 220) if r['team'] == 'A' else (200, 180, 0)
            label = f"{r['team']}{team_a.index(r)+1 if r['team']=='A' else team_b.index(r)+1} y={r['y']}"
            cv2.rectangle(annotated,
                          (r['x'], r['y']),
                          (r['x'] + r['width'], r['y'] + r['height']),
                          color, 2)
            cv2.putText(annotated, label, (5, r['y'] + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        save_debug(annotated, 'annotated/scoreboard_v2.png', debug_dir)

    return raw_rows

# ──────────────────────────────────────────────
# STAGE 3 — CROP COLUMN FROM ROW
# ──────────────────────────────────────────────
def crop_column(row_crop, col_key):
    """Extract a column slice using normalized COLUMN_DEFS."""
    w = row_crop.shape[1]
    col_defs = CROPPED_COLUMN_DEFS if w < 1200 else FULL_COLUMN_DEFS
    x0 = int(w * col_defs[col_key][0])
    x1 = int(w * col_defs[col_key][1])
    return row_crop[:, x0:x1]

# ──────────────────────────────────────────────
# STAGE 4 — PREPROCESSING FOR OCR
# ──────────────────────────────────────────────
def preprocess_dark_bg(region, upscale=3.5):
    """
    For: name, agent — light text on colored (red/teal/gold) background.
    Invert so text becomes dark on white for Tesseract.
    """
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    gray = cv2.resize(gray, (int(w * upscale), int(h * upscale)),
                      interpolation=cv2.INTER_LANCZOS4)
    _, binary = cv2.threshold(gray, 130, 255, cv2.THRESH_BINARY_INV)
    binary = cv2.medianBlur(binary, 3)
    return binary

def preprocess_dark_stat(region, dominant='DARK', upscale=4.0):
    """
    For: ACS, ECON, FB, PLT, DEF — light text on dark gray/red/teal background,
    or dark text on light gold background.
    """
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    if h < 5 or w < 5:
        return gray
    gray = cv2.resize(gray, (int(w * upscale), int(h * upscale)),
                      interpolation=cv2.INTER_LANCZOS4)
    if dominant == 'GOLD':
        _, binary = cv2.threshold(gray, 130, 255, cv2.THRESH_BINARY_INV)
        binary = cv2.medianBlur(binary, 3)
    else:
        # Standard RED and TEAL rows: bright white text (values 180-240) on dark background (30-100)
        _, binary = cv2.threshold(gray, 130, 255, cv2.THRESH_BINARY)
    return binary

def preprocess_kda(region, dominant='DARK', upscale=3.0):
    """KDA uses upscale 3.0 to keep slash separator sharp without digit distortion."""
    return preprocess_dark_stat(region, dominant, upscale)

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
    # Trim top 8% of row height to ignore row divider line artifact from preceding row
    rh = row_crop.shape[0]
    row_trimmed = row_crop[int(rh * 0.08):, :]
    col = crop_column(row_trimmed, "name")
    proc = preprocess_dark_bg(col)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_name_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_name_proc.png", debug_dir)
    # PSM 6 = assume uniform block of text → reads multiple lines (name + agent label)
    raw = run_tess(proc, psm=6)
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    name  = lines[0] if len(lines) >= 1 else ""
    agent = lines[1] if len(lines) >= 2 else ""
    # Agent label is ALL-CAPS letters only (e.g. REYNA, SKYE, BRIMSTONE)
    agent = re.sub(r"[^A-Z]", "", agent.upper()) if agent else ""
    return name.strip(), agent, raw

def ocr_number(row_crop, col_key, dominant='DARK', debug_dir=None, label=""):
    """OCR for ACS, ECON, PLT — moderate-width numeric columns."""
    col = crop_column(row_crop, col_key)
    proc = preprocess_dark_stat(col, dominant)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_{col_key}_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_{col_key}_proc.png", debug_dir)
    # PSM 7 confirmed empirically better than PSM 8 for these crop widths.
    # Fall back to PSM 6 if PSM 7 yields an empty result.
    raw = run_tess(proc, psm=7, whitelist=NUM_WHITELIST)
    if not raw.strip():
        raw_fallback = run_tess(proc, psm=6, whitelist=NUM_WHITELIST)
        if raw_fallback.strip():
            raw = raw_fallback
    return raw.strip()

def ocr_fb(row_crop, dominant='DARK', debug_dir=None, label=""):
    """OCR for First Bloods — single digit, sometimes low contrast.
    PSM 6 (uniform block) outperforms PSM 7 for very small/sparse digit cells.
    """
    col = crop_column(row_crop, "firstBloods")
    proc = preprocess_dark_stat(col, dominant)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_firstBloods_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_firstBloods_proc.png", debug_dir)
    raw = run_tess(proc, psm=6, whitelist=NUM_WHITELIST)
    if not raw.strip():
        raw_fallback = run_tess(proc, psm=7, whitelist=NUM_WHITELIST)
        if raw_fallback.strip():
            raw = raw_fallback
    return raw.strip()

def ocr_defuses(row_crop, debug_dir=None, label=""):
    """OCR for Defuses — rightmost column, single digit.
    Digit '1' is thin (~3px wide). Uses 5x resize with LANCZOS4,
    BINARY_INV thresholding (105) + white border padding with PSM 10,
    which reliably captures thin strokes without CLAHE distortion.
    """
    col = crop_column(row_crop, "defuses")
    gray = cv2.cvtColor(col, cv2.COLOR_BGR2GRAY)
    gh, gw = gray.shape
    if gh < 3 or gw < 3:
        return ""
    gray_up = cv2.resize(gray, (gw * 5, gh * 5), interpolation=cv2.INTER_LANCZOS4)

    # Inverted binary threshold with white border padding
    _, binary_inv = cv2.threshold(gray_up, 105, 255, cv2.THRESH_BINARY_INV)
    padded = cv2.copyMakeBorder(binary_inv, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=255)

    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_defuses_raw.png", debug_dir)
        save_debug(padded, f"row_crops/{label}_defuses_proc.png", debug_dir)

    raw = run_tess(padded, psm=10, whitelist=NUM_WHITELIST)
    result = raw.strip()

    # Fallback to PSM 6 if PSM 10 produced no digits
    if not result or not re.sub(r"[^\d]", "", result):
        raw_fallback = run_tess(padded, psm=6, whitelist=NUM_WHITELIST)
        result_fallback = raw_fallback.strip()
        if result_fallback and re.sub(r"[^\d]", "", result_fallback):
            result = result_fallback

    return result

def ocr_kda(row_crop, dominant='DARK', debug_dir=None, label=""):
    col = crop_column(row_crop, "kda")
    proc = preprocess_kda(col, dominant)
    if debug_dir and label:
        save_debug(col, f"row_crops/{label}_kda_raw.png", debug_dir)
        save_debug(proc, f"row_crops/{label}_kda_proc.png", debug_dir)
    # PSM 7 = single text line; KDA whitelist avoids non-numeric/slash noise
    raw = run_tess(proc, psm=7, whitelist=KDA_WHITELIST)
    if not raw or "/" not in raw:
        raw_fallback = run_tess(proc, psm=6, whitelist=KDA_WHITELIST)
        if raw_fallback and "/" in raw_fallback:
            raw = raw_fallback
    return raw.strip()

# ──────────────────────────────────────────────
# STAGE 6 — PARSE & NORMALIZE
# ──────────────────────────────────────────────
def parse_int(raw, field):
    clean = re.sub(r"[^\d]", "", raw)
    if clean:
        if field == "acs" and len(clean) == 4 and clean[0] == '7':
            clean = clean[1:]
        return int(clean), None
    return 0, f"{field}: unreadable raw='{raw}'"

def parse_kda(raw):
    import re as _re
    clean = _re.sub(r"\s+", " ", raw.strip())

    # 1. Primary standard K/D/A pattern (e.g. "20/19/6" or "17/17/73")
    m = _re.search(r"(\d+)\s*/\s*(\d+)\s*/\s*(\d+)", clean)
    if m:
        k, d, a = m.group(1), m.group(2), m.group(3)
        # Artifact: the column separator line is consistently read as '7' or '6' by Tesseract
        # when it immediately precedes the final assist digit (e.g. '74'->'4', '64'->'4').
        # Signature: last component is exactly 2 digits, starts with '6' or '7', and is > 30.
        # Legitimate 2-digit assists (e.g. 11, 12, 14) start with '1' or '2'.
        if len(a) == 2 and a[0] in ('6', '7') and int(a) > 30:
            a_stripped = a[1:]
            return f"{k}/{d}/{a_stripped}", f"kda: stripped leading separator-glyph '{a[0]}' from '{raw}'"
        return f"{k}/{d}/{a}", None

    # 2. Secondary recovery pattern: second slash misread as '7' or '1'
    # e.g. '17/916' (tail='916', 3 digits), '17/2179' (tail='2179', 4 digits), '9/9711' (tail='9711', 4 digits)
    m_single_slash = _re.search(r"^(\d+)\s*/\s*(\d{3,4})$", clean)
    if m_single_slash:
        k, tail = m_single_slash.group(1), m_single_slash.group(2)
        if len(tail) == 3:
            # 3 digits e.g. '916' -> d=9, a=6 (middle digit was misread slash)
            d, a = tail[0], tail[2]
            return f"{k}/{d}/{a}", f"kda: recovered missing slash from '{raw}'"
        elif len(tail) == 4:
            # 4 digits: either (2-digit d, '7' separator, 1-digit a) or (1-digit d, '7' separator, 2-digit a)
            d1, a1 = int(tail[:2]), int(tail[3])
            d2, a2 = int(tail[0]), int(tail[2:])
            if d1 <= 40 and (tail[2] in ('6', '7') or a1 <= 30) and int(tail[:2]) < 90:
                if tail[0:2] != '97':
                    return f"{k}/{tail[:2]}/{tail[3]}", f"kda: recovered missing slash from '{raw}'"
            if d2 <= 40 and a2 <= 40:
                return f"{k}/{tail[0]}/{tail[2:]}", f"kda: recovered missing slash from '{raw}'"

    return "", f"kda: unreadable raw='{raw}'"

def extract_match_round_score(img, debug_dir=None):
    """
    Extract match round score (e.g. 13 VICTORY 6 -> Team A: 6, Team B: 13).
    Preserves side identity:
    - Team A (RED): corresponds to the RED score (right banner / RED hue).
    - Team B (TEAL): corresponds to the TEAL score (left banner / TEAL hue).
    """
    h, w = img.shape[:2]
    # Header region in full Valorant screenshots is in top ~15%
    top_crop = img[0:min(120, int(h * 0.15)), :]
    gray = cv2.cvtColor(top_crop, cv2.COLOR_BGR2GRAY)
    top_hsv = cv2.cvtColor(top_crop, cv2.COLOR_BGR2HSV)

    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, bin_70 = cv2.threshold(gray, 70, 255, cv2.THRESH_BINARY)
    _, bin_100 = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY)

    candidates = [gray, otsu, bin_70, bin_100]

    for candidate in candidates:
        for psm in [6, 11, 3]:
            try:
                # 1. First attempt: image_to_data for discrete digit bounding boxes & color sampling
                data = pytesseract.image_to_data(candidate, output_type=pytesseract.Output.DICT, config=f"--psm {psm}")
                num_entries = []
                for i in range(len(data['text'])):
                    word = data['text'][i].strip()
                    m = re.match(r"^(\d{1,2})$", word)
                    if m:
                        val = int(m.group(1))
                        if 0 <= val <= 30:
                            x, y, bw, bh = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                            # Sample color
                            box_hsv = top_hsv[y:y+bh, x:x+bw]
                            mask_colored = (box_hsv[:, :, 1] > 25) & (box_hsv[:, :, 2] > 60)
                            hues = box_hsv[:, :, 0][mask_colored] if np.any(mask_colored) else []
                            med_h = np.median(hues) if len(hues) > 0 else None

                            color_vote = None
                            if med_h is not None:
                                if med_h <= 15 or med_h >= 150:
                                    color_vote = "RED"
                                elif 60 <= med_h <= 115:
                                    color_vote = "TEAL"

                            num_entries.append({
                                "val": val,
                                "x": x,
                                "rel_x": x / w,
                                "color": color_vote,
                            })

                if len(num_entries) >= 2:
                    num_entries.sort(key=lambda item: item['x'])
                    left_entry = num_entries[0]
                    right_entry = num_entries[-1]
                    s_left = left_entry['val']
                    s_right = right_entry['val']

                    if (s_left >= 13 or s_right >= 13) and s_left != s_right:
                        if left_entry['color'] == 'RED' and right_entry['color'] == 'TEAL':
                            score_a = s_left
                            score_b = s_right
                        elif left_entry['color'] == 'TEAL' and right_entry['color'] == 'RED':
                            score_a = s_right
                            score_b = s_left
                        else:
                            # Standard Valorant layout: Left = Friendly/TEAL (Team B), Right = Enemy/RED (Team A)
                            score_a = s_right
                            score_b = s_left

                        return {
                            "teamAScore": score_a,
                            "teamBScore": score_b,
                            "winnerScore": max(score_a, score_b),
                            "loserScore": min(score_a, score_b),
                        }

                # 2. Fallback: line regex parsing
                text = pytesseract.image_to_string(candidate, config=f"--psm {psm}").strip()
                m = re.search(r"(\d{1,2})\s*(?:VICTORY|DEFEAT|[A-Z\s]+)?\s*(\d{1,2})", text, re.IGNORECASE)
                if m:
                    s_first, s_second = int(m.group(1)), int(m.group(2))
                    if (s_first >= 13 or s_second >= 13) and 0 <= s_first <= 30 and 0 <= s_second <= 30 and s_first != s_second:
                        score_a = s_second  # Right score = Enemy / RED side = Team A
                        score_b = s_first   # Left score = Friendly / TEAL side = Team B
                        return {
                            "teamAScore": score_a,
                            "teamBScore": score_b,
                            "winnerScore": max(score_a, score_b),
                            "loserScore": min(score_a, score_b),
                            "raw": text.split("\n")[0],
                        }
            except Exception:
                continue
    return None

def normalize_name(raw):
    # Strip non-ASCII or unprintable artifacts
    s = re.sub(r"[^\x20-\x7E]+", "", raw.strip())
    # Fix OCR glyph confusion where single-stroke capital 'I' at word start is read as '|', '!', or '1' before a word
    # e.g. '| Am' -> 'I Am', '1 Am' -> 'I Am', '1Am' -> 'I Am'
    s = re.sub(r"^[\|!]\s*", "I ", s)
    s = re.sub(r"^1\s+(?=[A-Za-z])", "I ", s)
    s = re.sub(r"^1(?=[A-Z][a-z])", "I ", s)
    # Strip leading/trailing punctuation artifacts (dots, commas, pluses, tildes, hyphens, slashes)
    s = re.sub(r"^[\s\.\,\+\~\-\\\/]+", "", s)
    s = re.sub(r"[\s\.\,\+\~\-\\\/]+$", "", s)
    # Collapse multiple spaces
    s = re.sub(r"\s+", " ", s).strip()
    return s

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

    dominant = row.get('dominant', 'DARK')
    name, agent, raw_name_full = ocr_name_agent(row_crop, debug_dir, row_label)
    name = normalize_name(name)

    raw_acs  = ocr_number(row_crop, "acs",    dominant, debug_dir, row_label)
    raw_econ = ocr_number(row_crop, "econ",   dominant, debug_dir, row_label)
    raw_fb   = ocr_fb(row_crop,               dominant, debug_dir, row_label)  # PSM 6, wider
    raw_plt  = ocr_number(row_crop, "plants", dominant, debug_dir, row_label)
    raw_def  = ocr_defuses(row_crop,          debug_dir, row_label)  # upscale=5, PSM 6
    raw_kda  = ocr_kda(row_crop,              dominant, debug_dir, row_label)

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

    # ── Match round score detection (from top banner if present) ──
    round_score = extract_match_round_score(img, debug_dir)
    if round_score:
        eprint(f"[SCORE] Match round score detected: {round_score['teamAScore']}-{round_score['teamBScore']} (Winner: {round_score['winnerScore']})")

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
        "roundScore": {
            "teamA": round_score["teamAScore"],
            "teamB": round_score["teamBScore"],
            "winnerScore": round_score["winnerScore"],
            "loserScore": round_score["loserScore"],
        } if round_score else None,
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

