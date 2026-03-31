"""Lightweight HTTP wrapper around piper-tts.

Endpoints:
  POST /synthesize  — JSON body {"text": "...", "speaker": "...", "speaking_rate": 1.0}
                      Returns audio/wav (16-bit mono PCM in WAV container)
  GET  /health      — Returns 200 if the model is loaded
"""

import io
import json
import os
import struct
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL_PATH = os.environ.get("PIPER_MODEL", "/models/en_US-lessac-medium.onnx")
PIPER_BINARY = os.environ.get("PIPER_BINARY", "piper")
PORT = int(os.environ.get("PIPER_PORT", "5000"))
SAMPLE_RATE = 22050
SAMPLE_WIDTH = 2  # 16-bit
CHANNELS = 1


def pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap raw PCM in a WAV header."""
    buf = io.BytesIO()
    data_size = len(pcm)
    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    # fmt chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))  # chunk size
    buf.write(struct.pack("<H", 1))  # PCM format
    buf.write(struct.pack("<H", CHANNELS))
    buf.write(struct.pack("<I", SAMPLE_RATE))
    buf.write(struct.pack("<I", SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH))  # byte rate
    buf.write(struct.pack("<H", CHANNELS * SAMPLE_WIDTH))  # block align
    buf.write(struct.pack("<H", SAMPLE_WIDTH * 8))  # bits per sample
    # data chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


def synthesize(text: str, speaker: str | None = None) -> bytes:
    """Run piper and return raw PCM bytes."""
    args = [PIPER_BINARY, "--model", MODEL_PATH, "--output-raw"]
    if speaker:
        args.extend(["--speaker", speaker])

    proc = subprocess.run(
        args,
        input=text.encode("utf-8"),
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"piper exited {proc.returncode}: {proc.stderr.decode()}")
    return proc.stdout


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "model": MODEL_PATH}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}

        text = body.get("text", "")
        if not text:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "text is required"}).encode())
            return

        speaker = body.get("speaker")

        try:
            pcm = synthesize(text, speaker)
            wav = pcm_to_wav(pcm)

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        print(f"[piper-http] {args[0]}", flush=True)


if __name__ == "__main__":
    # Verify model exists at startup
    if not os.path.isfile(MODEL_PATH):
        print(f"[piper-http] ERROR: model not found at {MODEL_PATH}", file=sys.stderr)
        print(f"[piper-http] Mount a model volume or set PIPER_MODEL", file=sys.stderr)
        sys.exit(1)

    print(f"[piper-http] model: {MODEL_PATH}", flush=True)
    print(f"[piper-http] listening on :{PORT}", flush=True)

    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
