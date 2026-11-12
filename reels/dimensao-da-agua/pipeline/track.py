import cv2, numpy as np, json, mediapipe as mp, sys
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
M=sys.argv[1]
ho=vision.HandLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=M+'/hand_landmarker.task'),running_mode=vision.RunningMode.VIDEO,num_hands=2,min_hand_detection_confidence=0.3,min_hand_presence_confidence=0.3,min_tracking_confidence=0.3)
po=vision.PoseLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=M+'/pose_landmarker_heavy.task'),running_mode=vision.RunningMode.VIDEO)
hl=vision.HandLandmarker.create_from_options(ho); pl=vision.PoseLandmarker.create_from_options(po)
cap=cv2.VideoCapture('proxy.mp4'); out=[]; i=0
while True:
    ok,f=cap.read()
    if not ok: break
    img=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(f,cv2.COLOR_BGR2RGB))
    ts=int(i*1000/24)
    r=hl.detect_for_video(img,ts); p=pl.detect_for_video(img,ts)
    hands=[]
    for lm,hd in zip(r.hand_landmarks,r.handedness):
        hands.append({'label':hd[0].category_name,'score':round(hd[0].score,2),'pts':[[round(q.x,4),round(q.y,4)] for q in lm]})
    pose=[[round(q.x,4),round(q.y,4),round(q.visibility,2)] for q in p.pose_landmarks[0]] if p.pose_landmarks else None
    out.append({'f':i,'hands':hands,'pose':pose}); i+=1
json.dump(out,open('track.json','w'))
print('frames',i,'with2',sum(len(o['hands'])==2 for o in out),'with1',sum(len(o['hands'])==1 for o in out),'pose',sum(o['pose'] is not None for o in out))
