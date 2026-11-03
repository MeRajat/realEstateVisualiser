import numpy as np, cv2, json, re
ws=np.load('ws.npy'); fc=np.load('fillclass.npy'); meta=json.load(open('ws.json')); F=meta['F']; n=meta['n']
names=['','salmon','lavender','teal','purple','orange','pink']
ocr=[json.loads(l) for l in open('ocr.jsonl')]
for o in ocr: o['cx']=(o['x']+o['w']/2)/F; o['cy']=(o['y']+o['h']/2)/F
regs=[]
for lab in range(1,n+1):
    m=(ws==lab).astype(np.uint8)
    a=int(m.sum())
    if a*F*F<4000: continue
    cnts,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    c=max(cnts,key=cv2.contourArea)
    x,y,w,h=cv2.boundingRect(c)
    cls=np.bincount(fc[m>0],minlength=7); cls[0]=0
    if cls.sum()<0.3*a: continue
    rect=cv2.minAreaRect(c)
    thin=min(rect[1])
    if thin*F<30: continue
    texts=[o for o in ocr if x<=o['cx']<=x+w and y<=o['cy']<=y+h and cv2.pointPolygonTest(c,(o['cx'],o['cy']),False)>=0]
    regs.append({'lab':lab,'area_px':a*F*F,'cls':names[int(cls.argmax())],'bbox':[x*F,y*F,w*F,h*F],
                 'texts':[t['t'] for t in sorted(texts,key=lambda t:(t['cy'],t['cx']))],
                 'poly':(cv2.approxPolyDP(c,2.5/F,True).reshape(-1,2)*F).tolist()})
json.dump(regs,open('regions.json','w'))
print(len(regs))
for r in regs: print(r['lab'],r['cls'],r['bbox'][:2],r['area_px'],r['texts'])
