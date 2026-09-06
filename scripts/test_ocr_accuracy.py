import cv2, numpy as np
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

img = cv2.imread('Valorant_scoreboard.png')

def ocr_num(y0, y1, x0, x1, pad=6):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.copyMakeBorder(b, pad*4, pad*4, pad*4, pad*4, cv2.BORDER_CONSTANT, value=255)
    wl = '0123456789'
    r = pytesseract.image_to_string(Image.fromarray(b), config='--psm 7 -c tessedit_char_whitelist=' + wl).strip()
    return r

def ocr_kda(y0, y1):
    x0, x1 = 408, 531
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gu = cv2.resize(gray, (gray.shape[1]*4, gray.shape[0]*4), interpolation=cv2.INTER_LANCZOS4)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(2,2))
    gu = clahe.apply(gu)
    _, b = cv2.threshold(gu, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.copyMakeBorder(b, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255)
    r = pytesseract.image_to_string(Image.fromarray(b), config='--psm 7 -c tessedit_char_whitelist=0123456789/ ').strip()
    return r

rows_data = [
    (56,  108, 'HCL7',         'A', 335, '32/14/5',  81, 4, 2, 1),
    (110, 162, 'ATMAN FPS',    'B', 304, '23/23/6',  73, 6, 0, 1),
    (164, 216, 'White Tiger',  'A', 259, '21/19/12', 64, 2, 2, 0),
    (218, 270, 'cHiRu',        'A', 251, '20/19/6',  58, 5, 0, 0),
    (272, 324, 'kunty',        'B', 235, '20/19/9',  62, 3, 2, 0),
    (326, 378, 'F0rSakeN',     'B', 204, '17/17/3',  56, 2, 1, 0),
    (380, 432, 'Neeel',        'A', 186, '14/18/15', 45, 1, 3, 0),
    (434, 486, 'Venomnom',     'B', 166, '16/19/5',  43, 0, 6, 0),
    (488, 540, 'Ciggy',        'B', 152, '11/19/8',  55, 0, 1, 1),
    (542, 594, 'MTPX Kinesis', 'A', 129, '10/17/8',  36, 1, 2, 0),
]

FIELD_COLS = {
    'acs':  (271, 408),
    'kda':  (408, 531),
    'econ': (531, 635),
    'fb':   (635, 743),
    'plt':  (743, 851),
    'def':  (855, 978),
}

print('OCR Accuracy Test (PSM7 + white padding border)')
print('-' * 75)
header = 'Player         Team  ACS    KDA          ECON   FB     PLT    DEF'
print(header)
print('-' * 75)

field_totals = {k: [0, 0] for k in FIELD_COLS}  # [correct, total]

for row in rows_data:
    y0, y1, name, team, t_acs, t_kda, t_econ, t_fb, t_plt, t_def = row
    truths = {
        'acs': str(t_acs), 'kda': t_kda, 'econ': str(t_econ),
        'fb': str(t_fb), 'plt': str(t_plt), 'def': str(t_def)
    }
    results = {}
    for k, (x0, x1) in FIELD_COLS.items():
        if k == 'kda':
            r = ocr_kda(y0, y1)
            # normalize kda: remove spaces
            import re
            m = re.search(r'(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', r)
            results[k] = f'{m.group(1)}/{m.group(2)}/{m.group(3)}' if m else r
        else:
            results[k] = ocr_num(y0, y1, x0, x1)

    cells = []
    for k in ['acs', 'kda', 'econ', 'fb', 'plt', 'def']:
        got = results[k]
        exp = truths[k]
        ok = (got == exp)
        field_totals[k][0] += int(ok)
        field_totals[k][1] += 1
        mark = 'OK' if ok else f'{got}!={exp}'
        cells.append(f'{mark:12s}')
    line = f'{name:14s} {team}     ' + ''.join(cells)
    print(line)

print('-' * 75)
print('Totals:')
for k in ['acs', 'kda', 'econ', 'fb', 'plt', 'def']:
    c, t = field_totals[k]
    print(f'  {k:6s}: {c}/{t}  ({100*c//t}%)')
