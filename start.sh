cd /home/asus/PROJECT/MonoGS && MONOGS_DIR=$(pwd) /home/asus/PROJECT/monogs_env/bin/python gx10_server.py &
sleep 2 && curl -s http://localhost:8081/status/test