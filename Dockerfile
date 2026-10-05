FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TODO_DB=/data/todo.db \
    TODO_PORT=7670 \
    TODO_FRONTEND_DIST=/app/frontend/dist
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY todo_app/ todo_app/
COPY --from=web /web/dist frontend/dist
VOLUME ["/data"]
EXPOSE 7670

# Commit the image was built from; reported as service.version on traces.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}

HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"TODO_PORT\"]}/health', timeout=3)"
CMD ["python", "main.py"]
