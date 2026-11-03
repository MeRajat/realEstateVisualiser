import json, math, numpy as np, cv2, os, sys
d=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'layout.json')); G=d['geo']; r=math.radians(G['rotationDeg'])
def ll(p):
    X=(p[0]-G['origin'][0])*G['mPerFt']; Y=(G['origin'][1]-p[1])*G['mPerFt']
    E=X*math.cos(r)-Y*math.sin(r)+G['e0']; N=X*math.sin(r)+Y*math.cos(r)+G['n0']
    return G['lat0']+N/G['mPerDegLat'], G['lng0']+E/G['mPerDegLng']
z=18; S=3
def px(lat,lng):
    x=(lng+180)/360*256*2**z; y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*256*2**z; return x,y
pts=np.array([px(*ll(p)) for p in d['boundary']])
x0,y0=pts.min(0)-80; x1,y1=pts.max(0)+80
tx0,ty0,tx1,ty1=int(x0//256),int(y0//256),int(x1//256),int(y1//256)
mos=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256,3),np.uint8)
for tx in range(tx0,tx1+1):
  for ty in range(ty0,ty1+1):
    t=cv2.imread(f'tiles/esri_{z}_{tx}_{ty}.jpg'); mos[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=t
mos=cv2.resize(mos,None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
def P(poly): return np.array([[(px(*ll(p))[0]-tx0*256)*S,(px(*ll(p))[1]-ty0*256)*S] for p in poly]).astype(np.int32)
ov=mos.copy()
cv2.fillPoly(ov,[P(d['boundary'])],(150,150,150))
col={'park':(80,170,60),'green':(80,170,60),'play':(60,200,160),'utility':(200,200,200),'commercial':(80,160,250),'shops':(120,120,220)}
for a in d['amenities']: cv2.fillPoly(ov,[P(a['points'])],col[a['kind']])
for p in d['plots']: cv2.fillPoly(ov,[P(p['points'])],(120,200,250))
out=cv2.addWeighted(ov,0.45,mos,0.55,0)
for p in d['plots']: cv2.polylines(out,[P(p['points'])],True,(255,255,255),1,cv2.LINE_AA)
cv2.polylines(out,[P(d['boundary'])],True,(0,0,255),2,cv2.LINE_AA)
c=out[int((y0-ty0*256)*S):int((y1-ty0*256)*S),int((x0-tx0*256)*S):int((x1-tx0*256)*S)]
cv2.imwrite('img/verify_full.jpg',cv2.resize(c,None,fx=0.33,fy=0.33,interpolation=cv2.INTER_AREA))
cv2.imwrite('img/verify_nw.jpg',c[0:c.shape[0]//2,0:c.shape[1]//2])
print(c.shape)
