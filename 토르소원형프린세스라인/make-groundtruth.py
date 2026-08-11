#!/usr/bin/env python3
"""토르소 원형 프린세스라인 — 원본 DXF 66호 정답지 생성.
   원본 : ~/Downloads/토르소원형프린세스라인.dxf  →  dxf-parsed.json (dxf-parse.py)
   출력 : dxf-66-groundtruth.json
   대역 : C(y 1560~1659) = 전체 제도. B 와 곡선이 완전히 같고 치수선이 더 많다.
   원점 : 앞 = 앞중심 x 1588.247 × 상단 기준선 y 1638.251
          뒤 = 뒤중심 x 1664.040 × 같은 상단선.  x 옆으로 +, y 아래 +. cm."""
import json, math, statistics, os
HERE = os.path.dirname(os.path.abspath(__file__))
E = json.load(open(os.path.join(HERE, 'dxf-parsed.json'), encoding='utf-8'))
FO = (1588.247, 1638.251); BO = (1664.040, 1638.251)
def tf(p): return [round(p[0] - FO[0], 4), round(FO[1] - p[1], 4)]
def tb(p): return [round(BO[0] - p[0], 4), round(BO[1] - p[1], 4)]
def alen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
def trim(p):
    """중복점 제거 + 꼬리(다른 대역의 성근 점열)가 붙어 있으면 잘라낸다."""
    q = [p[0]]
    for r in p[1:]:
        if math.dist(q[-1], r) > 1e-6: q.append(r)
    if len(q) < 4: return q
    g = [math.dist(q[i], q[i + 1]) for i in range(len(q) - 1)]
    for i in range(2, len(g)):
        if g[i] > 3 * statistics.median(g[:i]) and g[i] > 3.0: return q[:i + 1]
    return q
band = [o for o in E if 1560 <= sum(y for _, y in o['p']) / len(o['p']) < 1660]
cs = sorted([o for o in band if o['t'] in ('POLY', 'LWPOLY')], key=lambda o: -alen(o['p']))
out = {
  'note': ('토르소 원형 프린세스라인 원본 DXF 66호 정답지. B=87.6 · H=97.04 · 등길이 37.5 · 옷길이 58.5. '
           '좌표: 앞 = 앞중심선 x 상단 기준선 · 뒤 = 뒤중심선 x 같은 상단선. x 옆으로 +, y 아래 +. cm. '
           'DXF 대역 C(y 1560~1659)에서 추출 — B 대역과 곡선이 완전히 같고 치수선이 더 많다.'),
  'ref': {'B': 87.6, 'H': 97.04, 'backLen': 37.5, 'coatLen': 58.5,
          'delta': 21.0,                      # 옷길이 − 등길이 = 밑단까지
          'BL': 21.9, 'frontW_half': 17.15, 'neckW': 7.3,
          'frontHalf': 23.4,                  # B/4 + 여유분 1.5
          'hipEase1': 25.26,                  # H/4 + 1
          'origin_front_dxf': list(FO), 'origin_back_dxf': list(BO)},
  'curves': []}
for o in cs:
    p = trim(o['p'])
    cx = sum(q[0] for q in p) / len(p)
    fr = 'front' if cx < (FO[0] + BO[0]) / 2 else 'back'
    T = tf if fr == 'front' else tb
    lp = [T(q) for q in p]
    out['curves'].append({'name': '', 'frame': fr, 'color': o['c'],
                          'arc': round(alen(lp), 4), 'n': len(lp), 'local': lp})
json.dump(out, open(os.path.join(HERE, 'dxf-66-groundtruth.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
for i, c in enumerate(out['curves']):
    print(f"{i:2} {c['frame']:5} c={c['color']:>2} n={c['n']:3} 호={c['arc']:7.3f}  "
          f"{c['local'][0]} → {c['local'][-1]}")
