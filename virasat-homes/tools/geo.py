import math, json, numpy as np
LAT0,LNG0=26.6185639,75.9935556
ML=111132.954-559.822*math.cos(2*math.radians(LAT0))+1.175*math.cos(4*math.radians(LAT0))
MG=111412.84*math.cos(math.radians(LAT0))-93.5*math.cos(3*math.radians(LAT0))
def load(): return json.load(open('georef.json'))
def plan_to_en(P,g):
    # plan px (x right, y down) -> local east/north metres around (LAT0,LNG0)
    P=np.asarray(P,float); s=g['mpp']; t=math.radians(g['rot'])
    X=(P[...,0]-g['ox'])*s; Y=-(P[...,1]-g['oy'])*s
    E=X*math.cos(t)-Y*math.sin(t)+g['e0']; N=X*math.sin(t)+Y*math.cos(t)+g['n0']
    return E,N
def en_to_plan(E,N,g):
    s=g['mpp']; t=math.radians(g['rot']); E=np.asarray(E)-g['e0']; N=np.asarray(N)-g['n0']
    X=E*math.cos(t)+N*math.sin(t); Y=-E*math.sin(t)+N*math.cos(t)
    return X/s+g['ox'], -Y/s+g['oy']
def en_to_ll(E,N): return LAT0+np.asarray(N)/ML, LNG0+np.asarray(E)/MG
def ll_to_en(lat,lng): return (np.asarray(lng)-LNG0)*MG,(np.asarray(lat)-LAT0)*ML
def ll_to_px(lat,lng,z):
    lat=np.asarray(lat); x=(np.asarray(lng)+180)/360*256*2**z
    y=(1-np.log(np.tan(np.radians(lat))+1/np.cos(np.radians(lat)))/math.pi)/2*256*2**z; return x,y
def px_to_ll(x,y,z):
    lng=np.asarray(x)/(256*2**z)*360-180; n=math.pi-2*math.pi*np.asarray(y)/(256*2**z)
    return np.degrees(np.arctan(np.sinh(n))), lng
