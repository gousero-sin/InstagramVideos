import sys, json, whisper
m = whisper.load_model("large-v3", device="cpu")
r = m.transcribe(sys.argv[1], language="pt", word_timestamps=True, fp16=False, beam_size=5, temperature=0)
out=[]
for s in r["segments"]:
    out.append({"start":s["start"],"end":s["end"],"text":s["text"],"words":[{"w":w["word"],"s":round(float(w["start"]),3),"e":round(float(w["end"]),3),"p":round(float(w["probability"]),3)} for w in s.get("words",[])]})
    print(f"[{s['start']:6.2f}-{s['end']:6.2f}] {s['text']}", flush=True)
json.dump(out, open(sys.argv[2],"w"), ensure_ascii=False, indent=1)
