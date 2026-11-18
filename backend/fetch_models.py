"""Download pinned upstream models with resumable ranges and SHA-256 verification."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1] / ".training/bird-backend/models"
ENCODERS = {
    "bioclip-2": ("bioclip-2", "2957b322090f9cb17ae72c71981c7218a28d81e0", 1710517724,
                  "b7b2bf6fbc95799e42630e394cf95803892ab447c1a8ab629dbc82fbeaf7dfef"),
    "bioclip-2.5": ("bioclip-2.5-vith14", "6e3d04e3d6522012c88181085c5ae666e14c45cd", 3944517804,
                    "ac2e37c2f89ef8e6b889176a9a3f418970ad9db15a218bd29e3321e95c46ae97"),
}
YOLO = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_m.onnx"


def curl(url, target, *options):
    subprocess.run(["curl", "-fLsS", "--retry", "4", "--retry-all-errors", "--connect-timeout", "20",
                    "--max-time", "180", *options, "-o", str(target), url], check=True)


def verified(path, expected):
    if not path.exists():
        return False
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest() == expected


def encoder(key):
    repo, revision, size, digest = ENCODERS[key]
    base = f"https://huggingface.co/imageomics/{repo}/resolve/{revision}"
    folder = ROOT / key
    folder.mkdir(parents=True, exist_ok=True)
    for name in ["open_clip_config.json", "README.md"]:
        curl(f"{base}/{name}", folder / name)
    dest = folder / "open_clip_model.safetensors"
    if verified(dest, digest):
        return
    pieces = folder / "parts"
    pieces.mkdir(exist_ok=True)
    chunk = 16 * 1024**2

    def fetch(start):
        end = min(start + chunk, size) - 1
        part = pieces / str(start)
        wanted = end - start + 1
        have = part.stat().st_size if part.exists() else 0
        if have > wanted:
            raise IOError(f"Oversized download part: {part}")
        # Keep already received bytes across restarts and cap each replay at 4 MiB.
        while have < wanted:
            offset = start + have
            length = min(4 * 1024**2, wanted - have)
            transfer = part.with_suffix(".transfer")
            curl(f"{base}/{dest.name}?part={offset}", transfer,
                 "--range", f"{offset}-{offset + length - 1}", "--max-filesize", str(length))
            if transfer.stat().st_size != length:
                raise IOError(f"Invalid length at offset {offset}")
            with transfer.open("rb") as src, part.open("ab") as out:
                shutil.copyfileobj(src, out)
            transfer.unlink()
            have += length
        return part

    pending = dest.with_suffix(".partial")
    with ThreadPoolExecutor(max_workers=10) as workers, pending.open("wb") as out:
        for part in workers.map(fetch, range(0, size, chunk)):
            with part.open("rb") as src:
                shutil.copyfileobj(src, out)
    if not verified(pending, digest):
        raise IOError(f"SHA-256 mismatch: {pending}")
    pending.replace(dest)
    for start in range(0, size, chunk):
        (pieces / str(start)).unlink()
    pieces.rmdir()
    print(f"Verified {repo}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="+", choices=[*ENCODERS, "yolox-m"])
    for name in parser.parse_args().models:
        if name in ENCODERS:
            encoder(name)
        else:
            ROOT.mkdir(parents=True, exist_ok=True)
            dest = ROOT / "yolox_m.onnx"
            digest = "21ff6cfdeb53b013bac2249599e55f00bff3cfdfdab37ed7a4620818c1d15b3f"
            if not verified(dest, digest):
                temp = dest.with_suffix(".partial")
                curl(YOLO, temp)
                if not verified(temp, digest):
                    raise IOError("Invalid YOLOX-M digest")
                temp.replace(dest)


if __name__ == "__main__":
    main()
