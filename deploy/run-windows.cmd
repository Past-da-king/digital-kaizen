@echo off
rem Starts Digital Kaizen from its own folder and keeps a log.
rem Used by the scheduled task that deploy\install-windows-service.ps1 creates.
cd /d "%~dp0.."
if not exist data mkdir data
node --env-file-if-exists=.env src\run.js >> data\digital-kaizen.log 2>&1
