/* 원본 DXF 곡선에 CAL 을 맞춘다 — node calibrate.js  (결과를 engine.js 의 CAL 에 반영) */
'use strict';
var fs=require('fs'), E=require('./engine.js'), U=E.util, V=U.V;
var GT=JSON.parse(fs.readFileSync('./dxf-66-groundtruth.json','utf8'));
var C={}; GT.curves.forEach(function(c){C[c.name]=c;});
var g=E.geom(E.measuresForSize('66호'));
function dev(segs,pts){var poly=U.sampleSegs(segs,0.03),mx=0;
 pts.forEach(function(p){var b=Infinity;
  for(var i=0;i<poly.length-1;i++){var a=poly[i],c=poly[i+1];
   var dx=c[0]-a[0],dy=c[1]-a[1],L2=dx*dx+dy*dy;
   var t=L2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2:0; t=t<0?0:t>1?1:t;
   var e=Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy)); if(e<b)b=e;}
  if(b>mx)mx=b;}); return mx;}
function opt(x0,lo,hi,f,rounds){var x=x0.slice(),best=f(x),step=0.2;
 for(var R=0;R<(rounds||14);R++){var mv=true,gd=0;
  while(mv&&gd++<300){mv=false;
   for(var i=0;i<x.length;i++)for(var s2=0;s2<2;s2++){var s=s2?-step:step;
    var y=x.slice(); y[i]=Math.min(hi[i],Math.max(lo[i],y[i]+s*(hi[i]-lo[i])));
    var v=f(y); if(v<best-1e-10){best=v;x=y;mv=true;}}}
  step*=0.55;} return {x:x,v:best};}
var SS=U.splineSegs, ET=U.endTan;

/* 뒷목둘레 : 목옆점 → 중간점 → 뒤중심(수평 도착) */
var gtBN=C['뒷목둘레'].local;
function bn(p){var Mp=[g.SNPb[0]*p[0], g.SNPb[1]*(1-p[1])];
 return SS([g.SNPb,Mp,g.BNP], ET(V.sub(g.BNP,g.SNPb),p[2]), ET([-1,0],p[3]));}
var r1=opt([0.62,0.30,1,1],[0.2,0.0,0.2,0.2],[0.95,0.9,3,3],function(p){return dev(bn(p),gtBN);},18);
console.log('backNeck  { mx: %s, my: %s, k0: %s, k1: %s }  편차 %s · 길이 %s (도면 %s)',
 r1.x[0].toFixed(4),r1.x[1].toFixed(4),r1.x[2].toFixed(4),r1.x[3].toFixed(4),
 r1.v.toFixed(4), U.sLen(bn(r1.x)).toFixed(3), C['뒷목둘레'].arc);

/* 앞목둘레 : 앞중심(수평 출발) → 대각선 2/3 + 0.3 → 목옆점 */
var gtFN=C['앞목둘레'].local, nw=g.nw, dep=g.FNP[1];
function fn(p){var P0=[nw*2/3,dep*2/3], u=V.norm([nw,dep]);
 var Pm=V.add(P0,V.mul(u,p[0]));
 return SS([g.FNP,Pm,g.SNPf], ET([1,0],p[1]), ET(V.sub(g.SNPf,Pm),p[2]));}
var r2=opt([0.3,1,1],[0.0,0.2,0.2],[1.0,3,3],function(p){return dev(fn(p),gtFN);},18);
console.log('frontNeck { out: %s, k0: %s, k1: %s }  편차 %s · 길이 %s (도면 %s)',
 r2.x[0].toFixed(4),r2.x[1].toFixed(4),r2.x[2].toFixed(4),
 r2.v.toFixed(4), U.sLen(fn(r2.x)).toFixed(3), C['앞목둘레'].arc);

/* 암홀 — 어깨점 → 품선 1/3 → 품선 2/3 → 오목점 → 겨드랑(수평 도착) */
function arm(SP,pitchX,U2,BL,topY,p){
 var y1=topY+(BL-topY)/3, y2=topY+(BL-topY)*2/3;
 var P1=[pitchX+p[0],y1], P2=[pitchX+p[1],y2];
 var H=[U2[0]-p[2]*(U2[0]-pitchX), BL-p[3]*(BL-y2)];
 return SS([SP,P1,P2,H,U2], ET(V.sub(P1,SP),p[4]), ET([1,0],p[5]));}
var gtBA=C['뒤 암홀 (어깨~등품점)'].local
   .concat(C['뒤 암홀 (중간~등품점)'].local, C['뒤 암홀 (겨드랑~중간)'].local);
var r3=opt([0.2,0,0.6,0.3,1,1],[-0.5,-0.5,0.2,0.0,0.2,0.2],[1.5,0.5,1.2,0.9,3,3],
 function(p){return dev(arm(g.SPb,g.bPitchX,g.Ub,g.BL,0.671,p),gtBA);},20);
console.log('backArm   [%s]  편차 %s · 길이 %s (도면 23.94)',
 r3.x.map(function(v){return v.toFixed(4);}).join(', '), r3.v.toFixed(4),
 U.sLen(arm(g.SPb,g.bPitchX,g.Ub,g.BL,0.671,r3.x)).toFixed(3));

var gtFA=C['앞 암홀'].local;
var r4=opt([0.2,0,0.6,0.3,1,1],[-0.5,-0.5,0.2,0.0,0.2,0.2],[1.5,0.5,1.2,0.9,3,3],
 function(p){return dev(arm(g.SPf,g.fPitchX,g.Uf,g.BL,g.SPf[1],p),gtFA);},20);
console.log('frontArm  [%s]  편차 %s · 길이 %s (도면 %s)',
 r4.x.map(function(v){return v.toFixed(4);}).join(', '), r4.v.toFixed(4),
 U.sLen(arm(g.SPf,g.fPitchX,g.Uf,g.BL,g.SPf[1],r4.x)).toFixed(3), C['앞 암홀'].arc);
