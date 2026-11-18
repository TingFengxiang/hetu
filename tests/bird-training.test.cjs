const test = require("node:test");
const assert = require("node:assert/strict");
const { splitPhotos } = require("../tools/bird-split.cjs");

test("photographer and observer identities cannot cross the test boundary", () => {
  const rows = [
    { file: "a", label: "spoon", observer: "alice", credit: "(c) Cara, some rights reserved (CC BY)" },
    { file: "b", label: "knot", observer: "bob", credit: "(c) Cara, no rights reserved (CC0)" },
    { file: "c", label: "knot", observer: "alice", credit: "(c) Other, some rights reserved (CC BY)" },
    ...Array.from({ length: 20 }, (_, i) => ({
      file: "x" + i, label: i % 2 ? "spoon" : "knot", observer: "user" + i,
    })),
  ];
  const split = splitPhotos(rows);
  const testFiles = new Set(split.heldOut.map(row => row.file));
  assert.equal(testFiles.has("a"), testFiles.has("b"));
  assert.equal(testFiles.has("a"), testFiles.has("c"));
  assert.equal(split.heldOut.length + split.training.length, rows.length);
  assert.equal(new Set(split.heldOut.map(row => row.label)).size, 2);
  const reversed = splitPhotos([...rows].reverse());
  assert.deepEqual([...testFiles].sort(), reversed.heldOut.map(row => row.file).sort());
});

test("a frozen holdout excludes newly added photos from the same photographer", () => {
  const rows = [
    { file: "test.jpg", label: "spoon", observer: "alice" },
    { file: "new.jpg", label: "knot", observer: "alice" },
    { file: "train.jpg", label: "spoon", observer: "bob" },
  ];
  const { training, heldOut, excluded } = splitPhotos(rows, ["test.jpg"]);
  assert.deepEqual(heldOut.map(row => row.file), ["test.jpg"]);
  assert.deepEqual(training.map(row => row.file), ["train.jpg"]);
  assert.deepEqual(excluded.map(row => row.file), ["new.jpg"]);
  assert.throws(() => splitPhotos(rows, ["missing.jpg"]), /missing/);
});
