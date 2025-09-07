@echo off
echo ========================================
echo   Staff Rota Management System
echo ========================================
echo.
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

REM Check if npm dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Check if .env file exists
if not exist ".env" (
    echo WARNING: .env file not found
    echo Creating default .env file...
    echo DB_USER=postgres > .env
    echo DB_HOST=localhost >> .env
    echo DB_NAME=work_scheduler >> .env
    echo DB_PASSWORD=postgres123 >> .env
    echo DB_PORT=5432 >> .env
    echo PORT=3001 >> .env
    echo.
    echo Please update the .env file with your database credentials
    echo.
)

REM Start the server
echo Starting server on http://localhost:3001
echo Press Ctrl+C to stop the server
echo.
npm start

REM If the server stops, pause to show any error messages
if %errorlevel% neq 0 (
    echo.
    echo Server stopped with error code %errorlevel%
    pause
)
