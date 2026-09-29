import socket, time, re, sys
IAC,DONT,DO,WONT,WILL,SB,SE=255,254,253,252,251,250,240
def clean(b):
    t=b.decode('utf-8','ignore')
    t=re.sub(r'\x1b\[[0-9;?]*[A-Za-z]','',t)
    return re.sub(r'[\x00-\x08\x0b-\x1f]','',t)
class T:
    def __init__(s,host='127.0.0.1',port=8888):
        s.s=socket.create_connection((host,port)); s.s.settimeout(0.5); s.buf=b''
    def read(s,wait=1.5):
        end=time.time()+wait; out=b''
        while time.time()<end:
            try: d=s.s.recv(4096)
            except socket.timeout: continue
            if not d: break
            i=0; clean_=b''
            while i<len(d):
                if d[i]==IAC and i+2<len(d) and d[i+1] in (DO,DONT,WILL,WONT):
                    cmd=d[i+1]; opt=d[i+2]
                    if cmd==DO and opt==31: s.s.sendall(bytes([IAC,WILL,31,IAC,SB,31,0,80,0,24,IAC,SE]))
                    elif cmd==DO and opt==24: s.s.sendall(bytes([IAC,WILL,24]))
                    elif cmd==DO: s.s.sendall(bytes([IAC,WONT,opt]))
                    elif cmd==WILL: s.s.sendall(bytes([IAC,DONT,opt]))
                    i+=3
                elif d[i]==IAC and i+1<len(d) and d[i+1]==SB:
                    j=d.find(bytes([IAC,SE]),i)
                    if d[i+2]==24: s.s.sendall(bytes([IAC,SB,24,0])+b'xterm'+bytes([IAC,SE]))
                    i=(j+2) if j>=0 else len(d)
                else: clean_+=d[i:i+1]; i+=1
            for _ in range(clean_.count(b'\x1b[0c')): s.s.sendall(b'\x1b[?1;2c')
            for _ in range(clean_.count(b'\x1b[6n')): s.s.sendall(b'\x1b[24;80R')
            out+=clean_; end=time.time()+0.6
        return out
    def send(s,txt): s.s.sendall(txt.encode() if isinstance(txt,str) else txt)
def show(tag,b):
    t=clean(b); t='\n'.join(l.rstrip() for l in t.splitlines() if l.strip())
    print(f'--- {tag} ---\n{t[-900:]}')
