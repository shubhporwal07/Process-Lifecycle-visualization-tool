@echo off
echo.
echo   Building Process Lifecycle Visualization Tool...
echo   ================================================
echo.
gcc -o process_server.exe process_engine.c -lws2_32
if %errorlevel% == 0 (
    echo   [OK] Build successful: process_server.exe
    echo.
    echo   To run: process_server.exe
    echo   Then open: http://localhost:8080
) else (
    echo   [ERROR] Build failed!
)
echo.
pause
