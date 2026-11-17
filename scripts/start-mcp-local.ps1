$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoPath
$pilotState = Join-Path (Split-Path -Parent $repoPath) 'pilot-state'
$pgReady = Join-Path $pilotState 'pgsql\bin\pg_isready.exe'
$pgCtl = Join-Path $pilotState 'pgsql\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $pgReady)) {
  throw 'A helyi PostgreSQL tesztfuttató hiányzik a pilot-state\pgsql könyvtárból.'
}
& $pgReady -h 127.0.0.1 -p 55439 -U memorybook_test | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D (Join-Path $pilotState 'pgdata') -l (Join-Path $pilotState 'mcp-postgres.log') -o '-h 127.0.0.1 -p 55439' start
  if ($LASTEXITCODE -ne 0) { throw 'A helyi tesztadatbázis nem indult el.' }
}
$env:DATABASE_URL = 'postgresql://memorybook_test@127.0.0.1:55439/memorybook_wedding_test'
$env:NODE_ENV = 'test'
$env:WEDDING_LOCAL_DATABASE_ACK = 'yes'
Write-Output 'Fiktív helyi pilot: http://127.0.0.1:5190/pilot/account'
Write-Output 'Fiók: mcp-pilot@example.test / memorybook-pilot'
Write-Output 'Leállítás: Ctrl+C. Az elkülönített fiktív tesztadatok megmaradnak.'
node --import tsx scripts/mcp-local-demo.ts
if ($LASTEXITCODE -ne 0) { throw 'A helyi MCP-pilot hibával leállt.' }
