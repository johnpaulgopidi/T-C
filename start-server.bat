@echo off
echo ========================================
echo   Staff Rota Management System
echo   Database: danieltime
echo ========================================
echo.

REM ========================================
REM   SYSTEM MODE CONFIGURATION
REM   Comment/Uncomment the appropriate line
REM ========================================
REM LOCAL SYSTEM: Uncomment this line (remove REM)
set SYSTEM_MODE=LOCAL
REM REMOTE SYSTEM: Uncomment this line (remove REM) and comment out LOCAL line above
REM set SYSTEM_MODE=REMOTE

REM ========================================
REM   REMOTE SYSTEM TAILSCALE CONFIGURATION
REM   Only used when SYSTEM_MODE=REMOTE
REM ========================================
REM Set the Tailscale IP of the database host machine
REM Find this by running 'tailscale ip' on the database host
REM NOTE: Replace 100.1.2.3 with your actual database host's Tailscale IP
set TAILSCALE_DB_HOST=100.1.2.3

echo Starting the server...
echo.

REM Change to the project directory
cd /d "%~dp0project"

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Display Node.js version
echo Node.js version:
node --version
echo.

REM ========================================
REM   TAILSCALE CONNECTIVITY CHECK
REM   Only runs in REMOTE mode
REM ========================================
if "%SYSTEM_MODE%"=="REMOTE" (
    echo Checking Tailscale connectivity...
    echo.
    
    REM Check if Tailscale is running
    tailscale status >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Tailscale is not running or not in PATH
        echo Please ensure Tailscale is installed and running
        echo Download from https://tailscale.com/download
        pause
        exit /b 1
    )
    
    echo Tailscale is running
    echo.
    
    REM Check if TAILSCALE_DB_HOST is configured
    if "%TAILSCALE_DB_HOST%"=="100.x.x.x" (
        echo WARNING: TAILSCALE_DB_HOST is set to default placeholder (100.x.x.x)
        echo Please update TAILSCALE_DB_HOST in this script with the database host's Tailscale IP
        echo Find the IP by running 'tailscale ip' on the database host machine
        echo.
    )
    
    REM Test connectivity to Tailscale IP (optional ping test)
    echo Testing connectivity to database host at %TAILSCALE_DB_HOST%...
    ping -n 1 -w 1000 %TAILSCALE_DB_HOST% >nul 2>&1
    if %errorlevel% neq 0 (
        echo WARNING: Could not reach database host at %TAILSCALE_DB_HOST%
        echo Please verify:
        echo   1. Tailscale is running on both systems
        echo   2. Both systems are in the same Tailscale network
        echo   3. The Tailscale IP is correct
        echo   4. Database host firewall allows connections
        echo.
    ) else (
        echo Successfully reached database host via Tailscale
        echo.
    )
)

REM Check if npm dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
    echo Dependencies installed successfully!
    echo.
)

REM Check if .env file exists in project directory
if not exist ".env" (
    echo WARNING: .env file not found in project directory
    echo Creating default .env file for danieltime database...
    echo DB_USER=postgres > .env
    echo DB_HOST=localhost >> .env
    echo DB_NAME=danieltime >> .env
    echo DB_PASSWORD=postgres123 >> .env
    echo DB_PORT=5432 >> .env
    echo PORT=3001 >> .env
    echo.
    echo Default .env file created for danieltime database
    echo Please update the .env file with your database credentials if needed
    echo.
) else (
    echo .env file found - using existing configuration
    echo.
)

REM Check if database setup file exists
if not exist "complete-database-setup.sql" (
    echo WARNING: complete-database-setup.sql not found
    echo Please ensure the database setup file is in the project directory
    echo.
)

REM Start the server (in a separate window) and then open the browser on port 3001
echo ========================================
echo Starting server for danieltime database
echo System Mode: %SYSTEM_MODE%
if "%SYSTEM_MODE%"=="REMOTE" (
    echo Database Host: %TAILSCALE_DB_HOST% (via Tailscale)
) else (
    echo Database Host: localhost (direct connection)
)
echo Server will be available at: http://localhost:3001
echo A browser window will open automatically.
echo ========================================
echo.

start "Shift Server" cmd /c "node server.js"

REM Wait a moment for the server to boot, then open the browser
timeout /t 3 /nobreak >nul
start "" "http://localhost:3001/"

echo Server started. You can close this window; the server runs in a separate one.
