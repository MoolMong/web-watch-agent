# web-watch-agent

웹사이트를 주기적으로 확인하고, 알릴 가치가 있는지 AI가 판단해 대시보드에 보여 주는 개인용 감시 에이전트입니다.

- **수집**: [ego lite](https://github.com/citrolabs/ego-lite) 브라우저가 내 PC에서 사이트를 엽니다(읽기 전용).
- **판단**: OpenRouter의 TypeSafe **Jev**(`~typesafe/jev-latest`)가 "지금 알릴 때인가"를 확률로 답합니다.
- **저장·통신**: Supabase(Postgres + 로그인 + 실시간). 대시보드의 "지금 검색" 요청과 확인 결과가 여기 저장됩니다.
- **대시보드**: GitHub Pages(`docs/`). 소유자 로그인 후에만 데이터가 보입니다.
- **결제·예매는 자동으로 하지 않습니다.**

```
대시보드 ──(요청 insert)──▶ Supabase ◀──(5초마다 확인, 결과 저장)── PC 에이전트 ── ego lite / Jev
```

## 감시 대상

| id | 내용 | 상태 |
|---|---|---|
| `flights` | 여러 감시(조건별) 목록 · 일괄 생성. 구글 항공권 최저가 + 구매 시점 판단, 구글 호텔(평점 필터) + Jev 숙소 유형 태그 | 동작 중 |
| `udemy` | Udemy 특정 강의 할인가 | 예정 |
| `ktx` | KTX 매진 열차 취소표 | 예정 |

## 구조

```
core/agent.ts               PC 에이전트: 요청 처리 + 켜 둔 감시 정기 확인 + 결과 저장
core/db.ts                  Supabase REST 클라이언트 (secret key)
core/jev.ts                 Jev(OpenRouter Decisions API) 호출
watchers/<id>/index.ts      감시 대상 정의 (기본 조건, 검증, 판단, 주기)
watchers/<id>/scrape.mjs    ego-browser로 페이지 읽기
watchers/<id>/judge.ts      Jev 판단
docs/                       대시보드 (GitHub Pages)
supabase/schema.sql         테이블 + RLS + 실시간 설정
scripts/start-agent.ps1     에이전트 실행 (-Once로 한 번만)
scripts/register-task.ps1   로그인 시 에이전트 자동 실행 등록
scripts/write-site-config.ps1  docs/config.js 생성 (URL + publishable key)
```

새 감시 대상은 `watchers/<id>/`를 만들고 `core/agent.ts`의 `WATCHERS`, `docs/<id>/`, `docs/watchers.json`에 추가합니다.

## 설정

1. Supabase 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`, 이어서 `supabase/migrations/002_watches.sql`을 실행합니다.
2. Authentication에서 본인 계정(이메일+비밀번호)을 추가한 뒤 **Allow new users to sign up**을 끕니다.
3. 사용자 환경변수를 설정합니다.
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY` (공개용)
   - `SUPABASE_SECRET_KEY` (PC 전용, 절대 커밋 금지)
   - `OPENROUTER_API_KEY`
4. `scripts\write-site-config.ps1`을 실행하고 `docs/config.js`를 커밋합니다.
5. `scripts\register-task.ps1`을 실행한 뒤 `Start-ScheduledTask -TaskName WebWatchAgent`로 시작합니다.

로그: `core/.tmp/agent.log`
