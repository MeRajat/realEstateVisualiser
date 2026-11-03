import json, re, collections, cv2, numpy as np, sys
regs=json.load(open('regions.json'))
over=json.load(open('overrides.json')) if __import__('os').path.exists('overrides.json') else {}
for r in regs:
    toks=[]; areas=[]; codes=[]
    for t in r['texts']:
        for m in re.finditer(r'(?<![\d.])([LE])\s?(\d{1,2})(?![\d.])',t): codes.append(m.group(1)+m.group(2))
        for m in re.finditer(r'(?<![\d.])(\d{1,3}\.\d{2})(?!\d)',t): areas.append(float(m.group(1)))
        for m in re.finditer(r"(?<![\d.'\-LE])(\d{1,3})(?![\d.'\"°*\-:])",t):
            v=int(m.group(1))
            if 1<=v<=200: toks.append(v)
    pid=None
    if codes: pid=collections.Counter(codes).most_common(1)[0][0]
    elif toks: pid=str(collections.Counter(toks).most_common(1)[0][0])
    o=over.get(str(r['lab']),{})
    if o.get('drop'): r['drop']=True
    r['id']=o.get('id',pid); r['statedSqYd']=o.get('sqyd', (collections.Counter(areas).most_common(1)[0][0] if areas else None))
    r['kind']=o.get('kind','plot')
json.dump(regs,open('assigned.json','w'))
# duplicates report
c=collections.Counter(r['id'] for r in regs if not r.get('drop'))
print('none:',[r['lab'] for r in regs if r['id'] is None and not r.get('drop')])
print('dups:',{k:v for k,v in c.items() if v>1})
# overlay
im=cv2.imread('img/hi.png')
for r in regs:
    if r.get('drop'): continue
    p=np.array(r['poly'],np.int32)
    cv2.polylines(im,[p],True,(0,0,255),4)
    M=p.mean(axis=0).astype(int)
    lbl=f"{r['id']}|{r['lab']}"
    cv2.putText(im,lbl,(M[0]-60,M[1]+12),cv2.FONT_HERSHEY_SIMPLEX,1.3,(255,255,255),7)
    cv2.putText(im,lbl,(M[0]-60,M[1]+12),cv2.FONT_HERSHEY_SIMPLEX,1.3,(200,0,0),3)
cv2.imwrite('img/assigned.png',im)
