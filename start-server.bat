@echo off
echo ========================================
echo   Staff Rota Management System
echo   Database: danieltime
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

REM Display Node.js version
echo Node.js version:
node --version
echo.

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

REM Start the server
echo ========================================
echo Starting server for danieltime database
echo Server will be available at: http://localhost:3001
echo Press Ctrl+C to stop the server
echo ========================================
echo.
node server.js

REM If the server stops, pause to show any error messages
if %errorlevel% neq 0 (
    echo.
    echo Server stopped with error code %errorlevel%
    echo Check the error messages above for details
    pause
) else (
    echo.
    echo Server stopped normally
)
