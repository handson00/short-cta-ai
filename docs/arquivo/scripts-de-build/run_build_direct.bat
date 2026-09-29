@echo off
REM Navigate to project directory  
cd /d E:\short-cta-ai

REM Run npm build and capture output
echo Starting npm build...
npm run build > build_output.log 2>&1

REM Check result
if %errorlevel% equ 0 (
  echo Build successful!
  type build_output.log
) else (
  echo Build failed with error code %errorlevel%
  type build_output.log
)

REM Keep window open
pause
