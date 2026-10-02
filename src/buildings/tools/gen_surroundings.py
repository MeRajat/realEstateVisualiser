#!/usr/bin/env python3
"""Regenerate src/buildings/surroundings.json — the neighbourhood houses + trees drawn
around the society in the 3D view.

How it works
  1. Downloads Esri World Imagery tiles (z17) around society.location and OSM streets
     (Overpass) within ~1.7 km. Both are cached in ./.cache next to this script.
  2. Samples a jittered 11 m grid. Each 8 m window is classified from the imagery:
       • tree   — dark & green canopy      (brightness < 68, green index > 11, low texture)
       • house  — bright & busy texture    (brightness > 80, variance > 600) within 40 m of a street
     Points on carriageways, inside the society (+25 m) / approach road, or inside
     The Greater Mansarovar plot colony are skipped.
  3. Houses are aligned to the nearest street, sized 9–14 × 12–18 m, 2–4 storeys.
  4. Thins with distance (dense near the site, sparse towards the horizon) and caps counts.

Usage:  python3 src/buildings/tools/gen_surroundings.py
Needs:  numpy, Pillow. Keep LAT/LNG/SITE_* below in sync with src/buildings/society.js.
Data:   imagery © Esri; streets © OpenStreetMap contributors (ODbL).
"""
import concurrent.futures as cf
import json
import math
import os
import random
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, '..', 'surroundings.json')

LAT, LNG = 26.807802, 75.853483        # society.location
SITE_W, SITE_D = 128, 110              # society.site in metres (420 × 360 ft)
SITE_ROT = 249                         # society.siteRotation (deg clockwise from true north)
APPROACH_M = 80                        # gate → Mahal Road, plus margin
Z, HALF = 17, 1450                     # imagery zoom, half-size of the sampled square (m)
UA = {'User-Agent': 'Mozilla/5.0 (real-estate-visualiser surroundings generator)'}

ML = 110850.0
MG = 111320.0 * math.cos(math.radians(LAT))
os.makedirs(CACHE, exist_ok=True)


