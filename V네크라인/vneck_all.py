# -*- coding: utf-8 -*-
"""V네크라인.dxf 전 엔티티를 좌표 그대로 덤프 (POLYLINE 은 VERTEX 까지)"""
import sys, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxfdump import read_dxf, entities, gf, gv

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/ybr/Downloads/V네크라인.dxf'
ents = entities(read_dxf(SRC))

def collect():
    out = []; i = 0
    while i < len(ents):
        e = ents[i]; t = e['type']
        if t == 'LINE':
            out.append(('LINE', [(gf(e,10),gf(e,20)),(gf(e,11),gf(e,21))])); i += 1
        elif t == 'LWPOLYLINE':
            xs=[float(v) for c,v in e['g'] if c==10]; ys=[float(v) for c,v in e['g'] if c==20]
            out.append(('LW', list(zip(xs,ys)))); i += 1
        elif t == 'POLYLINE':
            pts=[]; j=i+1
            while j < len(ents) and ents[j]['type'] in ('VERTEX','SEQEND'):
                if ents[j]['type']=='SEQEND': j+=1; break
                if (int(float(gv(ents[j],70,'0') or 0)) & 16) == 0:
                    pts.append((gf(ents[j],10), gf(ents[j],20)))
                j += 1
            out.append(('PL', pts)); i = j
        elif t == 'POINT':
            out.append(('PT', [(gf(e,10),gf(e,20))])); i += 1
        elif t == 'ARC':
            c=(gf(e,10),gf(e,20)); r=gf(e,40); a0=gf(e,50); a1=gf(e,51)
            pts=[(c[0]+r*math.cos(math.radians(a)), c[1]+r*math.sin(math.radians(a)))
                 for a in (a0, (a0+a1)/2, a1)]
            out.append(('ARC', pts)); i += 1
        elif t == 'TEXT':
            out.append(('TXT_'+' '.join(v for c,v in e['g'] if c==1), [(gf(e,10),gf(e,20))])); i += 1
        else:
            i += 1
    return out

IT = [(k,p) for k,p in collect() if p]

# 행 구분: y 중심
def row(pts):
    ym = sum(p[1] for p in pts)/len(pts)
    if ym > 1650: return 1
    if ym > 1600: return 2
    return 3

def arclen(q): return sum(math.dist(q[i],q[i+1]) for i in range(len(q)-1))

ORIG = {  # (원점x, 원점y, 이름)  x 는 오른쪽(CF/CB) 기준 → 왼쪽 +, y 는 위쪽 기준 → 아래 +
    ('B',1): (2022.077, 1695.171), ('F',1): (1985.274, 1695.471),
    ('B',2): (2012.185, 1612.988), ('F',2): (1985.274, 1646.0),
    ('B',3): (2012.185, 1612.988), ('F',3): (1980.820, 1613.023),
}

for r in (1,2,3):
    print('\n' + '='*70)
    print('ROW %d' % r)
    print('='*70)
    items = [(k,p) for k,p in IT if row(p)==r]
    items.sort(key=lambda kp: (-max(x for x,y in kp[1]), -max(y for x,y in kp[1])))
    for k,q in items:
        if k.startswith('TXT'):
            print('  %-8s (%9.3f,%9.3f)  %s' % ('TEXT', q[0][0], q[0][1], k[4:])); continue
        L = arclen(q)
        head = '  %-4s n=%-3d' % (k, len(q))
        if len(q) <= 3:
            print(head + '  ' + ' -> '.join('(%9.3f,%9.3f)'%p for p in q) + '   len=%8.4f' % L)
        else:
            print(head + '  (%9.3f,%9.3f) -> (%9.3f,%9.3f)  arc=%8.4f' % (q[0][0],q[0][1],q[-1][0],q[-1][1], L))
            step = max(1, len(q)//10)
            print('        ' + ' '.join('(%.2f,%.2f)'%p for p in q[::step]))
