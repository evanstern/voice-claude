FROM python:3.11-slim

RUN pip install --no-cache-dir piper-tts pathvalidate

WORKDIR /app
COPY server.py .

ENV PIPER_MODEL=/models/en_US-lessac-medium.onnx
ENV PIPER_PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

CMD ["python", "server.py"]
