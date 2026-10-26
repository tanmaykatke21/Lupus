import subprocess, sys, re, os
SP, DEST = sys.argv[1], sys.argv[2]
F = f"{SP}/rec/node_modules/ffmpeg-static/ffmpeg"
OUT = f"{SP}/rec/out"; VO = f"{SP}/vo"
os.makedirs(DEST, exist_ok=True)
def dur(path):
    s = subprocess.run([F, "-i", path], capture_output=True, text=True).stderr
    h, m, x = re.search(r"Duration: (\d+):(\d+):([\d.]+)", s).groups(); return int(h)*3600+int(m)*60+float(x)
def raw(name):
    return sum(float(l.split()[1]) for l in open(f"{OUT}/{name}/list.txt") if l.startswith("duration"))
names = ["01-problem","02-who-benefits","03-schedule-compass","04-live-routing","05-ask-lupus","06-architecture"]
LEAD, TAIL = 0.3, 0.6
for n in names:
    a = dur(f"{VO}/{n}.aiff") / 1.05; T = a + LEAD + TAIL; k = T / raw(n)
    vin = ["-f","concat","-safe","0","-i",f"{OUT}/{n}/list.txt"]
    speed = f"setpts=PTS*{k:.4f},fps=30"
    if n in ("02-who-benefits","06-architecture"):
        fc = f"[0:v]{speed},scale=1920:1080,format=yuv420p[v];[1:a]atempo=1.05,adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad[a]"
        inputs = vin + ["-i", f"{VO}/{n}.aiff"]
    else:
        fc = (f"[0:v]{speed},scale=462:1000:flags=lanczos[ph];[1:v][ph]overlay=250:40[b];[b][2:v]overlay=0:0,format=yuv420p[v];"
              f"[3:a]atempo=1.05,adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad[a]")
        inputs = vin + ["-loop","1","-i",f"{OUT}/panel-{n}.png","-loop","1","-i",f"{OUT}/bezel.png","-i",f"{VO}/{n}.aiff"]
    cmd = [F,"-v","error","-y",*inputs,"-filter_complex",fc,"-map","[v]","-map","[a]","-t",f"{T:.2f}",
           "-c:v","libx264","-preset","slow","-crf","18","-pix_fmt","yuv420p","-r","30","-c:a","aac","-b:a","160k","-ar","48000","-ac","2",
           "-movflags","+faststart",f"{DEST}/{n}.mp4"]
    subprocess.run(cmd, check=True); print(n, f"speed x{1/k:.2f}", f"{T:.1f}s")
with open(f"{SP}/rec/concat.txt","w") as f:
    for n in names: f.write(f"file '{DEST}/{n}.mp4'\n")
subprocess.run([F,"-v","error","-y","-f","concat","-safe","0","-i",f"{SP}/rec/concat.txt","-c","copy","-movflags","+faststart",f"{DEST}/Lupus-Demo-Full.mp4"], check=True)
print("full", f"{dur(DEST+'/Lupus-Demo-Full.mp4'):.1f}s")
