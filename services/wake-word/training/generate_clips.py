"""Generate synthetic TTS clips for openWakeWord training using Microsoft Edge TTS.

Replaces piper-sample-generator (which depends on the archived piper-phonemize
and doesn't support Python 3.12 on Linux).

Usage:
  pip install edge-tts pydub
  python generate_clips.py --phrase "coda" --count 1500 --output ./my_custom_model

Output: WAV files at 16kHz mono in <output>/positive_clips/ — ready for
openWakeWord's --augment_clips step.
"""

import argparse
import asyncio
import random
import struct
import sys
import wave
from pathlib import Path

PHRASE_VARIATIONS = {
    "coda": ["coda", "Coda", "CODA", "coda!", "coda."],
    "hey coda": ["hey coda", "Hey Coda", "hey, coda", "Hey, Coda"],
}

RATE_VARIATIONS = ["-20%", "-10%", "+0%", "+10%", "+20%"]
PITCH_VARIATIONS = ["-5Hz", "+0Hz", "+5Hz", "+10Hz"]


async def get_english_voices():
    import edge_tts

    voices = await edge_tts.list_voices()
    return [v for v in voices if v["Locale"].startswith("en-")]


async def generate_one_clip(text, voice_name, rate, pitch, output_path):
    import edge_tts

    communicate = edge_tts.Communicate(text, voice_name, rate=rate, pitch=pitch)
    await communicate.save(str(output_path))


def mp3_to_wav16k(mp3_path, wav_path):
    from pydub import AudioSegment

    audio = AudioSegment.from_mp3(str(mp3_path))
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
    audio.export(str(wav_path), format="wav")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phrase", default="coda")
    parser.add_argument("--count", type=int, default=1500)
    parser.add_argument("--output", default="./my_custom_model")
    parser.add_argument("--val-count", type=int, default=500)
    args = parser.parse_args()

    output_dir = Path(args.output) / "positive_clips"
    output_dir.mkdir(parents=True, exist_ok=True)
    val_dir = Path(args.output) / "positive_clips_val"
    val_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(args.output) / "_tmp_mp3"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    variations = PHRASE_VARIATIONS.get(args.phrase, [args.phrase])

    print("Fetching voice list...")
    voices = await get_english_voices()
    print(f"Found {len(voices)} English voices")

    total = args.count + args.val_count
    generated = 0
    errors = 0

    for i in range(total):
        voice = random.choice(voices)
        text = random.choice(variations)
        rate = random.choice(RATE_VARIATIONS)
        pitch = random.choice(PITCH_VARIATIONS)

        is_val = i >= args.count
        dest_dir = val_dir if is_val else output_dir
        mp3_path = tmp_dir / f"clip_{i:05d}.mp3"
        wav_path = dest_dir / f"clip_{i:05d}.wav"

        try:
            await generate_one_clip(text, voice["Name"], rate, pitch, mp3_path)
            mp3_to_wav16k(mp3_path, wav_path)
            mp3_path.unlink()
            generated += 1
        except Exception as e:
            errors += 1
            if errors < 5:
                print(f"  error with {voice['Name']}: {e}")
            continue

        if (i + 1) % 50 == 0:
            split = "val" if is_val else "train"
            print(f"  [{split}] {generated}/{total} clips generated ({errors} errors)")

    print(f"\nDone: {generated} clips in {output_dir} and {val_dir}")
    print(f"Errors: {errors}")

    import shutil

    shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
