@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 20 o posterior y vuelve a abrir esta ventana.& pause & exit /b 1)
where adb >nul 2>nul || (echo Instala Android Platform Tools y agrega adb al PATH.& pause & exit /b 1)
if not exist node_modules\ws (call npm install --omit=dev || (pause & exit /b 1))
call npm start
pause
