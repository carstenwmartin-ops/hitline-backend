@echo off
echo Starting HITLINE Backend...
cd /d "%~dp0"
start cmd /k "node server.js"
timeout /t 2
echo Opening HITLINE...
start "" "C:\Users\carst\Documents\Hitline\Hitline.html"