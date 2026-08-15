# 이 리포가 쓰는 Claude 스킬

Claude Code 는 스킬을 `~/.claude/skills/` 에서 읽는다. 그 디렉터리는 git 이 아니라
이력이 안 남으므로 **실물을 여기 두고, 저쪽은 심볼릭 링크**로 건다. 한 벌만 관리한다.

| 스킬 | 하는 일 |
|---|---|
| `pattern-drawing-diff` | 교재 도면·완성이미지(jpg)·DXF 를 실측해 **완성된 패턴과 대조**하고 수정 지시까지 낸다. 「검산기는 0건인데 모양이 다르다」가 이 스킬이다 |
| `pattern-sewability-verify` | **봉제 가능성** — 맞물리는 변 길이·시접·너치·조각 누락. 도면 없이도 참이어야 하는 것들 |

## 링크 상태

```
~/.claude/skills/pattern-drawing-diff      → 이 리포 skills/pattern-drawing-diff
~/.claude/skills/pattern-sewability-verify → 이 리포 skills/pattern-sewability-verify
```

여기 파일을 고치면 Claude 가 **바로 그 내용을 읽는다** (복사 불필요).

## 다른 기기에서 클론했을 때 · 링크가 깨졌을 때

```bash
cd ~/.claude/skills
R="$HOME/pattern-Pro/여성복원형Suite/skills"          # 리포 경로가 다르면 여기만 고친다
rm -rf pattern-drawing-diff pattern-sewability-verify
ln -s "$R/pattern-drawing-diff" pattern-drawing-diff
ln -s "$R/pattern-sewability-verify" pattern-sewability-verify
ls -l | grep pattern                                  # 링크가 걸렸는지 눈으로 확인
head -3 pattern-drawing-diff/SKILL.md                 # 내용이 읽히는지까지 확인
```

⚠ **링크가 깨지면 스킬이 조용히 안 뜬다** — 에러가 아니라 그냥 없는 것처럼 된다.
리포를 옮기거나 이름을 바꿨으면 위 명령으로 다시 건다.

⚠ 이 리포를 지우면 스킬도 같이 사라진다. 전환 직전 사본은
`~/.claude/skills/.backup-2026-08-15/` 에 남겨 두었다.
