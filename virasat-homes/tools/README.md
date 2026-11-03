# Rebuilding data/layout.json from the brochure

Run in a scratch folder with `img/hi.png` = the last brochure page (extract with PyMuPDF), Python 3 + `opencv-python-headless numpy pymupdf pillow`, and macOS for OCR.

1. `swiftc -O ocr.swift -o ocr && ./ocr img/hi.png 1000 250 > ocr.jsonl` — Apple Vision OCR in overlapping tiles.
2. `python seg2.py` — colour classes, long dark divider lines, watershed → one region per plot (`ws.npy`).
3. `python regions.py > regions.txt && python assign.py` — attach OCR text; `overrides.json` holds the by-eye corrections and sliver merges.
4. `python boundary.py` — site boundary from the red dashed line, closed along the SH-2 right-of-way.
5. `python fit.py` — (optional) re-fit map placement against Esri imagery edges; `georef.json` is the adopted placement.
6. `python amen.py && python final_layout.py` — clean plot polygons, areas, facing, open areas → `layout.json`.
7. `python verify_json.py layout.json` — draws the result from the JSON alone over the satellite photo.
