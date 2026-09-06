"""
Targeted diagnostic: measure exact column boundaries for KDA, ECON, FB, DEF, and name crop.
Scans pixel brightness to find the precise column separator positions.
"""
import cv2
import numpy as np

img = cv2.imread('Valorant_scoreboard.png')
h, w = img.shape[:2]

# Use the ATMAN FPS row (y=110-162, teal) — good contrast for finding separators
# The separator lines show as R=236,G=232,B=225 (near-white vertical lines)
# Let's scan at y=136 (middle of ATMAN row)

print("=== Vertical separator scan at y=136 (ATMAN FPS row) ===")
print("Looking for R>220 AND G>220 AND B>200 (separator color)")
separators = []
for x in range(250, w):
    r, g, b = int(img[136,x,2]), int(img[136,x,1]), int(img[136,x,0])
    if r > 220 and g > 220 and b > 200:
        separators.append(x)

# Find contiguous groups
groups = []
if separators:
    g_start = separators[0]
    g_prev  = separators[0]
    for x in separators[1:]:
        if x - g_prev > 3:
            groups.append((g_start, g_prev))
            g_start = x
        g_prev = x
    groups.append((g_start, g_prev))

print("Separator groups (column dividers):")
for g in groups:
    print(f"  x={g[0]}-{g[1]}  center={( g[0]+g[1])//2}  norm={g[0]/w:.3f}")

print()
print("=== Per-row KDA region brightness scan (x=490-540) ===")
# Check whether the ECON digit bleeds into KDA at various x positions
rows_info = [
    (56,108,'HCL7','32/14/5','81'),
    (110,162,'ATMAN','23/23/6','73'),
    (326,378,'F0rSakeN','17/17/3','56'),
    (434,486,'Venomnom','16/19/5','43'),
    (488,540,'Ciggy','11/19/8','55'),
]
for y0,y1,name,kda_t,econ_t in rows_info:
    mid_y = (y0+y1)//2
    print(f"  {name} (y={y0}-{y1}, KDA={kda_t}, ECON={econ_t}):")
    for x in range(500, 555):
        r,g,b = int(img[mid_y,x,2]), int(img[mid_y,x,1]), int(img[mid_y,x,0])
        if r+g+b > 300:
            print(f"    x={x}: R={r} G={g} B={b}")

print()
print("=== DEF column scan — checking all 10 rows for bright pixel presence ===")
rows_all = [
    (56,108,'HCL7',1), (110,162,'ATMAN',1), (164,216,'WhiteTiger',0),
    (218,270,'cHiRu',0), (272,324,'kunty',0), (326,378,'F0rSakeN',0),
    (380,432,'Neeel',0), (434,486,'Venomnom',0), (488,540,'Ciggy',1),
    (542,594,'MTPX',0),
]
for y0,y1,name,truth in rows_all:
    mid_y = (y0+y1)//2
    bright_xs = []
    for x in range(850, w):
        r,g,b = int(img[mid_y,x,2]), int(img[mid_y,x,1]), int(img[mid_y,x,0])
        if r+g+b > 280:
            bright_xs.append((x, r, g, b))
    status = "OK" if bright_xs else "NO BRIGHT"
    print(f"  {name:14s} truth={truth}  bright_at={[bx[0] for bx in bright_xs[:5]]}  {status}")

print()
print("=== Name crop: checking where icon ends and text begins (y=80, HCL7) ===")
# Find where the agent icon dark region ends and the flat red background begins
for x in range(0, 280):
    r,g,b = int(img[80,x,2]), int(img[80,x,1]), int(img[80,x,0])
    # Flat red background: R≈110-140, G≈55-65, B≈65-80 (uniform)
    # Icon area: high variance, more complex colors
    if x % 10 == 0:
        print(f"  x={x:3d}: R={r:3d} G={g:3d} B={b:3d}")
