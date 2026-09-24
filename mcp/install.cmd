@echo off
rem Chippy — install the MCP server in Claude Desktop.
rem Double-click this file, or run it from a terminal with options, e.g.
rem   mcp\install.cmd --folder "C:\Users\me\OneDrive\Notebook" --read-only --claude-code
rem   mcp\install.cmd --uninstall
rem All options: mcp\install.cmd --help

setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found. Install it from https://nodejs.org ^(LTS^), then run this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0..\scripts\setup-mcp.mjs" %*
set RC=%ERRORLEVEL%

rem Keep the window open when started by double-click (no arguments).
if "%~1"=="" (
  echo.
  pause
)
exit /b %RC%
