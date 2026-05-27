@echo off
echo Запуск процессов antigravity...

:: Запускаем первую команду через call
call remoat open

:: Ожидание 5 секунд
echo Ожидание 5 секунд...
timeout /t 5 /nobreak

:: Запускаем вторую команду через call
call remoat start

:: Принудительно оставляем окно открытым
echo Все команды выполнены. Окно остается активным.
cmd /k