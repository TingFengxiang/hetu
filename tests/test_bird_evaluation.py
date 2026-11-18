from pathlib import Path
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import evaluate


class EvaluationTests(unittest.TestCase):
    def test_metrics_use_primary_detection_and_separate_unknown(self):
        report = evaluate.count_predictions([
            ("crane", ["crane"]), ("spoon", ["knot"]), ("knot", [None, "knot"]),
            ("other-stint", ["spoon"]), ("other-duck", []), ("spoon", []),
        ])
        self.assertEqual(report["targetCorrect"], 1)
        self.assertEqual(report["otherFalsePositives"], 1)
        self.assertEqual(report["perClass"]["knot"]["uncertain"], 1)
        self.assertEqual(report["perClass"]["spoon"]["noDetection"], 1)
        self.assertEqual(report["targetPhotos"], 4)

    def test_frozen_split_untouched(self):
        partitions = evaluate.load_split()
        sets = {k: {r["file"] for r in v} for k, v in partitions.items()}
        self.assertEqual(len(sets["holdout"]), 94)
        self.assertEqual(len(sets["excluded"]), 43)
        self.assertEqual(sum(len(partitions[k]) for k in ("fit", "calibration", "validation")), 608)
        for name, values in sets.items():
            self.assertFalse(any(values & other for k, other in sets.items() if k != name))

    def test_huge_needs_shorebird_gain_without_extra_false_positives(self):
        def candidate(name, correct, errors, p95, knot):
            return ({"encoder": name}, {
                "targetCorrect": correct, "targetWrong": 0, "otherFalsePositives": errors,
                "perClass": {"knot": {"correct": knot}, "spoon": {"correct": 5}},
                "backendLatencyMs": {"singleBox": {"p95": p95}},
            })
        base = candidate("base", 10, 1, 90, 3)
        weak = [candidate("huge", 11, 1, 1200, 4), candidate("huge", 15, 2, 150, 8),
                candidate("huge", 12, 1, 150, 3)]
        self.assertEqual(evaluate.select_candidate([base] + weak, "base"), base)
        better = candidate("huge", 13, 1, 140, 5)
        self.assertEqual(evaluate.select_candidate([base, better], "base"), better)


if __name__ == "__main__":
    unittest.main()
