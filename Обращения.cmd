@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - obrashcheniya
node tools\feedback-list.js %*
echo.
pause
