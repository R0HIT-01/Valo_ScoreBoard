"""
Precise measurement of DEF digit position and name start position.
"""
import cv2
import numpy as np
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

img = cv2.imread('Valorant_scoreboard.png')
h, w = img.shape[:2]

print("=== DEF digit precise position scan ===")
# The separator lines are at x=917. The DEF digit should be centered between
# the PLT right separator (~851) and the DEF right separator (~917)
# That gives center ~= 884. Let's scan the full DEF area carefully.

rows_def = [
    (56,108,'HCL7',1), (110,162,'ATMAN',1), (164,216,'WhiteTiger',0),
    (218,270,'cHiRu',0), (272,324,'kunty',0), (326,378,'F0rSakeN',0),
    (380,432,'Neeel',0), (434,486,'Venomnom',0), (488,540,'Ciggy',1),
    (542,594,'MTPX',0),
]
print(f"{'Name':14s}  {'truth':5s}  bright_pixels_in_DEF_area(x=855-916)")
for y0,y1,name,truth in rows_def:
    brights = []
    for y in range(y0+8, y1-8):
        for x in range(855, 916):
            r,g,b = int(img[y,x,2]),int(img[y,x,1]),int(img[y,x,0])
            if r+g+b > 380:
                brights.append(x)
    unique_x = sorted(set(brights))
    print(f"  {name:14s}  truth={truth}  bright_x={unique_x[:15]}")

print()
print("=== Full DEF area crops + OCR test ===")
def ocr_def(y0, y1, x0, x1, label, psm):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    r = pytesseract.image_to_string(Image.fromarray(b),
        config='--psm '+str(psm)+' -c tessedit_char_whitelist=0123456789').strip()
    return r

print(f"{'Name':14s}  {'truth':5s}  psm6(855-916)  psm7(855-916)  psm6(840-916)  psm7(840-916)")
for y0,y1,name,truth in rows_def:
    r1 = ocr_def(y0,y1, 855,916, name, 6)
    r2 = ocr_def(y0,y1, 855,916, name, 7)
    r3 = ocr_def(y0,y1, 840,916, name, 6)
    r4 = ocr_def(y0,y1, 840,916, name, 7)
    print(f"  {name:14s}  truth={truth}  [{r1}]  [{r2}]  [{r3}]  [{r4}]")

print()
print("=== NAME crop: find clean text start (exclude icon + separator) ===")
# From scan: x=90-112 has separator pixels (R=235+)
# Real name text starts after x=112
# Let's test name crops with different left boundaries
from PIL import Image
import re

def ocr_name_crop(y0, y1, x0, x1, psm=6):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4,4))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    b = cv2.medianBlur(b, 3)
    r = pytesseract.image_to_string(Image.fromarray(b), config='--psm '+str(psm)).strip()
    lines = [l.strip() for l in r.splitlines() if l.strip()]
    return lines[0] if lines else '', lines[1] if len(lines)>1 else '', r

rows_names = [
    (56,108,'HCL7','REYNA'),
    (110,162,'ATMAN FPS','RAZE'),
    (164,216,'White Tiger','SKYE'),
    (218,270,'cHiRu','RAZE'),
    (272,324,'kunty','OMEN'),
    (326,378,'F0rSakeN','VETO'),
    (380,432,'Neeel','BRIMSTONE'),
    (434,486,'Venomnom','SAGE'),
    (488,540,'Ciggy','FADE'),
    (542,594,'MTPX Kinesis','BREACH'),
]
print("Name crop comparison (x start boundaries):")
print(f"{'Name':14s}  {'x62':20s}  {'x112':20s}  {'x115':20s}")
for y0,y1,name,agent in rows_names:
    n62,a62,_ = ocr_name_crop(y0,y1, 62, 266)
    n112,a112,_ = ocr_name_crop(y0,y1, 112, 266)
    n115,a115,_ = ocr_name_crop(y0,y1, 115, 266)
    print(f"  {name:14s}  [{n62:18s}]  [{n112:18s}]  [{n115:18s}]")

print()
print("=== FB crop investigation ===")
rows_fb = [
    (56,108,'HCL7',4), (110,162,'ATMAN',6), (164,216,'WhiteTiger',2),
    (218,270,'cHiRu',5), (272,324,'kunty',3), (326,378,'F0rSakeN',2),
    (380,432,'Neeel',1), (434,486,'Venomnom',0), (488,540,'Ciggy',0),
    (542,594,'MTPX',1),
]
def ocr_fb(y0, y1, x0, x1, psm):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    r = pytesseract.image_to_string(Image.fromarray(b),
        config='--psm '+str(psm)+' -c tessedit_char_whitelist=0123456789').strip()
    return r

print(f"{'Name':14s}  truth  psm7(635-743)  psm6(635-743)  psm7(640-738)")
for y0,y1,name,truth in rows_fb:
    r1 = ocr_fb(y0,y1, 635,743, 7)
    r2 = ocr_fb(y0,y1, 635,743, 6)
    r3 = ocr_fb(y0,y1, 640,738, 7)
    print(f"  {name:14s}  {truth}      [{r1:5s}]  [{r2:5s}]  [{r3:5s}]")

print()
print("=== KDA boundary test: right boundary at 520 vs 525 vs 531 ===")
rows_kda = [
    (56,108,'HCL7','32/14/5'),
    (110,162,'ATMAN','23/23/6'),
    (326,378,'F0rSakeN','17/17/3'),
    (434,486,'Venomnom','16/19/5'),
    (488,540,'Ciggy','11/19/8'),
]
def ocr_kda(y0, y1, x0, x1, psm=7):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    r = pytesseract.image_to_string(Image.fromarray(b),
        config='--psm '+str(psm)+' -c tessedit_char_whitelist=0123456789/ ').strip()
    return r

print(f"{'Name':14s}  truth      rb=531   rb=525   rb=515   rb=505")
for y0,y1,name,truth in rows_kda:
    r1 = ocr_kda(y0,y1, 408,531)
    r2 = ocr_kda(y0,y1, 408,525)
    r3 = ocr_kda(y0,y1, 408,515)
    r4 = ocr_kda(y0,y1, 408,505)
    print(f"  {name:14s}  {truth:10s}  [{r1:12s}]  [{r2:12s}]  [{r3:12s}]  [{r4:12s}]")
