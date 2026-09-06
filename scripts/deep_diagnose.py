"""
Deep investigation of:
1. KDA contamination - where exactly does the spurious digit come from
2. DEF crop - what does the preprocessed image look like
3. Neeel FB=1 failure - what does the preprocessed crop look like
4. Name separator line at x=90-112
"""
import cv2
import numpy as np
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

img = cv2.imread('Valorant_scoreboard.png')
h, w = img.shape[:2]

# ─── 1. KDA: scan x=490-540 for ALL rows to find the spurious digit source ───
print("=== KDA: Row scan x=480-540 for ALL 10 rows (looking for bright pixel = ECON bleed) ===")
rows_all = [
    (56,108,'HCL7','32/14/5','81'),
    (110,162,'ATMAN','23/23/6','73'),
    (164,216,'WhiteTiger','21/19/12','64'),
    (218,270,'cHiRu','20/19/6','58'),
    (272,324,'kunty','20/19/9','62'),
    (326,378,'F0rSakeN','17/17/3','56'),
    (380,432,'Neeel','14/18/15','45'),
    (434,486,'Venomnom','16/19/5','43'),
    (488,540,'Ciggy','11/19/8','55'),
    (542,594,'MTPX','10/17/8','36'),
]
for y0,y1,name,kda_t,econ_t in rows_all:
    mid_y = (y0+y1)//2
    bright = []
    for x in range(480, 545):
        r,g,b = int(img[mid_y,x,2]),int(img[mid_y,x,1]),int(img[mid_y,x,0])
        if r+g+b > 320:
            bright.append(f"x={x}({r+g+b})")
    last_kda_digit = kda_t.split('/')[-1]
    econ = econ_t
    print(f"  {name:14s} KDA_last={last_kda_digit} ECON={econ}  bright={bright}")

print()
# ─── 2. DEF: save the processed crop and check what tesseract sees ───
print("=== DEF preprocessed crops saved to debug/vision/ ===")
import os
os.makedirs('debug/vision', exist_ok=True)

def prep_stat(crop, upscale=4.0):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    gu = cv2.resize(gray, (w*upscale.__int__(), h*upscale.__int__()), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    return b

# HCL7 DEF=1: y=56-108, x=855-916
crop_def_hcl7 = img[56:108, 855:916]
crop_def_hcl7_wide = img[56:108, 840:980]  # wider, includes neighbor 
proc = prep_stat(crop_def_hcl7)
proc_wide = prep_stat(crop_def_hcl7_wide)
cv2.imwrite('debug/vision/def_hcl7_narrow_raw.png', crop_def_hcl7)
cv2.imwrite('debug/vision/def_hcl7_narrow_proc.png', proc)
cv2.imwrite('debug/vision/def_hcl7_wide_raw.png', crop_def_hcl7_wide)
cv2.imwrite('debug/vision/def_hcl7_wide_proc.png', proc_wide)

# Test various upscales
for up in [3, 4, 5, 6]:
    gray = cv2.cvtColor(crop_def_hcl7, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*up, gray.shape[0]*up), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=5.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    for psm in [6, 7, 8]:
        r = pytesseract.image_to_string(Image.fromarray(b),
            config=f'--psm {psm} -c tessedit_char_whitelist=0123456789').strip()
        if r:
            print(f"  HCL7 DEF=1: upscale={up} PSM{psm}: [{r}]")

# Try ATMAN DEF=1
for up in [4, 5, 6]:
    crop = img[110:162, 855:916]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*up, gray.shape[0]*up), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=5.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    for psm in [6, 7, 8]:
        r = pytesseract.image_to_string(Image.fromarray(b),
            config=f'--psm {psm} -c tessedit_char_whitelist=0123456789').strip()
        if r:
            print(f"  ATMAN DEF=1: upscale={up} PSM{psm}: [{r}]")

print()
print("=== Neeel FB=1 investigation ===")
# Neeel row: y=380-432, FB column x=635-743
crop_fb = img[380:432, 635:743]
cv2.imwrite('debug/vision/fb_neeel_raw.png', crop_fb)
gray = cv2.cvtColor(crop_fb, cv2.COLOR_BGR2GRAY)
print(f"Neeel FB crop: mean={gray.mean():.1f} min={gray.min()} max={gray.max()}")
# scan for bright pixels
brights = []
for y in range(crop_fb.shape[0]):
    for x in range(crop_fb.shape[1]):
        r,g,b = int(crop_fb[y,x,2]),int(crop_fb[y,x,1]),int(crop_fb[y,x,0])
        if r+g+b > 360:
            brights.append((x+635, y+380, r+g+b))
print(f"Bright pixels in Neeel FB: {brights[:10]}")

# scan across row center for FB area
mid_y = (380+432)//2
print("Neeel y=406, x=620-755 horizontal scan:")
for x in range(620, 755, 5):
    r,g,b = int(img[406,x,2]),int(img[406,x,1]),int(img[406,x,0])
    if r+g+b > 300:
        print(f"  x={x}: R={r} G={g} B={b}")

# try wider FB for neeel
for x0,x1 in [(635,743),(630,750),(625,755)]:
    crop = img[380:432, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=5.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    for psm in [6,7]:
        r = pytesseract.image_to_string(Image.fromarray(b),
            config=f'--psm {psm} -c tessedit_char_whitelist=0123456789').strip()
        if r:
            print(f"  Neeel FB=1 x={x0}-{x1} PSM{psm}: [{r}]")
if True:
    print("  Neeel FB: no PSM/range combination found a digit")

print()
print("=== Name: what's the actual separator position? ===")
# From measurements: x=90-112 has bright pixels. Let's be more precise.
# Use HCL7 row (y=56-108)
print("HCL7 row, checking x=60-130 pixel values to find icon end:")
for x in range(60, 130):
    r,g,b = int(img[80,x,2]),int(img[80,x,1]),int(img[80,x,0])
    s = r+g+b
    marker = " <-- BRIGHT" if s > 400 else ""
    if x % 3 == 0 or s > 400:
        print(f"  x={x}: R={r:3d} G={g:3d} B={b:3d} sum={s}{marker}")
