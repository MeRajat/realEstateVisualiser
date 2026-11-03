import json, math, numpy as np, cv2, os, urllib.request
from geo import *
g0=load(); z=18
B=np.array(json.load(open('boundary.json')),float)
# sample points along boundary, excluding the frontage segment along the SH-2 ROW (offset ~8065)
t=math.radians(27.995); n=np.array([math.sin(t),math.cos(t)])
pts=[]
for a,b in zip(B,np.roll(B,-1,axis=0)):
    L=np.hypot(*(b-a)); k=max(2,int(L/20))
    for s in np.linspace(0,1,k,endpoint=False):
        p=a+(b-a)*s
        if p@n<8000: pts.append(p)
pts=np.array(pts); print('samples',len(pts))
# satellite mosaic covering area
E,N=plan_to_en(B,g0); la,ln=en_to_ll(E,N); X,Y=ll_to_px(la,ln,z)
x0,x1,y0,y1=int(X.min())-200,int(X.max())+200,int(Y.min())-200,int(Y.max())+200
tx0,tx1,ty0,ty1=x0//256,x1//256,y0//256,y1//256
mos=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256,3),np.uint8)
for tx in range(tx0,tx1+1):
  for ty in range(ty0,ty1+1):
    p=f'tiles/esri_{z}_{tx}_{ty}.jpg'
    if not os.path.exists(p):
      req=urllib.request.Request(f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{ty}/{tx}',headers={'User-Agent':'realEstateVisualiser/1.0'})
      open(p,'wb').write(urllib.request.urlopen(req,timeout=30).read())
    tt=cv2.imread(p); mos[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=tt
lab=cv2.cvtColor(mos,cv2.COLOR_BGR2LAB).astype(np.float32)
gm=np.zeros(mos.shape[:2],np.float32)
for c in range(3):
    ch=cv2.GaussianBlur(lab[...,c],(0,0),1.5)
    gm+=cv2.magnitude(cv2.Sobel(ch,cv2.CV_32F,1,0),cv2.Sobel(ch,cv2.CV_32F,0,1))
gm=cv2.GaussianBlur(gm,(0,0),1.0)
gm/=np.percentile(gm,99)
def score(g):
    E,N=plan_to_en(pts,g); la,ln=en_to_ll(E,N); X,Y=ll_to_px(la,ln,z)
    xi=np.clip((X-tx0*256).astype(int),0,gm.shape[1]-1); yi=np.clip((Y-ty0*256).astype(int),0,gm.shape[0]-1)
    return float(gm[yi,xi].mean())
# search: along-road shift u, perpendicular v, rotation dr ; road direction (real) 25.7deg
ra=math.radians(25.7); u_dir=np.array([math.cos(ra),math.sin(ra)]); v_dir=np.array([-math.sin(ra),math.cos(ra)])
res=[]
for dr in np.arange(-3,3.01,0.5):
  for u in np.arange(-80,80.1,2):
    for v in np.arange(-20,20.1,2):
      g=dict(g0); g['rot']=g0['rot']+dr; g['e0']=g0['e0']+u*u_dir[0]+v*v_dir[0]; g['n0']=g0['n0']+u*u_dir[1]+v*v_dir[1]
      res.append((score(g),dr,u,v))
res.sort(reverse=True)
print('baseline', score(g0))
for r in res[:15]: print('%.4f rot%+.1f along%+.0f perp%+.0f'%r)
# profile along u at best dr,v
b=res[0]
for u in np.arange(-80,80.1,8):
    g=dict(g0); g['rot']=g0['rot']+b[1]; g['e0']=g0['e0']+u*u_dir[0]+b[3]*v_dir[0]; g['n0']=g0['n0']+u*u_dir[1]+b[3]*v_dir[1]
    print('u %+4.0f %.4f'%(u,score(g)))
json.dump({'u_dir':u_dir.tolist(),'v_dir':v_dir.tolist(),'best':res[0]},open('fit_best.json','w'))
