# Road centre-line segments from the plan: for each "ROAD xx' WIDE" label, find the direction with the
# longest run through the road mask, walk to both ends, measure the width. Output in plan feet.
import json, math, re, numpy as np, cv2
PXFT=5.466
import os
lay=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'layout.json')))
H,W=9506,6236
B=np.array(lay['boundary'])*PXFT
inside=np.zeros((H,W),np.uint8); cv2.fillPoly(inside,[np.round(B).astype(np.int32)],1)
blocked=np.zeros((H,W),np.uint8)
for p in lay['plots']: cv2.fillPoly(blocked,[np.round(np.array(p['points'])*PXFT).astype(np.int32)],1)
for a in lay['amenities']: cv2.fillPoly(blocked,[np.round(np.array(a['points'])*PXFT).astype(np.int32)],1)
road=(inside&(1-cv2.dilate(blocked,np.ones((9,9),np.uint8)))).astype(np.uint8)
road=cv2.morphologyEx(road,cv2.MORPH_OPEN,np.ones((31,31),np.uint8))
np.save('road_final.npy',road)
def on(p): x,y=int(round(p[0])),int(round(p[1])); return 0<=x<W and 0<=y<H and road[y,x]
def run(p,d,step=3,maxlen=12000):
    t=0
    while t<maxlen and on(p+d*t): t+=step
    return t
ocr=[json.loads(l) for l in open('ocr.jsonl')]
labels=[]
for o in ocr:
    m=re.search(r"ROAD\s*(\d0)",o['t'].upper())
    if m: labels.append((o['x']+o['w']/2,o['y']+o['h']/2,int(m.group(1)),o['h']>o['w']))
segs=[]
for cx,cy,w,vert in labels:
    c=np.array([cx,cy],float)
    if not on(c):
        continue
    best=None
    base=-81 if vert else 9.5
    for a in np.arange(base-14,base+14.01,0.25):
        d=np.array([math.cos(math.radians(a)),math.sin(math.radians(a))])
        L=run(c,d)+run(c,-d)
        if best is None or L>best[0]: best=(L,a,d)
    L,a,d=best
    # recentre across the road, measure width
    n=np.array([-d[1],d[0]])
    w1,w2=run(c,n,1,600),run(c,-n,1,600)
    c=c+n*(w1-w2)/2; width=(w1+w2)/PXFT
    # re-walk from the centred point
    t1,t2=run(c,d),run(c,-d)
    A=c-d*t2; Bp=c+d*t1
    segs.append({'label':w,'widthFt':round(width,1),'a':(A/PXFT).round(1).tolist(),'b':(Bp/PXFT).round(1).tolist(),'angle':round(a,2),'len':round((t1+t2)/PXFT)})
# dedupe: same road if parallel and centreline distance < 10 ft and overlapping
out=[]
for s in sorted(segs,key=lambda s:-s['len']):
    A,Bp=np.array(s['a']),np.array(s['b']); d=(Bp-A)/np.linalg.norm(Bp-A)
    dup=False
    for o in out:
        oa,ob=np.array(o['a']),np.array(o['b']); od=(ob-oa)/np.linalg.norm(ob-oa)
        if abs(np.dot(d,od))<0.98: continue
        mid=(A+Bp)/2; n=np.array([-od[1],od[0]])
        if abs(np.dot(mid-oa,n))<12: dup=True; break
    if not dup: out.append(s)
for s in out: print(s)
json.dump(out,open('roads.json','w'))
vis=cv2.resize(cv2.imread('img/hi.png'),None,fx=0.25,fy=0.25)
for s in out:
    A=(np.array(s['a'])*PXFT/4).astype(int); Bp=(np.array(s['b'])*PXFT/4).astype(int)
    cv2.line(vis,tuple(A),tuple(Bp),(255,0,0),3); cv2.circle(vis,tuple(A),6,(0,0,255),-1); cv2.circle(vis,tuple(Bp),6,(0,200,0),-1)
cv2.imwrite('img/roads.png',vis)
