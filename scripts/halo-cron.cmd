@echo off
REM HALO overnight cron wrapper. Fired by the Windows Scheduled Task "NodeRoom-HALO-Overnight"
REM every 25 min until the June 10 10:00 AM PDT handoff. Each fire asks the
REM lock-aware supervisor to wait behind any active runner and continue
REM deterministic HALO coverage without overlapping artifact writers.
setlocal
set "PATH=C:\nvm4w\nodejs;%PATH%"
cd /d "D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom"
if not exist "docs\eval\halo-runs" mkdir "docs\eval\halo-runs"
echo [%date% %time%] cron fire: start >> "docs\eval\halo-runs\cron.log"
powershell -NoProfile -Command "$p=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*-File*halo-supervise-until.ps1*' -and $_.CommandLine -notlike '*-Command*' }); if ($p.Count -gt 0) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo [%date% %time%] cron fire: supervisor already active; skip >> "docs\eval\halo-runs\cron.log"
  goto done
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\halo-supervise-until.ps1" -Until "2026-06-10T17:00:00Z" -PollSeconds 300 >> "docs\eval\halo-runs\cron.log" 2>&1
:done
echo [%date% %time%] cron fire: end exit=%errorlevel% >> "docs\eval\halo-runs\cron.log"
endlocal
