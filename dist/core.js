(function (root) {
  "use strict";

  const tideStations = new Set(["tiaozini", "badou", "dongsha"]);

  function localDate(date = new Date()) {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date);
  }

  function offsetDate(date, offset) {
    const moment = new Date(date + "T12:00:00+08:00");
    moment.setUTCDate(moment.getUTCDate() + offset);
    return localDate(moment);
  }

  function readTideData(input) {
    if (!input || !tideStations.has(input.station) || typeof input.date !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < "2020-01-01" || input.date > "2099-12-31") return null;
    const date = new Date(input.date + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date) return null;
    if (typeof input.source !== "string" || typeof input.datum !== "string" || !input.source.trim() || !input.datum.trim()) return null;
    if (!Array.isArray(input.levels) || input.levels.length !== 25
        || !input.levels.every((height) => Number.isFinite(height) && Math.abs(height) <= 20)) return null;
    return { station: input.station, date: input.date, source: input.source.trim().slice(0, 100),
      datum: input.datum.trim().slice(0, 60), levels: input.levels };
  }

  function readMarineForecast(raw, station, date) {
    const times = raw?.hourly?.time;
    const heights = raw?.hourly?.sea_level_height_msl;
    if (raw?.utc_offset_seconds !== 28800 || raw.hourly_units?.sea_level_height_msl !== "m"
        || !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)
        || !Array.isArray(times) || !Array.isArray(heights) || times.length !== heights.length) return null;
    const start = times.indexOf(date + "T00:00");
    if (start < 0 || times[start + 24] !== offsetDate(date, 1) + "T00:00") return null;
    for (let hour = 1; hour < 24; hour++) {
      if (times[start + hour] !== date + "T" + String(hour).padStart(2, "0") + ":00") return null;
    }
    const data = readTideData({
      station, date, levels: heights.slice(start, start + 25),
      source: "Open-Meteo · Météo-France SMOC / Copernicus Marine",
      datum: "全球平均海平面（MSL）",
    });
    return data && { ...data, grid: [raw.latitude, raw.longitude] };
  }

  function tideExtremes(series) {
    return series.slice(1, -1).flatMap((item, index) => {
      const left = series[index].height;
      const right = series[index + 2].height;
      if (item.height > left && item.height >= right) return [{ ...item, kind: "high" }];
      if (item.height < left && item.height <= right) return [{ ...item, kind: "low" }];
      return [];
    });
  }

  function seasonalAlerts(date) {
    const monthDay = date.slice(5);
    const alerts = [];
    if (monthDay >= "11-01" || monthDay <= "03-19") alerts.push("winter");
    if (monthDay >= "03-20" && monthDay <= "05-20") alerts.push("spring");
    if (monthDay >= "07-15" && monthDay <= "10-31") alerts.push("autumn");
    return alerts;
  }

  function recordVisit(visits, route, stop, note, time = new Date().toISOString(), mode = "field") {
    const key = route + "/" + stop;
    if (visits[key]) return visits;
    return { ...visits, [key]: { note: note.trim().slice(0, 160), time, mode } };
  }

  function unitVector(vector) {
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }

  function birdScores(unit, head) {
    const logits = head.map(({ id, values }) => ({
      id, score: values.reduce((sum, value, index) => sum + value * unit[index], 0),
    }));
    const top = Math.max(...logits.map((row) => row.score));
    const sum = logits.reduce((total, row) => total + Math.exp(row.score - top), 0);
    return logits.map(({ id, score }) => ({ id, score: Math.exp(score - top) / sum }));
  }

  function classifyBird(vector, head, minimum, margin, limits) {
    const ranking = birdScores(unitVector(vector), head).sort((a, b) => b.score - a.score);
    const [first, second] = ranking;
    const limit = first && limits?.[first.id];
    const match = first && !first.id.startsWith("other-") && first.score >= (limit?.minimum ?? minimum)
      && first.score - (second?.score ?? 0) >= (limit?.margin ?? margin) ? first.id : null;
    return { ranking, match };
  }

  const api = { localDate, offsetDate, readTideData, readMarineForecast, tideExtremes, seasonalAlerts,
    recordVisit, unitVector, birdScores, classifyBird };
  if (typeof module === "object") module.exports = api;
  else root.HetuCore = api;
})(globalThis);
