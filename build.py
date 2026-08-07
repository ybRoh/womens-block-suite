#!/usr/bin/env python3
"""기본무다트원형-문화식FS.html 빌드 — 팀별 파일을 단일 self-contained HTML 로 합칩니다.
   실행: python3 기본무다트원형/build.py"""
import os, re, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '기본무다트원형-포터블.html')          # 리포 루트 = 이 폴더
OUT2 = os.path.join(os.path.dirname(HERE), '기본무다트원형-문화식FS.html')  # pattern-Pro 에도 사본
R = lambda n: open(os.path.join(HERE, n), encoding='utf-8').read()

ui_html, ui_css, print_css = R('ui.html'), R('ui.css'), R('print.css')
engine_js, print_js, dxf_js, ui_js = R('engine.js'), R('print.js'), R('dxf.js'), R('ui.js')

# node 전용 export 는 브라우저에서 무해하지만, 혹시 모를 참조 오류를 막기 위해 확인만 한다
for name, src in (('engine.js', engine_js), ('print.js', print_js), ('dxf.js', dxf_js)):
    if 'require(' in re.sub(r'typeof require', '', src):
        raise SystemExit(f'{name}: 브라우저에서 동작하지 않는 require() 가 있습니다')
for name, src in (('ui.css', ui_css), ('print.css', print_css), ('ui.html', ui_html),
                  ('engine.js', engine_js), ('print.js', print_js), ('dxf.js', dxf_js), ('ui.js', ui_js)):
    if re.search(r'https?://(?!www\.w3\.org)', src):
        raise SystemExit(f'{name}: 외부 URL 참조가 있습니다 (self-contained 위반)')
    if '</script' in src.lower() and name.endswith('.js'):
        raise SystemExit(f'{name}: </script 문자열이 있어 인라인하면 깨집니다')

stamp = datetime.date.today().isoformat()
html = f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>기본 무다트 원형 (문화식) · 55·66·77호</title>
<!-- 자동 생성 파일 — 직접 수정하지 마세요.
     원본: 기본무다트원형/{{ui.html, ui.css, print.css, engine.js, print.js, dxf.js, ui.js}}
     재생성: python3 기본무다트원형/build.py     생성일: {stamp} -->
<style>
/* ══ ui.css ══ */
{ui_css}
/* ══ print.css ══ */
{print_css}
</style>
</head>
<body>
{ui_html}
<script>
/* ══ engine.js ══ */
{engine_js}
</script>
<script>
/* ══ print.js ══ */
{print_js}
</script>
<script>
/* ══ dxf.js ══ */
{dxf_js}
</script>
<script>
/* ══ ui.js ══ */
{ui_js}
</script>
</body>
</html>
'''
open(OUT, 'w', encoding='utf-8').write(html)
open(OUT2, 'w', encoding='utf-8').write(html)
print(f'생성: {OUT}')
print(f'사본: {OUT2}   ({len(html):,} bytes, {html.count(chr(10)):,} 줄)')
