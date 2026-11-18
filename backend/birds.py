"""GPU inference shared by the local bird service and its evaluation."""

import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


SPECIES = {
    "crane": ("Grus japonensis", "red-crowned crane"),
    "spoon": ("Calidris pygmaea", "spoon-billed sandpiper"),
    "knot": ("Calidris tenuirostris", "great knot"),
    "other-dunlin": ("Calidris alpina", "dunlin"),
    "other-redknot": ("Calidris canutus", "red knot"),
    "other-stint": ("Calidris ruficollis", "red-necked stint"),
    "other-egret": ("Egretta garzetta", "little egret"),
    "other-duck": ("Anas zonorhyncha", "eastern spot-billed duck"),
}
LABELS = tuple(SPECIES)


@lru_cache(maxsize=2)
def _anchors(size):
    grids, strides = [], []
    for stride in (8, 16, 32):
        axis = np.arange(size // stride, dtype=np.float32)
        grids.append(np.stack(np.meshgrid(axis, axis), axis=-1).reshape(-1, 2))
        strides.append(np.full((len(axis) ** 2, 1), stride, dtype=np.float32))
    return np.concatenate(grids), np.concatenate(strides)


def decode_boxes(raw, size, width, height):
    """Decode official YOLOX raw heads. width/height exclude letterbox padding."""
    grid, strides = _anchors(size)
    if raw.shape != (1, len(grid), 85):
        raise ValueError(f"Unexpected YOLOX output shape {raw.shape}")
    outputs = raw[0]
    scores = outputs[:, 4] * outputs[:, 5 + 14]  # COCO bird
    indices = np.flatnonzero(scores > .22)
    indices = indices[np.argsort(-scores[indices], kind="stable")]
    center = (outputs[indices, :2] + grid[indices]) * strides[indices]
    half = np.exp(np.clip(outputs[indices, 2:4], -20, 20)) * strides[indices] / 2
    scale = np.array([width, height], dtype=np.float32)
    starts = np.clip(center - half, 0, scale)
    ends = np.clip(center + half, 0, scale)
    remaining = np.flatnonzero(np.min(ends - starts, axis=1) >= 5)
    areas = np.prod(ends - starts, axis=1)
    selected = []
    while remaining.size:
        index, *rest = remaining
        extra = (ends[index] - starts[index]) * .075  # expand by 15% in total
        first = np.maximum(starts[index] - extra, 0) / scale
        last = np.minimum(ends[index] + extra, scale) / scale
        selected.append(np.concatenate([first, last]).tolist())
        others = np.asarray(rest, dtype=int)
        intersection = np.maximum(
            0, np.minimum(ends[index], ends[others]) - np.maximum(starts[index], starts[others])
        ).prod(axis=1)
        iou = intersection / (areas[index] + areas[others] - intersection)
        remaining = others[iou <= .45]
    return selected


class Detector:
    def __init__(self, path):
        import torch
        import onnxruntime as ort

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable for YOLOX")
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls()
        options = {"arena_extend_strategy": "kSameAsRequested", "cudnn_conv_use_max_workspace": "0"}
        self.session = ort.InferenceSession(str(path), providers=[("CUDAExecutionProvider", options)])
        if "CUDAExecutionProvider" not in self.session.get_providers():
            raise RuntimeError("ONNX Runtime could not activate CUDAExecutionProvider")
        self.session.disable_fallback()
        model_input = self.session.get_inputs()[0]
        self.input_name = model_input.name
        self.size = model_input.shape[-1]
        if self.size not in (416, 640) or model_input.shape[-2] != self.size:
            raise ValueError(f"Unexpected official YOLOX input {model_input.shape}")

    def detect(self, image):
        ratio = self.size / max(image.size)
        width, height = (max(1, int(x * ratio)) for x in image.size)
        small = image.convert("RGB").resize((width, height), Image.Resampling.BILINEAR)
        tensor = np.full((1, 3, self.size, self.size), 114, dtype=np.float32)
        tensor[0, :, :height, :width] = np.asarray(small)[:, :, ::-1].transpose(2, 0, 1)
        raw = self.session.run(None, {self.input_name: tensor})[0]
        return decode_boxes(raw, self.size, width, height)


def crop_image(image, box):
    left, top, right, bottom = box
    return image.crop((
        math.floor(left * image.width), math.floor(top * image.height),
        math.ceil(right * image.width), math.ceil(bottom * image.height),
    ))


class Encoder:
    def __init__(self, model_dir):
        import open_clip
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable for BioCLIP")
        model_dir = Path(model_dir).resolve()
        name = "local-dir:" + str(model_dir)
        self.model, self.preprocess = open_clip.create_model_from_pretrained(
            name, device="cuda", precision="fp16",
        )
        self.model.eval()
        self.tokenize = open_clip.get_tokenizer(name)
        self.dimension = self.model.visual.output_dim
        self.size = self.model.visual.image_size
        if isinstance(self.size, int):
            self.size = (self.size, self.size)

    def encode_images(self, images):
        import torch
        from torch.nn.functional import normalize

        batches = []
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
            for i in range(0, len(images), 4):
                # Preserve the beak and tail when OpenCLIP center-crops elongated birds.
                batch = [self.preprocess(ImageOps.pad(
                    image.convert("RGB"), self.size, method=Image.Resampling.BICUBIC,
                    color=(123, 117, 104),
                )) for image in images[i:i + 4]]
                encoded = self.model.encode_image(torch.stack(batch).to("cuda"))
                batches.append(normalize(encoded.float(), dim=-1).cpu().numpy())
        return np.concatenate(batches) if batches else np.empty((0, self.dimension), dtype=np.float32)

    def text_features(self):
        import torch
        from torch.nn.functional import normalize

        prompts = [f"a photo of a {name}." for names in SPECIES.values() for name in names]
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
            encoded = self.model.encode_text(self.tokenize(prompts).to("cuda"))
            pairs = normalize(encoded.float(), dim=-1).reshape(len(LABELS), 2, -1)
            return normalize(pairs.mean(dim=1), dim=-1).cpu().numpy()


def predict(features, config):
    weights = np.asarray(config["weights"], dtype=np.float32)
    bias = np.asarray(config["bias"], dtype=np.float32)
    scores = np.asarray(features, dtype=np.float32) @ weights.T + bias
    ranking = np.argsort(-scores, axis=1, kind="stable")
    matches = []
    for row, (first, second, *_) in zip(scores, ranking):
        label = config["labels"][first]
        limits = config["limits"].get(label)
        accepted = (label in LABELS[:3] and limits is not None
                    and row[first] >= limits["minimum"]
                    and row[first] - row[second] >= limits["margin"])
        matches.append(label if accepted else None)
    return matches


class BirdPipeline:
    def __init__(self, detector, encoder, config):
        self.detector = detector
        self.encoder = encoder
        self.config = config

    @classmethod
    def from_config(cls, path, training_dir):
        config = json.loads(Path(path).read_text(encoding="utf-8"))
        training_dir = Path(training_dir)
        return cls(Detector(training_dir / config["detector"]),
                   Encoder(training_dir / config["encoder"]), config)

    def recognize(self, image):
        boxes = self.detector.detect(image)
        birds = []
        for start in range(0, len(boxes), 4):
            group = boxes[start:start + 4]
            vectors = self.encoder.encode_images([crop_image(image, box) for box in group])
            matches = predict(vectors, self.config)
            birds.extend({"box": box, "match": match} for box, match in zip(group, matches))
        return {"birds": birds}
