"""Serve the local Hetu web app and its resident GPU bird pipeline."""

import argparse
import io
import json
import logging
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 15 * 1024 * 1024


def make_handler(recognize):
    gpu = threading.Lock()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

        def reply(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != "/api/birds/recognize":
                return self.reply(404, {"error": "接口不存在"})
            host = self.headers.get("Host")
            if self.headers.get("Origin") not in (None, f"http://{host}"):
                return self.reply(403, {"error": "请从本机服务页面选择照片"})
            try:
                count = int(self.headers["Content-Length"])
            except (TypeError, ValueError):
                return self.reply(411, {"error": "缺少文件大小"})
            if not 0 < count <= MAX_BYTES:
                return self.reply(413, {"error": "请选择 15 MB 以内的照片"})
            data = self.rfile.read(count)
            if len(data) != count:
                return self.reply(400, {"error": "照片传输不完整"})
            try:
                with gpu:
                    result = recognize(data)
            except ValueError as error:
                return self.reply(400, {"error": str(error)})
            except Exception:
                logging.exception("Bird inference failed")
                return self.reply(500, {"error": "识别服务运行异常，请查看后端日志"})
            self.reply(200, result)

    return Handler


def decode_photo(data):
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 40_000_000:
                raise ValueError("照片超过 4000 万像素，请缩小后重试")
            return ImageOps.exif_transpose(image).convert("RGB")
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError("无法读取照片，请选择有效图片") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    from backend.birds import BirdPipeline

    training = ROOT / ".training"
    config = training / "bird-backend" / "config.json"
    if not config.is_file():
        config = Path(__file__).with_name("deployed-config.json")
    pipeline = BirdPipeline.from_config(config, training)
    handler = make_handler(lambda data: pipeline.recognize(decode_photo(data)))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"http://127.0.0.1:{args.port}/#birds", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
