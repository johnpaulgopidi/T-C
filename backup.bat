@echo off
REM PostgreSQL Backup Script
REM This script creates a backup of the PostgreSQL database
REM It replaces the previous backup file each time it runs

set PGPASSWORD=postgres123
REM Set backup directory to T-C\backups (same level as this script and start-server.bat)
REM Script is in T-C\, so backups folder is in the same directory
set SCRIPT_DIR=%~dp0
set BACKUP_DIR=%SCRIPT_DIR%backups
set DB_NAME=danieltimes

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" (
    echo Creating backup directory: %BACKUP_DIR%
    mkdir "%BACKUP_DIR%"
)

REM Use a single backup file that gets replaced each time
set BACKUP_FILE=%BACKUP_DIR%\backup.dump

REM Create backup (will overwrite previous backup if it exists)
echo [%date% %time%] Creating backup: %BACKUP_FILE%
pg_dump -U postgres -d %DB_NAME% -F c -f "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Backup completed successfully: %BACKUP_FILE%
    exit /b 0
) else (
    echo [%date% %time%] ERROR: Backup failed with error code: %ERRORLEVEL%
    echo [%date% %time%] Please check PostgreSQL is running and credentials are correct.
    exit /b 1
)
