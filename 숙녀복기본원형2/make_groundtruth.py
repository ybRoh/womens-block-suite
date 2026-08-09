# -*- coding: utf-8 -*-
"""숙녀복기본원형2.dxf → dxf-66-groundtruth.json  (앞: CF·앞상단 / 뒤: CB·뒤상단 로컬)"""
import sys, math, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxfdump import read_dxf, entities, gf, gv

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/ybr/Downloads/숙녀복기본원형2.dxf'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dxf-66-groundtruth.json')
ents = entities(read_dxf(SRC))

def frame():
    """앞 CF·상단 = 길이 42 세로선 / 뒤 CB·상단 = 길이 38 세로선 / 허리선 = 공통 아래"""
    ver = []
    for e in ents:
        if e['type'] != 'LINE': continue
        x1,y1,x2,y2 = gf(e,10),gf(e,20),gf(e,11),gf(e,21)
        if abs(x1-x2) < 1e-6: ver.append((abs(y2-y1), x1, min(y1,y2), max(y1,y2)))
    ver.sort(reverse=True)
    f = ver[0]; b = [v for v in ver[1:] if abs(v[1]-f[1]) > 5][0]
    if f[1] > b[1]: f, b = b, f                     # 앞이 왼쪽
    return f[1], f[3], b[1], b[3], f[2], f[0], b[0]  # CF, TOPF, CB, TOPB, WL, 앞길이, 등길이

CF, TOPF, CB, TOPB, WLy, FRONTLEN, BACKLEN = frame()

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
        else: i+=1
    return [o for o in out if o[1]]

def side(p): return 'back' if p[0][0] > (CF+CB)/2 else 'front'
def loc(p,s): return [round((CB-p[0]) if s=='back' else (p[0]-CF),4),
                      round((TOPB-p[1]) if s=='back' else (TOPF-p[1]),4)]
def L(q): return round(sum(math.dist(q[i],q[i+1]) for i in range(len(q)-1)),4)

curves, lines, points = [], [], []
for k,p in collect():
    s = side(p); q = [loc(x,s) for x in p]
    if k=='PT': points.append({'side':s,'local':q[0]})
    elif len(q)<=2: lines.append({'side':s,'local':q,'len':L(q)})
    else: curves.append({'side':s,'n':len(q),'arc':L(q),'local':q})

# 곡선 이름 붙이기 — 시작·끝 좌표로 판별
def name_of(c):
    s,a,b,n = c['side'], c['local'][0], c['local'][-1], c['n']
    if s=='front':
        if n==4: return '앞목 사각'
        if abs(a[1]-7.9)<0.1 and abs(b[0]-7.3)<0.1: return '앞목둘레'
        if n>40: return '앞 암홀'
    else:
        if abs(a[0]-7.8)<0.1: return '뒷목둘레'
        if abs(a[1]-1.0)<0.1: return '뒤 암홀 (어깨~등품점)'
        if abs(a[0]-23.9)<0.1: return '뒤 암홀 (겨드랑~중간)'
        return '뒤 암홀 (중간~등품점)'
    return s+'-'+str(n)
for c in curves: c['name'] = name_of(c)
curves.sort(key=lambda c:(c['side'], c['name']))
lines.sort(key=lambda l:(l['side'], -l['len']))

json.dump({
 'note': ('숙녀복 기본원형 II 원본 DXF — 제도 2(완성 조각). 앞은 CF·앞상단, 뒤는 CB·뒤상단 로컬.'
          ' 앞 상단이 뒤 상단보다 %g 위(앞 등길이 차이치수).' % (FRONTLEN-BACKLEN)),
 'ref': {'CF':CF,'TOPF':TOPF,'CB':CB,'TOPB':TOPB,'WL_DXF':WLy,
         'frontLen':round(FRONTLEN,4),'backLen':round(BACKLEN,4),
         'frontBackDiff':round(FRONTLEN-BACKLEN,4)},
 'curves':curves,'lines':lines,'points':points},
 open(OUT,'w',encoding='utf-8'), ensure_ascii=False, indent=1)
print('기준선 — CF %.3f 상단 %.3f (앞길이 %.1f) · CB %.3f 상단 %.3f (등길이 %.1f) · 차이 %.1f'
      % (CF,TOPF,FRONTLEN,CB,TOPB,BACKLEN,FRONTLEN-BACKLEN))
for c in curves: print('  %-22s %-5s n=%-4d arc=%8.3f  (%7.3f,%7.3f) -> (%7.3f,%7.3f)'
                       % (c['name'],c['side'],c['n'],c['arc'],c['local'][0][0],c['local'][0][1],c['local'][-1][0],c['local'][-1][1]))
