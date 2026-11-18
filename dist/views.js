(function (root) {
  "use strict";
  const core = root.HetuCore;
  const content = root.HetuContent;
  const { stations, birds, routes, areas, alerts, sources } = content;
  const fmtDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
  const fmtLog = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const time = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const dateLabel = (date) => fmtDate.format(new Date(date + "T12:00:00+08:00"));
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const external = (url, label) => `<a class="text-button" href="${url}" target="_blank" rel="noopener noreferrer">${label} ${icon("external")}</a>`;
  const tag = (label, tone = "") => `<span class="tag ${tone}">${label}</span>`;
  const iconBox = (name, tone = "") => `<span class="icon-box ${tone}">${icon(name)}</span>`;
  const action = (label, href, type = "", name = "arrow") => `<a class="btn ${type}" href="${href}">${label} ${icon(name)}</a>`;
  const callout = (text, name = "info", tone = "") => `<div class="callout ${tone}">${icon(name)}<div>${text}</div></div>`;

  function pageHead(title, description, name, tone, right = "") {
    return `<header class="page-head ${tone}"><div class="page-intro">${iconBox(name, tone)}
      <div><h1>${title}</h1><p>${description}</p></div></div>${right}</header>`;
  }

  function stationControl(state) {
    return `<div class="segments" role="group" aria-label="选择潮汐点位">
      ${stations.map(({ id, name }) => `<button type="button" data-action="station" data-id="${id}" aria-pressed="${id === state.station}">${name}</button>`).join("")}
    </div>`;
  }

  function tideContext(state) {
    const station = stations.find(({ id }) => id === state.station);
    const key = station.id + "/" + state.date;
    const { status, data, message } = state.tide;
    const storedImport = state.imports[key];
    if (!data) return { station, status, message, storedImport, kind: status === "error" ? "暂无数据" : "查询中" };
    const kind = status === "imported" ? "导入数据" : "Open-Meteo 预报";
    const series = data.levels.map((height, hour) => ({ minute: hour * 60, height }));
    const lower = Math.floor(Math.min(...data.levels));
    const step = Math.max(1, Math.ceil((Math.max(...data.levels) - lower) / 3));
    const scale = [lower + 3 * step, lower + 2 * step, lower + step, lower];
    return { station, status, storedImport, data, kind, series, scale, extremes: core.tideExtremes(series) };
  }

  const chartY = (height, scale) => 120 * (scale[0] - height) / (scale[0] - scale[3]);

  function graph(ctx, index) {
    const { station, series, scale, status } = ctx;
    const coords = series.map(({ minute, height }) => `${minute},${chartY(height, scale).toFixed(2)}`).join(" ");
    const point = series[index];
    return `<figure class="tide-figure">
      <div class="plot">
        <div class="y-axis" aria-hidden="true">${scale.map((value) => `<span>${value} m</span>`).join("")}</div>
        <svg class="graph" viewBox="0 0 1440 120" preserveAspectRatio="none" role="img" aria-label="${station.name}潮位曲线，横轴为 0 至 24 时，纵轴为 ${scale[3]} 至 ${scale[0]} 米">
          <defs><linearGradient id="tide-gradient" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#76bfa2" stop-opacity=".42"/><stop offset="1" stop-color="#d8eee4" stop-opacity=".25"/></linearGradient></defs>
          ${[0, 40, 80, 120].map((y) => `<path class="plot-grid" d="M0 ${y}h1440"/>`).join("")}
          <polygon points="0,120 ${coords} 1440,120" fill="url(#tide-gradient)"/>
          <polyline points="${coords}" class="plot-line" pathLength="1"/>
          ${point ? `<line class="tick" data-tick x1="${point.minute}" x2="${point.minute}" y1="0" y2="120"/><ellipse class="point" data-point cx="${point.minute}" cy="${chartY(point.height, scale)}" rx="7" ry="3.3"/>` : ""}
        </svg>
        <div class="x-axis" aria-hidden="true"><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>24:00</span></div>
      </div>
      <figcaption class="chart-legend"><span><i class="legend-line"></i>${status === "imported" ? "导入潮位" : "Open-Meteo 模型潮位"}</span></figcaption>
    </figure>`;
  }

  function extremes(ctx) {
    return `<div class="mini-tides" aria-label="高低潮时刻">${ctx.extremes.map(({ minute, height, kind }) => `<div class="${kind}"><small>${kind === "high" ? "高潮" : "低潮"}</small><strong>${time(minute)} <span>${height.toFixed(2)} m</span></strong></div>`).join("")}</div>`;
  }

  function forecastStatus(ctx) {
    if (ctx.status !== "error") return '<p class="subtle" role="status">正在查询 Open-Meteo 近海潮位…</p>';
    return `<p class="subtle" role="status"><strong>暂无潮位数据。</strong> ${ctx.message}</p>
      <div class="source-row"><button type="button" class="text-button" data-action="query-forecast">重试查询</button></div>`;
  }

  function tideSourceCard(ctx) {
    if (ctx.status === "imported") return `<section class="card">
      <div class="section-heading"><h2>导入潮位资料</h2>${tag("待核验", "amber")}</div>
      <p class="subtle">出处：${escapeHtml(ctx.data.source)}<br>潮位基面：${escapeHtml(ctx.data.datum)}</p>
      <p class="home-advice">${ctx.station.advice} 实际开放时段请向当地管理方确认。</p>
      <button type="button" class="text-button" data-action="query-forecast">查询 Open-Meteo</button>
    </section>`;
    if (ctx.status !== "forecast") return "";
    const [lat, lon] = ctx.data.grid;
    return `<section class="card">
        <div class="section-heading"><h2>近海模型潮位</h2></div>
        <p class="subtle">海洋网格 ${lat.toFixed(3)}°N，${lon.toFixed(3)}°E<br>潮位基面为${ctx.data.datum}。</p>
        <p class="home-advice">近海模型仅供趋势参考。实际开放时段和海洋预警以现场及主管部门发布为准。</p>
        <div class="source-row">${external(sources.marine, "Open-Meteo")}</div>
    </section>`;
  }

  function home(state) {
    const ctx = tideContext(state);
    const season = alerts.find(({ id }) => core.seasonalAlerts(state.today).includes(id));
    const features = [
      ["tides", "waves", "blue", "潮汐预警", "三处点位潮位趋势"],
      ["birds", "feather", "", "候鸟识别", "拍照识鸟与保护等级"],
      ["study", "route", "gold", "研学打卡", "路线任务与观察笔记"],
      ["alerts", "bell", "clay", "农户提醒", "迁徙季与农田防护"],
    ];
    return `<section class="hero" aria-labelledby="hero-title">
      <picture class="hero-media">
        <source media="(max-width: 650px)" srcset="assets/crane-dawn-mobile.webp">
        <img class="hero-photo" src="assets/crane-dawn.webp" alt="" fetchpriority="high">
      </picture>
      <div class="hero-body">
        <span class="hero-label">${icon("pin")} 江苏盐城 · 世界自然遗产</span>
        <h1 id="hero-title">潮起黄海，<span>候鸟归来。</span></h1>
        <p>查滩涂潮汐，识身边候鸟，记录黄海湿地见闻。</p>
        <div class="hero-actions">
          ${action("潮汐预警", "#tides", "light")}
          ${action("识别候鸟", "#birds", "hero-secondary", "feather")}
        </div>
      </div>
      <small class="hero-credit">黄海滩涂 · 场景示意</small>
    </section>
    <nav class="tools-section" aria-label="湿地工具">
      <div class="shortcuts">${features.map(([id, name, tone, title, description]) => `<a class="shortcut ${tone}" href="#${id}">
        ${iconBox(name, tone)}<span class="shortcut-arrow">${icon("arrow")}</span><div class="shortcut-text"><strong>${title}</strong><small>${description}</small></div>
      </a>`).join("")}</div>
    </nav>
    <div class="panel-grid section">
      <section class="card">
        <div class="card-title"><div><h2>潮汐趋势</h2><p>${dateLabel(state.date)} · 北京时间 · ${ctx.kind}</p></div><a class="text-button" href="#tides">查看详情 ${icon("arrow")}</a></div>
        <div class="station-line">${stationControl(state)}<span class="station-label">${icon("pin")}${ctx.station.area}</span></div>
        ${ctx.data ? graph(ctx) + extremes(ctx) : forecastStatus(ctx)}
      </section>
      <div class="stack">
        ${tideSourceCard(ctx)}
        <section class="card season-overview">
          <div class="home-season">${iconBox("bell", "clay")}<div><h3>${season?.title ?? "候鸟迁徙日历"}</h3><p>${season?.season ?? "查看盐城沿海候鸟到访时段"}</p><a href="#alerts" class="text-button">查看农户提醒 ${icon("arrow")}</a></div></div>
        </section>
      </div>
    </div>`;
  }

  function tides(state) {
    const ctx = tideContext(state);
    const index = Math.round(state.chartMinute / 60);
    const selected = ctx.series?.[index];
    return `${pageHead("潮汐预警", "查询盐城沿海三个点位的近海潮位，或导入逐时资料。", "waves", "blue", tag(ctx.kind, ctx.data ? "blue" : "amber"))}
      ${callout("<strong>请选择开放的岸上观鸟点</strong>实际出行请查当天景区开放公告和官方海洋预警。", "shield", "amber")}
      <div class="tide-controls">
        <div class="station-line">${stationControl(state)}<span class="station-label">${icon("pin")}${ctx.station.area}</span></div>
        <div class="date-controls">
          <button class="square prev" type="button" data-action="date-step" data-step="-1" aria-label="前一天">${icon("arrow")}</button>
          <input id="tide-date" type="date" aria-label="潮汐日期" value="${state.date}" min="2020-01-01" max="2099-12-31">
          <button class="square" type="button" data-action="date-step" data-step="1" aria-label="后一天">${icon("arrow")}</button>
        </div>
      </div>
      <div class="panel-grid section">
        <section class="card detailed">
          <div class="card-title"><div><h2>${ctx.station.name}潮位曲线</h2><p>${dateLabel(state.date)} · 北京时间</p></div></div>
          ${selected ? `${graph(ctx, index)}
          <label class="slider-label" for="tide-hour">查看曲线上任一时刻<output id="tide-value" for="tide-hour">${time(selected.minute)} · ${selected.height.toFixed(2)} m</output></label>
          <input id="tide-hour" type="range" min="0" max="${ctx.series.length - 1}" value="${index}" aria-valuetext="${time(selected.minute)}，${selected.height.toFixed(2)} 米">
          ${extremes(ctx)}` : forecastStatus(ctx)}
        </section>
        <div class="stack">
          ${tideSourceCard(ctx)}
          <section class="card">
            <div class="section-heading"><h2>免费查港口潮汐</h2></div>
            <p class="subtle">${ctx.station.name}的区域参考站为<strong>${ctx.station.reference.name}</strong>。在国家海洋信息中心选站后，查看所选日期的潮时、潮高和基面。</p>
            <p class="subtle">港口潮位仅供区域参考。出行请查景区公告和官方海洋预警。</p>
            <div class="source-row">
              ${external(sources.tidePlatform, "国家海洋信息中心 · 全球潮汐")}
              ${external(sources.oceanWarnings, "国家海洋预报台")}
            </div>
          </section>
          <section class="card">
            <div class="section-heading"><h2>官方信息</h2></div>
            <p class="subtle">查盐城沿岸海区天气，或查看江苏海洋环境预报与港口潮汐表的发布样例。</p>
            <div class="source-row">${external(sources.coast, "沿岸海区预报")}${external(sources.tide, "潮汐发布样例")}</div>
          </section>
          <section class="card">
            <div class="section-heading"><h2>导入点位潮位</h2></div>
            <p class="subtle">导入带出处和潮位基面说明的逐小时 JSON。可用本地脚本下载${ctx.station.reference.name}参考站的和风天气潮位，配置见 README。</p>
            <div class="source-row"><button type="button" class="text-button" data-action="open-tide-file">选择 JSON 文件</button>
              <a class="text-button" href="assets/tide-template.json" download>下载空白模板</a>
              ${external(sources.qweather, "和风天气")}
              ${ctx.storedImport && ctx.status !== "imported" ? '<button type="button" class="text-button" data-action="show-imported-tide">查看已导入数据</button>' : ""}
              ${ctx.storedImport ? '<button type="button" class="text-button" data-action="remove-tide">移除此份数据</button>' : ""}</div>
            <input type="file" id="tide-file" accept=".json,application/json" hidden>
          </section>
        </div>
      </div>`;
  }

  function photoCredit(id) {
    const photo = root.HetuPhotos?.[id];
    if (!photo) return "";
    return `<a class="photo-credit" aria-label="照片出处与许可" href="${photo.source}" target="_blank" rel="noopener">${escapeHtml(photo.credit)}</a>`;
  }

  function birdResult(result) {
    if (!result) return "";
    const detections = result.birds || [];
    const boxes = detections.map(({ box: [left, top, right, bottom] }, index) =>
      `<span aria-hidden="true" class="bird-box" style="inset:${top*100}% ${(1-right)*100}% ${(1-bottom)*100}% ${left*100}%"><b>${index+1}</b></span>`
    ).join("");
    let summary;
    if (result.status === "loading") summary = '<h3><span class="loading"></span>正在识别</h3>';
    else if (result.status === "error") summary = `<h3>暂时无法识别</h3><p>${escapeHtml(result.message)}</p>`;
    else if (!detections.length) summary = "<h3>未检测到鸟</h3><p>可以换一张鸟体更清晰的照片。</p>";
    else summary = detections.map(({ match }, index) => {
      const bird = birds[match];
      const prefix = detections.length > 1 ? `${index + 1}. ` : "";
      if (!bird) return `<section><h3>${prefix}暂无法确定物种</h3><p>已检测到鸟，物种特征不足或超出当前支持范围。</p></section>`;
      return `<section><h3>${prefix}${bird.name}</h3><p class="latin">${bird.latin}</p>${tag(bird.protection)}<p>${bird.features}</p><p>${bird.habitat}</p></section>`;
    }).join("");
    return `<div class="photo-result"><div><div class="bird-frame"><img src="${escapeHtml(result.url)}" alt="本次识别照片">${boxes}</div>${result.sample ? photoCredit(result.sample) : ""}</div>
      <div class="bird-result">${summary}<div class="action-row">
        <button class="text-button" type="button" data-action="clear-photo">重新选图</button>
      </div></div></div>`;
  }

  function birdView(state) {
    const fromLocalFile = root.location.protocol === "file:";
    return `${pageHead("候鸟识别", "拍摄或选择一张清晰照片，查看候选鸟种和保护等级。", "feather", "", tag("后端识别"))}
    <div class="panel-grid">
      <section class="card">
        <div class="card-title"><div><h2>识别照片</h2><p>自动定位照片中的鸟，支持丹顶鹤、勺嘴鹬和大滨鹬。</p></div></div>
        ${fromLocalFile ? `<div class="upload">
          <h3>从本机服务打开候鸟识别</h3>
          <p>按项目 README 中的命令启动鹤途，再打开识鸟页面。</p>
          <div class="action-row"><a class="btn" href="http://127.0.0.1:8765/#birds">打开本机识鸟页面 ${icon("arrow")}</a></div>
        </div>` : `<div id="photo-area" aria-live="polite">
          ${state.photo ? birdResult(state.photo) : `<div class="upload" id="drop">
            ${iconBox("camera")}<h3>拍照或选择照片</h3><p>可拖入 JPG、PNG、WebP 等常见图片，最大 15 MB。</p>
            <div class="action-row">
              <button type="button" class="btn" data-action="open-photo">${icon("image")} 选择照片</button>
              <button type="button" class="btn outline" data-action="open-camera">${icon("camera")} 拍照</button>
            </div>
          </div>`}
        </div>
        <input type="file" id="bird-file" accept="image/*" hidden>
        <input type="file" id="bird-camera" accept="image/*" capture="environment" hidden>
        <div class="section"><div class="section-heading"><h2>用示例试一试</h2></div>
          <div class="bird-grid">${Object.entries(birds).map(([id, bird]) => `<button class="bird-sample" type="button" data-id="${id}" data-action="sample"><img src="assets/${id}.jpg" alt=""><span>${bird.name}</span></button>`).join("")}</div>
        </div>`}
      </section>
      <div class="stack">
        <section class="card"><div class="section-heading"><h2>支持的物种</h2></div>
          ${Object.entries(birds).map(([id, bird]) => `<div class="bird-entry"><img src="assets/${id}.jpg" alt="${bird.name}"><div class="bird-name"><strong>${bird.name}</strong> ${tag(bird.protection)}<p class="latin">${bird.latin}</p><p>${bird.season}</p></div></div>`).join("")}
          <div class="source-row">${external(sources.protection, "国家重点保护野生动物名录")}</div>
        </section>
        ${callout("照片将发送到鹤途后端识别。请结合鸟喙、羽色和行为核对结果。")}
      </div>
    </div>`;
  }

  function routeMeta(route) {
    return `<div class="route-meta"><span>${icon("pin")}${route.location}</span><span>${icon("clock")}${route.time}</span></div>`;
  }

  function routeProgress(state, route) {
    const done = route.stops.filter((stop) => state.visits[route.id + "/" + stop.id]).length;
    return `<div class="progress"><progress value="${done}" max="${route.stops.length}" aria-label="${route.title}完成进度"></progress><span>${done}/${route.stops.length} 站</span></div>`;
  }

  function routeCard(state, route) {
    return `<article class="card route-card"><div class="top">${iconBox(route.icon, "gold")}${tag(route.theme, "amber")}</div>
      <h2>${route.title}</h2><p>${route.subtitle}</p>
      ${routeMeta(route)}${routeProgress(state, route)}${action("查看路线", "#study/" + route.id, "outline")}
    </article>`;
  }

  function checkInForm(stop) {
    const alternative = stop.alternative;
    const material = content.studyMaterials[alternative.material];
    const photo = root.HetuPhotos?.[alternative.photo];
    return `<form id="checkin-form">
      <h3>${stop.name}</h3>
      <label class="control-label" for="checkin-mode">打卡方式</label>
      <select id="checkin-mode" name="mode" aria-describedby="checkin-help">
        <option value="field">现场观察</option>
        <option value="material">展陈资料（替代任务）</option>
      </select>
      <p id="checkin-help">点位关闭、展厅无法参观或未看到目标鸟种时，可选择替代任务。</p>
      <p id="checkin-field-task" class="checkin-task">${stop.task}</p>
      <div id="checkin-alternative" class="checkin-task" hidden>
        <h3>替代任务</h3><p>${alternative.task}</p>
        ${material ? `<p class="study-material">${material.summary}</p>${external(material.url, material.label)}` : ""}
        ${photo ? `<img class="study-photo" src="${photo.dataUri}" alt="丹顶鹤观察参考照片">${external(photo.source, "丹顶鹤照片来源与许可")}` : ""}
      </div>
      <label class="control-label" for="note" id="checkin-note-label">观察笔记（选填）</label>
      <textarea id="note" name="note" maxlength="160" placeholder="写下你的观察或答案"></textarea>
      <div class="action-row"><button class="btn outline" type="button" data-action="close-dialog">取消</button><button type="submit" class="btn">确认打卡</button></div>
    </form>`;
  }

  function visitModeLabel(visit) {
    if (visit.mode === "material") return "展陈资料";
    if (visit.mode === "field") return "现场观察";
    return "";
  }

  function visitModeTag(visit) {
    const label = visitModeLabel(visit);
    return label ? tag(label, visit.mode === "material" ? "amber" : "gray") : "";
  }

  function routeLogs(state) {
    const logs = Object.entries(state.visits).sort(([, a], [, b]) => b.time.localeCompare(a.time));
    if (!logs.length) return '<p class="empty">完成站点打卡后，观察笔记会出现在这里。</p>';
    return `<div class="log-list">${logs.map(([key, visit]) => {
      const [routeId, stopId] = key.split("/");
      const route = routes.find(({ id }) => id === routeId);
      const stop = route?.stops.find(({ id }) => id === stopId);
      if (!stop) return "";
      return `<article class="log"><h3>${stop.name}</h3><div class="visit-meta"><time>${fmtLog.format(new Date(visit.time))}</time>${visitModeTag(visit)}</div>${visit.note ? `<p>${escapeHtml(visit.note)}</p>` : ""}</article>`;
    }).join("")}</div>`;
  }

  function summaryStatus(summary) {
    if (summary.draft !== summary.saved) return "有未保存的修改";
    if (!summary.stored) return "仅保留在本次会话";
    return summary.saved ? "已保存到本机" : "小结保存在当前浏览器";
  }

  function routeSummary(route, summary) {
    return `<section class="card" id="route-summary" aria-labelledby="route-summary-title">
      <div class="section-heading"><h2 id="route-summary-title">路线小结</h2></div>
      <p class="route-question" id="route-question">${route.question}</p>
      <p class="subtle" id="summary-hint">${route.summaryHint}</p>
      <form id="summary-form" data-route="${route.id}">
        <label class="control-label" for="summary-text">我的小结</label>
        <textarea id="summary-text" name="summary" maxlength="320" required aria-describedby="route-question summary-hint">\n${escapeHtml(summary.draft)}</textarea>
        <div class="action-row"><button class="btn" type="submit">保存小结</button><span class="subtle" id="summary-status" role="status">${summaryStatus(summary)}</span></div>
      </form>
    </section>`;
  }

  function study(state, selected) {
    const route = routes.find(({ id }) => id === selected);
    if (!route) return `${pageHead("研学打卡", "为盐师研学实践设计的湿地路线，提供逐站观察任务和笔记。", "route", "gold", action("打卡记录", "#study/log", "outline", "history"))}
      <div class="route-list">${routes.map((item) => routeCard(state, item)).join("")}</div>
      <div class="section card" id="checkin-log"><div class="section-heading"><h2>打卡记录</h2>${tag("本机保存", "gray")}</div>${routeLogs(state)}</div>
      <div class="source-row">${external(sources.routes, "盐城市研学路线资料")}</div>`;
    const complete = route.stops.every((stop) => state.visits[route.id + "/" + stop.id]);
    return `${pageHead(route.title, route.subtitle, route.icon, "gold", action("返回路线库", "#study", "outline", "route"))}
      <div class="panel-grid">
        <section class="card"><div class="card-title"><div><h2>路线站点与任务</h2>${routeMeta(route)}</div></div>
          <ol class="stop-list">${route.stops.map((stop, index) => {
            const record = state.visits[route.id + "/" + stop.id];
            return `<li class="stop"><span class="order">${record ? icon("check") : index + 1}</span>
              <div><h3>${stop.name}</h3><p class="task">${stop.task}</p>
                <div class="visit-meta"><time>${record ? fmtLog.format(new Date(record.time)) : stop.duration}</time>${record ? visitModeTag(record) : ""}</div>
                ${record?.note ? `<p class="stop-note">${escapeHtml(record.note)}</p>` : ""}</div>
              ${record ? tag("已打卡") : `<button type="button" class="btn outline" data-action="check-in" data-route="${route.id}" data-id="${stop.id}">打卡</button>`}
            </li>`;
          }).join("")}</ol>
        </section>
        <div class="stack">
          <section class="card"><div class="section-heading"><h2>研学进度</h2></div>${routeProgress(state, route)}
            <div class="study-poster-action"><button class="btn" type="button" data-action="study-poster" data-route="${route.id}" ${complete ? "" : "disabled aria-describedby=\"poster-availability\""}>生成成果海报</button>
              ${complete ? "" : '<p class="subtle" id="poster-availability">完成全部站点后可生成海报。</p>'}</div>
            <div class="section">${callout("请在开放点位活动。点位关闭或没有看到目标鸟种时，可用展陈资料完成替代任务。打卡记录保存在当前浏览器。")}</div>
          </section>
          ${routeSummary(route, state.summaries[route.id])}
        </div>
      </div>`;
  }

  function alertView(state) {
    const active = core.seasonalAlerts(state.today);
    const subscription = state.subscription;
    const seasons = [...alerts].sort((a, b) => Number(active.includes(b.id)) - Number(active.includes(a.id)));
    return `${pageHead("农户提醒", "查看盐城沿海候鸟集中到访的季节参考和田间防护事项。", "bell", "clay", `<a class="btn outline" href="#alerts/inbox">${icon("bell")} 通知中心${state.inbox.length ? ` · ${state.inbox.length}` : ""}</a>`)}
    <div class="panel-grid">
      <div class="stack"><section class="card">
        <div class="card-title"><div><h2>候鸟到访日历</h2><p>依据公开观测资料整理 · 季节参考</p></div></div>
        <div class="alert-list">${seasons.map((item) => `<article class="season-card ${active.includes(item.id) ? "current-season" : ""}">
          <div class="section-heading"><h3>${item.title}</h3>${tag(active.includes(item.id) ? "当前季节" : item.badge, active.includes(item.id) ? "" : "gray")}</div>
          <small>${item.season}</small><p>${item.summary}</p>${external(sources[item.id], "查看资料")}
        </article>`).join("")}</div>
      </section><section class="card">
        <div class="section-heading"><h2>田间防护事项</h2>${iconBox("leaf")}</div>
        <ul class="advice-list">
          <li>按农时收储成熟作物，及时清理散落粮食，重点巡看田缘和沟渠。</li>
          <li>与村集体、保护地协商生态粮田的位置和管理方式，给候鸟保留低干扰的觅食空间。</li>
          <li>采用温和的防护方式，避免使用毒饵和容易缠绕鸟类的网具；遇到伤病鸟类联系当地野生动物主管部门。</li>
        </ul>
      </section></div>
      <div class="stack">
        <section class="card subscription">
          <div class="section-heading"><h2>订阅提醒</h2>${tag(subscription ? "已订阅" : "未订阅", subscription ? "" : "gray")}</div>
          <form id="subscription">
            <label class="control-label" for="area">关注区域</label>
            <select id="area" name="area">${areas.map(({ id, name }) => `<option value="${id}"${id === subscription ? " selected" : ""}>${name}</option>`).join("")}</select>
            <div class="action-row"><button class="btn" type="submit">${icon("bell")} ${subscription ? "保存订阅" : "确认订阅"}</button>
              ${subscription ? '<button type="button" class="btn outline" data-action="cancel-subscription">取消订阅</button>' : ""}</div>
          </form>
          ${callout("打开小程序时，关注区域的新季节提醒会进入通知中心。订阅保存在当前浏览器。")}
          ${subscription ? `<div class="action-row"><button type="button" class="text-button" data-action="test-alert">发送一条演示提醒</button>
            ${state.notificationAvailable ? `<button type="button" class="text-button" data-action="device-notices">${state.deviceNotices && state.notificationGranted ? "关闭系统通知" : "启用系统通知"}</button>` : ""}</div>` : ""}
        </section>
        <section class="card" id="inbox">
          <div class="section-heading"><h2>通知中心</h2>${tag(state.inbox.length + " 条", "gray")}</div>
          ${state.inbox.length ? `<div class="log-list">${state.inbox.map((item) => `<article class="log"><h3>${escapeHtml(item.title)}</h3><time>${fmtLog.format(new Date(item.time))}</time><p>${escapeHtml(item.body)}</p></article>`).join("")}</div>`
            : '<p class="empty">暂无消息。订阅后可接收季节提醒。</p>'}
        </section>
      </div>
    </div>`;
  }

  root.HetuViews = { icon, time, chartY, dateLabel, escapeHtml, external, tideContext, birdResult, checkInForm, visitModeLabel, summaryStatus, home, tides, birds: birdView, study, alerts: alertView };
})(window);
