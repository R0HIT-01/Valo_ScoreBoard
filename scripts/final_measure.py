"""
Final measurements to confirm:
1. Name crop: x=62 is correct (text starts at x=74 which is inside 62-270)
   - What causes -WhiteTiger, cHiRuof4 etc? It's that the icon portrait OVERLAPS the name zone.
   - The portrait occupies roughly x=0-62 but it leaks color into x=62-80 area.
   - For rows where the portrait is darker, the contrast threshold inverts oddly.
2. Correct ECON boundary: it was originally 531-635. The new 574-635 cut 8 too far.
   - ECON='81' was read as '31' (cropped the '8'). Need ~x=560 to capture full digit.
3. KDA contamination: where exactly does the spurious digit come from?
"""
import cv2, numpy as np
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

img = cv2.imread('Valorant_scoreboard.png')
h, w = img.shape[:2]

# ─── 1. Name: test crop at x=62 vs clean post-process ───
print("=== NAME: test x=62 crop with cleanup vs x=70 ===")

def ocr_name_full(y0, y1, x0=62, x1=266, psm=6):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4,4))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    raw = pytesseract.image_to_string(Image.fromarray(b), config=f'--psm {psm}').strip()
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    name = lines[0] if lines else ''
    agent = lines[1] if len(lines)>1 else ''
    return name, agent, raw

rows = [
    (56,108,'HCL7','REYNA'),
    (110,162,'ATMAN FPS','RAZE'),
    (164,216,'White Tiger','SKYE'),
    (218,270,'cHiRu','RAZE'),
    (272,324,'kunty','OMEN'),
    (326,378,'F0rSakeN','JETT/VETO'),
    (380,432,'Neeel','BRIMSTONE'),
    (434,486,'Venomnom','SAGE'),
    (488,540,'Ciggy','FADE'),
    (542,594,'MTPX Kinesis','BREACH'),
]
print(f"{'Name':14s}  {'x=62':22s}  {'x=70':22s}")
for y0,y1,truth_name,truth_agent in rows:
    n62, a62, _ = ocr_name_full(y0,y1,62,266)
    n70, a70, _ = ocr_name_full(y0,y1,70,266)
    print(f"  {truth_name:14s}  [{n62:20s}]  [{n70:20s}]")

print()

# ─── 2. ECON: test different left boundaries ───
print("=== ECON left boundary test ===")
econ_rows = [
    (56,108,'HCL7','81'),
    (110,162,'ATMAN','73'),
    (164,216,'WhiteTiger','64'),
    (218,270,'cHiRu','58'),
    (272,324,'kunty','62'),
    (326,378,'F0rSakeN','56'),
    (380,432,'Neeel','45'),
    (434,486,'Venomnom','43'),
    (488,540,'Ciggy','55'),
    (542,594,'MTPX','36'),
]

def ocr_econ(y0, y1, x0, x1):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    r = pytesseract.image_to_string(Image.fromarray(b),
        config='--psm 7 -c tessedit_char_whitelist=0123456789').strip()
    return r

print(f"{'Name':14s}  truth  x=531  x=545  x=555  x=560  x=565  x=570")
for y0,y1,name,truth in econ_rows:
    r531 = ocr_econ(y0,y1, 531,635)
    r545 = ocr_econ(y0,y1, 545,635)
    r555 = ocr_econ(y0,y1, 555,635)
    r560 = ocr_econ(y0,y1, 560,635)
    r565 = ocr_econ(y0,y1, 565,635)
    r570 = ocr_econ(y0,y1, 570,635)
    print(f"  {name:14s}  {truth:3s}    [{r531}]  [{r545}]  [{r555}]  [{r560}]  [{r565}]  [{r570}]")

print()
# ─── 3. KDA: test all 10 rows with rb=504 ───
print("=== KDA rb=504 test for ALL 10 rows ===")
kda_rows = [
    (56,108,'HCL7','32/14/5'),
    (110,162,'ATMAN','23/23/6'),
    (164,216,'WhiteTiger','21/19/12'),
    (218,270,'cHiRu','20/19/6'),
    (272,324,'kunty','20/19/9'),
    (326,378,'F0rSakeN','17/17/3'),
    (380,432,'Neeel','14/18/15'),
    (434,486,'Venomnom','16/19/5'),
    (488,540,'Ciggy','11/19/8'),
    (542,594,'MTPX','10/17/8'),
]
def ocr_kda(y0,y1,x0,x1):
    import re
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    r = pytesseract.image_to_string(Image.fromarray(b),
        config='--psm 7 -c tessedit_char_whitelist=0123456789/ ').strip()
    return r

print(f"{'Name':14s}  truth       rb=531      rb=510      rb=504      rb=498")
for y0,y1,name,truth in kda_rows:
    r531 = ocr_kda(y0,y1, 408,531)
    r510 = ocr_kda(y0,y1, 408,510)
    r504 = ocr_kda(y0,y1, 408,504)
    r498 = ocr_kda(y0,y1, 408,498)
    print(f"  {name:14s}  {truth:10s}  [{r531:12s}]  [{r510:12s}]  [{r504:12s}]  [{r498:12s}]")
