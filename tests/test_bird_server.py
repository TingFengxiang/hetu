import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer
from backend.serve import make_handler


class BirdServerTest(unittest.TestCase):
    def setUp(self):
        def recognize(data):
            if data != b"test photo":
                raise ValueError("invalid image")
            return {"birds": [{"box": [0, 0, 1, 1], "match": None}]}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(recognize))
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.client = http.client.HTTPConnection(*self.server.server_address, timeout=5)

    def tearDown(self):
        self.client.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, data, **headers):
        self.client.request("POST", "/api/birds/recognize", data,
                            {"Content-Type": "image/jpeg", **headers})
        return self.client.getresponse()

    def test_upload(self):
        import json
        res = self.post(b"test photo")
        self.assertEqual(res.status, 200)
        self.assertEqual(json.load(res)["birds"][0]["match"], None)

    def test_invalid_photo(self):
        self.assertEqual(self.post(b"bad").status, 400)

    def test_foreign_origin(self):
        self.assertEqual(self.post(b"test photo", Origin="https://example.org").status, 403)
