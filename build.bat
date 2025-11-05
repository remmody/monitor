@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set VERSION=dev
set LDFLAGS=-s -w

echo === Building Monitor v%VERSION% ===
echo.

if not exist bin mkdir bin

echo [1/3] Building Linux AMD64...
set CGO_ENABLED=0
set GOOS=linux
set GOARCH=amd64
go build -ldflags="%LDFLAGS%" -trimpath -o bin/monitor-linux-amd64 ./cmd/monitor
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
echo       ✓ bin/monitor-linux-amd64
echo.

echo [2/3] Building Linux ARM64...
set CGO_ENABLED=0
set GOOS=linux
set GOARCH=arm64
go build -ldflags="%LDFLAGS%" -trimpath -o bin/monitor-linux-arm64 ./cmd/monitor
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
echo       ✓ bin/monitor-linux-arm64
echo.

echo [3/3] Building Windows AMD64...
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64
go build -ldflags="%LDFLAGS%" -trimpath -o bin/monitor-windows-amd64.exe ./cmd/monitor
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
echo       ✓ bin/monitor-windows-amd64.exe
echo.

echo === Build complete! ===
echo.
dir bin
