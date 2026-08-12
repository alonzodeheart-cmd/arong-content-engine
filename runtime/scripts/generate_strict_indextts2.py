#!/usr/bin/env python3
"""Strict local IndexTTS2 production helper.

Adapted from the installed tts-skill helper. The only workspace-specific
change is that every path is passed explicitly, so the helper can live inside
the content pipeline without guessing a global workspace root.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def capture(command: list[str], cwd: Path | None = None) -> str:
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def gpu_free_mb() -> int | None:
    try:
        output = capture(
            [
                "nvidia-smi",
                "--query-gpu=memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ]
        )
        used, total = [int(value.strip()) for value in output.splitlines()[0].split(",")]
        return total - used
    except (OSError, subprocess.CalledProcessError, ValueError, IndexError):
        return None


def probe(path: Path) -> dict[str, Any]:
    return json.loads(
        capture(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,sample_rate,channels,bits_per_sample",
                "-show_entries",
                "format=duration,size,bit_rate",
                "-of",
                "json",
                str(path),
            ]
        )
    )


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid JSONL line {line_number}: {exc}") from exc
        if not isinstance(item, dict) or not str(item.get("text", "")).strip():
            raise SystemExit(f"JSONL line {line_number} must contain non-empty text")
        tasks.append(item)
    if not tasks:
        raise SystemExit("Batch contract is empty")
    return tasks


def recover_concat_temp_segments(
    raw_output: Path,
    segment_dir: Path,
    total: int,
) -> int:
    recovered = 0
    pattern = f".{raw_output.name}.*"
    candidates = sorted(
        raw_output.parent.glob(pattern),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for candidate in candidates[:1]:
        if not candidate.is_dir():
            continue
        for source in sorted(candidate.glob("[0-9][0-9][0-9][0-9].wav")):
            try:
                index = int(source.stem)
            except ValueError:
                continue
            if index < 1 or index > total:
                continue
            destination = segment_dir / f"{index:04d}.wav"
            if destination.exists():
                continue
            shutil.copy2(source, destination)
            recovered += 1
    return recovered


def concatenate_pcm_segments(tasks: list[dict[str, Any]], segment_dir: Path, output: Path) -> None:
    baseline: tuple[int, int, int, str, str] | None = None
    with wave.open(str(output), "wb") as writer:
        for index, task in enumerate(tasks, 1):
            segment = segment_dir / f"{index:04d}.wav"
            if not segment.is_file():
                raise SystemExit(f"Missing cached TTS segment: {segment}")
            with wave.open(str(segment), "rb") as reader:
                current = (
                    reader.getnchannels(),
                    reader.getsampwidth(),
                    reader.getframerate(),
                    reader.getcomptype(),
                    reader.getcompname(),
                )
                if baseline is None:
                    baseline = current
                    writer.setnchannels(current[0])
                    writer.setsampwidth(current[1])
                    writer.setframerate(current[2])
                    writer.setcomptype(current[3], current[4])
                elif current != baseline:
                    raise SystemExit(f"TTS segment WAV format mismatch: {segment}")
                writer.writeframes(reader.readframes(reader.getnframes()))
            silence_ms = max(0, int(task.get("silence_after_ms", 0)))
            if silence_ms and baseline is not None:
                silent_frames = round(baseline[2] * silence_ms / 1000)
                writer.writeframes(b"\x00" * silent_frames * baseline[0] * baseline[1])


def validate_lexicon(
    tasks: list[dict[str, Any]],
    lexicon_path: Path,
) -> tuple[list[str], str]:
    lexicon = json.loads(lexicon_path.read_text(encoding="utf-8"))
    terms = lexicon.get("terms")
    if not isinstance(terms, dict):
        raise SystemExit("Pronunciation lexicon must contain a terms object")
    matched: set[str] = set()
    violations: list[str] = []
    for index, task in enumerate(tasks, 1):
        text = str(task["text"])
        for term, contract in terms.items():
            approved = str(contract.get("tts", term))
            if approved and approved in text:
                matched.add(str(term))
            for forbidden in contract.get("forbidden_tts", []):
                if str(forbidden) and str(forbidden) in text:
                    violations.append(
                        f"segment {index}: forbidden {forbidden!r}; use {approved!r}"
                    )
    if violations:
        raise SystemExit("Pronunciation contract violation:\n- " + "\n- ".join(violations))
    return sorted(matched), sha256(lexicon_path)


def validate_route(route: dict[str, Any]) -> tuple[dict[str, Any], Path, dict[str, Any]]:
    local = route.get("local_video") or {}
    if local.get("provider") != "indextts2-local":
        raise SystemExit("Local video provider must be indextts2-local")
    if not str(local.get("voice_id", "")).strip():
        raise SystemExit("Local voice_id is required")
    if float((local.get("default_delivery") or {}).get("playback_speed", 0)) <= 0:
        raise SystemExit("Production playback speed must be greater than zero")
    reference = Path(str(local.get("reference_wav", "")))
    if not reference.is_file() or reference.suffix.lower() != ".wav":
        raise SystemExit(f"Canonical reference must be an existing WAV: {reference}")
    actual = sha256(reference)
    expected = str(local.get("reference_sha256", "")).lower()
    if actual.lower() != expected:
        raise SystemExit(
            f"Canonical reference SHA-256 mismatch: expected {expected}, got {actual}"
        )
    metadata = probe(reference)
    streams = metadata.get("streams") or []
    if not streams or not str(streams[0].get("codec_name", "")).startswith("pcm_"):
        raise SystemExit("Canonical reference must use a lossless PCM codec")
    return local, reference, metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--pronunciation-lexicon", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.output.suffix.lower() != ".wav":
        raise SystemExit("Production output must be WAV")
    if not args.batch_file.is_file():
        raise SystemExit(f"Batch contract does not exist: {args.batch_file}")
    if not args.config.is_file():
        raise SystemExit(f"TTS routing config does not exist: {args.config}")
    if args.output.exists() and not args.force and not args.dry_run:
        raise SystemExit(f"Output exists; use --force: {args.output}")

    route = json.loads(args.config.read_text(encoding="utf-8"))
    local, reference, reference_probe = validate_route(route)
    repository = Path(local["repository"])
    model_dir = Path(local["model_dir"])
    cli = repository / ".venv" / "Scripts" / "indextts2.exe"
    if not repository.is_dir() or not model_dir.is_dir() or not cli.is_file():
        raise SystemExit("IndexTTS2 repository, model directory, or CLI is missing")

    tasks = read_jsonl(args.batch_file)
    matched, lexicon_hash = validate_lexicon(tasks, args.pronunciation_lexicon)
    defaults = local["default_delivery"]
    inference_precision = str(local.get("inference_precision", "fp16")).lower()
    if inference_precision not in {"fp16", "fp32"}:
        raise SystemExit("inference_precision must be fp16 or fp32")
    free_gpu_mb = gpu_free_mb() if str(local.get("device", "cuda")).lower() == "cuda" else None
    minimum_free_gpu_mb = int(local.get("minimum_free_gpu_mb", 3800))
    effective: list[dict[str, Any]] = []
    for task in tasks:
        item = dict(task)
        if not any(key in item for key in ("emotion_vector", "emotion_audio", "emotion_text")):
            item["emotion_vector"] = defaults["emotion_vector"]
            item["emotion_weight"] = defaults["emotion_weight"]
        effective.append(item)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    effective_batch = args.output.with_name(f"{args.output.stem}-effective.jsonl")
    effective_batch.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in effective) + "\n",
        encoding="utf-8",
    )
    raw_output = args.output.with_name(f"{args.output.stem}-raw.wav")
    if args.dry_run:
        command = [
            str(cli),
            "batch",
            "--batch-file",
            str(effective_batch.resolve()),
            "--voice",
            str(reference),
            "--concat",
            "--output",
            str(raw_output.resolve()),
            "--model-dir",
            str(model_dir),
            "--device",
            str(local.get("device", "cuda")),
            "--no-deepspeed",
            "--no-cuda-kernel",
            "--dry-run",
            "--force",
        ]
        command.append("--fp16" if inference_precision == "fp16" else "--no-fp16")
        run(command, cwd=repository)
        print("IndexTTS2 strict contract: PASS")
        return 0

    contract_sha256 = hashlib.sha256(
        json.dumps(effective, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    segment_dir = args.output.with_name(
        f"{args.output.stem}-segments-{contract_sha256[:12]}"
    )
    segment_dir.mkdir(parents=True, exist_ok=True)
    recovered_segments = recover_concat_temp_segments(
        raw_output,
        segment_dir,
        len(effective),
    )
    pending: list[dict[str, Any]] = []
    for index, item in enumerate(effective, 1):
        destination = segment_dir / f"{index:04d}.wav"
        if destination.is_file():
            continue
        row = {key: value for key, value in item.items() if key != "silence_after_ms"}
        row["output"] = str(destination.resolve())
        pending.append(row)
    pending_batch = args.output.with_name(f"{args.output.stem}-pending.jsonl")
    pending_batch.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in pending)
        + ("\n" if pending else ""),
        encoding="utf-8",
    )
    if pending:
        free_gpu_mb = gpu_free_mb() if str(local.get("device", "cuda")).lower() == "cuda" else None
        if free_gpu_mb is not None and free_gpu_mb < minimum_free_gpu_mb:
            raise SystemExit(
                "GPU is busy: "
                f"free={free_gpu_mb}MB, required={minimum_free_gpu_mb}MB. "
                "Wait for the other IndexTTS2 job to finish, then resume the same task."
            )
        command = [
            str(cli),
            "batch",
            "--batch-file",
            str(pending_batch.resolve()),
            "--voice",
            str(reference),
            "--model-dir",
            str(model_dir),
            "--device",
            str(local.get("device", "cuda")),
            "--no-deepspeed",
            "--no-cuda-kernel",
            "--force",
        ]
        command.append("--fp16" if inference_precision == "fp16" else "--no-fp16")
        run(command, cwd=repository)
    concatenate_pcm_segments(effective, segment_dir, raw_output)

    run(
        [
            "ffmpeg",
            "-y" if args.force else "-n",
            "-loglevel",
            "error",
            "-i",
            str(raw_output),
            "-af",
            (
                f"atempo={defaults['playback_speed']},"
                f"loudnorm=I={defaults['integrated_loudness_lufs']}:TP=-1.5:LRA=11"
            ),
            "-ar",
            str(defaults["output_sample_rate"]),
            "-ac",
            str(defaults["output_channels"]),
            "-c:a",
            str(defaults["output_codec"]),
            str(args.output),
        ]
    )
    result = {
        "provider": "IndexTTS2",
        "provider_route": "indextts2-local",
        "voice_id": local["voice_id"],
        "model": local["model"],
        "device": local.get("device", "cuda"),
        "inference_precision": inference_precision,
        "gpu_free_mb_before_render": free_gpu_mb,
        "minimum_free_gpu_mb": minimum_free_gpu_mb,
        "segment_contract_sha256": contract_sha256,
        "segment_cache_dir": str(segment_dir.resolve()),
        "segments_recovered_from_interrupted_concat": recovered_segments,
        "repository_commit": capture(["git", "rev-parse", "HEAD"], cwd=repository),
        "reference": {
            "path": str(reference),
            "sha256": local["reference_sha256"],
            "probe": reference_probe,
            "lossless": True,
        },
        "pronunciation_contract": {
            "lexicon_path": str(args.pronunciation_lexicon.resolve()),
            "lexicon_sha256": lexicon_hash,
            "validated": True,
            "matched_terms": matched,
        },
        "segments": effective,
        "raw_output": str(raw_output.resolve()),
        "playback_speed": float(defaults["playback_speed"]),
        "output": str(args.output.resolve()),
        "output_sha256": sha256(args.output),
        "output_probe": probe(args.output),
        "used_fallback": False,
        "minimax_used": False,
    }
    args.manifest.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "manifest": str(args.manifest)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
