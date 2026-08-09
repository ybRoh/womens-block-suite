# -*- coding: utf-8 -*-
"""V네크라인.dxf → dxf-66-groundtruth.json
   행1(제도 본체)만 쓴다. 행2·행3 은 같은 도형의 사본이라 정보가 없다.
   로컬좌표: 뒤 = CB 에서 옆선쪽 +x, 위 기준선에서 아래 +y
             앞 = CF 에서 옆선쪽 +x(왼쪽 자락은 -x), 같은 기준선에서 아래 +y
"""
import sys, math, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxfdump import read_dxf, entities, gf, gv

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/Users/ybr/Downloads/V네크라인.dxf'
SIZE = sys.argv[2] if len(sys.argv) > 2 else '66호'
BACKLEN = {'44호': 36.5, '55호': 37.0, '66호': 37.5, '77호': 38.0, '88호': 38.5}[SIZE]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'dxf-%s-groundtruth.json' % SIZE.replace('호', ''))

ents = entities(read_dxf(SRC))

def find_frame():
    """기준선 자동 검출 — 다른 호수 도면도 바로 읽으려고.
       · 허리선 = 가장 긴 수평선 (앞면 허리선 = 옆선x × 2, 자락이라 제일 길다)
       · 앞중심 = 그 선의 중점 (자락이 앞중심 기준 좌우 같은 폭)
       · 뒤중심 = 오른쪽에서 길이가 등길이쯤 되는 수직선의 x
       · 상단 기준선 = 허리선 + 등길이 """
    hor, ver = [], []
    for e in ents:
        if e['type'] != 'LINE':
            continue
        x1, y1, x2, y2 = gf(e, 10), gf(e, 20), gf(e, 11), gf(e, 21)
        if abs(y1 - y2) < 1e-6:
            hor.append((abs(x2 - x1), y1, min(x1, x2), max(x1, x2)))
        elif abs(x1 - x2) < 1e-6:
            ver.append((abs(y2 - y1), x1, min(y1, y2)))
    if not hor or not ver:
        raise SystemExit('기준선을 못 찾았습니다 — 좌표를 직접 넣으세요')
    # 도면에 같은 길이(옆선x × 2)의 수평선이 여러 개다 —
    #   행1(제도 본체)에 허리선과 자락 끝 안내선 둘, 행3(완성 조각 사본)에 허리선 하나.
    #   ① 가장 긴 것들만 추리고 ② 제일 위 행(y 큰 쪽)을 고른 뒤 ③ 그 행의 아래쪽이 허리선.
    mx = max(h[0] for h in hor)
    cand_h = [h for h in hor if h[0] > mx - 0.05]
    top_y = max(h[1] for h in cand_h)
    row1 = [h for h in cand_h if top_y - h[1] < 20]
    wl_len, wl, x0, x1_ = min(row1, key=lambda h: h[1])
    cf = (x0 + x1_) / 2
    cand = [v for v in ver if abs(v[0] - (BACKLEN + 0.3)) < 0.6 and v[1] > cf + 5]
    if not cand:
        cand = [v for v in ver if abs(v[0] - BACKLEN) < 1.0 and v[1] > cf + 5]
    if not cand:
        raise SystemExit('뒤중심 수직선(길이 ≈ 등길이 %.1f)을 못 찾았습니다' % BACKLEN)
    cb = max(cand, key=lambda v: v[1])[1]
    return cb, cf, wl + BACKLEN, wl, wl_len

CB, CF, TOP, WL, WLLEN = find_frame()
print('기준선 자동 검출 — CB %.3f · CF %.3f · 상단 %.3f · 허리 %.3f (허리선 길이 %.2f = 옆선x × 2)'
      % (CB, CF, TOP, WL, WLLEN))

def collect():
    out = []; i = 0
    while i < len(ents):
        e = ents[i]; t = e['type']
        if t == 'LINE':
            out.append({'k':'LINE','p':[(gf(e,10),gf(e,20)),(gf(e,11),gf(e,21))]}); i += 1
        elif t == 'LWPOLYLINE':
            xs=[float(v) for c,v in e['g'] if c==10]; ys=[float(v) for c,v in e['g'] if c==20]
            out.append({'k':'LW','p':list(zip(xs,ys))}); i += 1
        elif t == 'POLYLINE':
            pts=[]; j=i+1
            while j < len(ents) and ents[j]['type'] in ('VERTEX','SEQEND'):
                if ents[j]['type']=='SEQEND': j+=1; break
                if (int(float(gv(ents[j],70,'0') or 0)) & 16) == 0:
                    pts.append((gf(ents[j],10), gf(ents[j],20)))
                j += 1
            out.append({'k':'PL','p':pts}); i = j
        elif t == 'POINT':
            out.append({'k':'PT','p':[(gf(e,10),gf(e,20))]}); i += 1
        elif t == 'ARC':
            c=(gf(e,10),gf(e,20)); r=gf(e,40); a0=gf(e,50); a1=gf(e,51)
            n=24; pts=[(c[0]+r*math.cos(math.radians(a0+(a1-a0)*k/n)),
                        c[1]+r*math.sin(math.radians(a0+(a1-a0)*k/n))) for k in range(n+1)]
            out.append({'k':'ARC','p':pts,'c':c,'r':r,'a0':a0,'a1':a1}); i += 1
        else: i += 1
    return [o for o in out if o['p']]

