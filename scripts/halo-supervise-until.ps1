param(
  [string]$Until = "2026-06-10T17:00:00Z",
  [int]$PollSeconds = 300,
  [switch]$FullLive,
  [bool]$SkipE2e = $true
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runsRoot = Join-Path $root "docs/eval/halo-runs"
$logPath = Join-Path $runsRoot "supervisor.log"
$statePath = Join-Path $runsRoot "supervisor-state.json"

if (-not (Test-Path $runsRoot)) {
  New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
}

function Write-SupervisorLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format o), $Message
  Add-Content -Path $logPath -Value $line -Encoding utf8
  Write-Output $line
}

function Write-SupervisorState {
  param(
    [string]$State,
    [object]$Status
  )
  $payload = [ordered]@{
    schema = 1
    pid = $PID
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    until = $Until
    pollSeconds = $PollSeconds
    fullLive = $FullLive.IsPresent
    skipE2e = $SkipE2e
    state = $State
    activeRunId = if ($Status -and $Status.activeLock) { $Status.activeLock.runId } else { $null }
    activePid = if ($Status -and $Status.activeLock) { $Status.activeLock.pid } else { $null }
    activePidAlive = if ($Status -and $Status.activeLock) { $Status.activeLock.pidAlive } else { $null }
  }
  $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $statePath -Encoding utf8
}

function Read-HaloStatus {
  try {
    $raw = & npm.cmd run halo:status -- --json 2>$null
    $jsonStart = ($raw | Select-String -Pattern "^\{" | Select-Object -First 1).LineNumber
    if (-not $jsonStart) {
      return $null
    }
    $json = ($raw | Select-Object -Skip ($jsonStart - 1)) -join "`n"
    return $json | ConvertFrom-Json
  } catch {
    Write-SupervisorLog "status read failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-ExistingSupervisorProcesses {
  try {
    return @(
      Get-CimInstance Win32_Process |
        Where-Object {
          $_.ProcessId -ne $PID -and
          $_.CommandLine -like "*-File*halo-supervise-until.ps1*" -and
          $_.CommandLine -notlike "*-Command*"
        } |
        Select-Object ProcessId,ParentProcessId,Name,CommandLine
    )
  } catch {
    return @()
  }
}

Set-Location $root
$existingSupervisors = @(Get-ExistingSupervisorProcesses)
if ($existingSupervisors.Count -gt 0) {
  $pids = ($existingSupervisors | ForEach-Object { $_.ProcessId }) -join ","
  Write-SupervisorLog "supervisor already active pid=$pids; exiting"
  exit 0
}

Write-SupervisorLog "supervisor start until=$Until pollSeconds=$PollSeconds fullLive=$($FullLive.IsPresent) skipE2e=$SkipE2e"
Write-SupervisorState "started" $null

$deadline = [DateTimeOffset]::Parse($Until)
while ([DateTimeOffset]::UtcNow -lt $deadline) {
  $status = Read-HaloStatus
  $active = $status -and $status.activeLock -and $status.activeLock.pidAlive
  if ($active) {
    Write-SupervisorState "waiting-active-runner" $status
    Write-SupervisorLog "active runner pid=$($status.activeLock.pid) runId=$($status.activeLock.runId) step=$($status.status.currentStep)"
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  $npmArgs = @("run", "halo:overnight", "--", "--until=$Until", "--sleep-minutes=30")
  if ($SkipE2e) {
    $npmArgs += "--skip-e2e"
  }
  if ($FullLive) {
    $npmArgs += "--full-live"
  } else {
    $npmArgs += "--skip-live"
  }

  Write-SupervisorLog "starting npm.cmd $($npmArgs -join ' ')"
  Write-SupervisorState "launching-runner" $status
  & npm.cmd @npmArgs 2>&1 | ForEach-Object { Add-Content -Path $logPath -Value $_ -Encoding utf8 }
  $exitCode = $LASTEXITCODE
  Write-SupervisorLog "halo:overnight exited code=$exitCode"
  Write-SupervisorState "runner-exited" (Read-HaloStatus)

  if ([DateTimeOffset]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds $PollSeconds
  }
}

Write-SupervisorLog "supervisor completed at deadline=$Until"
Write-SupervisorState "completed" (Read-HaloStatus)
