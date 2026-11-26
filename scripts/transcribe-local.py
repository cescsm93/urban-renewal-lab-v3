"""Recognize a 16 kHz mono WAV from stdin, entirely on this machine."""
import io
import json
import re
import sys
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
import sherpa_onnx
from pypinyin import lazy_pinyin

MODEL_DIR = Path(__file__).resolve().parents[1] / ".local-data" / "speech"


@lru_cache(maxsize=256)
def syllables(word):
    return tuple(lazy_pinyin(word))


def project_suggestion(text, names):
    """Offer only an unambiguous near-homophone, preserving the raw transcript."""
    aliases = {re.sub(r"(?:城市)?更新项目$|项目$", "", name) for name in names}
    aliases = {name for name in aliases if re.fullmatch(r"[\u3400-\u9fff]{3,20}", name)}
    possible = set()
    for run in re.finditer(r"[\u3400-\u9fff]+", text):
        words = run.group()
        sounds = syllables(words)
        for name in aliases:
            length = len(name)
            for pos in range(len(words) - length + 1):
                heard = words[pos:pos + length]
                if heard in aliases or any(alias in heard and len(alias)>=3 for alias in aliases):
                    continue
                agreement = sum(a == b for a,b in zip(heard,name))
                if agreement < max(1, length // 2) or sounds[pos:pos + length] != syllables(name):
                    continue
                begin = run.start() + pos
                possible.add((name,text[:begin] + name + text[begin + length:]))
    if len(possible) == 1:
        name, replacement = possible.pop()
        return {"name": name, "text": replacement}
    return None


def recognize(wav, names):
    with wave.open(io.BytesIO(wav), "rb") as source:
        if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (16000, 1, 2):
            raise ValueError("Expected 16 kHz mono PCM")
        audio = np.frombuffer(source.readframes(480000), dtype="<i2").astype(np.float32) / 32768
    # Compare short-time energy so a single click cannot turn silence into a question.
    blocks = audio[:len(audio)//320*320].reshape(-1, 320)
    rms = np.sqrt(np.mean(blocks ** 2, axis=1))
    active = np.flatnonzero(rms > 0.001)
    if len(active) < 6:
        return {"text": "", "reason": "quiet"}
    audio = audio[max(0,(active[0]-12)*320):(active[-1]+14)*320].copy()
    scale = min(6.0, 0.8 / max(0.001, float(np.quantile(np.abs(audio),0.995))))
    audio = np.clip(audio * scale,-1.0,1.0)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(MODEL_DIR / "model.int8.onnx"), tokens=str(MODEL_DIR / "tokens.txt"),
        language="zh", use_itn=True, num_threads=4, provider="cpu")
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, audio)
    recognizer.decode_stream(stream)
    text = re.sub(r"<\|[^|]+\|>", "", stream.result.text).strip()
    return {"text": text, "suggestion": project_suggestion(text,names)}


if __name__ == "__main__":
    names = json.loads(sys.stdin.buffer.readline(16384))
    result = recognize(sys.stdin.buffer.read(960045), names)
    print(json.dumps(result, ensure_ascii=True))
