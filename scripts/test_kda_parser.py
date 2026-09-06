import os
import sys

# Import parse_kda directly from ocr_pipeline
sys.path.insert(0, os.path.dirname(__file__))
from ocr_pipeline import parse_kda

tests = [
    ("16/1975", "16/19/5"),           # Venomnom missing slash recovery case
    ("20/19/6", "20/19/6"),           # Normal 1-digit assist (unchanged)
    ("17/17/73", "17/17/3"),          # Separator glyph '7' stripped
    ("11/19/78", "11/19/8"),          # Separator glyph '7' stripped
    ("32/14/5", "32/14/5"),           # Normal 1-digit assist
    ("21/19/12", "21/19/12"),         # Normal 2-digit assist (preserved)
    ("14/18/15", "14/18/15"),         # Normal 2-digit assist (preserved)
    ("10/17/8", "10/17/8"),           # Normal 1-digit assist
    ("unreadable_garbage", ""),       # Truly unreadable -> empty string (not "0/0/0")
]

print("=== Running parse_kda Regression Tests ===")
all_ok = True
for raw, expected in tests:
    result, warn = parse_kda(raw)
    ok = result == expected
    if not ok:
        all_ok = False
    status = "OK  " if ok else "FAIL"
    print(f"  [{status}] raw={repr(raw).ljust(20)} -> result={repr(result).ljust(12)} (expected={repr(expected)}) warn={repr(warn)}")

print(f"\nAll OK: {all_ok}")
if not all_ok:
    sys.exit(1)
