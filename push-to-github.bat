@echo off
REM Double-click file này để auto pull-rebase + push lên GitHub
REM (dùng cho Windows, không cần PowerShell)

cd /d "%~dp0"
echo.
echo =========================================
echo   Push Doscom repo to GitHub
echo =========================================
echo.

echo [1/2] Pulling latest changes (rebase)...
git pull --rebase origin main
if errorlevel 1 (
    echo.
    echo [X] Pull/rebase failed. Co the co conflict trong data/.
    echo     Chay lenh sau de giai quyet:
    echo     git checkout --theirs data/
    echo     git add data/
    echo     git rebase --continue
    echo.
    pause
    exit /b 1
)

echo.
echo [2/2] Pushing to GitHub...
git push origin main
if errorlevel 1 (
    echo.
    echo [X] Push failed. Kiem tra credentials hoac network.
    echo.
    pause
    exit /b 1
)

echo.
echo =========================================
echo   [OK] Pushed successfully!
echo =========================================
echo.
echo Gio vao trang sau de trigger 4 workflow moi manual:
echo https://github.com/hxduy93/facebook-ads-dashboard/actions
echo.
pause
