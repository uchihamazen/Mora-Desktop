@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required to open Mora Desktop. Install it and retry.
  exit /b 1
)
node "%~dp0scripts\launch.cjs"
