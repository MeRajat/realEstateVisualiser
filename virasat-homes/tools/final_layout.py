import json, math, re, collections, numpy as np, cv2
from polyfit import fit_polygon
from geo import ML, MG, LAT0, LNG0
PXFT=5.466
g=json.load(open('georef.json'))
ws=np.load('ws.npy'); H,W=ws.shape
regs=[r for r in json.load(open('assigned.json')) if r['id']]
byid=collections.defaultdict(list)
for r in regs: byid[r['id']].append(r)
cc=np.load('opencc.npy')
ROT=math.radians(g['rot'])
def bearing(nx,ny):
    X,Y=nx,-ny; E=X*math.cos(ROT)-Y*math.sin(ROT); N=X*math.sin(ROT)+Y*math.cos(ROT)
    return (math.degrees(math.atan2(E,N))+360)%360
DIRS=['North','North-East','East','South-East','South','South-West','West','North-West']
def dir8(b): return DIRS[int(((b+22.5)%360)//45)]
def ft(v): return round(float(v)/PXFT,2)
def fmt_ftin(x):
    i=round(x*12); f,inch=divmod(i,12); return f"{f}'" if inch==0 else f"{f}'{inch}\""
STD=[(list(range(154,167))+list(range(176,189)),111.91,(20,50+4/12)),
     (list(range(91,104))+list(range(140,152))+list(range(106,121))+list(range(123,137))+list(range(68,87))+list(range(52,66)),115.56,(20,52)),
     (list(range(21,37))+list(range(39,50)),166.69,(25,60))]
std={}
for ids,a,d in STD:
    for i in ids: std[str(i)]=(a,d)
for i in range(7,19): std[f'L{i}']=(89.11,(17+10/12,45))
CAT={'lavender':'Standard','teal':'Standard','purple':'Corner','salmon':'Large','orange':'Compact','pink':'Compact'}
fits={}
for pid,rs in byid.items(): fits[pid]=fit_polygon(np.isin(ws,[r['lab'] for r in rs]).astype(np.uint8))
B0=np.array(json.load(open('boundary.json')),np.int32)
inside=np.zeros((H,W),np.uint8); cv2.fillPoly(inside,[B0],1)
blocked=np.zeros((H,W),np.uint8)
for q,_ in fits.values(): cv2.fillPoly(blocked,[np.round(q).astype(np.int32)],1)
AMEN_IDX={'utility':1,'play':3,'g1':2,'g2':5,'commercial':8}
for i in AMEN_IDX.values(): blocked[cc==i]=1
cv2.fillPoly(blocked,[np.array([(4735,5489),(5533,5636),(5548,6185),(4590,6655),(4552,6630),(4535,6575)],np.int32)],1)
cv2.fillPoly(blocked,[np.array([(4936,4062),(5553,4192),(5553,4452),(4887,4354)],np.int32)],1)
road=(inside&(1-cv2.dilate(blocked,np.ones((5,5),np.uint8)))).astype(np.uint8)
road=cv2.morphologyEx(road,cv2.MORPH_OPEN,np.ones((41,41),np.uint8))
ocr0=[json.loads(l) for l in open('ocr.jsonl')]
LBL=[]
for o in ocr0:
    mt=re.search(r"ROAD\s*(\d0)",o['t'].upper())
    if mt: LBL.append((o['x']+o['w']/2,o['y']+o['h']/2,int(mt.group(1)),o['h']>o['w']))
def road_width(pt,vertical):
    c=[l for l in LBL if l[3]==vertical] or LBL
    return min(c,key=lambda l:(l[0]-pt[0])**2+(l[1]-pt[1])**2)[2]
plots=[]
for pid,rs in byid.items():
    q,quad=fits[pid]
    areaPx=cv2.contourArea(q.astype(np.float32)); measured=areaPx/PXFT**2/9
    decs=[]
    for r in rs:
        for t in r['texts']:
            decs+= [float(x) for x in re.findall(r'(?<![\d.])(\d{2,3}\.\d{2})(?!\d)',t)]
    stated=None; src='measured'
    if pid in std: stated=std[pid][0]; src='plan'
    elif decs:
        best=min(decs,key=lambda d:abs(d-measured))
        if abs(best-measured)/measured<0.08: stated=best; src='plan'
    area=stated if stated else round(measured,2)
    cx,cy=q.mean(axis=0)
    # road-facing sides
    sides=[]; n=len(q)
    relaxed=False
    for need in (int(10*PXFT/4), int(4*PXFT/4)):
      if sides: break
      relaxed = need < 10
      for i in range(n):
          a,b=q[i],q[(i+1)%n]; L=np.hypot(*(b-a))
          if L<(3 if relaxed else 8)*PXFT: continue
          mid=(a+b)/2; d=(b-a)/L; nrm=np.array([d[1],-d[0]])
          if np.dot(nrm,mid-[cx,cy])<0: nrm=-nrm
          hits=0
          for s in range(int(4*PXFT),int(22*PXFT),4):
              x,y=(mid+nrm*s).astype(int)
              if 0<=x<W and 0<=y<H and road[y,x]: hits+=1
          if hits>=need:
              vert=abs(d[1])>abs(d[0])
              w=road_width(mid+nrm*15*PXFT,vert)
              sides.append({'dir':dir8(bearing(*nrm)),'bearing':round(bearing(*nrm)),'roadFt':w,'lenFt':round(L/PXFT,1)})
    # merge same direction
    fac={}
    for s in sides:
        if s['dir'] not in fac or s['lenFt']>fac[s['dir']]['lenFt']: fac[s['dir']]=s
    facing=sorted(fac.values(),key=lambda s:-s['lenFt'])
    card=[f for f in facing if '-' not in f['dir']]
    facing=(card if card else facing)[:1 if relaxed else 2]
    if pid in std:
        w,dpt=std[pid][1]; dims={'w':round(w,2),'d':round(dpt,2),'label':f"{fmt_ftin(w)} × {fmt_ftin(dpt)}"}
    elif quad:
        s=[np.hypot(*(q[(i+1)%4]-q[i]))/PXFT for i in range(4)]
        w=(s[0]+s[2])/2; dpt=(s[1]+s[3])/2
        if w>dpt: w,dpt=dpt,w
        dims={'w':round(w,1),'d':round(dpt,1),'label':f"≈ {round(w)}' × {round(dpt)}'"}
    else: dims=None
    cls=collections.Counter(r['cls'] for r in rs).most_common(1)[0][0]
    plots.append({'id':pid,'category':CAT[cls],'tone':cls,'areaSqYd':round(area,2),'areaSource':src,'areaSqFt':round(area*9),
                  'dims':dims,'facing':facing,'points':[[ft(x),ft(y)] for x,y in q]})
def keyf(p):
    m=re.match(r'([A-Z]?)(\d+)',p['id']); return ({'':0,'L':1,'E':2}[m.group(1)],int(m.group(2)))
plots.sort(key=keyf)
# amenities
def comp_poly(i,eps=6):
    m=(cc==i).astype(np.uint8); c=max(cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)[0],key=cv2.contourArea)
    return cv2.approxPolyDP(c,eps,True).reshape(-1,2)
P5=np.array(json.load(open('fitted.json'))['5'])
am=[('Public utility','utility',comp_poly(1),2999.51),('Play ground','play',comp_poly(3),2352.83),('Green belt','green',comp_poly(2),None),
    ('Green belt','green',comp_poly(5),None),('Commercial','commercial',comp_poly(8),2990.00),
    ('Park','park',np.array([(4735,5489),(5533,5636),(5548,6185),(4590,6655),(4552,6630),(4535,6575)]),2896.62),
    ('Shops & parking','shops',np.array([(4936,4062),(5553,4192),(5553,4452),(4887,4354)]),None)]
amen=[]
for name,kind,poly,stated in am:
    a=cv2.contourArea(poly.astype(np.float32))/PXFT**2/9
    amen.append({'name':name,'kind':kind,'areaSqYd':stated or round(a),'measuredSqYd':round(a),'points':[[ft(x),ft(y)] for x,y in poly]})
# road labels from OCR + local road direction
ocr=[json.loads(l) for l in open('ocr.jsonl')]
labels=[]
for o in ocr:
    mt=re.search(r"ROAD\s*(\d0)",o['t'].upper())
    if not mt: continue
    cx,cy=o['x']+o['w']/2,o['y']+o['h']/2
    if any(abs(cx-l[0])<300 and abs(cy-l[1])<300 for l in labels): continue
    ys,xs=np.nonzero(road[int(cy)-120:int(cy)+120,int(cx)-120:int(cx)+120])
    if len(xs)<100: continue
    vertical=o['h']>o['w']
    # direction of the road: PCA over a long window along the dominant axis
    win=road[max(0,int(cy)-500):int(cy)+500,max(0,int(cx)-500):int(cx)+500]
    ys,xs=np.nonzero(win); pts=np.stack([xs,ys],1).astype(float); pts-=pts.mean(0)
    # use text orientation to choose the near-vertical or near-horizontal road
    ang=-81.0 if vertical else 9.5
    labels.append((cx,cy,int(mt.group(1)),ang))
roadLabels=[{'text':f"{w}' road",'at':[ft(x),ft(y)],'angle':a} for x,y,w,a in labels]
B=json.load(open('boundary.json'))
geo={'lat0':LAT0,'lng0':LNG0,'mPerDegLat':ML,'mPerDegLng':MG,'origin':[ft(g['ox']),ft(g['oy'])],'e0':round(g['e0'],3),'n0':round(g['n0'],3),
     'rotationDeg':round(g['rot'],3),'mPerFt':0.3048,
     '_doc':'plan feet (x right, y down) -> metres: X=(x-origin.x)*mPerFt, Y=(origin.y-y)*mPerFt; E=X cos r - Y sin r + e0; N = X sin r + Y cos r + n0; lat=lat0+N/mPerDegLat; lng=lng0+E/mPerDegLng (r = rotationDeg, counter-clockwise). Fitted to Esri World Imagery field boundaries and the SH-2 road; owner pin = lat0/lng0.'}
out={'project':{'name':'Virasat Homes','developer':'Terrabloom Colonizers & Developers Pvt. Ltd.','village':'Beer Pinarpura','tehsil':'Chaksu','district':'Jaipur',
     'address':'Kotkhawada Road (SH-2), Beer Pinarpura, Chaksu, Rajasthan 303901','pin':[LAT0,LNG0]},
     'geo':geo,'boundary':[[ft(x),ft(y)] for x,y in B],'plots':plots,'amenities':amen,'roadLabels':roadLabels}
json.dump(out,open('layout.json','w'),separators=(',',':'))
print('plots',len(plots),'plan-area',sum(p['areaSource']=='plan' for p in plots),'measured',sum(p['areaSource']=='measured' for p in plots))
print('amenities',[(a['name'],a['areaSqYd'],a['measuredSqYd']) for a in amen])
print('road labels',len(roadLabels))
print('no facing',[p['id'] for p in plots if not p['facing']])
print('size KB',len(json.dumps(out,separators=(',',':')))//1024)
tot=sum(p['areaSqYd'] for p in plots); print('total plot area sqyd',round(tot))
for pid in ['1','17','100','25','189','E5','L1','173','89','122']:
    p=[x for x in plots if x['id']==pid][0]; print(pid,p['areaSqYd'],p['areaSource'],p['dims'] and p['dims']['label'],[f"{f['dir']} {f['roadFt']}'" for f in p['facing']])
