import json, numpy as np, cv2
PXFT=5.466
ws=np.load('ws.npy'); H,W=ws.shape
img=cv2.imread('img/hi.png'); I=img.astype(np.int16)
B=np.array(json.load(open('boundary.json')),np.int32)
inside=np.zeros((H,W),np.uint8); cv2.fillPoly(inside,[B],1)
polys=json.load(open('fitted.json'))
plotm=np.zeros((H,W),np.uint8)
for q in polys.values(): cv2.fillPoly(plotm,[np.round(np.array(q)).astype(np.int32)],1)
gray=(np.abs(I-np.array([0xc4,0xc4,0xc4])).sum(axis=2)<24).astype(np.uint8)
road=cv2.morphologyEx(gray,cv2.MORPH_CLOSE,np.ones((41,41),np.uint8))
road=cv2.morphologyEx(road,cv2.MORPH_OPEN,np.ones((61,61),np.uint8))&inside   # 61px ~ 11ft: drops park paths
np.save('roadmask.npy',road)
openm=(inside&(1-cv2.dilate(plotm,np.ones((15,15),np.uint8)))&(1-cv2.dilate(road,np.ones((9,9),np.uint8)))).astype(np.uint8)
openm=cv2.morphologyEx(openm,cv2.MORPH_OPEN,np.ones((31,31),np.uint8))
n,cc,st,cen=cv2.connectedComponentsWithStats(openm,connectivity=4)
vis=img.copy()
rng=np.random.default_rng(3)
for i in range(1,n):
    if st[i,4]<20000: continue
    col=tuple(int(v) for v in rng.integers(0,255,3)); m=cc==i
    vis[m]=(vis[m]*0.4+np.array(col)*0.6).astype(np.uint8)
    cv2.putText(vis,f'{i}:{st[i,4]/PXFT**2/9:.0f}',tuple(int(v) for v in cen[i]),cv2.FONT_HERSHEY_SIMPLEX,3,(0,0,0),8)
vis[road>0]=(vis[road>0]*0.5+np.array([0,0,255])*0.5).astype(np.uint8)
cv2.imwrite('img/amen.png',cv2.resize(vis,None,fx=0.12,fy=0.12))
np.save('opencc.npy',cc)
