"""Calibrate on photographer-disjoint training groups and evaluate one locked deployment."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
if not __package__:
    sys.path.insert(0, str(ROOT))
DATA = ROOT / ".training"
OUTPUT = DATA / "bird-backend"
TARGETS = ("crane", "spoon", "knot")
DEFAULT_ENCODER = "bird-backend/models/bioclip-2"
DEFAULT_M = "bird-backend/models/yolox_m.onnx"
DEFAULT_NANO = "yolo/yolox_nano.onnx"
CONFIG = OUTPUT / "config.json"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False, dir=path.parent) as handle:
        json.dump(value, handle, ensure_ascii=False, allow_nan=False)
        temp = handle.name
    os.replace(temp, path)


def load_split():
    # Keep the existing author/observer grouping and frozen names exactly as specified.
    code = """
    const fs = require('node:fs');
    const {splitPhotos} = require('./tools/bird-split.cjs');
    const json = name => JSON.parse(fs.readFileSync('.training/'+name+'.json','utf8'));
    const split = splitPhotos(json('samples'), json('test-split'));
    const outer = splitPhotos(split.training);
    const inner = splitPhotos(outer.training);
    process.stdout.write(JSON.stringify({fit:inner.training, calibration:inner.heldOut,
      validation:outer.heldOut, holdout:split.heldOut, excluded:split.excluded}));
    """
    return json.loads(subprocess.check_output(["node", "-e", code], cwd=ROOT))


def count_predictions(rows):
    """Historical label is per photo. Score the leading detection, preserve extras separately."""
    report = dict(targetPhotos=0, targetCorrect=0, targetWrong=0, otherPhotos=0,
                  otherFalsePositives=0, perClass={}, extraBoxes=0,
                  targetPhotosWithLabelAnywhere=0, otherPhotosWithAnyTargetPrediction=0)
    for label, matches in rows:
        target = label in TARGETS
        report["targetPhotos" if target else "otherPhotos"] += 1
        counts = report["perClass"].setdefault(label, dict(correct=0, wrong=0, uncertain=0, noDetection=0))
        report["extraBoxes"] += max(0, len(matches) - 1)
        if target and label in matches:
            report["targetPhotosWithLabelAnywhere"] += 1
        if not target and any(match in TARGETS for match in matches):
            report["otherPhotosWithAnyTargetPrediction"] += 1
        if not matches:
            key = "noDetection"
        elif matches[0] == label or (not target and matches[0] is None):
            key = "correct"
            if target:
                report["targetCorrect"] += 1
        elif matches[0] is None:
            key = "uncertain"
        else:
            key = "wrong"
            report["targetWrong" if target else "otherFalsePositives"] += 1
        counts[key] += 1
    return report


def read_photo(row, cached_box=None):
    from PIL import Image, ImageOps
    with Image.open(DATA / "photos" / row["file"]) as img:
        if cached_box is not None:
            # Legacy JPEG decoder stored coordinates before applying EXIF orientation.
            from backend.birds import crop_image
            img = crop_image(img, cached_box)
        return ImageOps.exif_transpose(img).convert("RGB")


def extract_cached(rows, crops, encoder):
    import numpy as np
    available = [r for r in rows if crops[r["file"]]]
    vectors = []
    for i in range(0, len(available), 4):
        batch = [read_photo(r, crops[r["file"]]) for r in available[i:i + 4]]
        vectors.append(encoder.encode_images(batch))
    return np.concatenate(vectors), [r["label"] for r in available]


def linear_head(x, labels, classes):
    """Balanced least squares with an unregularized intercept and a fixed ridge penalty."""
    import numpy as np
    y = np.eye(len(classes))[np.array([classes.index(k) for k in labels])]
    counts = y.sum(axis=0)
    if (counts == 0).any():
        raise ValueError("Missing a class in fitting crops")
    row_weight = (y @ (1 / counts)) * (len(y) / len(classes))
    x_mean = np.average(x, axis=0, weights=row_weight)
    y_mean = np.average(y, axis=0, weights=row_weight)
    z = (x - x_mean) * np.sqrt(row_weight[:, None])
    targets = (y - y_mean) * np.sqrt(row_weight[:, None])
    coefficients = z.T @ np.linalg.solve(z @ z.T + np.eye(len(z)) * 0.1, targets)
    return coefficients.T, y_mean - x_mean @ coefficients


def calibrated_config(weights, bias, examples, truth, classes):
    import numpy as np
    weights, bias = weights.astype(np.float32), bias.astype(np.float32)
    scores = examples @ weights.T + bias
    ranking = np.argsort(-scores, axis=1, kind="stable")
    indices = np.arange(len(truth))
    best = scores[indices, ranking[:, 0]]
    gap = best - scores[indices, ranking[:, 1]]
    limits = {}
    for key in TARGETS:
        picked = ranking[:, 0] == classes.index(key)
        correct = np.array(truth) == key
        # Disable an unsupported class by putting its threshold beyond observed logits.
        best_choice = (0, 0)
        min_score, min_gap = 1e9, 1e9
        if picked.any():
            for minimum in np.unique(np.quantile(best[picked], [0, .15, .35, .55, .75])):
                for margin in np.unique(np.quantile(gap[picked], [0, .15, .35, .55, .75])):
                    accepted = picked & (best >= minimum) & (gap >= margin)
                    tp = int((accepted & correct).sum())
                    fp = int((accepted & ~correct).sum())
                    value = (tp - 2 * fp, -fp)
                    if value > best_choice:
                        best_choice = value
                        min_score, min_gap = float(minimum), float(margin)
        limits[key] = dict(minimum=min_score, margin=min_gap)
    return dict(labels=list(classes), weights=weights.tolist(), bias=bias.tolist(), limits=limits)


def latency_summary(times):
    values = sorted(times)
    n = len(values)
    return {"n": n, "p50": values[math.ceil(n * .5) - 1] if n else None,
            "p95": values[math.ceil(n * .95) - 1] if n else None}


def measure(rows, encoder, detector, configs):
    """Time full image decode + all boxes + scoring, excluding HTTP and page rendering."""
    import torch
    from backend.birds import crop_image, predict
    outputs = {k: [] for k in configs}
    timings = []
    details = []
    for row in rows:
        torch.cuda.synchronize()
        start = time.perf_counter()
        image = read_photo(row)
        boxes = detector.detect(image)
        features = []
        for i in range(0, len(boxes), 4):
            images = [crop_image(image, box) for box in boxes[i:i + 4]]
            features.append(encoder.encode_images(images))
        torch.cuda.synchronize()
        elapsed = (time.perf_counter() - start) * 1000
        row_detail = {"file": row["file"], "truth": row["label"], "matches": {}}
        for method, config in configs.items():
            tick = time.perf_counter()
            matches = [label for batch in features for label in predict(batch, config)]
            method_ms = elapsed + (time.perf_counter() - tick) * 1000
            outputs[method].append((row["label"], matches))
            row_detail["matches"][method] = matches
            timings.append((method, len(boxes), method_ms))
        details.append(row_detail)
    reports = {}
    for method, results in outputs.items():
        report = count_predictions(results)
        latencies = {}
        for name, predicate in (("all", lambda n: True), ("singleBox", lambda n: n == 1),
                                ("multipleBoxes", lambda n: n > 1)):
            latencies[name] = latency_summary(t for kind, n, t in timings if kind == method and predicate(n))
        report["backendLatencyMs"] = latencies
        reports[method] = report
    return reports, details


def utility(report):
    return report["targetCorrect"] - 2 * (report["otherFalsePositives"] + report["targetWrong"])


def compare_encoder(encoder_path, detectors, split, crops):
    import numpy as np
    import torch
    from backend.birds import Detector, Encoder, LABELS
    encoder = Encoder(DATA / encoder_path)
    x, labels = extract_cached(split["fit"], crops, encoder)
    calibration, truth = extract_cached(split["calibration"], crops, encoder)
    head, intercept = linear_head(x, labels, LABELS)
    methods = {"linear": (head, intercept), "text": (encoder.text_features(), np.zeros(len(LABELS)))}
    configs = {k: calibrated_config(w, b, calibration, truth, LABELS) for k, (w, b) in methods.items()}
    candidates = []
    for detector_path in detectors:
        detector = Detector(DATA / detector_path)
        measure(split["fit"][:2], encoder, detector, configs)  # warm before taking measurements
        reports, _ = measure(split["validation"], encoder, detector, configs)
        for method, report in reports.items():
            config = dict(configs[method], encoder=encoder_path, detector=detector_path, method=method)
            candidates.append((config, report))
            print(encoder_path, detector_path, method, "validation:", report["targetCorrect"],
                  "/", report["targetPhotos"], "other false positives:", report["otherFalsePositives"], flush=True)
        del detector
    del encoder
    torch.cuda.empty_cache()
    return candidates


def selection_key(encoder_path, detectors, split):
    """Reuse only complete training-side runs with identical inputs and runtimes."""
    from importlib.metadata import version
    import torch
    state = hashlib.sha256()
    for part in ("fit", "calibration", "validation"):
        for row in split[part]:
            state.update(json.dumps(row, sort_keys=True).encode())
            with (DATA / "photos" / row["file"]).open("rb") as photo:
                state.update(hashlib.file_digest(photo, "sha256").digest())
    model = DATA / encoder_path
    paths = [Path(__file__), Path(__file__).with_name("birds.py"), DATA / "yolo-crops.json",
             model / "open_clip_config.json", model / "open_clip_model.safetensors",
             *(DATA / d for d in detectors)]
    for path in paths:
        with path.open("rb") as source:
            state.update(hashlib.file_digest(source, "sha256").digest())
    versions = [version(package) for package in ["torch", "onnxruntime-gpu", "open_clip_torch", "Pillow", "numpy"]]
    state.update(json.dumps([encoder_path, detectors, versions, torch.cuda.get_device_name()]).encode())
    return state.hexdigest()


def select_candidate(candidates, base):
    def rank(candidate):
        cfg, result = candidate
        p95 = result["backendLatencyMs"]["singleBox"]["p95"] or float("inf")
        return (p95 <= 1000, utility(result), result["targetCorrect"], -p95)
    best = max((v for v in candidates if v[0]["encoder"] == base), key=rank)
    baseline = best[1]
    for pair in candidates:
        cfg, result = pair
        if cfg["encoder"] == base:
            continue
        if ((result["backendLatencyMs"]["singleBox"]["p95"] or float("inf")) <= 1000
                and result["otherFalsePositives"] <= baseline["otherFalsePositives"]
                and result["targetCorrect"] > baseline["targetCorrect"]
                and any(result["perClass"][s]["correct"] > baseline["perClass"][s]["correct"] for s in ("spoon", "knot"))
                and rank(pair) > rank(best)):
            best = pair
    return best


def select(args, split):
    gcrops = read(DATA / "yolo-crops.json")
    detectors = [args.nano, args.detector] if args.nano != args.detector else [args.detector]
    encoders = list(dict.fromkeys([args.encoder] + ([args.huge] if args.huge else [])))
    candidates = []
    for path in encoders:
        signature = selection_key(path, detectors, split)
        cache = OUTPUT / ("validation-" + signature + ".json")
        if cache.exists() and not args.refresh:
            result = read(cache)
            print("Reusing complete validation results for", path, flush=True)
        else:
            result = compare_encoder(path, detectors, split, gcrops)
            save(cache, result)
        candidates.extend(result)
    config, report = select_candidate(candidates, args.encoder)
    save(OUTPUT / "selection.json", {
        "splits": {key: len(items) for key, items in split.items()},
        "fitCrops": sum(bool(gcrops[r["file"]]) for r in split["fit"]),
        "calibrationCrops": sum(bool(gcrops[r["file"]]) for r in split["calibration"]),
        "primaryBoxOnly": True,
        "candidates": [dict(encoder=c["encoder"], detector=c["detector"], method=c["method"], validation=r)
                       for c, r in candidates],
        "selected": {k: config[k] for k in ["encoder", "detector", "method"]},
    })
    save(CONFIG, config)
    print("Selected", config["encoder"], config["detector"], config["method"], "->", CONFIG)


def holdout(split):
    import torch
    from backend.birds import Encoder, Detector
    config = read(CONFIG)
    encoder = Encoder(DATA / config["encoder"])
    detector = Detector(DATA / config["detector"])
    configs = {"deployed": config}
    measure(split["fit"][:2], encoder, detector, configs)
    torch.cuda.reset_peak_memory_stats()
    reports, details = measure(split["holdout"], encoder, detector, configs)
    result = reports["deployed"]
    result["torchPeakAllocatedMiB"] = torch.cuda.max_memory_allocated() / 2**20
    result["configSha256"] = hashlib.sha256(CONFIG.read_bytes()).hexdigest()
    result["details"] = details
    save(OUTPUT / "holdout.json", result)
    print(json.dumps({k: v for k, v in result.items() if k != "details"}, indent=2))


def http_benchmark(split, port):
    previous = read(OUTPUT / "holdout.json")
    expected = {r["file"]: r["matches"]["deployed"] for r in previous["details"]}
    if previous["configSha256"] != hashlib.sha256(CONFIG.read_bytes()).hexdigest():
        raise ValueError("Model config has changed since the holdout evaluation")
    durations = {"all": [], "singleBox": [], "multipleBoxes": []}
    def post(row):
        data = (DATA / "photos" / row["file"]).read_bytes()
        request = urllib.request.Request(f"http://127.0.0.1:{port}/api/birds/recognize", data=data,
                                         headers={"Content-Type": "image/jpeg"})
        tick = time.perf_counter()
        with urllib.request.urlopen(request, timeout=120) as response:
            matches = [bird["match"] for bird in json.load(response)["birds"]]
        return matches, (time.perf_counter() - tick) * 1000
    for row in split["fit"][:2]:
        post(row)
    for row in split["holdout"]:
        matches, ms = post(row)
        if matches != expected[row["file"]]:
            raise ValueError("HTTP results differ from frozen config for " + row["file"])
        durations["all"].append(ms)
        if len(matches) == 1:
            durations["singleBox"].append(ms)
        elif len(matches) > 1:
            durations["multipleBoxes"].append(ms)
    timing = {name: latency_summary(times) for name, times in durations.items()}
    save(OUTPUT / "http-benchmark.json", {"configSha256": previous["configSha256"], "milliseconds": timing})
    print(json.dumps(timing, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["split", "select", "holdout", "http"])
    parser.add_argument("--encoder", default=DEFAULT_ENCODER, help="encoder directory relative to .training")
    parser.add_argument("--huge", help="also compare this local Huge model directory, relative to .training")
    parser.add_argument("--detector", default=DEFAULT_M)
    parser.add_argument("--nano", default=DEFAULT_NANO)
    parser.add_argument("--port", default=8765, type=int, help="localhost HTTP benchmark port")
    parser.add_argument("--refresh", action="store_true", help="remeasure cached training-side candidates")
    args = parser.parse_args()
    split = load_split()
    if args.stage == "split":
        print(json.dumps({k: len(v) for k, v in split.items()}))
    elif args.stage == "select":
        select(args, split)
    elif args.stage == "holdout":
        holdout(split)
    else:
        http_benchmark(split, args.port)


if __name__ == "__main__":
    main()
