"""openWakeWord WebSocket service for real-time wake-word detection.

Protocol:
  Client -> Server:
    1. First text message: JSON {"sample_rate": 16000} (optional, defaults to 16000)
    2. Binary messages: raw 16-bit PCM audio frames

  Server -> Client:
    1. On connect: JSON {"type": "ready", "models": ["coda"], "sample_rate": 16000}
    2. On wake detection: JSON {"type": "wake", "model": "coda", "score": 0.87, "timestamp": ...}
"""

import json
import logging
import os
import sys
import time

import numpy as np
from aiohttp import WSMsgType, web

logging.basicConfig(
    level=logging.INFO,
    format="[wake-word] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("wake-word")

from dataclasses import dataclass, field

PORT = int(os.environ.get("WAKE_WORD_PORT", "9000"))
MODEL_PATH = os.environ.get("WAKE_WORD_MODEL", "")
THRESHOLD = float(os.environ.get("WAKE_WORD_THRESHOLD", "0.5"))
VAD_THRESHOLD = float(os.environ.get("WAKE_WORD_VAD_THRESHOLD", "0.5"))
PATIENCE = int(os.environ.get("WAKE_WORD_PATIENCE", "3"))
DEBOUNCE_SEC = float(os.environ.get("WAKE_WORD_DEBOUNCE", "2.0"))
ENABLE_SPEEX = os.environ.get("WAKE_WORD_SPEEX", "false").lower() == "true"
EXPECTED_SAMPLE_RATE = 16000


@dataclass
class Metrics:
    total_detections: int = 0
    total_audio_frames: int = 0
    total_audio_seconds: float = 0.0
    start_time: float = field(default_factory=time.time)
    detection_timestamps: list = field(default_factory=list)

    def record_detection(self, model: str, score: float):
        self.total_detections += 1
        self.detection_timestamps.append(
            {"model": model, "score": score, "time": time.time()}
        )

    def record_audio(self, samples: int):
        self.total_audio_frames += 1
        self.total_audio_seconds += samples / EXPECTED_SAMPLE_RATE

    def to_dict(self):
        uptime = time.time() - self.start_time
        detections_per_hour = (
            (self.total_detections / uptime * 3600) if uptime > 0 else 0
        )
        return {
            "uptime_seconds": round(uptime, 1),
            "total_detections": self.total_detections,
            "detections_per_hour": round(detections_per_hour, 3),
            "total_audio_frames": self.total_audio_frames,
            "total_audio_seconds": round(self.total_audio_seconds, 1),
            "recent_detections": self.detection_timestamps[-20:],
        }


metrics = Metrics()


def load_model():
    import openwakeword

    model_kwargs = {
        "vad_threshold": VAD_THRESHOLD,
    }

    if ENABLE_SPEEX:
        model_kwargs["enable_speex_noise_suppression"] = True

    if MODEL_PATH:
        model_kwargs["wakeword_models"] = [MODEL_PATH]
        log.info("loading custom model: %s", MODEL_PATH)
    else:
        log.info("no custom model specified, downloading pre-trained models...")
        openwakeword.utils.download_models()

    from openwakeword.model import Model

    model = Model(**model_kwargs)
    log.info("loaded models: %s", list(model.models.keys()))
    return model


# ── Handlers ─────────────────────────────────────────────────────


async def health_handler(request):
    return web.json_response({"status": "ok", "port": PORT})


async def metrics_handler(request):
    return web.json_response(metrics.to_dict())


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    client = request.remote or "unknown"
    log.info("client connected: %s", client)

    model = request.app["model"]
    model_names = list(model.models.keys())
    sample_rate = EXPECTED_SAMPLE_RATE
    resampler = None

    await ws.send_json(
        {
            "type": "ready",
            "models": model_names,
            "sample_rate": EXPECTED_SAMPLE_RATE,
            "threshold": THRESHOLD,
        }
    )

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    config = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue

                if "sample_rate" in config:
                    sample_rate = int(config["sample_rate"])
                    log.info("client sample rate: %d Hz", sample_rate)
                    if sample_rate != EXPECTED_SAMPLE_RATE:
                        import resampy

                        resampler = lambda data: resampy.resample(
                            data.astype(np.float32),
                            sample_rate,
                            EXPECTED_SAMPLE_RATE,
                        ).astype(np.int16)
                    else:
                        resampler = None

                msg_type = config.get("type")
                if msg_type == "resume":
                    model.reset()
                    log.debug("model state reset on resume")

            elif msg.type == WSMsgType.BINARY:
                audio_data = np.frombuffer(msg.data, dtype=np.int16)
                if len(audio_data) == 0:
                    continue

                metrics.record_audio(len(audio_data))

                if resampler is not None:
                    audio_data = resampler(audio_data)

                predictions = model.predict(
                    audio_data,
                    patience={name: PATIENCE for name in model_names},
                    threshold={name: THRESHOLD for name in model_names},
                    debounce_time=DEBOUNCE_SEC,
                )

                for name, score in predictions.items():
                    if score >= THRESHOLD:
                        metrics.record_detection(name, float(score))
                        log.info("WAKE DETECTED: model=%s score=%.4f", name, score)
                        await ws.send_json(
                            {
                                "type": "wake",
                                "model": name,
                                "score": round(float(score), 4),
                                "timestamp": int(time.time() * 1000),
                            }
                        )

            elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break

    except Exception:
        log.exception("error in WebSocket handler")
    finally:
        log.info("client disconnected: %s", client)

    return ws


# ── App ──────────────────────────────────────────────────────────


def create_app():
    app = web.Application()
    log.info("initializing openWakeWord...")
    app["model"] = load_model()
    app.router.add_get("/health", health_handler)
    app.router.add_get("/metrics", metrics_handler)
    app.router.add_get("/ws", websocket_handler)
    return app


if __name__ == "__main__":
    app = create_app()
    log.info("starting on port %d", PORT)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)
