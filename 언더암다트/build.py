#!/usr/bin/env python3
"""언더암다트.html 빌드 — 모듈 소스를 단일 self-contained HTML 로 합칩니다.
   보통은 리포 루트의 build.py 가 호출합니다."""
import os, re, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '언더암다트.html')
R = lambda n: open(os.path.join(HERE, n), encoding='utf-8').read()

ui_html, ui_css, print_css = R('ui.html'), R('ui.css'), R('print.css')
engine_js, print_js, dxf_js, pdf_js, ui_js = R('engine.js'), R('print.js'), R('dxf.js'), R('pdf.js'), R('ui.js')

for name, src in (('engine.js', engine_js), ('print.js', print_js), ('dxf.js', dxf_js), ('pdf.js', pdf_js)):
    if 'require(' in re.sub(r'typeof require', '', src):
        raise SystemExit(f'{name}: 브라우저에서 동작하지 않는 require() 가 있습니다')
for name, src in (('ui.css', ui_css), ('print.css', print_css), ('ui.html', ui_html),
                  ('engine.js', engine_js), ('print.js', print_js), ('dxf.js', dxf_js),
                  ('pdf.js', pdf_js), ('ui.js', ui_js)):
    if re.search(r'https?://(?!www\.w3\.org)', src):
        raise SystemExit(f'{name}: 외부 URL 참조가 있습니다 (self-contained 위반)')
    if '</script' in src.lower() and name.endswith('.js'):
        raise SystemExit(f'{name}: </script 문자열이 있어 인라인하면 깨집니다')

stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')   # 분까지 — 재빌드 후 새로고침이 먹혔는지 화면에서 확인하려면 날짜만으론 부족하다
html = f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>언더암 다트 원형 · 44~88호 자동 제도</title>
<!-- 자동 생성 파일 — 직접 수정하지 마세요.
     원본: 언더암다트/{{ui.html, ui.css, print.css, engine.js, print.js, dxf.js, pdf.js, ui.js}}
     재생성: python3 언더암다트/build.py     생성일: {stamp} -->
<style>
/* ══ ui.css ══ */
{ui_css}
/* ══ print.css ══ */
{print_css}
</style>
</head>
<body>
{ui_html}
<script>window.ND_BUILD = '{stamp}'; window.ND_APP = '언더암다트';</script>
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
/* ══ pdf.js ══ */
{pdf_js}
</script>
<script>
/* ══ ui.js ══ */
{ui_js}
</script>
</body>
</html>
'''
open(OUT, 'w', encoding='utf-8').write(html)
print(f'  언더암 다트 원형   {len(html):>9,} bytes  →  {os.path.basename(OUT)}')
