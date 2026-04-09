FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libspeexdsp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY wake_word_service.py .

ENV WAKE_WORD_PORT=9000

EXPOSE 9000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/health')" || exit 1

CMD ["python", "wake_word_service.py"]
