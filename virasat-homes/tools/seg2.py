import numpy as np, cv2, json, time
t0=time.time()
full=cv2.imread('img/hi.png')
F=1
im=cv2.resize(full,None,fx=1/F,fy=1/F,interpolation=cv2.INTER_AREA)
H,W=im.shape[:2]
I=im.astype(np.int16)
def bgr(h): return np.array([int(h[4:6],16),int(h[2:4],16),int(h[0:2],16)])
CL={'salmon':'fcb49c','lavender':'c4bce4','teal':'6cc4b4','purple':'a464ac','orange':'ec845c','pink':'fcacac'}
OTHER={'road':'c4c4c4','white':'fcfcfc','brown':'8c745c','black':'040404','red':'ec1c24','green':'54bc4c','blue':'2c4ca4','gray2':'7c7c7c'}
allc=list(CL.items())+list(OTHER.items())
lab=np.zeros((H,W),np.uint8); best=np.full((H,W),10**6,np.int32)
for i,(k,h) in enumerate(allc,1):
    d=np.abs(I-bgr(h)).sum(axis=2); m=d<best; lab[m]=i; best=np.where(m,d,best)
names=[None]+[k for k,_ in allc]
fill=((lab>=1)&(lab<=len(CL))&(best<60)).astype(np.uint8)
brown=((lab==names.index('brown'))&(best<70)).astype(np.uint8)
gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
dark=((gray<140)&(fill==0)).astype(np.uint8)
# straight dark runs: open with rotated line kernels
L=56
lines=np.zeros_like(dark)
for a in list(np.arange(-20,21,1.0))+list(np.arange(70,111,1.0)):
    k=np.zeros((L+1,L+1),np.uint8); c=L/2; r=np.radians(a)
    p1=(int(round(c-np.cos(r)*c)),int(round(c-np.sin(r)*c))); p2=(int(round(c+np.cos(r)*c)),int(round(c+np.sin(r)*c)))
    cv2.line(k,p1,p2,1,1)
    lines|=cv2.morphologyEx(dark,cv2.MORPH_OPEN,k)
barrier=cv2.dilate(lines|brown,np.ones((3,3),np.uint8))
# blocks: plot-coloured areas, closed and hole-filled
nf,fcc,fst,_=cv2.connectedComponentsWithStats(fill,connectivity=8)
edge=[i for i in range(1,nf) if fst[i,0]<120 or fst[i,1]<120 or fst[i,0]+fst[i,2]>W-120 or fst[i,1]+fst[i,3]>H-120]
fill[np.isin(fcc,edge)]=0
blk=cv2.morphologyEx(fill,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
cnts,_=cv2.findContours(blk,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
blocks=np.zeros_like(blk)
for c in cnts:
    if 12000<cv2.contourArea(c)<12e6: cv2.drawContours(blocks,[c],-1,1,-1)
region=(blocks&(1-barrier)).astype(np.uint8)
region=cv2.erode(region,np.ones((11,11),np.uint8))
n,cc,st,cen=cv2.connectedComponentsWithStats(region,connectivity=4)
keep=[i for i in range(1,n) if st[i,4]>1000]
markers=np.zeros((H,W),np.int32)
for j,i in enumerate(keep,1): markers[cc==i]=j
markers[blocks==0]=len(keep)+1  # background marker
ws=cv2.watershed(im.copy(),markers)
np.save('ws.npy',ws)
np.save('fillclass.npy',np.where(fill>0,lab,0))
cv2.imwrite('img/lines_small.png',cv2.resize((lines|brown)*255,None,fx=0.125,fy=0.125,interpolation=cv2.INTER_AREA))
rng=np.random.default_rng(2); col=rng.integers(60,255,(len(keep)+3,3)).astype(np.uint8); col[0]=0; col[len(keep)+1]=0
vis=col[np.clip(ws,0,len(keep)+1)]
cv2.imwrite('img/ws_small.png',cv2.resize(vis,None,fx=0.125,fy=0.125,interpolation=cv2.INTER_NEAREST))
json.dump({'F':F,'n':len(keep)},open('ws.json','w'))
print('regions',len(keep),'time',round(time.time()-t0,1))
