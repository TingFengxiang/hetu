// Run against the warmed local backend after backend.evaluate holdout.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const root = path.join(__dirname, "..");
const output = path.join(root, ".training", "bird-backend");
const start = new URL(process.argv[2] || "http://127.0.0.1:8765/#birds");
assert.ok(start.protocol === "http:" && ["127.0.0.1", "localhost"].includes(start.hostname), "Use the local Hetu service");
start.hash = "birds";
const holdout = JSON.parse(fs.readFileSync(path.join(output, "holdout.json")));
const frozen = JSON.parse(fs.readFileSync(path.join(root, ".training", "test-split.json")));
assert.deepEqual(holdout.details.map(row => row.file).sort(), frozen.sort(), "Holdout files changed");
const profile = path.join(root, ".preview", "bird-latency-" + process.pid);
fs.mkdirSync(profile, { recursive: true });
const executable = process.env.HETU_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const chrome = spawn(executable, ["--headless=new", "--no-first-run", "--disable-extensions",
  "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
let next = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
  return reply.result.value;
}
async function until(attempt) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (chrome.exitCode !== null) throw new Error("Chrome exited: " + chrome.exitCode);
    try { const value = await attempt(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error("Timed out establishing Chrome or loading the local web app");
}

async function submit(filename) {
  const { root: document } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: document.nodeId, selector: "#bird-file" });
  // Start on the same change event as the app, before its bubbling handler.
  await evaluate(`(() => {
    const area = document.querySelector("#photo-area");
    const input = document.querySelector("#bird-file");
    window.birdPainted = new Promise((resolve, reject) => {
      input.addEventListener("change", () => {
        const began = performance.now();
        const observer = new MutationObserver(async () => {
          if (area.querySelector(".loading") || !area.querySelector(".bird-result h3")) return;
          observer.disconnect();
          try {
            await area.querySelector(".bird-frame img").decode();
            await new Promise(frame => requestAnimationFrame(() => requestAnimationFrame(frame)));
            const headings = [...area.querySelectorAll(".bird-result h3")].map(node => node.textContent.trim());
            resolve({ elapsedMs: performance.now() - began, headings, count: area.querySelectorAll(".bird-box").length });
          } catch (error) { reject(error); }
          finally { clearTimeout(timeout); }
        });
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("No painted bird result")); }, 60000);
        observer.observe(area, { childList: true, subtree: true });
      }, { capture: true, once: true });
    });
    return true;
  })()`);
  await send("DOM.setFileInputFiles", { nodeId, files: [path.join(root, ".training", "photos", filename)] });
  const result = await evaluate("window.birdPainted");
  if (!result.count) assert.deepEqual(result.headings, ["未检测到鸟"], filename);
  assert.ok(!result.count || result.count === result.headings.length, "Box count differs from rendered species count");
  const names = { "丹顶鹤": "crane", "大滨鹬": "knot", "勺嘴鹬": "spoon", "暂无法确定物种": null };
  const matches = result.count ? result.headings.map(text => {
    const label = text.replace(/^\d+\.\s*/, "");
    assert.ok(Object.hasOwn(names, label), "Unexpected heading: " + label);
    return names[label];
  }) : [];
  return { matches, elapsedMs: result.elapsedMs };
}

function summarize(rows) {
  const ms = rows.map(row => row.elapsedMs).sort((a,b) => a-b);
  const percentile = p => ms.length ? ms[Math.ceil(ms.length*p)-1] : null;
  return { n: ms.length, p50: percentile(.5), p95: percentile(.95), max: ms.at(-1) ?? null };
}
async function main() {
  const target = await until(async () => {
    const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0];
    const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    return targets.find(tab => tab.type === "page")?.webSocketDebuggerUrl;
  });
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const msg = JSON.parse(event.data);
    const callback = pending.get(msg.id);
    if (!callback) return;
    pending.delete(msg.id);
    if (msg.error) callback.reject(new Error(msg.error.message));
    else callback.resolve(msg.result);
  });
  await send("Page.navigate", { url: start.href });
  await until(() => evaluate('Boolean(document.querySelector("#bird-file"))'));
  await submit(holdout.details[0].file);
  const rows = [];
  const discrepancies = [];
  for (const { file, truth, matches: { deployed } } of holdout.details) {
    const { matches, elapsedMs } = await submit(file);
    rows.push({ file, truth, boxes: matches.length, matches, elapsedMs: Math.round(elapsedMs * 10) / 10 });
    if (JSON.stringify(matches) !== JSON.stringify(deployed)) discrepancies.push({ file, expected: deployed, matches });
  }
  const latencyMs = { all: summarize(rows), singleBox: summarize(rows.filter(r => r.boxes === 1)),
    multipleBoxes: summarize(rows.filter(r => r.boxes > 1)), noBox: summarize(rows.filter(r => !r.boxes)) };
  fs.writeFileSync(path.join(output, "browser-latency.json"), JSON.stringify({
    configSha256: holdout.configSha256, warmups: 1, latencyMs, discrepancies, rows,
  }, null, 2) + "\n");
  console.log(JSON.stringify(latencyMs, null, 2));
  assert.equal(discrepancies.length, 0, "Browser classifications differ from holdout.json; see browser-latency.json");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome.kill();
});
