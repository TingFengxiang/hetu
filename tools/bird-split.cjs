const { createHash } = require("node:crypto");

function photoIdentities(row) {
  const author = (row.photographer || row.credit || "")
    .replace(/^\([cC]\)\s*|^©\s*/u, "")
    .replace(/,?\s*(?:some|all|no) rights reserved.*$/i, "")
    .trim().normalize("NFKC").toLowerCase();
  const observer = row.observer?.trim().toLowerCase();
  return [
    ...(observer ? ["observer:" + observer] : []),
    ...(author ? ["author:" + author] : []),
  ];
}

function splitPhotos(photos, heldOutFiles) {
  const rows = [...photos].sort((a, b) => a.file.localeCompare(b.file, "en"));
  const parents = rows.map((_, i) => i);
  const owner = new Map();
  function group(i) {
    if (parents[i] !== i) parents[i] = group(parents[i]);
    return parents[i];
  }
  for (const [i, row] of rows.entries()) {
    for (const id of photoIdentities(row)) {
      if (owner.has(id)) parents[group(i)] = group(owner.get(id));
      else owner.set(id, i);
    }
  }
  const groups = new Map();
  const sizes = new Map();
  for (const [i, row] of rows.entries()) {
    const key = group(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    sizes.set(row.label, (sizes.get(row.label) || 0) + 1);
  }
  if (heldOutFiles) {
    const test = new Set(heldOutFiles);
    const available = new Set(rows.map(row => row.file));
    for (const file of test) {
      if (!available.has(file)) throw new Error("Photo missing from frozen holdout: " + file);
    }
    const training = [];
    const heldOut = [];
    const excluded = [];
    for (const items of groups.values()) {
      if (!items.some(row => test.has(row.file))) training.push(...items);
      else {
        for (const row of items) (test.has(row.file) ? heldOut : excluded).push(row);
      }
    }
    const byFile = (a, b) => a.file.localeCompare(b.file, "en");
    return { training: training.sort(byFile), heldOut: heldOut.sort(byFile), excluded: excluded.sort(byFile) };
  }
  const goals = new Map([...sizes].map(([id, count]) => [id, Math.round(count * .24)]));
  const counts = new Map();
  const choices = [...groups.values()].map(items => ({
    items, order: createHash("sha256").update("hetu-v2/" + items[0].file).digest("hex"),
  })).sort((a, b) => a.order.localeCompare(b.order, "en"));

  const testFiles = new Set();
  for (const { items } of choices) {
    const additions = new Map();
    for (const { label } of items) additions.set(label, (additions.get(label) || 0) + 1);
    let improvement = 0;
    for (const [id, extra] of additions) {
      const goal = goals.get(id);
      const count = counts.get(id) || 0;
      improvement += (Math.abs(goal - count) - Math.abs(goal - count - extra)) / (goal || 1);
    }
    if (improvement <= 0) continue;
    for (const { file } of items) testFiles.add(file);
    for (const [id, extra] of additions) counts.set(id, (counts.get(id) || 0) + extra);
  }
  return {
    training: rows.filter(row => !testFiles.has(row.file)),
    heldOut: rows.filter(row => testFiles.has(row.file)),
  };
}

module.exports = { photoIdentities, splitPhotos };
