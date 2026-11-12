# Robust Video Matting (ONNX) → sequência de alpha (vídeo cinza sem perdas)
#   RVM_MODEL=models/rvm_resnet50_fp32.onnx python3 matte.py SRC matte.mkv 1080 1920
import os, sys, subprocess, time, numpy as np, onnxruntime as ort
src, out, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
ss = sys.argv[5] if len(sys.argv)>5 else None; nfr = int(sys.argv[6]) if len(sys.argv)>6 else None
ratio = float(sys.argv[7]) if len(sys.argv)>7 else 0.25
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sess = ort.InferenceSession(os.environ.get('RVM_MODEL', 'models/rvm_resnet50_fp32.onnx'), so, providers=['CPUExecutionProvider'])
cmd = ['ffmpeg','-v','error']+(['-ss',ss] if ss else [])+['-i',src,'-map','0:v:0','-vf',f'scale={W}:{H}:flags=area','-pix_fmt','rgb24','-f','rawvideo']+(['-frames:v',str(nfr)] if nfr else [])+['-']
dec = subprocess.Popen(cmd, stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','gray','-s',f'{W}x{H}','-r','24','-i','-','-c:v','ffv1','-level','3',out], stdin=subprocess.PIPE)
rec = [np.zeros([1,1,1,1],dtype=np.float32)]*4
dr = np.array([ratio],dtype=np.float32)
n=0; t0=time.time()
while True:
    buf = dec.stdout.read(W*H*3)
    if len(buf) < W*H*3: break
    x = np.frombuffer(buf,np.uint8).reshape(1,H,W,3).transpose(0,3,1,2).astype(np.float32)/255
    fgr, pha, *rec = sess.run(None, {'src':x,'r1i':rec[0],'r2i':rec[1],'r3i':rec[2],'r4i':rec[3],'downsample_ratio':dr})
    enc.stdin.write((pha[0,0]*255).clip(0,255).astype(np.uint8).tobytes())
    n+=1
    if n%100==0: print(n, f'{(time.time()-t0)/n:.2f}s/f', flush=True)
enc.stdin.close(); enc.wait(); print('done',n, f'{(time.time()-t0)/n:.2f}s/f')
