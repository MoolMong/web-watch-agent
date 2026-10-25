# web-watch-agent

웹사이트를 주기적으로 확인하고, 알릴 가치가 있는지 AI가 판단해 GitHub Pages 대시보드에 보여 주는 개인용 감시 에이전트입니다.

- **수집**: [ego lite](https://github.com/citrolabs/ego-lite) 브라우저가 내 PC에서 사이트를 엽니다(읽기 전용).
- **판단**: OpenRouter의 TypeSafe **Jev**(`~typesafe/jev-latest`)가 "지금 알릴 때인가"를 확률로 답합니다.
- **표시**: 결과 JSON을 레포에 push → GitHub Pages(`docs/`)가 대시보드로 보여 줍니다.
- **결제·예매는 자동으로 하지 않습니다.** 알림을 보고 직접 결제하세요.

## 감시 대상

| id | 내용 | 상태 |
|---|---|---|
| `flights` | 구글 항공권 최저가 + 구매 시점 판단, 구글 호텔(평점 필터) 목록 + Jev 숙소 유형 태그(캡슐호텔·공유방·개인실) | 동작 중 |
| `udemy` | Udemy 특정 강의 할인가 | 예정 |
| `ktx` | KTX 매진 열차 취소표 | 예정 |

## 구조

```
core/jev.ts                 Jev(OpenRouter Decisions API) 호출
watchers/<id>/scrape.mjs    ego-browser로 페이지 읽기 → watchers/<id>/.tmp/scrape.json
watchers/<id>/judge.ts      Jev 판단 → docs/<id>/data/{latest,history}.json
docs/<id>/config.json       감시 조건 (사이트에서 만들고 GitHub에서 수정)
docs/<id>/index.html        대시보드
docs/watchers.json          허브 목록
scripts/run.ps1             한 번 실행: pull → scrape → judge → push
scripts/register-task.ps1   Windows 작업 스케줄러 등록
```

새 감시 대상은 `watchers/<id>/`, `docs/<id>/`를 만들고 `docs/watchers.json`에 추가하면 됩니다.

## 준비

1. ego lite 설치 (ego-browser CLI 포함), Node.js 22.18+, git, GitHub CLI
2. 사용자 환경변수 `OPENROUTER_API_KEY` 설정
3. `gh auth login` 후 `gh auth setup-git`

## 실행

```powershell
# 한 번 실행 (push 없이 테스트하려면 -NoPush)
powershell -ExecutionPolicy Bypass -File scripts\run.ps1 -Watcher flights

# 3시간마다 자동 실행 (로그인 상태에서만)
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Watcher flights -Hours 3
```

로그: `watchers/<id>/.tmp/run.log`

## 대시보드에서 "지금 검색"

조건을 바꾸고 **이 조건으로 지금 검색**을 누르면 `[run] flights ...` 제목과 `run` 라벨, 설정 JSON이 채워진 GitHub 이슈 작성 화면이 열립니다.
Submit하면 PC의 `WebWatchAgent-requests` 작업(`scripts/poll.ps1`, 2분 간격)이 이를 받아 처리합니다.

1. 저장소 소유자가 연 이슈만 받습니다.
2. `watchers/<id>/apply-config.ts`로 검증합니다.
3. `docs/<id>/config.json`을 커밋하고 바로 `run.ps1`을 실행합니다.
4. 결과를 댓글로 남기고 이슈를 닫습니다.

공개 사이트에 쓰기 토큰을 두지 않으려고 이 방식을 씁니다.

## 주의

- 화면 글자를 읽는 방식이라 사이트 구성이 바뀌면 수집이 깨질 수 있습니다.
- 레포가 공개라면 감시 조건과 가격 기록도 공개됩니다.
- Jev의 Decisions API는 알파 단계입니다.
