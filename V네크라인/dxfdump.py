#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""숙녀복기본원형1.dxf 전체 엔티티 덤프 (LINE / LWPOLYLINE / POLYLINE / ARC / CIRCLE / TEXT / MTEXT)"""
import sys, math, json

def read_dxf(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        raw = f.read().splitlines()
    pairs = []
    i = 0
    while i + 1 < len(raw):
        code = raw[i].strip()
        val = raw[i+1]
        try:
            code = int(code)
        except ValueError:
            i += 2
            continue
        pairs.append((code, val.strip()))
        i += 2
    return pairs

def entities(pairs):
    # ENTITIES 섹션만
    out = []
    in_ent = False
    cur = None
    for code, val in pairs:
        if code == 2 and val == 'ENTITIES':
            in_ent = True
            continue
        if code == 0 and val == 'ENDSEC' and in_ent:
            if cur: out.append(cur)
            cur = None
            in_ent = False
            continue
        if not in_ent:
            continue
        if code == 0:
            if cur: out.append(cur)
            cur = {'type': val, 'g': []}
        elif cur is not None:
            cur['g'].append((code, val))
    if cur: out.append(cur)
    return out

def gv(e, code, default=None, idx=0):
    hits = [v for c, v in e['g'] if c == code]
    if len(hits) > idx:
        return hits[idx]
    return default

def gf(e, code, default=None, idx=0):
    v = gv(e, code, None, idx)
    if v is None: return default
    try: return float(v)
    except ValueError: return default

def main(path):
    pairs = read_dxf(path)
    ents = entities(pairs)
    from collections import Counter
    print('== 엔티티 종류 ==')
    for t, n in Counter(e['type'] for e in ents).most_common():
        print('  %-14s %d' % (t, n))
    print()

    layers = Counter(gv(e, 8, '?') for e in ents)
    print('== 레이어 ==')
    for l, n in layers.most_common():
        print('  %-20s %d' % (l, n))
    print()

    print('== TEXT / MTEXT ==')
    for e in ents:
        if e['type'] in ('TEXT', 'MTEXT'):
            x, y = gf(e, 10, 0), gf(e, 20, 0)
            txt = ' '.join(v for c, v in e['g'] if c in (1, 3))
            print('  (%9.3f, %9.3f)  %s' % (x, y, txt))
    print()

    print('== LINE ==')
    ls = []
    for e in ents:
        if e['type'] == 'LINE':
            x1, y1 = gf(e, 10, 0), gf(e, 20, 0)
            x2, y2 = gf(e, 11, 0), gf(e, 21, 0)
            ls.append((x1, y1, x2, y2, gv(e, 8, '?')))
    ls.sort()
    for x1, y1, x2, y2, lay in ls:
        print('  (%9.3f,%9.3f) -> (%9.3f,%9.3f)  len=%8.4f  [%s]'
              % (x1, y1, x2, y2, math.hypot(x2-x1, y2-y1), lay))
    print()

    print('== POLYLINE 계열 ==')
    for k, e in enumerate(ents):
        if e['type'] in ('LWPOLYLINE', 'POLYLINE'):
            xs = [float(v) for c, v in e['g'] if c == 10]
            ys = [float(v) for c, v in e['g'] if c == 20]
            if not xs: continue
            L = sum(math.hypot(xs[i+1]-xs[i], ys[i+1]-ys[i]) for i in range(len(xs)-1))
            print('  #%-3d n=%-4d (%9.3f,%9.3f)->(%9.3f,%9.3f) arc=%8.4f [%s]'
                  % (k, len(xs), xs[0], ys[0], xs[-1], ys[-1], L, gv(e, 8, '?')))
    print()

    print('== ARC / CIRCLE ==')
    for e in ents:
        if e['type'] in ('ARC', 'CIRCLE'):
            print('  %s c=(%9.3f,%9.3f) r=%8.4f  a=%s..%s [%s]'
                  % (e['type'], gf(e, 10, 0), gf(e, 20, 0), gf(e, 40, 0),
                     gv(e, 50, '-'), gv(e, 51, '-'), gv(e, 8, '?')))

if __name__ == '__main__':
    main(sys.argv[1])