IT = collect()
def row1(o): return all(1655 <= p[1] <= 1705 for p in o['p'])
IT = [o for o in IT if row1(o)]

def isBack(o): return all(p[0] >= 1990 for p in o['p'])
def lb(p): return [round(CB - p[0], 4), round(TOP - p[1], 4)]
def lf(p): return [round(p[0] - CF, 4), round(TOP - p[1], 4)]
def arclen(q): return round(sum(math.dist(q[i], q[i+1]) for i in range(len(q)-1)), 4)

# ── 이름표 ────────────────────────────────────────────────────────────
NAME = {   # (side, 시작점 로컬, 끝점 로컬) 근사 매칭
 ('back', 17): '뒷목둘레', ('back', 32): '뒤 목둘레 안단선',
 ('back', 65): '뒤 암홀',  ('back', 127): '뒤 암홀 안단선',
 ('front', 25): None,      ('front', 107): '앞 암홀 안단선',
 ('front', 57): '앞 암홀',  ('front', 25*2): None,
}

curves, lines, points, arcs = [], [], [], []
for o in IT:
    side = 'back' if isBack(o) else 'front'
    L = lb if side == 'back' else lf
    q = [L(p) for p in o['p']]
    if o['k'] in ('LINE',):
        lines.append({'side': side, 'local': q, 'len': arclen(q)})
    elif o['k'] == 'PT':
        points.append({'side': side, 'local': q[0]})
    elif o['k'] == 'ARC':
        arcs.append({'side': side, 'local': q, 'arc': arclen(q), 'r': round(o['r'], 4)})
    else:
        nm = NAME.get((side, len(q)))
        if nm is None and side == 'front' and len(q) == 25:
            nm = 'V 네크라인' if abs(q[0][1] - 28.2) < 0.2 else 'V 네크라인 안단선'
        curves.append({'name': nm or ('%s-%d' % (side, len(q))), 'side': side,
                       'n': len(q), 'arc': arclen(q), 'local': q})

curves.sort(key=lambda c: (c['side'], c['name']))
lines.sort(key=lambda l: (l['side'], -l['len']))

doc = {
 'note': ('%s V 네크라인 원본 DXF — 행1(제도 본체)에서 뽑은 좌표. 스플라인 fit 정점만.'
          ' 앞: CF=%g, 뒤: CB=%g, 공통 상단 기준선 y=%g, 허리선 y=%g (원본 도면 좌표)'
          % (SIZE, CF, CB, TOP, WL)),
 'size': SIZE,
 'ref': {'CB': CB, 'CF': CF, 'TOP': TOP, 'WL_DXF': WL,
         'backLen': round(TOP - WL, 4),
         'waistLineLen': round(WLLEN, 4)},
 'curves': curves, 'lines': lines, 'points': points, 'arcs': arcs,
}
json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('wrote', OUT)
for c in curves:
    print('  %-18s %-5s n=%-4d arc=%8.3f  (%7.3f,%7.3f) -> (%7.3f,%7.3f)'
          % (c['name'], c['side'], c['n'], c['arc'], c['local'][0][0], c['local'][0][1],
             c['local'][-1][0], c['local'][-1][1]))
print('\n-- lines --')
for l in lines:
    print('  %-5s (%8.3f,%8.3f) -> (%8.3f,%8.3f)  %7.3f'
          % (l['side'], l['local'][0][0], l['local'][0][1], l['local'][1][0], l['local'][1][1], l['len']))
print('\n-- points --')
for p in points: print('  %-5s (%7.3f,%7.3f)' % (p['side'], p['local'][0], p['local'][1]))
print('\n-- arcs --')
for a in arcs: print('  %-5s r=%8.3f  (%7.3f,%7.3f) -> (%7.3f,%7.3f)  arc=%6.3f'
                     % (a['side'], a['r'], a['local'][0][0], a['local'][0][1], a['local'][-1][0], a['local'][-1][1], a['arc']))
