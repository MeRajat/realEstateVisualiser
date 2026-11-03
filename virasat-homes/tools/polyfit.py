import numpy as np, cv2
def _contour(mask):
    m=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((9,9),np.uint8))
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    return max(cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)[0],key=cv2.contourArea).reshape(-1,2).astype(float)
def _fit(P):
    vx,vy,x0,y0=cv2.fitLine(P.astype(np.float32),cv2.DIST_HUBER,0,0.01,0.01).ravel()
    return np.array([x0,y0],float),np.array([vx,vy],float)
def _inter(l1,l2):
    (p1,d1),(p2,d2)=l1,l2; A=np.array([d1,-d2]).T
    if abs(np.linalg.det(A))<1e-9: return None
    t=np.linalg.solve(A,p2-p1); return p1+d1*t[0]
def fit_polygon(mask):
    c=_contour(mask)
    for eps in (14,18,24,32,42):
        ap=cv2.approxPolyDP(c.astype(np.float32).reshape(-1,1,2),eps,True).reshape(-1,2)
        if len(ap)==4: break
    if len(ap)!=4:
        return cv2.approxPolyDP(c.astype(np.float32).reshape(-1,1,2),7,True).reshape(-1,2).astype(float), False
    idx=sorted(int(np.argmin(((c-v)**2).sum(1))) for v in ap)
    lines=[]
    for k in range(4):
        a,b=idx[k],idx[(k+1)%4]
        P=c[a:b+1] if b>a else np.vstack([c[a:],c[:b+1]])
        t=max(3,len(P)//8); Q=P[t:-t] if len(P)>2*t+5 else P
        lines.append(_fit(Q))
    out=[]
    for k in range(4):
        q=_inter(lines[k-1],lines[k]); out.append(q if q is not None else c[idx[k]])
    out=np.array(out,float)
    far=max(np.sqrt(((c-v)**2).sum(1)).min() for v in out)
    if far>(12 if eps<=24 else 20):
        return cv2.approxPolyDP(c.astype(np.float32).reshape(-1,1,2),7,True).reshape(-1,2).astype(float), False
    return out, True
