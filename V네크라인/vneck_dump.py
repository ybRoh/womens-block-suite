import sys,math,json; sys.path.insert(0,'.')
from dxfdump import read_dxf, entities, gf
ents=entities(read_dxf('/Users/ybr/Downloads/V네크라인.dxf'))
def collect():
    out=[]; i=0
    while i<len(ents):
        e=ents[i]
        if e['type']=='LINE': out.append(('LINE',[(gf(e,10),gf(e,20)),(gf(e,11),gf(e,21))])); i+=1
        elif e['type']=='LWPOLYLINE':
            xs=[float(v) for c,v in e['g'] if c==10]; ys=[float(v) for c,v in e['g'] if c==20]
            out.append(('LW',list(zip(xs,ys)))); i+=1
        elif e['type']=='POLYLINE':
            pts=[]; j=i+1
            while j<len(ents) and ents[j]['type']=='VERTEX':
                if (int(gf(ents[j],70,0) or 0)&16)==0: pts.append((gf(ents[j],10),gf(ents[j],20)))
                j+=1
            out.append(('PL',pts)); i=j
        elif e['type']=='ARC': out.append(('ARC',[(gf(e,10),gf(e,20)),(gf(e,40),gf(e,50)),(gf(e,51),0)])); i+=1
        elif e['type']=='POINT': out.append(('PT',[(gf(e,10),gf(e,20))])); i+=1
        else: i+=1
    return out
IT=collect()
CB, TOP, WLy = 2022.08, 1695.17, 1657.37      # 뒷면: CB=오른쪽끝, 상단선, 허리선
def LB(p): return (round(CB-p[0],4), round(TOP-p[1],4))
print('== 뒷면 로컬 (CB=0, x 옆선 +, y 아래 +) ==   WL y =', round(TOP-WLy,3))
for k,pts in IT:
    if not pts: continue
    if not all(1997.0<=p[0]<=2023.5 and 1655<=p[1]<=1702 for p in pts if k!='ARC'): continue
    if k=='ARC': continue
    q=[LB(p) for p in pts]
    arc=sum(math.dist(q[i],q[i+1]) for i in range(len(q)-1))
    if k=='LINE': print('  LINE (%7.3f,%7.3f)->(%7.3f,%7.3f)  %7.3f'%(q[0][0],q[0][1],q[1][0],q[1][1],arc))
    elif k=='PT': print('  PT   (%7.3f,%7.3f)'%(q[0][0],q[0][1]))
    else:
        print('  %s n=%-4d (%7.3f,%7.3f)->(%7.3f,%7.3f) 호 %7.3f'%(k,len(q),q[0][0],q[0][1],q[-1][0],q[-1][1],arc))
        if len(q)<=40:
            for w in q[::max(1,len(q)//8)]: print('        (%7.3f,%7.3f)'%w)
