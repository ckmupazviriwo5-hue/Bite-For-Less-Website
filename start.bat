@echo off
REM ============================================================
REM  Bite For Less - local demo launcher (Express + SQLite)
REM  Starts the API + website on http://localhost:5000 and opens it.
REM ============================================================
setlocal
cd /d "%~dp0"

echo [Bite For Less] Starting local API on port 5000 (nodemon live reload)...
if not exist "backend\data\biteforless.db" (
  echo [Bite For Less] No database found - running first-run migrate + seed...
  call npm run migrate
  call npm run seed
)

start "Bite For Less API" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
start "" http://localhost:5000

echo [Bite For Less] Demo logins: admin@biteforless.test / admin123
echo [Bite For Less]              customer@example.com / password123
echo [Bite For Less]              shopowner@example.com / password123
echo.
echo Close the opened "Bite For Less API" window to stop the server.
endlocal
