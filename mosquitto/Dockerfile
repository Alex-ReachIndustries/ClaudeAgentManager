FROM eclipse-mosquitto:2

COPY config/mosquitto.conf /mosquitto/config/mosquitto.conf
COPY config/generate-passwd.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
