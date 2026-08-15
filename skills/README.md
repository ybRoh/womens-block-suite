# 이 리포가 쓰는 Claude 스킬

Claude Code 는 스킬을 `~/.claude/skills/` 에서 읽는다. 그 디렉터리는 git 이 아니라
이력이 안 남으므로, **이 리포에 사본을 두고 함께 버전 관리**한다.

| 스킬 | 하는 일 |
|---|---|
| `pattern-drawing-diff` | 교재 도면·완성이미지(jpg)·DXF 를 실측해 **완성된 패턴과 대조**하고 수정 지시까지 낸다. 「검산기는 0건인데 모양이 다르다」가 이 스킬이다 |
| `pattern-sewability-verify` | **봉제 가능성** — 맞물리는 변 길이·시접·너치·조각 누락. 도면 없이도 참이어야 하는 것들 |

## 고칠 때

원본은 `~/.claude/skills/` 이고 여기는 사본이다. **두 벌이 어긋나면 소용이 없다** —
한쪽을 고쳤으면 바로 맞춘다:

```bash
# 원본 → 리포 (고친 뒤 커밋 전에)
cp -R ~/.claude/skills/pattern-drawing-diff ~/.claude/skills/pattern-sewability-verify skills/

# 리포 → 원본 (다른 기기에서 클론한 뒤)
cp -R skills/pattern-drawing-diff skills/pattern-sewability-verify ~/.claude/skills/
```

⚠ 심볼릭 링크로 묶으면 한 벌로 관리되지만, 링크가 깨지면 스킬이 조용히 안 뜬다.
지금은 **복사본**으로 두고 위 명령으로 맞춘다.
