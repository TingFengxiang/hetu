import math
import unittest

import numpy as np
from PIL import Image

from backend.birds import LABELS, crop_image, decode_boxes, predict


class BirdModelTests(unittest.TestCase):
    def test_multiple_birds_deduped_before_padding_and_clipped_to_unpadded_image(self):
        raw = np.zeros((1, 21, 85), dtype=np.float32)
        for anchor, offset, score in [(0, .6, .9), (1, -.4, .8), (2, 1, .7)]:
            raw[0, anchor, :5] = [offset, 1, math.log(1.5), math.log(1.5), 1]
            raw[0, anchor, 19] = score
        # Anchor in the padded lower half of a landscape photo.
        raw[0, 12, :5] = [1, .5, 0, 0, 1]
        raw[0, 12, 19] = .99
        boxes = decode_boxes(raw, 32, 32, 16)
        self.assertEqual(len(boxes), 2)
        self.assertEqual(boxes[0][0], 0)
        self.assertLess(boxes[0][2], boxes[1][0])
        crop = crop_image(Image.new("RGB", (320, 160)), boxes[1])
        self.assertGreater(crop.width, 120)

    def test_classifier_rejects_other_ambiguous_and_below_threshold(self):
        size = len(LABELS)
        features = np.eye(size, dtype=np.float32)[[0, 1, 3, 2]].copy()
        features[1, 2] = .99
        features[3, 2] = .3
        config = {
            "labels": list(LABELS), "weights": np.eye(size), "bias": np.zeros(size),
            "limits": {key: {"minimum": .5, "margin": .1} for key in LABELS[:3]},
        }
        self.assertEqual(predict(features, config), ["crane", None, None, None])


if __name__ == "__main__":
    unittest.main()
