(function () {
  "use strict";
  const core = window.HetuCore;
  const content = window.HetuContent;
  const view = window.HetuViews;
  const root = document.getElementById("main");
  const dialog = document.getElementById("modal");
  const notice = document.getElementById("toast");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionEase = "cubic-bezier(.2,.75,.28,1)";
  const storageKey = "hetu.v1.";
  const labels = { home: "湿地总览", tides: "潮汐预警", birds: "候鸟识别", study: "研学打卡", alerts: "农户提醒" };
  const today = core.localDate();

  let toastTimer;
  let photoController;
  let forecastController;
  let checkInTarget;

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(storageKey + key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(storageKey + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  const summaries = Object.fromEntries(content.routes.map(({ id }) => {
    const saved = load("summary." + id, "");
    return [id, { saved, draft: saved, stored: true }];
  }));
  const state = {
    today, date: today, station: content.stations[0].id, chartMinute: 720, photo: null,
    visits: load("visits", {}), summaries, subscription: load("subscription", ""),
    inbox: load("inbox", []), seenNotice: load("seenNotice", ""), imports: load("imports", {}),
    tide: { status: "idle" },
    deviceNotices: load("deviceNotices", false),
  };

  function canNotify() {
    return window.isSecureContext && /^https?:$/.test(location.protocol)
      && "Notification" in window && "serviceWorker" in navigator;
  }

  function locationView() {
    const [page, subject] = location.hash.slice(1).split("/");
    return Object.hasOwn(labels, page) ? [page, subject] : ["home", undefined];
  }

  function toast(message) {
    clearTimeout(toastTimer);
    notice.textContent = message;
    notice.classList.add("toast-visible");
    toastTimer = setTimeout(() => notice.classList.remove("toast-visible"), 3600);
  }

  function reveal(elements, stagger = 0) {
    if (reducedMotion.matches) return;
    let delay = 0;
    for (const element of elements) {
      element.animate?.([
        { opacity: 0.25, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 290, delay, easing: motionEase, fill: "backwards" });
      delay += stagger;
    }
  }

  function render(focusSelector, enter = false) {
    const [page, subject] = locationView();
    const previousCurve = root.querySelector(".plot-line")?.getAttribute("points");
    document.getElementById("view-name").textContent = labels[page];
    const newest = state.inbox[0]?.id;
    if (page === "alerts" && subject === "inbox" && newest && newest !== state.seenNotice) {
      state.seenNotice = newest;
      save("seenNotice", newest);
    }
    document.getElementById("inbox-dot").hidden = !newest || newest === state.seenNotice;
    document.title = labels[page] + " · 鹤途";
    for (const link of document.querySelectorAll("#navigation a")) {
      if (link.dataset.view === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    state.notificationAvailable = canNotify();
    state.notificationGranted = state.notificationAvailable && Notification.permission === "granted";
    root.dataset.view = page;
    root.innerHTML = view[page](state, subject);
    if (enter) {
      reveal(root.querySelectorAll(".hero-body > *, .page-head"), 42);
      reveal(root.querySelectorAll(".shortcut, .route-card"), 34);
      if (!reducedMotion.matches) {
        root.querySelector(".hero-photo")?.animate?.([
          { transform: "scale(1.045)" }, { transform: "scale(1)" },
        ], { duration: 920, easing: motionEase });
      }
    }
    const curve = root.querySelector(".plot-line");
    if (curve && !reducedMotion.matches && (enter || curve.getAttribute("points") !== previousCurve)) {
      curve.animate?.([
        { strokeDasharray: "1 1", strokeDashoffset: "1" },
        { strokeDasharray: "1 1", strokeDashoffset: "0" },
      ], { duration: 530, easing: motionEase });
    }
    if (focusSelector) root.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function navigate() {
    const [page, subject] = locationView();
    if ((page === "tides" || page === "home") && state.tide.status === "idle") queryForecast(undefined, true);
    else render(undefined, true);
    const landmark = page === "study" && subject === "log" ? "checkin-log"
      : page === "alerts" && subject === "inbox" ? "inbox" : null;
    if (landmark) document.getElementById(landmark).scrollIntoView({ block: "center" });
    else window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
  }

  function setDate(date, focusSelector) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2020-01-01" || date > "2099-12-31" || date === state.date) return;
    state.date = date;
    queryForecast(focusSelector);
  }

  function addNotice(id, title, body) {
    if (state.inbox.some((item) => item.id === id)) return true;
    state.inbox = [{ id, title, body, time: new Date().toISOString() }, ...state.inbox].slice(0, 30);
    return save("inbox", state.inbox);
  }

  async function showDeviceNotice(title, body) {
    if (!state.deviceNotices || !canNotify() || Notification.permission !== "granted") return;
    try {
      await navigator.serviceWorker.register("sw.js");
      const worker = await navigator.serviceWorker.ready;
      await worker.showNotification(title, { body, icon: "assets/mark.svg" });
    } catch {
      toast("浏览器未能显示系统通知，站内通知仍可查看。");
    }
  }

  async function toggleDeviceNotices() {
    if (!canNotify()) return;
    if (state.deviceNotices && Notification.permission === "granted") {
      state.deviceNotices = false;
      save("deviceNotices", false);
      render('[data-action="device-notices"]');
      toast("已关闭本站的系统通知。");
      return;
    }
    try {
      if (await Notification.requestPermission() !== "granted") {
        toast("系统通知权限未开启，仍可查看站内提醒。");
        return;
      }
      state.deviceNotices = true;
      save("deviceNotices", true);
      render('[data-action="device-notices"]');
      toast("已启用本站的系统通知。");
    } catch {
      toast("当前浏览器无法启用系统通知。");
    }
  }

  function updateSeasonalNotices() {
    const area = content.areas.find(({ id }) => id === state.subscription);
    if (!area) return true;
    let result = true;
    for (const id of core.seasonalAlerts(state.today)) {
      const season = content.alerts.find((item) => item.id === id);
      let year = Number(state.today.slice(0, 4));
      if (id === "winter" && state.today.slice(5) < "11-01") year -= 1;
      const key = `season/${area.id}/${id}/${year}`;
      if (state.inbox.some((item) => item.id === key)) continue;
      const title = season.title + " · " + area.name;
      result = addNotice(key, title, season.summary) && result;
      showDeviceNotice(title, season.summary);
    }
    return result;
  }

  function titleDialog(title, html) {
    checkInTarget = undefined;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="square" aria-label="关闭弹窗" data-action="close-dialog">${view.icon("x")}</button></div>${html}`;
    dialog.setAttribute("aria-labelledby", "dialog-title");
    if (!dialog.open) dialog.showModal();
  }

  function openSources() {
    const s = content.sources;
    titleDialog("数据与图片来源", `<ul class="source-list">
      <li>${view.external(s.heritage, "世界自然遗产 · UNESCO")}</li>
      <li>${view.external(s.wetland, "条子泥岸段 · 生态环境部")}</li>
      <li>${view.external(s.coast, "盐城沿岸海区 · 中央气象台")}</li>
      <li>${view.external(s.tidePlatform, "全球潮汐预报服务平台 · 国家海洋信息中心")}</li>
      <li>${view.external(s.marine, "近海预报 · Open-Meteo")} · ${view.external(s.marineModel, "Météo-France SMOC / Copernicus Marine")}</li>
      <li>${view.external(s.qweather, "和风天气 · 可选港口潮位数据")}</li>
      <li>${view.external(s.tide, "江苏海洋环境预报历史样例 · 江苏海事局")}</li>
      <li>${view.external(s.protection, "国家重点保护野生动物名录")}</li>
      <li>${view.external(s.routes, "研学线路资料 · 盐城市人民政府")}</li>
      <li>${view.external("https://github.com/Megvii-BaseDetection/YOLOX", "自动定位 · YOLOX")}</li>
      <li>${view.external("https://huggingface.co/imageomics/bioclip-2", "BioCLIP 2")} · ${view.external("https://huggingface.co/imageomics/bioclip-2.5-vith14", "BioCLIP 2.5 Huge")}</li>
      <li><a href="assets/bird-yolo-training-sources.json" target="_blank" rel="noopener">鸟类训练照片来源与许可</a></li>
    </ul><p>首页图片为 AI 生成的黄海湿地场景示意。</p>`);
  }

  function openCheckIn(routeId, stopId) {
    const route = content.routes.find(({ id }) => id === routeId);
    const stop = route?.stops.find(({ id }) => id === stopId);
    if (!stop || state.visits[routeId + "/" + stopId]) return;
    titleDialog("研学打卡", view.checkInForm(stop));
    checkInTarget = { routeId, stopId };
  }

  function updateCheckInMode(select) {
    const usingMaterials = select.value === "material";
    dialog.querySelector("#checkin-field-task").hidden = usingMaterials;
    dialog.querySelector("#checkin-alternative").hidden = !usingMaterials;
    dialog.querySelector("#checkin-note-label").textContent = usingMaterials ? "替代任务记录（必填）" : "观察笔记（选填）";
    const note = select.form.elements.note;
    note.required = usingMaterials;
    note.setCustomValidity("");
  }

  async function openStudyPoster(button) {
    const routeId = button.dataset.route;
    const route = content.routes.find(({ id }) => id === routeId);
    if (!route) return;
    const visits = route.stops.map((stop) => state.visits[routeId + "/" + stop.id]);
    if (visits.some((visit) => !visit)) return;
    const date = core.localDate(new Date(visits.map((visit) => visit.time).sort().at(-1)));
    const summary = state.summaries[routeId];
    const records = route.stops.map((stop, index) => {
      const visit = visits[index];
      const task = visit.mode === "material" ? stop.alternative.task : stop.task;
      const source = visit.mode === "material" ? window.HetuPhotos?.[stop.alternative.photo] : null;
      const photo = source && { dataUri: source.dataUri,
        caption: `照片 · iNaturalist #${source.source.split("/").at(-1)} · ${source.license.toUpperCase()}` };
      return { name: stop.name, mode: view.visitModeLabel(visit) || "已打卡", note: visit.note || "站点任务 · " + task, photo };
    });
    const savedSummary = summary.saved;
    button.disabled = true;
    let image;
    try {
      image = await window.HetuPoster.create(route, records, savedSummary, date);
      if (!image.startsWith("data:image/png;base64,")) throw new Error("PNG export unavailable");
    } catch {
      toast("海报生成失败，请重试。");
      return;
    } finally {
      button.disabled = false;
    }
    if (!button.isConnected || dialog.open) return;
    const title = view.escapeHtml(route.title);
    titleDialog("成果预览", `<div class="study-poster-actions"><a class="btn" id="study-poster-download" href="${image}" download="${title}-${date}.png">下载 PNG</a></div>
      ${summary.draft !== savedSummary ? '<p>如需包含最新小结，请保存后重新生成。</p>' : ""}
      <div class="study-poster-preview" tabindex="0" role="region" aria-label="海报预览"><img src="${image}" alt="${title}成果海报"></div>`);
  }

  function clearPhoto() {
    photoController?.abort();
    photoController = undefined;
    if (state.photo?.url?.startsWith("blob:")) URL.revokeObjectURL(state.photo.url);
    state.photo = null;
  }

  function showPhotoResult() {
    const area = document.getElementById("photo-area");
    if (area) area.innerHTML = view.birdResult(state.photo);
  }

  function validDetection(bird) {
    if (!Array.isArray(bird?.box) || bird.box.length !== 4) return false;
    const [left, top, right, bottom] = bird.box;
    return bird.box.every(n => Number.isFinite(n) && n >= 0 && n <= 1)
      && right > left && bottom > top
      && (bird.match === null || Object.hasOwn(content.birds, bird.match));
  }

  async function openPhoto(url, sample, file) {
    clearPhoto();
    const controller = new AbortController();
    photoController = controller;
    state.photo = { status: "loading", url, sample };
    showPhotoResult();
    try {
      if (location.protocol === "file:") throw new Error("请启动鹤途后端服务，从服务地址打开网页后选择照片。");
      const signal = controller.signal;
      const image = file || await (await fetch(url, { signal })).blob();
      const response = await fetch("/api/birds/recognize", { method: "POST", body: image, signal,
        headers: { "Content-Type": image.type || "application/octet-stream" } });
      if ([400, 413, 415, 422].includes(response.status)) {
        const reason = await response.json().catch(() => null);
        throw new Error(typeof reason?.error === "string" ? reason.error : "服务无法读取这张照片。请换一张图片重试。");
      }
      if (!response.ok) throw new Error("识别服务暂不可用，请检查后端运行状态后重试。");
      const { birds } = await response.json();
      if (!Array.isArray(birds) || !birds.every(validDetection)) throw new Error("识别服务返回的数据格式有误。");
      if (signal.aborted) return;
      state.photo = { status: "done", url, sample, birds };
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof TypeError || error instanceof SyntaxError
        ? "无法连接鹤途识别接口，请从后端服务地址打开网页后重试。" : error.message;
      state.photo = { status: "error", url, sample, message };
    }
    showPhotoResult();
  }

  function selectFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast("图片超过 15 MB，请选择较小的图片。");
    if (file.type && !file.type.startsWith("image/")) return toast("请选择图片文件。");
    openPhoto(URL.createObjectURL(file), undefined, file);
  }

  async function importTides(file) {
    if (!file) return;
    if (file.size > 64 * 1024) return toast("潮位文件不能超过 64 KB。");
    let imported;
    try {
      imported = core.readTideData(JSON.parse(await file.text()));
    } catch {
      return toast("无法读取文件，请检查 JSON 格式。");
    }
    if (!imported) return toast("数据不完整。请按格式示例提供点位、日期、出处、基面和 25 个潮位。");
    state.imports = { ...state.imports, [imported.station + "/" + imported.date]: imported };
    const stored = save("imports", state.imports);
    showImportedTide(imported);
    toast(stored ? "已导入潮位数据。" : "数据已导入当前会话。");
  }

  function showImportedTide(data) {
    forecastController?.abort();
    state.station = data.station;
    state.date = data.date;
    state.tide = { status: "imported", data };
    render('[data-action="open-tide-file"]');
  }

  async function queryForecast(focusSelector, enter = false) {
    forecastController?.abort();
    const controller = new AbortController();
    forecastController = controller;
    const { station, date } = state;
    const [latitude, longitude] = content.stations.find(({ id }) => id === station).marine;
    const params = new URLSearchParams({
      latitude, longitude, hourly: "sea_level_height_msl", timezone: "Asia/Shanghai",
      start_date: date, end_date: core.offsetDate(date, 1), cell_selection: "sea",
    });
    state.tide = { status: "loading" };
    render(focusSelector, enter);
    let tide = { status: "error", message: "Open-Meteo 暂不可用。请检查网络后重试。" };
    try {
      const response = await fetch("https://marine-api.open-meteo.com/v1/marine?" + params, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (response.ok) {
        const data = core.readMarineForecast(await response.json(), station, date);
        tide = data ? { status: "forecast", data }
          : { status: "error", message: "Open-Meteo 未返回该日期的完整逐小时潮位。" };
      } else if (response.status === 400) {
        tide.message = "该日期超出 Open-Meteo 可查询的范围，请选择临近日期。";
      }
    } catch {
      // Network errors and timeouts share the retry state.
    }
    if (controller.signal.aborted) return;
    forecastController = undefined;
    state.tide = tide;
    const [page] = locationView();
    if (page === "tides" || page === "home") {
      const focusedControl = focusSelector && document.activeElement.matches(focusSelector);
      render(focusedControl ? focusSelector : undefined);
    }
  }

  const actions = {
    station(button) {
      if (state.station === button.dataset.id) return;
      state.station = button.dataset.id;
      queryForecast(`[data-action="station"][data-id="${state.station}"]`);
    },
    "date-step"(button) {
      setDate(core.offsetDate(state.date, Number(button.dataset.step)), `[data-step="${button.dataset.step}"]`);
    },
    sources: openSources,
    "close-dialog": () => dialog.close(),
    "check-in": (button) => openCheckIn(button.dataset.route, button.dataset.id),
    "study-poster": openStudyPoster,
    "open-photo": () => document.getElementById("bird-file").click(),
    "open-camera": () => document.getElementById("bird-camera").click(),
    "open-tide-file": () => document.getElementById("tide-file").click(),
    "query-forecast": () => queryForecast(),
    "show-imported-tide"() {
      const data = state.imports[state.station + "/" + state.date];
      if (data) showImportedTide(data);
    },
    "remove-tide"() {
      const key = state.station + "/" + state.date;
      delete state.imports[key];
      save("imports", state.imports);
      queryForecast('[data-action="open-tide-file"]');
      toast("已移除导入资料。");
    },
    "clear-photo"() {
      clearPhoto();
      render('[data-action="open-photo"]');
    },
    sample(button) {
      const id = button.dataset.id;
      const sample = window.HetuPhotos?.[id];
      if (sample) openPhoto(sample.dataUri, id);
      else toast("示例图片暂不可用，请检查应用文件。");
    },
    "cancel-subscription"() {
      state.subscription = "";
      const stored = save("subscription", "");
      render("#area");
      toast(stored ? "已取消订阅。" : "本次会话已取消订阅。");
    },
    "device-notices": toggleDeviceNotices,
    "test-alert"() {
      const area = content.areas.find(({ id }) => id === state.subscription);
      if (!area) return;
      const title = "农田防护演示 · " + area.name;
      const body = "候鸟迁徙季临近，请提前巡看田缘，和村集体协商生态粮田安排。";
      addNotice("demo/" + area.id, title, body);
      showDeviceNotice(title, body);
      if (location.hash === "#alerts/inbox") navigate();
      else location.hash = "alerts/inbox";
      toast("演示提醒已送达通知中心。");
    },
  };

  function updateChart(slider) {
    const ctx = view.tideContext(state);
    const { series, scale } = ctx;
    const index = Number(slider.value);
    const { minute, height } = series[index];
    state.chartMinute = minute;
    document.getElementById("tide-value").textContent = `${view.time(minute)} · ${height.toFixed(2)} m`;
    slider.setAttribute("aria-valuetext", `${view.time(minute)}，${height.toFixed(2)} 米`);
    const tick = root.querySelector("[data-tick]");
    tick.setAttribute("x1", minute);
    tick.setAttribute("x2", minute);
    const point = root.querySelector("[data-point]");
    point.setAttribute("cx", minute);
    point.setAttribute("cy", view.chartY(height, scale));
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".skip")) {
      event.preventDefault();
      root.focus();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (button) actions[button.dataset.action]?.(button);
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "subscription") {
      event.preventDefault();
      state.subscription = new FormData(event.target).get("area");
      const stored = save("subscription", state.subscription);
      const inboxStored = updateSeasonalNotices();
      render("#area");
      toast(stored && inboxStored ? "已保存订阅。" : "已在本次会话订阅，浏览器存储不可用。");
    }
    if (event.target.id === "checkin-form" && checkInTarget) {
      event.preventDefault();
      const { mode, note } = event.target.elements;
      if (mode.value === "material" && !note.value.trim()) {
        note.setCustomValidity("请写下你根据资料得到的观察或答案。");
        note.reportValidity();
        return;
      }
      state.visits = core.recordVisit(state.visits, checkInTarget.routeId, checkInTarget.stopId, note.value, undefined, mode.value);
      const stored = save("visits", state.visits);
      dialog.close();
      render();
      toast(stored ? "打卡成功，已保存到本机。" : "打卡成功，记录仅保留在本次会话。");
    }
    if (event.target.id === "summary-form") {
      event.preventDefault();
      const { route } = event.target.dataset;
      const input = event.target.elements.summary;
      const text = input.value.trim().slice(0, input.maxLength);
      if (!text) {
        input.setCustomValidity("请写下你的路线小结。");
        input.reportValidity();
        return;
      }
      const summary = state.summaries[route];
      summary.saved = summary.draft = input.value = text;
      summary.stored = save("summary." + route, text);
      event.target.querySelector("#summary-status").textContent = view.summaryStatus(summary);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "checkin-mode") updateCheckInMode(event.target);
    if (event.target.id === "tide-date" && event.target.validity.valid) setDate(event.target.value, "#tide-date");
    if (event.target.id === "bird-file" || event.target.id === "bird-camera") {
      selectFile(event.target.files[0]);
      event.target.value = "";
    }
    if (event.target.id === "tide-file") {
      importTides(event.target.files[0]);
      event.target.value = "";
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "note" && event.target.form?.id === "checkin-form") event.target.setCustomValidity("");
    if (event.target.id === "summary-text") {
      const form = event.target.form;
      const summary = state.summaries[form.dataset.route];
      event.target.setCustomValidity("");
      summary.draft = event.target.value;
      const status = form.querySelector("#summary-status");
      const message = view.summaryStatus(summary);
      if (status.textContent !== message) status.textContent = message;
    }
    if (event.target.id === "tide-hour") updateChart(event.target);
  });
  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest("#drop");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("dragging");
  });
  document.addEventListener("dragleave", (event) => {
    const zone = event.target.closest("#drop");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("dragging");
  });
  document.addEventListener("drop", (event) => {
    const zone = event.target.closest("#drop");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("dragging");
    selectFile(event.dataTransfer.files[0]);
  });

  const topDate = document.getElementById("local-date");
  topDate.dateTime = today;
  const weekDay = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" });
  topDate.textContent = view.dateLabel(today) + " " + weekDay.format(new Date());
  updateSeasonalNotices();
  window.addEventListener("hashchange", navigate);
  if (location.hash) navigate();
  else queryForecast(undefined, true);
})();
