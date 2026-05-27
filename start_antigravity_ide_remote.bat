@echo off
echo Запуск процессов antigravity...

:: Запускаем первую команду через call
call remoat open

:: Ожидание 15 секунд
echo Ожидание 15 секунд...
timeout /t 15 /nobreak

:: Запускаем вторую команду через call
call remoat start

:: Принудительно оставляем окно открытым
echo Все команды выполнены. Окно остается активным.
cmd /k