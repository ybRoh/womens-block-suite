  function capGeom(AH, AHb, AHf, capReduce, apexShift, capHIn, padIn, botBIn) {
    var capH = (capHIn === undefined) ? AH / 4 + 2 : capHIn;   // ★ 이 모듈은 AH/3 + 패드분
    /* ★ AH 대각선은 **상단선이 아니라 패드점 (0, 패드분) 에서** 내린다 — 정답지 확인.
       패드분은 소매산을 위로 밀어 올릴 뿐 대각선(=암홀 길이)의 수직변이 아니다.
       상단선에서 내리면 66호 소매폭이 1.87 좁아진다. */
    var pad = padIn || 0, vert = capH - pad;
    var diagB = AHb - capReduce, diagF = AHf - capReduce;    // 대각선 = 각 암홀 길이
    var halfB = Math.sqrt(Math.max(diagB * diagB - vert * vert, 0.01));
    var halfF = Math.sqrt(Math.max(diagF * diagF - vert * vert, 0.01));
    var apex = [apexShift, 0], bicepB = [-halfB, capH], bicepF = [halfF, capH];

    // 마크 — 상단은 중심선 상단점에서 수평 AH/8, 하단은 소매폭 끝에서 안쪽으로
    var markTopB = [-AH / 8, 0], markTopF = [AH / 8, 0];
    /* 뒤 하단 마크는 **고정 4.5** — 정답지 실측 4.5000 (AH/12+0.6 = 4.41 이 아니다) */
    var markBotB = [-halfB + (botBIn === undefined ? AH / 12 + 0.6 : botBIn), capH];
    var markBotF = [halfF - AH / 8, capH];

    /* 각 마크에서 대각선에 수선 → 발점. 곡선은 발점↔마크 사이 capBulge 비율 지점을 지난다.
       ★ 수선을 내리는 대각선은 **패드점 (0, 패드분) → 소매폭점** 이다 (원본 DXF 에 그 선이
         엔티티로 남아 있다: (0,1)→(−18.47,16.218) · (0,1)→(15.5,16.218)).
         공용 footOn() 은 원점 (0,0) 기준이라 여기서 쓰면 상단 통과점이 0.33 어긋난다
         — 그게 소매산이 도면보다 배부르던 원인이다. tightSleeveGeom 은 패드분이 없어
         (0,0)=패드점이므로 공용 footOn 그대로 쓴다. */
    var org = [0, pad];
    function footFromOrg(D, P) {
      var d = V.sub(D, org), L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
      var q = V.sub(P, org), t = q[0] * u[0] + q[1] * u[1];
      var F = [org[0] + u[0] * t, org[1] + u[1] * t];
      return { foot: F, t: t / L, dist: V.dist(P, F), u: u, len: L };
    }
    var fTB = footFromOrg(bicepB, markTopB), fBB = footFromOrg(bicepB, markBotB);
    var fTF = footFromOrg(bicepF, markTopF), fBF = footFromOrg(bicepF, markBotF);
    var mixP = function (f, mk) { return _lerp(f.foot, mk, K.capBulge); };
    var pTB = mixP(fTB, markTopB), pBB = mixP(fBB, markBotB);
    var pTF = mixP(fTF, markTopF), pBF = mixP(fBF, markBotF);

    // 소매산 곡선 — 정점에서 수평 출발, 상단 볼록점 → 하단 오목점 → 소매폭 끝
    /* 양 끝 접선은 **둘 다 수평** — 정점에서 수평으로 출발해 소매통 끝에도 수평으로
       닿는다 (긴소매 DXF 실측: 소매통 도착 접선 뒤 −1.55° / 앞 1.82°).
       끝접선을 자유롭게 두면 소매통 근처에서 도면과 0.15 cm 어긋난다. */
    /* 정점 → 상단 통과점 → 하단 통과점 → 소매통 끝을 **C2 스플라인**으로 잇는다.
       양 끝 접선은 둘 다 수평 (DXF 실측 도착 접선 뒤 −1.55° / 앞 1.82°).
       구간별 장력을 따로 적합하던 이전 방식은 통과점 사이가 직선처럼 펴져 보였다. */
    /* 앞뒤 장력을 따로 쓴다 — 하나로 묶으면 앞이 배부르고 뒤가 모자란다 */
    var cb = CAL.capBack || CAL.sleeveCap, cf = CAL.capFront || CAL.sleeveCap;
    /* ★ 중간앵커(현의 중점)를 뺐다 — **이 도면에는 그 마크가 없다**. 실제 곡선은 중점보다
       0.27 뒤를 지난다. 4점 [정점, 상단 통과점, 하단 통과점, 소매폭점] 이 도면과 맞는다. */
    var capBack = splineSegs([apex, pTB, pBB, bicepB],
      endTan([-1, 0], cb.k0), endTan([-1, 0], cb.k1));
    var capFront = splineSegs([apex, pTF, pBF, bicepF],
      endTan([1, 0], cf.k0), endTan([1, 0], cf.k1));
    var capLenBack = sLen(capBack), capLenFront = sLen(capFront);
    return {
      capH: capH, diagB: diagB, diagF: diagF, halfB: halfB, halfF: halfF,
      apexShift: apexShift, apex: apex, bicepB: bicepB, bicepF: bicepF,
      markTopB: markTopB, markTopF: markTopF, markBotB: markBotB, markBotF: markBotF,
      footTopB: fTB, footBotB: fBB, footTopF: fTF, footBotF: fBF,
      pTB: pTB, pBB: pBB, pTF: pTF, pBF: pBF,
      capBack: capBack, capFront: capFront,
      capLenBack: capLenBack, capLenFront: capLenFront,
      capLenTotal: capLenBack + capLenFront, capEase: capLenBack + capLenFront - AH
    };
  }
  function twoSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    var ST = SLEEVE_TYPE.two;
    var step = (m.B - BASE.B) / GRADE.B;
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;
    var cuffW = (opt.cuffW === undefined) ? ST.cuff + ST.cuffGrade * step : +opt.cuffW;

    /* ★ 소매산 높이를 넘긴다 — 원형1 은 AH/4+2, 이 모듈은 **AH/3 + 패드분** 이다.
       capGeom 안에 하드코딩돼 있던 것을 파라미터로 뺐다. */
    var capH2 = AH / K.capHeightDiv + num(opt.capPad, K.capPad);
    var pad2 = num(opt.capPad, K.capPad);
    var cg = capGeom(AH, AHb, AHf, capReduce, K.capApexShift, capH2, pad2, K.twoMarkBotB);
    var halfB = cg.halfB, halfF = cg.halfF;
    /* 길이 골격은 **패드점 기준** — 정답지: 팔꿈치 33.5 = 1 + 60/2 + 2.5 · 부리 61.0 = 1 + 60 */
    var elbowY = pad2 + sleeveLen / 2 + K.elbowAdd;
    var insetY = K.twoInsetY;              // 이세처리 구간 표시용

    /* ── 절개 골격 (정답지 실측) ────────────────────────────────────────
     *  · 절개점 높이 = **소매산의 정확히 절반** (정답지 8.109 = 16.218/2)
     *  · 큰소매 절개점 = 소매산 곡선 ∩ 그 높이
     *  · 작은소매 절개점 = 큰소매보다 **0.8 뒤** (도면 `0.8` 두 곳 · 실측 0.8000)
     *    두 조각이 절개선에서 0.8 씩 겹쳐 그 만큼이 이세로 들어간다.
     *  ⚠ 예전에는 splitX = −AH/4 한 점을 두 조각이 공유했다. */
    var splitY = cg.capH / 2;
    var splitP = ptOnSegsAtY(cg.capBack, splitY);
    var splitX = splitP[0];
    var splitU = [splitX - num(opt.twoSplitGap, K.twoSplitGap), splitY];   // 작은소매 절개점
    /* 소매산(정점 → 뒤 소매통)을 절개점에서 자른다.
       head = 정점~절개점 → **큰소매** 몫, tail = 절개점~뒤 소매통 → **작은소매** 몫 */
    var capSplit = splitSegsAtX(cg.capBack, splitX);

    /* ★ 큰소매 앞 소매산은 소매통 끝까지 가지 않고 **소매폭점 F 에서 현(직선거리) 3.0 인
       곡선 위 점**에서 끝난다. 도면의 숫자 `3` 은 x 오프셋이 아니라 **현 길이**다
       (실측 앞 3.0087 · 뒤 3.0071). 예전에는 x = halfF − 3 으로 잘라 끝점이 도면과
       0.16 어긋났고, `앞경계 상단 0.558 올림`을 별도 규칙으로 오해했다 — 그 0.558 은
       현 3 절단의 **결과**이지 규칙이 아니다. */
    var capFrontPts = sampleSegs(cg.capFront, 0.02);
    var cutF = idxAtChordFromEnd(capFrontPts, cg.bicepF, num(opt.twoSideOff, K.twoSideOff));
    var capBigFront = capFrontPts.slice(0, cutF.i + 1).concat([cutF.p]);
    var frontInX = cutF.p[0];
    var topY = cutF.p[1];
    /* ★ 잘라낸 꼬리(앞경계 → 소매폭점 F)를 **소매폭만큼 뒤로 평행이동**한 것이
       작은소매의 `소매통 연결`이다. 도면에서 두 곡선의 끝점 차 0.0017 · 접선각 둘 다 23.17°
       — 같은 곡선이다. 「큰소매 앞폭 3 을 떼어 작은소매 뒤에 붙인다」가 문자 그대로 이것이다.
       그래서 backOutX·topY 는 규칙이 아니라 **파생값**이다. */
    var sleeveW = halfB + halfF;
    var capOutPts = capFrontPts.slice(cutF.i + 1);
    capOutPts = [cutF.p].concat(capOutPts, [cg.bicepF]).map(function (q) { return [q[0] - sleeveW, q[1]]; });
    var backOutX = capOutPts[0][0];
    /* 밑단선 y — **패드점 기준**이라야 팔꿈치(33.5)와 앞뒤가 맞는다.
       도면 실측 60.7 = 패드분 1 + 소매길이 60 − 0.3. 그 0.3 이 어디서 오는지는 [미확정]. */
    var hemY = pad2 + sleeveLen - K.twoHemUp, hemLowY = hemY + K.twoHemDrop;

    var bigHemF = [halfF - K.twoFrontHemIn, hemY];
    /* ★ 작은소매 부리 뒤 모서리는 뒤 경계보다 **안쪽**이고 **0.3 올라간다**
       (도면 마크 「작은소매 부리 뒤모서리(0.3 올림)」 실측 (−20.250, 60.4) · 뒤 경계 −21.425).
       예전에는 `backOutX − 1.492` 로 **바깥으로** 내밀어 부호가 반대였다. 그 2.6 때문에
       바깥 뒤선이 팔꿈치 아래에서 크게 휘고(휨 0.404 · 도면 0.117) 부리 몫도 틀렸다
       (작은 9.85 / 도면 8.46). 팔꿈치선까지는 도면과 0.05 로 맞고 있었다. */
    var undHemB = [backOutX + K.twoUndHemIn, hemY - K.twoUndHemRise];
    /* ★ 작은소매 절개선은 큰소매 절개선을 **절개점 수직선에 대칭**시킨 것이다.
       도면이 그렇다 — 큰 −5.586 / 작은 −15.836 은 절개점 −10.711 에 대해 정확히 대칭.
       대칭이면 두 절개변 길이가 저절로 같아진다(도면 53.7565 = 53.7565).
       그래서 **입력은 소맷부리 총둘레 하나뿐**이고, 큰/작은 몫은 대칭이 정한다.
         총둘레 C = (앞 − 큰끝) + (2·절개x − 큰끝 − 작은바깥)
         ⇒ 큰끝 = (앞 − 작은바깥 + 2·절개x − C) / 2
       ⚠ 큰소매 몫만 따로 등급을 주면 대칭 때문에 작은소매 몫이 호수마다 널뛴다
         (66호 6.9 → 88호 3.4 로 줄었다). 총둘레를 등급하고 몫은 계산해야 한다. */
    /* ★ 소맷부리는 **큰:작은 = 2:1** 로 나눈다 (도면 17.019 / 8.460 = 0.668 / 0.332).
       예전에는 두 조각을 절개점 수직선에 대칭시켜 몫을 정했다. 그러면 대칭축이
       절개점(엔진 −9.585)에 묶이는데, 도면의 축은 **밑단 두 모서리의 중점 −9.835** 이고
       절개점의 중점(−10.074)과도 다르다 — 즉 대칭이 아니라 이 비율이 축을 정한다. */
    /* 비율은 **호(부리선 길이)** 기준이다. 밑단 두 끝의 y 가 달라(하강 1.492 · 올림 0.3)
       x 폭으로 그대로 쓰면 호가 길어진다 — y 차를 빼고 x 폭을 낸다. */
    var xOf = function (arc, dy) { return Math.sqrt(Math.max(arc * arc - dy * dy, 0.01)); };
    /* ★ 몫(share)은 **고정 상수가 아니라 계산 결과**다 — 위 주석이 이미 경고한 함정이다.
       2/3 을 박아 두면 66호만 맞고, 다른 호수에서는 두 밑단 모서리(bigHemF·undHemB)가
       서로 다른 속도로 벌어져 **큰↔작은 절개선 길이가 44호 1.16 · 88호 1.53 어긋난다**
       (2026-08-12 QA). 두 절개선은 서로 꿰매는 짝이라 길이가 같아야 한다.
       총 부리둘레 cuffW 는 그대로 두고 **몫만 이분법으로 풀어** 길이를 맞춘다.
       66호에서는 답이 2/3 근처로 나오므로 정답지 적합이 유지된다. */
    var hemPts = function (share) {
      return [[bigHemF[0] - xOf(cuffW * share, hemLowY - bigHemF[1]), hemLowY],
              [undHemB[0] + xOf(cuffW * (1 - share), hemLowY - undHemB[1]), hemLowY]];
    };
    var shareSolved, cuffBigArc, cuffUndArc, bigHemB, undHemF, cuffBig, cuffUnder;   // ↓ mkSeam 정의 뒤에 푼다

    /* 절개선 — 절개점 → 팔꿈치선 위의 중간 앵커 → 밑단.
       앵커 위치(mr·my)와 양 끝 접선(k0·k1)은 도면 bigBack 41점에 적합했다. */
    /* 절개선은 **C 자**다 — 한쪽으로만 휘고 곡률 부호가 바뀌지 않는다.
       x 의 극값이 중간(y = twoInsetY 20.805)에 있을 뿐이다.
       도면 큰소매 뒤선: 절개점 −9.674 → 가장 부푼 점 −10.335(y 20.805) → 트임어깨 −8.796.
       즉 절개점 수직선에서 **뒤로 0.661** 부풀었다가 밑단 쪽으로 돌아온다.
       ⚠ 예전 앵커는 팔꿈치선보다 6.8 **위**의 한 점이라 이 S 를 못 그렸고, 팔꿈치 휨이
         0.25(도면 0.94)로 거의 곧은 선이었다. 앵커를 정점 자리로 옮긴다. */
    var mkSeam = function (endPt, startP, outSign, bulgeScale) {
      var cs = CAL.twoSeam;
      var st = startP || splitP;
      var bs = (bulgeScale === undefined) ? 1 : bulgeScale;
      /* 앵커 **두 점** — 가장 부푼 자리(y 20.805)와 팔꿈치 아래(y 34.315).
         한 점만 쓰면 아래쪽이 곧게 펴져 도면과 0.29 벗어난다 (도면 −10.078 · 엔진 −9.9). */
      /* ★ 두 절개선은 서로의 거울이지만 **각자의 절개점**에서 출발한다. 그래서 자기
         절개점 기준으로 재면 부푼 양이 다르다 (큰 0.661/0.404 · 작은 1.139/0.882).
         차이는 둘 다 0.478 로 같다 — 대칭축이 절개점이 아니라 그 사이의 −9.835 이기 때문. */
      var sg = (outSign || -1), un = (sg > 0);
      /* ★ 앵커 y 는 **절개선 자기 구간 안의 비율**이다 (절대 좌표 아님).
         66호 실측 y(20.8 · 34.315 · 51.273)를 그대로 박아 뒀더니 절개점·밑단은
         호수 따라 움직이는데 앵커는 안 움직여, 서로 반대로 부푸는 두 곡선이 호수마다
         다르게 늘어났다 — **큰↔작은 절개선 짝이 44호 1.16 · 88호 1.53 어긋났다**
         (66호만 −0.045 로 맞았다. 2026-08-12 QA). 봉제하면 소매가 뒤틀린다. */
      var yAt = function (t) { return st[1] + (endPt[1] - st[1]) * t; };
      var b1 = [st[0] + sg * bs * num(opt.twoSeamBulge, un ? K.twoSeamBulgeU : K.twoSeamBulge), yAt(K.twoSeamT1)];
      var b2 = [st[0] + sg * bs * (un ? K.twoSeamBulgeU2 : K.twoSeamBulge2), yAt(K.twoSeamT2)];
      /* 앵커 3 — **트임어깨 자리**(y 51.27). 여기가 비어 있으면 아래쪽이 끝접선만으로
         흘러가 트임어깨가 큰 0.193 · 작은 0.110 어긋난다. 이 자리에서 곡선은 자기
         절개점 수직선을 이미 **넘어가 있다**(큰 +0.878 · 작은 −0.398) — 그래서 부호가 음수다. */
      var b3 = [st[0] + sg * bs * (un ? K.twoSeamBulgeU3 : K.twoSeamBulge3), yAt(K.twoSeamT3)];
      return splineSegs([st, b1, b2, b3, endPt],
        endTan([0, 1], cs.k0), endTan(V.sub(endPt, b3), cs.k1));
    };
    shareSolved = (function () {
      function gap(sh) {
        var h = hemPts(sh);
        return sLen(mkSeam(h[0])) - sLen(mkSeam(h[1], splitU, +1));
      }
      var lo = 0.35, hi = 0.90, gLo = gap(lo);
      if (gLo * gap(hi) > 0) return K.twoCuffBigShare;      // 구간 안에 답이 없으면 도면 몫
      for (var i = 0; i < 44; i++) {
        var mid = (lo + hi) / 2;
        if (gap(mid) * gLo > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    })();
    cuffBigArc = cuffW * shareSolved; cuffUndArc = cuffW * (1 - shareSolved);
    var _hp = hemPts(shareSolved);
    bigHemB = _hp[0]; undHemF = _hp[1];
    cuffBig = bigHemF[0] - bigHemB[0]; cuffUnder = undHemF[0] - undHemB[0];
    var bigBack = mkSeam(bigHemB);
    /* 작은소매 절개선은 **자기 절개점(splitU)** 에서 출발한다 — 큰소매보다 0.8 뒤.
       두 절개선이 그 0.8 만큼 겹쳐 그것이 이세로 들어간다 (도면 `0.8` 두 곳). */
    /* ★ 두 절개선은 **서로 꿰매는 짝**이라 길이가 같아야 한다. 앵커 x 는 66호 실측이라
       호수가 바뀌면 밑단 x 가 크게 움직여(큰소매 dx 44호 −3.2 ↔ 88호 +7.4) 두 곡선이
       다르게 늘어난다 — 44호 1.16 · 88호 1.53 어긋난 채 나갔다 (2026-08-12 QA).
       작은소매 앵커의 부푼 양에 **배율 하나**를 걸어 길이를 맞춘다. 66호는 배율 ≈ 1
       이라 정답지 적합이 그대로 유지되고, 다른 호수만 따라온다.
       (부푼 양을 줄이면 곡선이 짧아진다 — 단조라 이분법으로 찾는다) */
    var undBack = mkSeam(undHemF, splitU, +1);   // 작은소매는 반대쪽(앞)으로 부푼다 — 큰소매의 거울
    /* 트임 — 두 조각 모두 절개선 아래 9 를 바깥으로 2.2 내민다 */
    var ventBig = ventOf(bigBack, [halfF, elbowY], num(opt.ventWBig, K.ventWBig));      // 조각 안쪽 = 앞쪽 → 덧단은 뒤로
    var ventUnd = ventOf(undBack, [backOutX, elbowY], num(opt.ventWUnd, K.ventW));   // 조각 안쪽 = 뒤쪽 → 덧단은 앞으로

    var bigFront = splineSegs([[frontInX, topY], [frontInX - K.twoFrontElbowIn, elbowY], bigHemF],
      endTan([0, 1], CAL.twoFront.k0), null);
    /* 작은소매 바깥 뒤선 — 앵커 **두 점**. 가장 앞으로 나온 자리는 팔꿈치선(33.5)이 아니라
       그보다 아래 y 36.199 다 (도면 −19.460 · 뒤 경계에서 1.965). 팔꿈치선에 한 점만 두면
       아래쪽이 곧게 펴져 도면과 0.53 벗어난다. */
    var undOuter = splineSegs([[backOutX, topY],
        [backOutX + K.twoUndOutIn1, K.twoUndOutY1],
        [backOutX + K.twoUndOutIn2, K.twoUndOutY2], undHemB],
      endTan([0, 1], CAL.twoUndOuter.k0), endTan([0, 1], CAL.twoUndOuter.k1));
    /* 소매통 연결 — 위에서 만든 **큰소매 앞 소매산의 잘린 꼬리를 평행이동한 것** 그대로다.
       예전에는 CAL.twoCapOut 으로 따로 적합한 스플라인을 그렸다 (도면에 없는 곡선이었다). */
    var undCapOut = lineSegs.apply(null, capOutPts);

    /* ── 작은소매 소매산 — **독립 재제도 곡선**이다 (도면 마크가 그대로 남아 있다) ──
     *  예전에는 큰소매 소매산을 큰소매 절개점에서 자른 tail 을 그대로 썼다. 그러면 끝점이
     *  절개선 시작점(0.8 뒤)과 안 맞아 외곽선에 0.8 짜리 직선 점프가 생겼다.
     *  도면의 작도 골격:
     *    · 소매폭점 B 에서 앞으로 **0.8 수평 직선** (실측 Δx 0.800 / Δy 0.002)
     *    · 그 다음 스플라인이 pBB(뒤 하단 마크 4.5 의 수선 통과점, 큰소매와 공유) 와
     *      **선분 splitU↔markBotB 의 중점** 을 지나 작은소매 절개점에서 끝난다
     *      (도면 십자 마크 3곳과 0.002 이내 일치)
     *  평행이동·x압축 가설은 각각 편차 0.68 · 0.53 으로 기각됐다. */
    var undCapHead = [cg.bicepB, [cg.bicepB[0] + num(opt.twoSplitGap, K.twoSplitGap), cg.bicepB[1]]];
    var undCapCurve = splineSegs(
      [undCapHead[1], cg.pBB, _lerp(splitU, cg.markBotB, 0.5), splitU],
      endTan([1, 0], CAL.twoUnderCap.k0), null);
    var capUnderBack = undCapHead.concat(sampleSegs(undCapCurve, 0.02).slice(1));

    var out = {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: 'two', typeName: ST.name, twoPiece: true,
      cuffBig: cuffBig, cuffUnder: cuffUnder, cuffW: cuffBig + cuffUnder,
      elbowY: elbowY, insetY: insetY, splitX: splitX, splitP: splitP, splitU: splitU,
      backOutX: backOutX, frontInX: frontInX, topY: topY,
      capBigFront: capBigFront,               // 정점 → 앞 절단점 (소매통까지 안 간다)
      capBigBack: revPts(capSplit.head),      // 절개점 → 정점
      capUnderBack: capUnderBack,             // 뒤 소매통 → 작은소매 절개점(0.8 뒤)
      bigHemF: bigHemF, bigHemB: bigHemB, undHemB: undHemB, undHemF: undHemF,
      bigBack: bigBack, undBack: undBack, bigFront: bigFront,
      ventBig: ventBig, ventUnd: ventUnd, ventW: K.ventW, ventLen: K.ventLen,
      undOuter: undOuter, undCapOut: undCapOut,
      seamLenBig: polyLen(sampleSegs(bigBack, 0.02)),
      seamLenUnder: polyLen(sampleSegs(undBack, 0.02)),
      underLenB: polyLen(sampleSegs(undOuter, 0.02)),
      underLenF: polyLen(sampleSegs(bigFront, 0.02)),
      hemEndB: bigHemB, hemEndF: bigHemF, hemMidB: bigHemB, hemMidF: bigHemF,
      hemHalfB: cuffBig / 2, hemHalfF: cuffBig / 2, hemBack: null, hemFront: null
    };
    for (var k in cg) if (cg.hasOwnProperty(k)) out[k] = cg[k];

    /* ── 봉제 기준 앞뒤 구분 ────────────────────────────────────────────────
     *  이 2장소매는 **큰소매 앞쪽 폭에서 3 을 떼어 작은소매 뒤쪽에 붙인** 설계다.
     *  그래서 작은소매의 `소매통 연결`(뒤바깥 상단 → 소매폭점 B)은 제도에서는 뒤에
     *  그려지지만 **꿰맬 때는 앞 암홀**로 들어간다.
     *      앞 = 큰소매 앞 소매산 + 작은소매 소매통 연결   (정답지 20.662 + 3.035 = 23.697)
     *      뒤 = 큰소매 뒤 소매산 + 작은소매 뒤 소매산     (정답지 13.679 + 12.258 = 25.937)
     *  ⚠ 총합만 보면 이 배분이 틀려도 안 드러난다. 예전에는 소매통 연결을 뒤로 세어
     *    앞 이세가 −0.95(소매가 안 들어가는 값)인데도 총 이세 4.66 이라 통과했다.        */
    var lenBigF = polyLen(out.capBigFront), lenBigB = polyLen(out.capBigBack);
    var lenUndB = polyLen(out.capUnderBack), lenUndO = polyLen(sampleSegs(undCapOut, 0.02));
    out.capLenBigFront = lenBigF; out.capLenBigBack = lenBigB;
    out.capLenUnderBack = lenUndB; out.capLenUnderOut = lenUndO;
    out.capLenFront = lenBigF + lenUndO;          // 봉제 앞 소매산
    out.capLenBack = lenBigB + lenUndB;           // 봉제 뒤 소매산
    out.capLenTotal = out.capLenFront + out.capLenBack;
    out.capEaseFront = out.capLenFront - AHf;
    out.capEaseBack = out.capLenBack - AHb;
    out.capEase = out.capLenTotal - AH;
    return out;
  }
  function twoSleevePieces(s, seam) {
    function mk(id, name, edges, grain, notches) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      return {
        id: id, name: name, cutCount: 2, grainline: grain,
        outline: loop.pts, seamline: sm.seamline,
        foldEdges: [], seamEdges: sm.seamEdges, seamFoldEdges: [],
        seamByRole: sm.seamByRole, edges: withSeam(loop.ranges, sm.edgeSeam),
        internal: twoInternal(s, id), notches: notches || [], bbox: bboxOf(loop.pts)
      };
    }
    var poly = function (pts) { return lineSegs.apply(null, pts); };
    var vB = s.ventBig, vU = s.ventUnd;
    var big = mk('sleeveBig', '큰소매', [
      { name: '앞 소매산', role: 'armhole',   segs: poly(s.capBigFront) },
      { name: '앞 밑선',   role: 'side',      segs: s.bigFront },
      { name: '밑단',      role: 'sleeveHem', segs: lineSegs(s.bigHemF, s.bigHemB) },
      /* 트임 덧단 — 밑단에서 2.2 나갔다가 9 올라가고, 위는 미터로 잘려 뾰족해진다 */
      { name: '트임 밑단', role: 'sleeveHem', segs: lineSegs(s.bigHemB, vB.hemOut) },
      { name: '트임',      role: 'side',      segs: lineSegs(vB.hemOut, vB.topOut) },
      { name: '트임 미터', role: 'side',      segs: lineSegs(vB.topOut, vB.mitreOn) },
      { name: '뒤 절개선', role: 'side',      segs: revSegs(vB.seamHead) },
      { name: '뒤 소매산', role: 'armhole',   segs: poly(s.capBigBack) }
    ], [[s.apexShift, 1.0], [s.apexShift, s.sleeveLen - 1.0]],
       [{ p: cp(s.splitP), angle: 0, label: '절개 시작' },
        { p: cp(s.apex), angle: 90, label: '소매산 정점' },
        /* 앞 합인 — 도면 마크 (11.6975, 11.4023) */
        { p: cp(s.pBF), angle: angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], s.pBF))), label: '앞 합인' },
        /* ★ 트임 끝은 **외곽선 위의 mitreOn** 이다 — 절개선(봉제선)이 실제로 끝나는 자리.
           예전엔 vB.top(원래 절개선 위 9 지점)을 썼는데 그 자리는 미터 사선으로 대체돼
           **외곽선에서 1.4cm 떨어진 허공**이었다 (전 호수, 2026-08-12 QA).
           봉제하는 사람에게 필요한 것은 「여기서 박음질을 멈춘다」는 재단선 위의 표시다. */
        { p: cp(vB.mitreOn), angle: 0, label: '트임 끝' }]
       .concat(seamMatchNotches(s.bigFront, revSegs(s.undOuter), [0, s.sleeveLen * 0.5]).a)
       );
    var und = mk('sleeveUnder', '작은소매', [
      { name: '뒤 소매산',  role: 'armhole',   segs: poly(s.capUnderBack) },
      { name: '절개선',     role: 'side',      segs: vU.seamHead },
      { name: '트임 미터',  role: 'side',      segs: lineSegs(vU.mitreOn, vU.topOut) },
      { name: '트임',       role: 'side',      segs: lineSegs(vU.topOut, vU.hemOut) },
      { name: '트임 밑단',  role: 'sleeveHem', segs: lineSegs(vU.hemOut, s.undHemF) },
      { name: '밑단',       role: 'sleeveHem', segs: lineSegs(s.undHemF, s.undHemB) },
      { name: '바깥 뒤선',  role: 'side',      segs: revSegs(s.undOuter) },
      { name: '소매통 연결', role: 'armhole',  segs: s.undCapOut }
    ], [[s.backOutX + 2, 15], [s.backOutX + 2, s.sleeveLen - 1.0]],
       /* ★ 작은소매의 절개 시작점은 **자기 절개점 splitU** 다 — splitP(큰소매 것)를 쓰면
          twoSplitGap 0.8 만큼 통째로 어긋난다. 그 0.8 이 이세로 들어가는 값이라
          숫자가 작아 눈에 안 띄었다 (전 호수 정확히 0.800 어긋나 있었다). */
       [{ p: cp(s.splitU), angle: 180, label: '절개 시작' },
        /* 뒤 합인 — 도면 마크 (−14.9255, 11.7312). 절개점과 소매통 사이라 작은소매 몫 */
        { p: cp(s.pBB), angle: angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], s.pBB))), label: '뒤 합인' },
        { p: cp(vU.mitreOn), angle: 180, label: '트임 끝' }]
       .concat(seamMatchNotches(s.bigFront, revSegs(s.undOuter), [0, s.sleeveLen * 0.5]).b)
       );
    /* ★ 소매산 맞춤 너치는 **조각 외곽선에 붙여 나눈다.**
       예전엔 「어느 곡선 위인가」(onPts)로 걸렀는데, 곡선 경계에 놓인 너치가 어느 쪽에도
       안 잡혀 **통째로 사라졌다** — 「뒤 1/3」이 44·55·88호에 없었다(66·77호만 있었다).
       몸판 암홀 3등분에 대응하는 필수 너치가 호수에 따라 있다 없다 한 것이다
       (2026-08-12 QA). 외곽선이 기준이면 조각이 곧 판정 기준이라 빠질 수가 없다. */
    (function () {
      /** 외곽선까지 최단거리와 그 발 — 꼭짓점이 아니라 **변에 내린 수선**이라야
          너치가 재단선 위에 정확히 앉는다 */
      function foot(q, o) {
        var best = null, bd = Infinity;
        for (var i = 1; i < o.length; i++) {
          var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var c = [a[0] + t * dx, a[1] + t * dy], e = V.dist(q, c);
          if (e < bd) { bd = e; best = c; }
        }
        return { d: bd, p: best };
      }
      capNotches(s).forEach(function (nt) {
        var fb = foot(nt.p, big.outline), fu = foot(nt.p, und.outline);
        var host = fb.d <= fu.d ? big : und, hit = fb.d <= fu.d ? fb : fu;
        /* ⚠ capNotches 는 **한 장 소매의 소매산**에서 잰다. 작은소매 소매산은 독립
           재제도 곡선이라 「뒤 1/3」이 0.02~0.11 떠 있다 — 그래서 재단선 위로 내린다.
           0.35 를 넘으면 그 조각 것이 아니므로 넣지 않는다. */
        if (hit.d > 0.35) return;
        var dup = host.notches.some(function (x) { return V.dist(x.p, hit.p) < 0.06; });
        if (!dup) host.notches.push({ p: cp(hit.p), angle: nt.angle, label: nt.label });
      });
    })();
    return [big, und];
  }
