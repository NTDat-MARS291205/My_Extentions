@echo off
title YT Music Saver - Cai dat Native Host

echo.
echo ============================================
echo    YT Music Saver - Cai dat Native Host
echo ============================================
echo.

:: ── Set Python cố định ──────────────────────────────────────
set "PYTHON_EXE=C:\Users\Admin\AppData\Local\Programs\Python\Python313\python.exe"

if not exist "%PYTHON_EXE%" (
    echo [LOI] Khong tim thay Python tai: %PYTHON_EXE%
    pause
    exit /b 1
)

echo [OK] Python: %PYTHON_EXE%

if not defined PYTHON_EXE (
    echo [LOI] Khong tim thay Python!
    echo       Hay cai Python tai: https://python.org/downloads
    echo.
    pause
    exit /b 1
)
echo [OK] Python: %PYTHON_EXE%

:: ── Kiem tra native_host.py ─────────────────────────────────
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "HOST_SCRIPT=%SCRIPT_DIR%\native_host.py"

if not exist "%HOST_SCRIPT%" (
    echo [LOI] Khong tim thay file: %HOST_SCRIPT%
    echo.
    pause
    exit /b 1
)
echo [OK] native_host.py: %HOST_SCRIPT%

:: ── Huong dan lay Extension ID ───────────────────────────────
echo.
echo ============================================
echo   BUOC QUAN TRONG: Lay Extension ID
echo ============================================
echo.
echo 1. Mo Chrome
echo 2. Vao dia chi: chrome://extensions/
echo 3. Bat "Developer mode" (goc tren phai)
echo 4. Tim "YT Music Saver" trong danh sach
echo 5. Copy day ky tu ID ben duoi ten extension
echo    Vi du: abcdefghijklmnopqrstuvwxyz123456
echo.

set /p EXT_ID="Nhap Extension ID cua ban: "

:: Xoa khoang trang neu co
set "EXT_ID=%EXT_ID: =%"

if "%EXT_ID%"=="" (
    echo.
    echo [LOI] Ban chua nhap Extension ID!
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Extension ID: %EXT_ID%

:: ── Tao file manifest JSON ───────────────────────────────────
set "MANIFEST_PATH=%SCRIPT_DIR%\com.ytmusicsaver.server.json"

:: Path tới run.bat
set "RUN_BAT=%SCRIPT_DIR%\run.bat"
set "RUN_BAT_JSON=%RUN_BAT:\=\\%"

(
echo {
echo   "name": "com.ytmusicsaver.server",
echo   "description": "YT Music Saver Native Host",
echo   "path": "%RUN_BAT_JSON%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

echo [OK] Tao file manifest JSON thanh cong

:: ── Ghi vao Registry Chrome ──────────────────────────────────
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytmusicsaver.server"
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

if errorlevel 1 (
    echo [LOI] Ghi Registry that bai!
    echo       Thu chay file nay bang "Run as Administrator"
    echo.
    pause
    exit /b 1
)
echo [OK] Da ghi Registry Chrome

:: Cung dang ky cho Edge neu co
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.ytmusicsaver.server" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

:: ── Tao shortcut Start Server.bat ────────────────────────────
set "SERVER_DIR=%SCRIPT_DIR%\..\server"
(
echo @echo off
echo title YT Music Saver Server
echo cd /d "%SERVER_DIR%"
echo "%PYTHON_EXE%" server.py
echo pause
) > "%SERVER_DIR%\Start Server.bat"

echo [OK] Da tao "Start Server.bat" trong thu muc server\

:: ── Hoan tat ─────────────────────────────────────────────────
echo.
echo ============================================
echo   CAI DAT THANH CONG!
echo ============================================
echo.
echo Buoc tiep theo:
echo 1. Vao chrome://extensions/
echo 2. Nhan nut Reload tren "YT Music Saver"
echo 3. Mo video YouTube bat ky
echo 4. Click icon extension ^> Tab "Server"
echo 5. Nhan "KHOI DONG SERVER"
echo.
pause
