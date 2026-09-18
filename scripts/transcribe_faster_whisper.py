#!/usr/bin/env python3
"""Transcreve um audio com faster-whisper e imprime JSON em stdout.

Uso: transcribe_faster_whisper.py <audio> <modelo> <device> <compute_type> [idioma]

Saida:
{"language": "pt", "segments": [{"start": 0.0, "end": 1.2, "text": "...",
 "avg_logprob": -0.3, "no_speech_prob": 0.01}]}
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 5:
        print(json.dumps({"error": "argumentos insuficientes"}), file=sys.stdout)
        return 2

    audio, model_name, device, compute_type = sys.argv[1:5]
    language = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] not in ("", "auto") else None

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - depende do ambiente
        print(json.dumps({"error": f"faster-whisper indisponivel: {exc}"}))
        return 3

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        audio,
        language=language,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )

    out = []
    for seg in segments:
        out.append(
            {
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": seg.text.strip(),
                "avg_logprob": float(getattr(seg, "avg_logprob", 0.0)),
                "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0)),
            }
        )

    print(json.dumps({"language": getattr(info, "language", None), "segments": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
