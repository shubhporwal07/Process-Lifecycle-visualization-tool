@echo off
echo   Starting Process Lifecycle Visualization Tool...
echo.
start process_server.exe
timeout /t 2 /nobreak >nul
start http://localhost:8080
echo   Server started. Browser opening...
echo   Press Ctrl+C in server window to stop.
