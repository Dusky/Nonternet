# The MUD (docs/09). Build context is the repo root: docker build -f services/mud/Dockerfile .
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /game
COPY services/mud/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY services/mud/ ./
RUN useradd --create-home mud && chown -R mud:mud /game
USER mud
# 4000 telnet (public), 4001 internal web server (core only), 4002 WebSocket (behind Caddy at /ws/mud)
EXPOSE 4000 4001 4002
HEALTHCHECK --interval=15s --timeout=4s --retries=10 CMD ["python", "server/healthcheck.py"]
# `start -l` keeps the container in the foreground, following Evennia's log.
CMD ["sh", "-c", "python server/ensure_db.py && evennia migrate && exec evennia start -l"]
