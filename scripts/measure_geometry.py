import cv2
import numpy as np

img = cv2.imread('Valorant_scoreboard.png')
h, w = img.shape[:2]
print(f'Image: {w}x{h}')

# ─── VERTICAL SCAN: find exact row Y boundaries ───
# Scan at x=400 (numeric area) and x=200 (name area)
# Both should show color pattern changes between rows
print('\n=== VERTICAL SCAN at x=400 (ACS column) ===')
prev_team = None
for y in range(40, h, 1):
    b,g,r = map(int, img[y, 400])
    # classify pixel
    is_red  = r > 80 and r > g*1.4 and r > b*1.3
    is_teal = b > 80 and g > 80 and r < 80
    is_dark = (r+g+b) < 120
    team = 'A' if is_red else ('B' if is_teal else ('dark' if is_dark else 'gray'))
    if team != prev_team:
        print(f'  y={y:3d}: {team:6s}  R={r:3d} G={g:3d} B={b:3d}')
        prev_team = team

# ─── HORIZONTAL SCAN: find exact column X boundaries ───
print('\n=== HORIZONTAL SCAN at y=80 (HCL7 row) ===')
# Look at brightness of column divider lines
row_y = 80
prev_zone = None
for x in range(0, w, 1):
    b,g,r = map(int, img[row_y, x])
    tot = r+g+b
    # Bright = likely stat number or separator
    bright = tot > 450
    if bright:
        if prev_zone != 'bright':
            print(f'  x={x}: BRIGHT start  R={r} G={g} B={b}')
            prev_zone = 'bright'
    else:
        if prev_zone == 'bright':
            print(f'  x={x}: BRIGHT end')
            prev_zone = 'dark'
        elif prev_zone is None:
            prev_zone = 'dark'

# ─── SAMPLE STAT VALUES at known positions ───
print('\n=== STAT POSITIONS at y=80 (HCL7: ACS=335, KDA=32/14/5, ECON=81, FB=4, PLT=2, DEF=1) ===')
for x in range(250, w, 5):
    b,g,r = map(int, img[row_y, x])
    tot = r+g+b
    if tot > 300:
        print(f'  x={x}: R={r} G={g} B={b} total={tot}')
