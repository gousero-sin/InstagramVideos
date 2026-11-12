import cv2, numpy as np, sys
W,H=1080,1920
cv=cv2.VideoCapture('proxy.mp4'); cm=cv2.VideoCapture('matte.mkv')
acc=np.zeros((H,W,3),np.float64); wsum=np.zeros((H,W,1),np.float64); i=0
while True:
    ok,f=cv.read(); ok2,m=cm.read()
    if not ok or not ok2: break
    if i%6==0:
        a=m[...,0].astype(np.float32)/255
        a=cv2.dilate(a,np.ones((41,41),np.uint8))
        w=(a<0.02).astype(np.float64)[...,None]
        acc+=f*w; wsum+=w
    i+=1
plate=(acc/np.maximum(wsum,1)).astype(np.uint8)
hole=(wsum[...,0]<3).astype(np.uint8)*255
print('frames',i,'hole px',int((hole>0).sum()))
plate=cv2.inpaint(plate,hole,9,cv2.INPAINT_TELEA)
cv2.imwrite('plate.png',plate); cv2.imwrite('plate_hole.png',hole)
