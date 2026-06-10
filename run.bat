@echo off
REM Kampung Kaki -- local run only.
REM Usage:
REM   run.bat            preview on http://localhost:5173 (build if needed)
REM   run.bat dev        vite dev server on http://localhost:3000
setlocal
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=preview"

where node >nul 2>&1
if errorlevel 1 (
  echo !! node.js not found. Install Node 20+ first ^(https://nodejs.org^).
  exit /b 1
)
for /f %%V in ('node -v') do echo ^>^> node: %%V

REM free common dev ports
for %%P in (3000 4173 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo ^>^> freeing port %%P (pid %%A)
    taskkill /F /PID %%A >nul 2>&1
  )
)

if not exist node_modules (
  echo ^>^> installing dependencies...
  if exist package-lock.json (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 exit /b 1
)

if /I "%MODE%"=="dev" (
  echo ^>^> vite dev server on http://localhost:3000
  call npm run dev
  goto :eof
)

if /I "%MODE%"=="preview" (
  if not exist dist (
    echo ^>^> no dist\, building first...
    call npm run build
    if errorlevel 1 exit /b 1
  )
  echo ^>^> vite preview on http://localhost:5173
  call npx vite preview --host 0.0.0.0 --port 5173
  goto :eof
)

echo !! unknown mode: %MODE%
echo    usage: run.bat [dev^|preview]
exit /b 2
