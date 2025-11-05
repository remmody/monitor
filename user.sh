# Создать системного пользователя (без доступа к shell)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin monitor

# Установить права на файлы
sudo chown monitor:monitor /opt/monitor/monitor-linux-amd64
sudo chmod 755 /opt/monitor/monitor-linux-amd64
sudo chown -R monitor:monitor /opt/monitor

# Перезагрузить systemd
sudo systemctl daemon-reload

# Запустить
sudo systemctl start monitor
sudo systemctl status monitor
