const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");

const project = path.resolve(__dirname, "..");
const output = path.join(project, ".preview");
const chrome = process.env.HETU_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
let start = process.argv[2];
let staticServer;
async function serveFrontend() {
  const dist = path.join(project, "dist");
  const types = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".css": "text/css",
    ".json": "application/json", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };
  staticServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(dist, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(dist + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => staticServer.once("error", reject).listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + staticServer.address().port + "/";
}
const port = process.env.HETU_DEBUG_PORT || "9229";
fs.mkdirSync(output, { recursive: true });
const browser = spawn(chrome, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-extensions",
  `--user-data-dir=${path.join(output, "chrome-" + process.pid)}`,
  `--remote-debugging-port=${port}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let sequence = 0;
let ws;
const callbacks = new Map();
const issues = [];

async function waitFor(attempt, limit = 12000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch {}
    await delay(120);
  }
  throw new Error("Timed out: " + attempt);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    callbacks.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalOnPage(expression) {
  const data = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (data.exceptionDetails) throw new Error(data.exceptionDetails.exception?.description);
  return data.result.value;
}

const click = (selector) => evalOnPage(`document.querySelector(${JSON.stringify(selector)}).click()`);
const hasText = (selector, expected) => waitFor(() => evalOnPage(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(expected)})`));
const hashPage = (hash) => evalOnPage(`location.hash = ${JSON.stringify(hash)}`);
const size = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
const noHorizontalOverflow = () => evalOnPage("document.documentElement.scrollWidth === document.documentElement.clientWidth");
const checkInMode = (mode) => evalOnPage(`(() => {
  const select = document.querySelector('#checkin-mode');
  select.value = ${JSON.stringify(mode)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);

function waitForCover(filename) {
  return waitFor(() => evalOnPage(`(() => {
    const cover = document.querySelector(".hero-photo");
    return cover?.naturalWidth > 0 && cover.currentSrc.endsWith(${JSON.stringify(filename)});
  })()`));
}

async function selectFile(selector, relativePath) {
  const file = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: file.root.nodeId, selector });
  await send("DOM.setFileInputFiles", { nodeId, files: [path.join(project, relativePath)] });
}

async function screenshot(name) {
  await evalOnPage("Promise.allSettled(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)).then(() => true)");
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(capture.data, "base64"));
}

async function main() {
  start ||= await serveFrontend();
  const url = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
  });
  ws = new WebSocket(url);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const callback = callbacks.get(message.id);
    if (callback) {
      callbacks.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      issues.push(message.params.exceptionDetails.exception?.description);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      issues.push(message.params.args.map((arg) => arg.description || arg.value).join(" "));
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");

  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const nativeFetch = window.fetch;
    window.marineRequests = [];
    window.fetch = (input, options) => {
      const url = new URL(input, location.href);
      if (url.origin === location.origin && url.pathname === "/api/birds/recognize") {
        if (options.method !== "POST" || !(options.body instanceof Blob) || !options.body.size) {
          throw new Error("Expected a binary image POST");
        }
        window.birdRequestCount = (window.birdRequestCount || 0) + 1;
        if (window.deferBird) {
          window.deferBird = false;
          return new Promise(resolve => { window.releaseBird = () => resolve(Response.json({ birds: [] })); });
        }
        if (window.birdUnavailable) return Promise.resolve(new Response(null, { status: 503 }));
        if (window.invalidImage) return Promise.resolve(Response.json({ error: "无法读取照片，请选择有效图片" }, { status: 400 }));
        return Promise.resolve(Response.json({ birds: window.testBirds || [] }));
      }
      if (url.hostname !== 'marine-api.open-meteo.com') return nativeFetch(input, options);
      const params = Object.fromEntries(url.searchParams);
      window.marineRequests.push(params);
      if (window.forecastUnavailable) return Promise.resolve(new Response(null, { status: 503 }));
      const time = Array.from({ length: 24 }, (_, hour) =>
        params.start_date + 'T' + String(hour).padStart(2, '0') + ':00');
      time.push(params.end_date + 'T00:00');
      const response = (offset = 0) => Response.json({
        latitude: Number(params.latitude), longitude: Number(params.longitude), utc_offset_seconds: 28800,
        hourly_units: { sea_level_height_msl: 'm' },
        hourly: { time, sea_level_height_msl: time.map((_, hour) => hour / 10 - 1 + offset) },
      });
      if (window.deferNextForecast) {
        window.deferNextForecast = false;
        return new Promise(resolve => { window.finishDeferredForecast = () => resolve(response(5)); });
      }
      return Promise.resolve(response());
    };
  })()` });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await size(1440, 900);
  await send("Page.navigate", { url: start });
  await hasText("h1", "候鸟归来");
  await waitForCover("crane-dawn.webp");
  await waitFor(() => evalOnPage("document.fonts.status === 'loaded'"));
  await screenshot("desktop");
  assert.equal(await noHorizontalOverflow(), true);
  await click('a[href="#tides"].light');
  await hasText("h1", "潮汐预警");
  await hasText(".stack", "条子泥的区域参考站为弶港");
  assert.equal(await evalOnPage(`document.querySelector('a[href="https://global-tide.nmdis.org.cn/"]').target`), "_blank");
  await hasText(".chart-legend", "Open-Meteo 模型潮位");
  assert.equal(await evalOnPage("window.marineRequests.length"), 1);
  for (const [id, latitude, longitude] of [["badou", "32.98", "121.02"], ["dongsha", "33.11", "121.3"], ["tiaozini", "32.76", "121.11"]]) {
    await click(`[data-id="${id}"]`);
    await hasText(".chart-legend", "Open-Meteo 模型潮位");
    await hasText(".stack", "全球平均海平面");
    const request = await evalOnPage("window.marineRequests.at(-1)");
    assert.equal(request.latitude, latitude);
    assert.equal(request.longitude, longitude);
    assert.equal(request.timezone, "Asia/Shanghai");
    assert.equal(request.hourly, "sea_level_height_msl");
  }

  const today = await evalOnPage("HetuCore.localDate()");
  const tomorrow = await evalOnPage("HetuCore.offsetDate(HetuCore.localDate(), 1)");
  await evalOnPage("window.deferNextForecast = true");
  await click('[data-step="1"]');
  await hasText(".detailed", "正在查询 Open-Meteo");
  assert.equal(await evalOnPage("window.marineRequests.at(-1).start_date"), tomorrow);
  assert.equal(await evalOnPage("Boolean(document.querySelector('.plot-line, #tide-hour'))"), false);
  await click('[data-step="-1"]');
  await hasText(".chart-legend", "Open-Meteo 模型潮位");
  assert.equal(await evalOnPage("window.marineRequests.at(-1).start_date"), today);
  assert.equal(await evalOnPage("window.marineRequests.length"), 6);
  await evalOnPage("window.finishDeferredForecast()");
  assert.equal(await evalOnPage("document.querySelector('#tide-date').value"), today);
  assert.equal(await evalOnPage("document.querySelector('#tide-value').textContent.includes('0.20 m')"), true);

  await evalOnPage(`(() => {
    window.forecastUnavailable = true;
    const input = document.querySelector('#tide-date');
    input.value = "${tomorrow}";
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await hasText(".detailed", "暂无潮位数据");
  assert.equal(await evalOnPage("window.marineRequests.at(-1).start_date"), tomorrow);
  assert.equal(await evalOnPage("Boolean(document.querySelector('.plot-line, #tide-hour'))"), false);
  await evalOnPage("window.forecastUnavailable = false");
  await click('[data-action="query-forecast"]');
  await hasText(".chart-legend", "Open-Meteo 模型潮位");
  await evalOnPage(`(() => {
    const slider = document.querySelector('#tide-hour');
    slider.value = 3;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    const tide = { station: 'tiaozini', date: '${tomorrow}', source: '测试导入资料', datum: '测试基面',
      levels: Array(25).fill(2) };
    const file = new File([JSON.stringify(tide)], 'tides.json', { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#tide-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await hasText(".chart-legend", "导入潮位");
  await hasText("#tide-value", "03:00");
  await click('[data-action="remove-tide"]');
  await hasText(".chart-legend", "Open-Meteo 模型潮位");
  await screenshot("tides");

  await hashPage("study/tidal");
  await hasText("h1", "潮间带");
  assert.match(await evalOnPage("document.querySelector('#route-summary')?.textContent || ''"), /潮水/);
  assert.equal(await evalOnPage(`document.querySelector('[data-action="study-poster"]')?.disabled`), true);
  await click('[data-action="check-in"]');
  await evalOnPage("document.querySelector('#note').value = '660 号观测记录 <草本>'");
  await click('#checkin-form button[type="submit"]');
  await hasText(".stop-list", "已打卡");
  await hasText('[data-id="roost"]', "打卡");
  await click('[data-action="check-in"][data-id="roost"]');
  assert.equal(await evalOnPage("document.querySelector('#checkin-alternative').hidden"), true);
  await checkInMode("material");
  await hasText("#checkin-alternative", "720 高地");
  assert.equal(await evalOnPage("document.querySelector('#checkin-field-task').hidden"), true);
  assert.equal(await evalOnPage("document.querySelector('#checkin-alternative a').hostname"), "www.mee.gov.cn");
  await click('#checkin-form button[type="submit"]');
  assert.equal(await evalOnPage("document.querySelector('dialog').open"), true);
  await evalOnPage("document.querySelector('#note').value = '   '");
  await click('#checkin-form button[type="submit"]');
  assert.equal(await evalOnPage("document.querySelector('#note').validity.customError"), true);
  await checkInMode("field");
  assert.equal(await evalOnPage("document.querySelector('#note').required"), false);
  assert.equal(await evalOnPage("document.querySelector('#checkin-alternative').hidden"), true);
  await checkInMode("material");
  await evalOnPage("document.querySelector('#note').value = '退潮后在滩涂觅食，涨潮后到高地休息。'");
  await click('#checkin-form button[type="submit"]');
  await hasText(".stop-list", "展陈资料");
  assert.equal(await evalOnPage(`Boolean(document.querySelector('[data-action="check-in"][data-id="roost"]'))`), false);
  await hasText(".stop-list", "退潮后在滩涂觅食，涨潮后到高地休息。");
  await evalOnPage(`(() => {
    const summary = document.querySelector('#summary-text');
    summary.value = '\\n  潮水改变可用的觅食地点。<观察>  ';
    summary.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await hasText("#summary-status", "有未保存的修改");
  await hashPage("study/cranes");
  await hasText("h1", "丹顶鹤湿地生态课堂");
  assert.equal(await evalOnPage("document.querySelector('#summary-text').value"), "");
  await hasText("#route-summary", "哪些特征");
  await click('[data-action="check-in"][data-id="lookout"]');
  await checkInMode("material");
  await waitFor(() => evalOnPage("document.querySelector('.study-photo')?.naturalWidth > 0"));
  await hasText("#checkin-alternative", "丹顶鹤照片来源与许可");
  await click('dialog [data-action="close-dialog"]');
  await hashPage("study/tidal");
  await hasText("h1", "潮间带");
  assert.equal(await evalOnPage("document.querySelector('#summary-text').value"), "\n  潮水改变可用的觅食地点。<观察>  ");
  await click('#summary-form button[type="submit"]');
  await hasText("#summary-status", "已保存");
  await evalOnPage(`(() => {
    const key = 'hetu.v1.visits';
    const visits = JSON.parse(localStorage.getItem(key));
    visits['museum/lobby'] = { note: '旧观察笔记', time: '2026-11-10T04:00:00.000Z' };
    localStorage.setItem(key, JSON.stringify(visits));
  })()`);
  await send("Page.reload");
  await hasText("h1", "潮间带");
  assert.equal(await evalOnPage("document.querySelector('#summary-text').value"), "潮水改变可用的觅食地点。<观察>");
  await hasText("#summary-status", "已保存");
  await evalOnPage("document.querySelector('#summary-text').value = '补充：水鸟可能到高地休息。'");
  await click('#summary-form button[type="submit"]');
  assert.equal(await evalOnPage("JSON.parse(localStorage.getItem('hetu.v1.summary.tidal'))"), "补充：水鸟可能到高地休息。");
  assert.equal(await evalOnPage(`document.querySelector('[data-action="study-poster"]').disabled`), true);
  await click('[data-action="check-in"][data-id="platform"]');
  await click('#checkin-form button[type="submit"]');
  assert.equal(await evalOnPage(`document.querySelector('[data-action="study-poster"]').disabled`), false);
  await click('[data-action="study-poster"]');
  await hasText('#dialog-title', '成果预览');
  await waitFor(() => evalOnPage("document.querySelector('.study-poster-preview img')?.naturalWidth >= 1080"));
  const poster = await evalOnPage(`(() => {
    const preview = document.querySelector('.study-poster-preview img');
    const download = document.querySelector('#study-poster-download');
    return { filename: download.download, height: preview.naturalHeight,
      valid: download.href === preview.src && download.href.startsWith('data:image/png;base64,') };
  })()`);
  assert.equal(poster.valid, true);
  assert.ok(poster.height > 1080);
  assert.match(poster.filename, /^条子泥潮间带观察.*\.png$/);
  const downloadPath = path.join(output, 'chrome-' + process.pid);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  await click('#study-poster-download');
  const png = await waitFor(() => fs.readFileSync(path.join(downloadPath, poster.filename)));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await click('dialog [data-action="close-dialog"]');
  await hashPage("study/log");
  await hasText(".log-list", "660 号观测记录 <草本>");
  await hasText(".log-list", "旧观察笔记");
  assert.deepEqual(await evalOnPage(`Object.fromEntries(Array.from(document.querySelectorAll('.log-list .log'), (row) => [
    row.querySelector('h3').textContent, row.querySelector('.tag')?.textContent || null
  ]))`), { "720 高地外围公开观察点": "展陈资料", "条子泥游客中心": "现场观察", "景区开放观鸟平台": "现场观察", "黄海湿地博物馆 · 序厅": null });
  await hasText(".log-list", "退潮后在滩涂觅食，涨潮后到高地休息。");

  await hashPage("study/cranes");
  await hasText("h1", "丹顶鹤湿地生态课堂");
  for (const id of ["entrance", "lookout", "review"]) {
    await click(`[data-action="check-in"][data-id="${id}"]`);
    if (id === "lookout") {
      await checkInMode("material");
      await evalOnPage("document.querySelector('#note').value = '照片观察：羽毛以白色为主。'");
    }
    await click('#checkin-form button[type="submit"]');
  }
  await evalOnPage(`(() => {
    const canvas = CanvasRenderingContext2D.prototype;
    window.posterDraws = { text: [], images: 0 };
    const originalText = canvas.fillText;
    const originalImage = canvas.drawImage;
    canvas.fillText = function (value, ...args) {
      window.posterDraws.text.push(value);
      return originalText.call(this, value, ...args);
    };
    canvas.drawImage = function (image, ...args) {
      if (image instanceof HTMLImageElement && image.src === HetuPhotos.crane.dataUri) window.posterDraws.images++;
      return originalImage.call(this, image, ...args);
    };
    window.restorePosterCanvas = () => {
      canvas.fillText = originalText;
      canvas.drawImage = originalImage;
    };
  })()`);
  await click('[data-action="study-poster"]');
  await waitFor(() => evalOnPage("document.querySelector('.study-poster-preview img')?.naturalWidth >= 1080"));
  const draws = await evalOnPage("window.restorePosterCanvas(); window.posterDraws");
  assert.equal(draws.images, 1);
  assert.equal(draws.text.some((line) => line.includes("研学海报")), false);
  assert.ok(draws.text.some((line) => line.includes("羽毛以白色为主")));
  assert.ok(draws.text.some((line) => line.includes("iNaturalist")));
  const photoPosterName = await evalOnPage("document.querySelector('#study-poster-download').download");
  await click('#study-poster-download');
  const photoPoster = await waitFor(() => fs.readFileSync(path.join(downloadPath, photoPosterName)));
  assert.equal(photoPoster.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await click('dialog [data-action="close-dialog"]');

  await hashPage("alerts");
  await hasText("h1", "农户提醒");
  await click('#subscription button[type="submit"]');
  await hasText(".subscription", "已订阅");
  if (start.startsWith("http://127.0.0.1:")) {
    await send("Browser.grantPermissions", { origin: new URL(start).origin, permissions: ["notifications"] });
    await click('[data-action="device-notices"]');
    await hasText('[data-action="device-notices"]', "关闭系统通知");
  }
  await click('[data-action="test-alert"]');
  await hasText("#inbox", "农田防护演示");
  assert.equal(await evalOnPage("document.querySelector('#inbox-dot').hidden"), true);
  if (start.startsWith("http://127.0.0.1:")) {
    await waitFor(() => evalOnPage("navigator.serviceWorker.getRegistration().then(r => r?.getNotifications()).then(rows => rows?.some(row => row.title.includes('农田防护演示')))"));
  }
  await send("Page.reload");
  await hasText("#inbox", "农田防护演示");
  await click('[data-action="cancel-subscription"]');
  await hasText(".subscription", "未订阅");

  await hashPage("birds");
  await hasText("h1", "候鸟识别");
  if (start.startsWith("file:")) {
    assert.equal(await evalOnPage(`document.querySelector('a[href="http://127.0.0.1:8765/#birds"]')?.href`),
      "http://127.0.0.1:8765/#birds");
    assert.equal(await evalOnPage(`Boolean(document.querySelector('#drop, #bird-file, [data-action="sample"]'))`), false);
  } else {
    for (const [id, name] of [["crane", "丹顶鹤"], ["spoon", "勺嘴鹬"], ["knot", "大滨鹬"]]) {
      await evalOnPage(`window.testBirds = [{ match: ${JSON.stringify(id)}, box: [.1,.2,.7,.9] }]`);
      await click(`[data-action="sample"][data-id="${id}"]`);
      await hasText(".bird-result h3", name);
    }
    assert.equal(await evalOnPage("window.birdRequestCount"), 3);
    await click('[data-action="clear-photo"]');
    await evalOnPage("window.testBirds.push({ match: null, box: [.7,.1,.9,.4] })");
    await selectFile("#bird-file", "dist/assets/crane.jpg");
    await hasText("#photo-area", "暂无法确定物种");
    assert.equal(await evalOnPage("document.querySelectorAll('.bird-box').length"), 2);
    assert.equal(await evalOnPage("document.querySelectorAll('.bird-result h3').length"), 2);
    await screenshot("birds");
    await evalOnPage("window.deferBird = true");
    await click('[data-action="sample"][data-id="crane"]');
    await waitFor(() => evalOnPage("Boolean(window.releaseBird)"));
    await click('[data-action="sample"][data-id="knot"]');
    await hasText(".bird-result h3", "大滨鹬");
    await evalOnPage("window.releaseBird()");
    await hasText(".bird-result h3", "大滨鹬");
    await evalOnPage("window.testBirds = []");
    await click('[data-action="sample"][data-id="knot"]');
    await hasText("#photo-area", "未检测到鸟");
    await evalOnPage("window.birdUnavailable = true");
    await click('[data-action="sample"][data-id="knot"]');
    await hasText("#photo-area", "暂时无法识别");
    await evalOnPage("window.birdUnavailable = false; window.invalidImage = true");
    await click('[data-action="sample"][data-id="knot"]');
    await hasText("#photo-area", "无法读取照片，请选择有效图片");
    assert.equal(await evalOnPage("Boolean(document.querySelector('[data-action=adjust-crop]'))"), false);
  }

  await size(390, 844, true);
  await send("Page.navigate", { url: start });
  await hasText("h1", "候鸟归来");
  await waitForCover("crane-dawn-mobile.webp");
  assert.equal(await noHorizontalOverflow(), true);
  assert.equal(await evalOnPage("getComputedStyle(document.querySelector('.sidebar')).position"), "fixed");
  await screenshot("mobile");
  await hashPage("birds");
  await hasText("h1", "候鸟识别");
  assert.equal(await noHorizontalOverflow(), true);
  await hashPage("study/museum");
  await hasText("h1", "师范研学");
  await hasText("#route-summary", "向中学生解释");
  assert.equal(await evalOnPage("document.querySelector('#summary-text').value"), "");
  assert.equal(await noHorizontalOverflow(), true);
  await click('[data-action="check-in"][data-id="flyway"]');
  await checkInMode("material");
  await hasText("#checkin-alternative", "候鸟迁飞通道保护修复中国行动计划");
  assert.equal(await noHorizontalOverflow(), true);
  await click('dialog [data-action="close-dialog"]');
  await hashPage("study/tidal");
  await hasText("h1", "潮间带");
  await click('[data-action="study-poster"]');
  await hasText('#dialog-title', '成果预览');
  assert.equal(await evalOnPage("document.querySelector('.study-poster-preview').clientWidth === document.querySelector('.study-poster-preview').scrollWidth"), true);
  assert.equal(await noHorizontalOverflow(), true);
  await click('dialog [data-action="close-dialog"]');
  await click('[data-action="sources"]');
  assert.equal(await evalOnPage("document.querySelector('dialog').open"), true);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await size(320, 740, true);
  await send("Page.navigate", { url: start });
  await hasText("h1", "候鸟归来");
  await waitForCover("crane-dawn-mobile.webp");
  assert.equal(await evalOnPage("document.querySelector('.hero h1').getAnimations().length"), 0);
  assert.equal(await evalOnPage("document.querySelector('.hero-photo').getAnimations().length"), 0);
  assert.equal(await noHorizontalOverflow(), true);
  await click('a[href="#tides"].light');
  await hasText("h1", "潮汐预警");
  await hasText(".chart-legend", "Open-Meteo 模型潮位");
  assert.equal(await evalOnPage("document.querySelector('.plot-line').getAnimations().length"), 0);
  assert.equal(await noHorizontalOverflow(), true);
  assert.deepEqual(issues, []);
  console.log("Browser checks passed: desktop and mobile, Open-Meteo queries and failure fallback, tide import, bird API integration with fixture responses, multi-bird boxes, unknown species, empty detections and server errors, saved check-in, study poster preview and PNG download, and inbox.");
}

main().catch((error) => {
  console.error(error);
  console.error(issues);
  process.exitCode = 1;
}).finally(() => {
  staticServer?.close();
  ws?.close();
  browser.kill();
});
