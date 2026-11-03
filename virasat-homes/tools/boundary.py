import numpy as np, cv2, json, math
im=cv2.imread('img/hi.png').astype(np.int16)
red=(np.abs(im-np.array([0x24,0x1c,0xec])).sum(axis=2)<120).astype(np.uint8)
red[:700,:]=0; red[5600:7600,0:1900]=0; red[4050:4480,4850:5534]=0
# top edge fit from visible dashes right of the tower
ys,xs=np.nonzero(red[700:1200,1520:2600]); xs=xs+1520; ys=ys+700
c,d=np.polyfit(xs,ys,1)
cv2.line(red,(1240,int(c*1240+d)),(1560,int(c*1560+d)),1,22)
k=cv2.morphologyEx(red,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(45,45)))
t=math.radians(27.995); n=np.array([math.sin(t),math.cos(t)]); dd=np.array([math.cos(t),-math.sin(t)])
base=n*8065; cv2.line(k,tuple((base-dd*8000).astype(int)),tuple((base+dd*8000).astype(int)),1,12)
cnts,hier=cv2.findContours(k,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)
best=None
for i,cn in enumerate(cnts):
    if hier[0][i][3]>=0 and cv2.pointPolygonTest(cn,(3300,2700),False)>0:
        a=cv2.contourArea(cn); best=(a,cn) if best is None or a<best[0] else best
m=np.zeros(k.shape,np.uint8); cv2.drawContours(m,[best[1]],-1,1,-1)
m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(21,21)))
c2=max(cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)[0],key=cv2.contourArea)
poly=cv2.approxPolyDP(c2,4,True).reshape(-1,2)
A=cv2.contourArea(poly)/5.466**2
print('vertices',len(poly),'area sqft %.0f sqyd %.0f acres %.2f'%(A,A/9,A/43560))
json.dump(poly.tolist(),open('boundary.json','w'))
vis=cv2.imread('img/hi.png'); cv2.polylines(vis,[poly.reshape(-1,1,2)],True,(255,0,0),10)
for p in poly: cv2.circle(vis,tuple(int(v) for v in p),16,(0,160,0),-1)
cv2.imwrite('img/boundary.png',cv2.resize(vis,None,fx=0.125,fy=0.125))
