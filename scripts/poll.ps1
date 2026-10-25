# Handles "지금 검색" requests from the dashboard. The page opens a GitHub issue titled
# "[run] <watcher>" with label "run" (and optionally a ```json config block). This script,
# run every few minutes by the scheduler, picks up the newest open request from the repo
# owner, applies the config, runs the watcher immediately, comments the result and closes it.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
$utf8 = New-Object Text.UTF8Encoding $false
Push-Location $root
try {
  $issues = @(gh issue list --label run --state open --json number,title,body,author --limit 20 | ConvertFrom-Json)
  if ($issues.Count -eq 0) { exit 0 }
  $owner = gh repo view --json owner --jq .owner.login
  $pages = gh api "repos/{owner}/{repo}/pages" --jq .html_url

  function Reply($n, $text) {
    $f = Join-Path $env:TEMP "wwa-comment-$n.md"
    [IO.File]::WriteAllText($f, $text, $utf8)
    gh issue comment $n --body-file $f | Out-Null
    gh issue close $n | Out-Null
    Remove-Item $f -ErrorAction SilentlyContinue
  }

  $mine = @($issues | Where-Object { $_.author.login -eq $owner } | Sort-Object number)
  foreach ($i in @($issues | Where-Object { $_.author.login -ne $owner })) { Reply $i.number "저장소 소유자의 요청만 처리합니다." }
  if ($mine.Count -eq 0) { exit 0 }
  $req = $mine[-1]
  foreach ($old in $mine[0..($mine.Count - 2)] | Where-Object { $_ -and $_.number -ne $req.number }) {
    Reply $old.number "더 최근 요청 #$($req.number)으로 대체했습니다."
  }

  $id = "flights"
  if ($req.title -match '^\[run\]\s+([a-z0-9-]+)') { $id = $Matches[1] }
  if (-not (Test-Path "watchers\$id\scrape.mjs")) { Reply $req.number "알 수 없는 감시 대상입니다: $id"; exit 0 }
  $tmp = "watchers\$id\.tmp"; New-Item -ItemType Directory -Force $tmp | Out-Null

  $note = "현재 저장된 조건으로 다시 검색했습니다."
  if ($req.body -match '(?s)```json\s*(.*?)```') {
    [IO.File]::WriteAllText((Join-Path $root "$tmp\request.json"), $Matches[1], $utf8)
    git pull --rebase --quiet
    $applied = node "watchers/$id/apply-config.ts" "$tmp/request.json"
    if ($LASTEXITCODE -ne 0) { Reply $req.number "조건이 올바르지 않아 적용하지 않았습니다: $applied"; exit 0 }
    git add "docs/$id/config.json"
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit --quiet -m "config($id): from dashboard request #$($req.number)"
      git push --quiet
    }
    $note = "새 조건을 적용하고 검색했습니다. ($applied)"
  }

  $out = powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 -Watcher $id
  $ok = $LASTEXITCODE -eq 0
  $summary = ($out | Where-Object { "$_" -match '최저|failed|not set' } | Select-Object -Last 1)
  if ($ok) { Reply $req.number "$note`n`n결과: $summary`n`n대시보드: $pages$id/" }
  else { Reply $req.number "검색 중 오류가 났습니다: $summary`n로그: watchers/$id/.tmp/run.log" }
} finally { Pop-Location }
