@echo off
cd /d "E:\Facebook Ads\github-repo"
git add data/competitor_snapshots.json data/competitor_baseline.json data/radar-latest.json known_competitors.json
git commit -m "Radar: cap nhat doi thu %date:~0,10%"
git push origin main
echo.
echo Push hoan tat! Dashboard se tu dong deploy len Cloudflare Pages.
pause
