from telnet_client import *
import re
def txt(b):
    t=clean(b)
    return '\n'.join(re.sub(r'\s{3,}','  |  ',l.strip()) for l in t.splitlines() if re.search(r'[A-Za-z0-9]{3}',l) and not re.search(r'[▀▄█░▒▓]{3}',l))
t=T(); t.read(3); t.send('\r'); t.read(2)
t.send('\r'); t.read(2); t.send('zerocool\r'); t.read(1.5); t.send('correct-horse-9\r'); t.read(3)
for i in range(2): t.send('\r'); t.read(2)
t.send('\r'); print('--- after yeah ---'); print(txt(t.read(4)))
t.send('\r'); r=t.read(4)  # newscan yes -> list
t.send('\r'); t.read(3)
t.send('\r'); r=t.read(5)  # open message
s=r.decode('utf-8','ignore')
print(txt(r))
print('utf8 café:', 'café' in s, '| ✓:', '✓' in s, '| 日本:', '日本' in s, '| First post:', 'First post' in s)
i=s.find('UTF-8'); print(repr(s[i-5:i+60]) if i>=0 else 'no UTF-8 marker in output')
