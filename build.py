#!/usr/bin/env python3
"""여성복 원형 Suite 빌드

  python3 build.py

  1) 각 원형 앱을 단일 HTML 로 빌드
  2) 런처 두 벌 생성
       여성복원형Suite.html          — iframe src=  (개발용, 앱 파일을 따로 읽음)
       여성복원형Suite-포터블.html    — iframe srcdoc= (배포용, 이 파일 하나로 전부 동작)

  포터블은 각 앱을 srcdoc 으로 인라인하므로 origin 이 부모(file://)를 상속합니다.
  → localStorage 와 인쇄 동작이 개별 파일 버전과 동일하게 유지됩니다.
"""
import os, re, html, subprocess, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))

# (폴더, 탭 이름, 빌드 스크립트 유무)  — 순서가 곧 탭 순서
APPS = [
    ('기본원형',        '기본원형',        True),
    ('숙녀복기본원형1',  '숙녀복 기본원형1', True),
    ('숙녀복기본원형2',  '숙녀복 기본원형2', False),
]


def build_apps():
    print('── 앱 빌드 ──')
    out = []
    for folder, label, has_build in APPS:
        d = os.path.join(HERE, folder)
        f = os.path.join(d, folder + '.html')
        if has_build:
            script = os.path.join(d, 'build.py')
            if not os.path.exists(script):
                sys.exit(f'{folder}: build.py 가 없습니다')
            subprocess.run([sys.executable, script], check=True)
        if not os.path.exists(f):
            sys.exit(f'{folder}: {os.path.basename(f)} 가 없습니다')
        src = open(f, encoding='utf-8').read()
        if re.search(r'https?://(?!www\.w3\.org)', src):
            sys.exit(f'{folder}: 외부 URL 참조가 있습니다 (self-contained 위반)')
        if not has_build:
            print(f'  {label:14s} {len(src):>9,} bytes  (준비 중 안내 페이지)')
        out.append((folder, label, has_build, src))
    return out


def render(shell, apps, portable):
    tabs, frames = [], []
    for i, (folder, label, ready, src) in enumerate(apps):
        tabs.append(
            f'<button type="button" class="suitetab{" is-on" if i == 0 else ""}" role="tab" '
            f'data-app="{folder}" data-ready="{1 if ready else 0}" '
            f'aria-selected="{"true" if i == 0 else "false"}">{label}</button>'
        )
        attr = (f'srcdoc="{html.escape(src, quote=True)}"' if portable
                else f'src="{folder}/{folder}.html"')
        frames.append(
            f'<iframe class="suiteframe" data-app="{folder}" title="{label}" '
            f'{attr}{"" if i == 0 else " hidden"}></iframe>'
        )
    for ph in ('<!--TABS-->', '<!--FRAMES-->'):
        if shell.count(ph) != 1:
            sys.exit(f'shell.html: 자리표시자 {ph} 가 정확히 1번 나와야 합니다 (현재 {shell.count(ph)}번)')
    body = shell.replace('<!--TABS-->', '\n      '.join(tabs)) \
                .replace('<!--FRAMES-->', '\n    '.join(frames))
    stamp = datetime.date.today().isoformat()
    kind = '포터블 — 이 파일 하나로 전부 동작' if portable else '개발용 — 앱 파일을 따로 읽음'
    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>여성복 원형 · 문화식 자동 제도</title>
<!-- 자동 생성 파일 — 직접 수정하지 마세요.  원본: shell.html + 각 원형 폴더
     재생성: python3 build.py     {kind}     생성일: {stamp} -->
</head>
<body>
{body}
</body>
</html>
'''


def main():
    shell = open(os.path.join(HERE, 'shell.html'), encoding='utf-8').read()
    apps = build_apps()
    print('── 런처 ──')
    for portable, name in ((False, '여성복원형Suite.html'), (True, '여성복원형Suite-포터블.html')):
        doc = render(shell, apps, portable)
        open(os.path.join(HERE, name), 'w', encoding='utf-8').write(doc)
        print(f'  {name:28s} {len(doc):>9,} bytes')
    print(f'\n포터블 파일 하나만 복사하면 원형 {len(apps)}종이 전부 동작합니다.')


if __name__ == '__main__':
    main()
