@echo off
REM Kampung Kaki -- install + build locally, then deploy to Vercel.
REM Usage:
REM   build.bat                build + deploy production to Vercel
REM   build.bat --no-deploy    build only (no Vercel call)
REM   build.bat --preview      build + deploy a Vercel preview (non-prod)
setlocal
cd /d "%~dp0"

set "DEPLOY=prod"
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-deploy" set "DEPLOY=none"
if /I "%~1"=="--preview"   set "DEPLOY=preview"
if /I "%~1"=="-h"          goto show_help
if /I "%~1"=="--help"      goto show_help
shift
goto parse_args
:show_help
echo usage: build.bat [--no-deploy^|--preview]
exit /b 0
:args_done

where node >nul 2>&1
if errorlevel 1 (
  echo !! node.js not found. Install Node 20+ first ^(https://nodejs.org^).
  exit /b 1
)
for /f %%V in ('node -v') do echo ^>^> node: %%V

echo ^>^> installing dependencies...
if exist package-lock.json (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
if errorlevel 1 exit /b 1

echo ^>^> building production bundle...
call npm run build
if errorlevel 1 exit /b 1
echo ^>^> [OK] local build complete (dist\)

if /I "%DEPLOY%"=="none" (
  echo ^>^> skipping Vercel deploy (--no-deploy)
  exit /b 0
)

echo.
echo ^>^> deploying to Vercel (%DEPLOY%)...
echo ^>^> first run will prompt to log in and link this folder to a project.

set "VERCEL_FLAGS=--yes"
if not "%VERCEL_TOKEN%"=="" set "VERCEL_FLAGS=%VERCEL_FLAGS% --token %VERCEL_TOKEN%"
if /I "%DEPLOY%"=="prod" set "VERCEL_FLAGS=%VERCEL_FLAGS% --prod"

call npx --yes vercel@latest %VERCEL_FLAGS%
if errorlevel 1 exit /b 1

echo.
echo ^>^> [OK] deploy command finished. Check the URL printed above.
