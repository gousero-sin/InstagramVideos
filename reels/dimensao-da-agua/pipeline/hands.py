# builds smooth per-frame tracks: A = subject's left hand (screen right), B = subject's right hand (screen left)
import json, numpy as np
from scipy.ndimage import gaussian_filter1d
T=json.load(open('track.json')); N=len(T)
def palm(p): 
    p=np.array(p); return p[[0,5,9,13,17]].mean(0)
A=np.full((N,2),np.nan); B=np.full((N,2),np.nan); PA=np.zeros((N,3)); PB=np.zeros((N,3)); HEAD=np.zeros((N,2)); SH=np.zeros((N,4))
for i,o in enumerate(T):
    po=np.array(o['pose']); 
    # pose: 15 left wrist,16 right wrist,19 left index,20 right index, 0 nose
    la=(po[15,:2]+po[19,:2]*1.0+po[17,:2])/3; rb=(po[16,:2]+po[20,:2]+po[18,:2])/3
    PA[i]=[*la,po[15,2]]; PB[i]=[*rb,po[16,2]]; HEAD[i]=po[0,:2]; SH[i]=[*po[11,:2],*po[12,:2]]
    for h in o['hands']:
        c=palm(h['pts'])
        if np.hypot(*(c-la))<np.hypot(*(c-rb)): A[i]=c
        else: B[i]=c
def fill(X,P):
    out=X.copy()
    for k in range(2):
        v=X[:,k]; ok=~np.isnan(v)
        # offset-corrected pose fallback
        d=np.interp(np.arange(N),np.where(ok)[0],(v-P[:,k])[ok]) if ok.sum()>2 else 0
        out[:,k]=np.where(ok,v,P[:,k]+d)
        out[:,k]=gaussian_filter1d(out[:,k],1.2)
    return out
A2=fill(A,PA); B2=fill(B,PB)
np.savez('hands.npz',A=A2,B=B2,visA=PA[:,2],visB=PB[:,2],detA=~np.isnan(A[:,0]),detB=~np.isnan(B[:,0]),head=gaussian_filter1d(HEAD,1.5,axis=0),sh=gaussian_filter1d(SH,1.5,axis=0))
for i in range(640,940,4):
    print(f"{i/24:6.2f} A {A2[i,0]:.2f},{A2[i,1]:.2f} {'D' if not np.isnan(A[i,0]) else '-'}{PA[i,2]:.1f} | B {B2[i,0]:.2f},{B2[i,1]:.2f} {'D' if not np.isnan(B[i,0]) else '-'}{PB[i,2]:.1f} | head {HEAD[i,0]:.2f},{HEAD[i,1]:.2f}")
