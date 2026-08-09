# -*- coding: utf-8 -*-
"""숙녀복기본원형2.dxf 전 엔티티를 로컬좌표로 (앞: CF=1961.299 · 뒤: CB=2034.310, 각자 상단 기준)"""
import sys, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxfdump import read_dxf, entities, gf, gv

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/ybr/Downloads/숙녀복기본원형2.dxf'
ents = entities(read_dxf(SRC))
CF, TOPF = 1961.299, 1327.550          # 앞 중심 · 앞 상단(앞길이 42 의 시작)
CB, TOPB = 2034.310, 1323.550          # 뒤 중심 · 뒤 상단(등길이 38 의 시작)
WL = 1285.550

def collect():
    out=[]; i=0
    while i < len(ents):
        e=ents[i]; t=e['type']
        if t=='LINE': out.append(('LINE',[(gf(e,10),gf(e,20)),(gf(e,11),gf(e,21))])); i+=1
        elif t=='LWPOLYLINE':
            xs=[float(v) for c,v in e['g'] if c==10]; ys=[float(v) for c,v in e['g'] if c==20]
            out.append(('LW',list(zip(xs,ys)))); i+=1
        elif t=='POLYLINE':
            pts=[]; j=i+1
            while j<len(ents) and ents[j]['type'] in ('VERTEX','SEQEND'):
                if ents[j]['type']=='SEQEND': j+=1; break
                if (int(float(gv(ents[j],70,'0') or 0)) & 16)==0: pts.append((gf(ents[j],10),gf(ents[j],20)))
                j+=1
            out.append(('PL',pts)); i=j
        elif t=='POINT': out.append(('PT',[(gf(e,10),gf(e,20))])); i+=1
        elif t=='TEXT': out.append(('TXT '+' '.join(v for c,v in e['g'] if c==1),[(gf(e,10),gf(e,20))])); i+=1
        else: i+=1
    return [o for o in out if o[1]]

def side(p): return 'back' if p[0][0] > 2000 else 'front'
def loc(p, s): return (round((CB-p[0]) if s=='back' else (p[0]-CF),3),
                       round((TOPB-p[1]) if s=='back' else (TOPF-p[1]),3))
def L(q): return round(sum(math.dist(q[i],q[i+1]) for i in range(len(q)-1)),4)

for s in ('front','back'):
    print('\n'+'='*64+'\n '+('앞면 (CF %.3f · 상단 %.3f)'%(CF,TOPF) if s=='front' else '뒷면 (CB %.3f · 상단 %.3f)'%(CB,TOPB))+'\n'+'='*64)
    items=[(k,p) for k,p in collect() if side(p)==s]
    for k,p in items:
        q=[loc(x,s) for x in p]
        if k.startswith('TXT'): print('  TEXT  (%7.3f,%7.3f) %s'%(q[0][0],q[0][1],k[4:])); continue
        if len(q)<=2: print('  %-4s (%8.3f,%8.3f) -> (%8.3f,%8.3f)  len %8.4f'%(k,q[0][0],q[0][1],q[-1][0],q[-1][1],L(q)))
        else:
            print('  %-4s n=%-3d (%8.3f,%8.3f) -> (%8.3f,%8.3f)  arc %8.4f'%(k,len(q),q[0][0],q[0][1],q[-1][0],q[-1][1],L(q)))
            st=max(1,len(q)//8); print('        '+' '.join('(%.2f,%.2f)'%p2 for p2 in q[::st]))
print('\n허리선 y(local): 앞 %.3f · 뒤 %.3f'%(TOPF-WL, TOPB-WL))
