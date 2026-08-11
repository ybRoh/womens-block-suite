import collections, math, json
P="/Users/ybr/Downloads/토르소원형프린세스라인.dxf"
L=[x.strip() for x in open(P,encoding='utf-8',errors='replace').read().splitlines()]
pairs=[(L[i],L[i+1]) for i in range(0,len(L)-1,2)]
ents=[];cur=None
for c,v in pairs:
    if c=='0':
        if cur: ents.append(cur)
        cur={'type':v,'g':collections.defaultdict(list)}
    elif cur is not None: cur['g'][c].append(v)
if cur: ents.append(cur)
def g1(e,c,d=None):
    v=e['g'].get(c); return v[0] if v else d
out=[];i=0
while i<len(ents):
    e=ents[i]; t=e['type']
    if t=='POLYLINE':
        pts=[];j=i+1
        while j<len(ents) and ents[j]['type']=='VERTEX':
            pts.append([float(g1(ents[j],'10',0)),float(g1(ents[j],'20',0))]);j+=1
        out.append({'t':'POLY','c':g1(e,'62','?'),'p':pts});i=j
    elif t=='LWPOLYLINE':
        xs=[float(v) for v in e['g'].get('10',[])];ys=[float(v) for v in e['g'].get('20',[])]
        out.append({'t':'LWPOLY','c':g1(e,'62','?'),'p':[[a,b] for a,b in zip(xs,ys)]});i+=1
    elif t=='LINE':
        out.append({'t':'LINE','c':g1(e,'62','?'),'p':[[float(g1(e,'10',0)),float(g1(e,'20',0))],[float(g1(e,'11',0)),float(g1(e,'21',0))]]});i+=1
    elif t=='POINT':
        out.append({'t':'POINT','c':g1(e,'62','?'),'p':[[float(g1(e,'10',0)),float(g1(e,'20',0))]]});i+=1
    elif t=='MTEXT':
        tx=' '.join(e['g'].get('1',[])+e['g'].get('3',[]))
        out.append({'t':'TEXT','c':g1(e,'62','?'),'p':[[float(g1(e,'10',0)),float(g1(e,'20',0))]],'s':tx});i+=1
    elif t=='DIMENSION':
        out.append({'t':'DIM','c':g1(e,'62','?'),'p':[[float(g1(e,'10',0)),float(g1(e,'20',0))]],'s':g1(e,'1','')});i+=1
    else: i+=1
# bounding clusters by y band
ys=[q[1] for o in out for q in o['p']]
print("y range",min(ys),max(ys))
xs=[q[0] for o in out for q in o['p']]
print("x range",min(xs),max(xs))
json.dump(out,open('dxft.json','w'),ensure_ascii=False)
print("entities",len(out))
# cluster by y
bands=collections.Counter()
for o in out:
    for q in o['p']: bands[int(q[1]//50)*50]+=1
for k in sorted(bands): print("  y",k,"~",k+50,bands[k])