# ─── Inputs ───────────────────────────────────────────
def fetch_osm():
    path = os.path.join(CACHE, 'osm_highways.json')
    if os.path.exists(path):
        return json.load(open(path))
    q = f'[out:json][timeout:90];way(around:1700,{LAT},{LNG})["highway"];out geom;'
    for attempt in range(8):
        for host in ('overpass-api.de', 'overpass.kumi.systems'):
            try:
                req = urllib.request.Request(f'https://{host}/api/interpreter',
                                             data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
                data = json.loads(urllib.request.urlopen(req, timeout=120).read())
                json.dump(data, open(path, 'w'))
                return data
            except Exception as e:  # busy server → back off and retry
                print('overpass', host, 'failed:', e)
        time.sleep(5 * (attempt + 1))
    raise SystemExit('Overpass unavailable — try again later')


def lng2x(l): return (l + 180) / 360 * 2 ** Z
def lat2y(a): r = math.radians(a); return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z


MPT = 40075016.686 * math.cos(math.radians(LAT)) / 2 ** Z  # metres per tile
MPP = MPT / 256
CX, CY = lng2x(LNG), lat2y(LAT)
X0, X1 = int(CX - HALF / MPT) - 1, int(CX + HALF / MPT) + 1
Y0, Y1 = int(CY - HALF / MPT) - 1, int(CY + HALF / MPT) + 1


def fetch_tile(xy):
    x, y = xy
    p = os.path.join(CACHE, f'{Z}_{x}_{y}.jpg')
    if not (os.path.exists(p) and os.path.getsize(p)):
        url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{y}/{x}'
        for _ in range(3):
            try:
                open(p, 'wb').write(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())
                break
            except Exception:
                time.sleep(1)
    return p


def mosaic():
    tiles = [(x, y) for x in range(X0, X1 + 1) for y in range(Y0, Y1 + 1)]
    with cf.ThreadPoolExecutor(12) as ex:
        list(ex.map(fetch_tile, tiles))
    img = np.zeros(((Y1 - Y0 + 1) * 256, (X1 - X0 + 1) * 256, 3), np.float32)
    for x, y in tiles:
        p = os.path.join(CACHE, f'{Z}_{x}_{y}.jpg')
        if os.path.exists(p) and os.path.getsize(p):
            img[(y - Y0) * 256:(y - Y0 + 1) * 256, (x - X0) * 256:(x - X0 + 1) * 256] = np.asarray(Image.open(p).convert('RGB'), np.float32)
    return img


def px(e, n): return (CX - X0) * 256 + e / MPP, (CY - Y0) * 256 - n / MPP


def integral(a): return np.pad(a, ((1, 0), (1, 0))).cumsum(0).cumsum(1)


def wmean(I, c, r, h):
    c0, c1, r0, r1 = int(c - h), int(c + h), int(r - h), int(r + h)
    if c0 < 0 or r0 < 0 or c1 >= I.shape[1] - 1 or r1 >= I.shape[0] - 1:
        return None
    return (I[r1, c1] - I[r0, c1] - I[r1, c0] + I[r0, c0]) / ((c1 - c0) * (r1 - r0))


# ─── Exclusions ───────────────────────────────────────
def in_site(p, m=0):
    """Inside the society footprint / approach corridor (+m metres)."""
    e, n = p
    R = math.radians(SITE_ROT)
    s_ = -n
    x = e * math.cos(R) + s_ * math.sin(R)
    s = -e * math.sin(R) + s_ * math.cos(R)
    if abs(x) < SITE_W / 2 + m and abs(s) < SITE_D / 2 + m:
        return True
    return abs(x) < 9 + m and SITE_D / 2 - 2 < s < SITE_D / 2 + APPROACH_M


def colony_polygon():
    geo = json.load(open(os.path.join(ROOT, 'src/shared/geo.json')))
    plots = json.load(open(os.path.join(ROOT, 'src/shared/plots_data.json')))
    boundary = next(f for f in plots if f['id'] == 'SITE BOUNDARY')['points']
    r = math.radians(geo['rotationDeg'])
    out = []
    for x, y in boundary:
        dx = (x - geo['centerX']) * geo['metersPerUnit']
        dy = (geo['centerY'] - y) * geo['metersPerUnit']
        e_ = dx * math.cos(r) - dy * math.sin(r)
        n_ = dx * math.sin(r) + dy * math.cos(r)
        out.append(((geo['lng'] + e_ / MG - LNG) * MG, (geo['lat'] + n_ / ML - LAT) * ML))
    return out


def inside(p, poly):
    x, y = p
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


# ─── Main ─────────────────────────────────────────────
def main():
    random.seed(5)
    img = mosaic()
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    bright = (R + G + B) / 3
    green = G - (R + B) / 2
    Ib, Ig, Ib2 = integral(bright), integral(green), integral(bright ** 2)

    widths = {'trunk': 14, 'primary': 12, 'secondary': 16, 'tertiary': 8, 'residential': 5,
              'service': 4, 'unclassified': 5, 'track': 2, 'path': 2, 'footway': 2}
    roads = []
    for el in fetch_osm()['elements']:
        if 'geometry' not in el or 'highway' not in el.get('tags', {}):
            continue
        w = widths.get(el['tags']['highway'], 3)
        pts = [((p['lon'] - LNG) * MG, (p['lat'] - LAT) * ML) for p in el['geometry']]
        roads += [(pts[i], pts[i + 1], w) for i in range(len(pts) - 1)]
    CELL = 60
    grid = {}
    for k, (a, b, _) in enumerate(roads):
        for gx in range(int(min(a[0], b[0]) // CELL) - 1, int(max(a[0], b[0]) // CELL) + 2):
            for gy in range(int(min(a[1], b[1]) // CELL) - 1, int(max(a[1], b[1]) // CELL) + 2):
                grid.setdefault((gx, gy), []).append(k)

    def nearest_road(p):
        best = (1e9, None)
        for k in grid.get((int(p[0] // CELL), int(p[1] // CELL)), []):
            a, b, w = roads[k]
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = dx * dx + dy * dy
            t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
            d = math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) - w / 2
            if d < best[0]:
                best = (d, (dx, dy))
        return best

    colony = colony_polygon()
    houses, trees = [], []
    for e in np.arange(-HALF, HALF, 11):
        for n in np.arange(-HALF, HALF, 11):
            p = (e + random.uniform(-2, 2), n + random.uniform(-2, 2))
            if in_site(p, 25) or inside(p, colony):
                continue
            c, r = px(*p)
            h = 4 / MPP
            mb, mg = wmean(Ib, c, r, h), wmean(Ig, c, r, h)
            if mb is None:
                continue
            var = wmean(Ib2, c, r, h) - mb * mb
            d, direction = nearest_road(p)
            if d < 2.5:
                continue
            if mb < 68 and mg > 11 and var < 650:
                if math.hypot(*p) > 40:
                    trees.append((round(p[0]), round(p[1]), random.randint(9, 15)))
                    if mg > 15 and random.random() < 0.5:
                        q = (p[0] + random.uniform(-5, 5), p[1] + random.uniform(-5, 5))
                        if nearest_road(q)[0] > 2.5:
                            trees.append((round(q[0]), round(q[1]), random.randint(8, 13)))
                continue
            if mb > 80 and var > 600 and d < 40:
                dx, dy = direction
                rot = math.degrees(math.atan2(dx, dy)) % 180
                houses.append((round(p[0]), round(p[1]), round(rot), random.choice([9, 10, 12, 12, 14]),
                               random.choice([12, 14, 15, 18]), random.choices([2, 3, 4], [5, 4, 1])[0], random.randrange(6)))

    def keep(r, near): return r < near or random.random() < (near / r) ** 1.6
    houses = sorted([h for h in houses if keep(math.hypot(h[0], h[1]), 450)], key=lambda h: math.hypot(h[0], h[1]))[:4200]
    trees = sorted([t for t in trees if keep(math.hypot(t[0], t[1]), 300)], key=lambda t: math.hypot(t[0], t[1]))[:3600]
    out = {
        '_doc': 'Generated by src/buildings/tools/gen_surroundings.py. Metres from society.location, true north. '
                'houses: flat [east, north, rotDeg(cw from N), width, depth, storeys, paletteIdx]*; '
                'trees: flat [east, north, scale×10]*. Imagery © Esri, streets © OpenStreetMap contributors.',
        'origin': [LAT, LNG],
        'houses': [v for h in houses for v in h],
        'trees': [v for t in trees for v in t],
    }
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(houses)} houses, {len(trees)} trees → {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
