#!/usr/bin/env python3
"""Transcreve um audio com faster-whisper e imprime JSON em stdout.

Uso: transcribe_faster_whisper.py <audio> <modelo> <device> <compute_type> [idioma] [beam]

device: "cpu", "cuda" ou "auto" (tenta a GPU e, se ela nao estiver pronta,
transcreve na CPU com int8 - a fala sai do mesmo jeito, so mais devagar).

Saida:
{"language": "pt", "device": "cuda", "segments": [{"start": 0.0, "end": 1.2, "text": "...",
 "avg_logprob": -0.3, "no_speech_prob": 0.01}]}
"""
import json
import os
import sys


def add_cuda_dll_dirs() -> None:
    """No Windows, as bibliotecas CUDA instaladas pelo pip (nvidia-cublas-cu12,
    nvidia-cudnn-cu12) ficam em site-packages/nvidia/*/bin, fora do PATH: sem
    registrar essas pastas, o CTranslate2 nao acha o cublas64_12.dll."""
    if os.name != "nt":
        return
    try:
        import nvidia  # type: ignore
    except Exception:
        return
    for base in getattr(nvidia, "__path__", []):
        for lib in os.listdir(base):
            bin_dir = os.path.join(base, lib, "bin")
            if os.path.isdir(bin_dir):
                os.add_dll_directory(bin_dir)
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


def transcribe(WhisperModel, audio, model_name, device, compute_type, language, beam):
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        audio,
        language=language,
        vad_filter=True,
        beam_size=beam,
        condition_on_previous_text=False,
    )
    # "segments" e um gerador: o trabalho (e o erro de GPU, se houver) acontece
    # aqui, por isso a lista e montada dentro da tentativa.
    out = [
        {
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": seg.text.strip(),
            "avg_logprob": float(getattr(seg, "avg_logprob", 0.0)),
            "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0)),
        }
        for seg in segments
    ]
    return getattr(info, "language", None), out


def main() -> int:
    if len(sys.argv) < 5:
        print(json.dumps({"error": "argumentos insuficientes"}), file=sys.stdout)
        return 2

    # O Node le a saida como UTF-8. No Windows o Python pode escrever em cp1252
    # quando a saida e um arquivo, e os acentos da fala viram lixo.
    sys.stdout.reconfigure(encoding="utf-8")

    audio, model_name, device, compute_type = sys.argv[1:5]
    language = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] not in ("", "auto") else None
    beam = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6].isdigit() else 1

    if device in ("cuda", "auto"):
        add_cuda_dll_dirs()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - depende do ambiente
        print(json.dumps({"error": f"faster-whisper indisponivel: {exc}"}))
        return 3

    used = device
    if device == "auto":
        try:
            # float16 e o tipo nativo da GPU; o int8 configurado e o da CPU.
            lang, out = transcribe(WhisperModel, audio, model_name, "cuda", "float16", language, beam)
            used = "cuda"
        except Exception as exc:
            print(f"GPU indisponivel, usando CPU: {exc}", file=sys.stderr)
            lang, out = transcribe(WhisperModel, audio, model_name, "cpu", compute_type, language, beam)
            used = "cpu"
    else:
        lang, out = transcribe(WhisperModel, audio, model_name, device, compute_type, language, beam)

    print(json.dumps({"language": lang, "device": used, "segments": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
