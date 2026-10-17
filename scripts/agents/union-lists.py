#!/usr/bin/env python3
# Resolve conflicts on one-line JS/TS string lists by union (HEAD order, then new entries).
import re,sys
for p in sys.argv[1:]:
    s=open(p).read()
    def fix(m):
        a,b=m.group(1).rstrip('\n'),m.group(2).rstrip('\n')
        ia=re.findall(r"'([^']+)'",a); ib=re.findall(r"'([^']+)'",b)
        extra=[x for x in ib if x not in ia]
        if not extra: return a+'\n'
        last=ia[-1]
        return a.replace("'%s'"%last, "'%s', "%last + ", ".join("'%s'"%x for x in extra),1)+'\n'
    s=re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n",fix,s,flags=re.S)
    open(p,'w').write(s)
