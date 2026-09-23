@echo off
chcp 65001 >nul
title MAAPVZ 游戏助手 - 启动中
color 0A

cd /d "%~dp0"

echo ========================================
echo   正在启动 Flask 服务...
echo ========================================

:: ---------------------------------------------------------------
:: 选择带 flask 的 Python 解释器：
::   1) 优先项目自带 .venv（requirements.txt 已含 Flask>=3.1.0）
::   2) .venv 缺 flask 时回退到本机已装 flask 的解释器
:: ---------------------------------------------------------------
set "PYEXE=..\..\.venv\Scripts\python.exe"
"%PYEXE%" -c "import flask" >nul 2>&1
if errorlevel 1 (
    if exist "D:\ana\python.exe" (
        set "PYEXE=D:\ana\python.exe"
    ) else (
        set "PYEXE=python.exe"
    )
    echo [提示] 项目 .venv 未安装 flask，改用 %PYEXE%
    echo        建议执行: ..\..\.venv\Scripts\python.exe -m pip install -r ..\..\requirements.txt
)

:: 后台启动 Flask，日志写入临时文件
start /b "" "%PYEXE%" pvz.py > flask.log 2>&1

:: 进度条最大长度（步数）
set MAX_STEPS=20
set STEP=0
set /p "=进度: [" <nul

:loop
:: 检测服务是否就绪
for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://127.0.0.1:5000 2^>nul') do set CODE=%%i

if "%CODE%"=="200" (
    :: 填充剩余进度
    set /a REMAIN=%MAX_STEPS%-%STEP%
    for /l %%j in (1,1,!REMAIN!) do set /p "=#" <nul
    echo ] 服务就绪！

    :: 清屏，去掉所有进度条内容
    cls
    echo ========================================
    echo   Flask 服务已启动
    echo ========================================
    echo ----------------------------------------
    :: 使用 PowerShell 读取日志文件尾部
    powershell -Command "Get-Content flask.log -Tail 5"
    echo ----------------------------------------
    echo 完整日志请查看当前目录下的 flask.log
    echo.
    echo 正在打开浏览器...
    timeout /t 2 /nobreak >nul
    start http://127.0.0.1:5000
    exit /b
)

:: 进度推进
set /a STEP+=1
if %STEP% geq %MAX_STEPS% (
    echo ] 超时：服务启动失败，请检查 flask.log
    pause
    exit /b
)

set /p "=#" <nul
ping -n 1 -w 500 127.0.0.1 >nul
goto loop
