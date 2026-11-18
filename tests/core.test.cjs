const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../dist/core.js");

test("an ongoing seasonal notice spans New Year and shuts off after March", () => {
  assert.deepEqual(core.seasonalAlerts("2027-01-18"), ["winter"]);
  assert.deepEqual(core.seasonalAlerts("2027-07-05"), []);
});

test("repeated check-in preserves the original note and timestamp", () => {
  const original = core.recordVisit({}, "museum", "lobby", "海岸剖面", "2026-11-16T04:00:00.000Z");
  assert.deepEqual(
    core.recordVisit(original, "museum", "lobby", "替换", "2026-11-17T04:00:00.000Z"),
    original,
  );
  assert.equal(original["museum/lobby"].note, "海岸剖面");
});

test("check-ins preserve the evidence mode alongside the observation", () => {
  const time = "2026-11-18T04:00:00.000Z";
  const visits = core.recordVisit({}, "cranes", "lookout", " 白羽和黑颈 ", time, "material");
  assert.deepEqual(visits["cranes/lookout"], { note: "白羽和黑颈", time, mode: "material" });
  assert.equal(core.recordVisit(visits, "cranes", "lookout", "新记录", time, "field"), visits);
  assert.equal(core.recordVisit({}, "cranes", "entrance", "", time)["cranes/entrance"].mode, "field");
});

test("bird classification rejects distant or ambiguous feature vectors", () => {
  const head = [
    { id: "crane", values: [5, 0, 0] }, { id: "knot", values: [0, 5, 0] },
    { id: "other-egret", values: [0, 0, 5] },
  ];
  assert.equal(core.classifyBird([0.98, 0.02, 0], head, 0.34, 0.08).match, "crane");
  assert.equal(core.classifyBird([0.5, 0.5, 0], head, 0.34, 0.08).match, null);
  assert.equal(core.classifyBird([0, 0, 1], head, 0.34, 0.08).match, null);
});

test("imported tide measurements require a point, datum and all hourly values", () => {
  const input = { station: "badou", date: "2026-11-16", source: "演示样例", datum: "示例基面",
    levels: Array.from({ length: 25 }, (_, hour) => hour / 10 - 1) };
  assert.equal(core.readTideData(input).levels[24], 1.4);
  assert.equal(core.readTideData({ ...input, date: "2026-02-31" }), null);
  assert.equal(core.readTideData({ ...input, datum: "" }), null);
  assert.equal(core.readTideData({ ...input, levels: input.levels.slice(1) }), null);
});

test("Open-Meteo forecasts include all 25 Beijing-time samples and preserve the model datum", () => {
  const date = "2026-11-18";
  const time = Array.from({ length: 24 }, (_, hour) => date + "T" + String(hour).padStart(2, "0") + ":00");
  time.push("2026-11-19T00:00");
  const levels = time.map((_, hour) => hour / 10 - 1);
  const raw = {
    latitude: 32.8, longitude: 121.1, utc_offset_seconds: 28800,
    hourly_units: { sea_level_height_msl: "m" },
    hourly: { time, sea_level_height_msl: levels },
  };
  const result = core.readMarineForecast(raw, "tiaozini", date);
  assert.equal(result.source, "Open-Meteo · Météo-France SMOC / Copernicus Marine");
  assert.match(result.datum, /全球平均海平面/);
  assert.deepEqual(result.grid, [32.8, 121.1]);
  assert.deepEqual(result.levels, levels);
  assert.equal(core.readMarineForecast({ ...raw, utc_offset_seconds: 0 }, "tiaozini", date), null);
  assert.equal(core.readMarineForecast({ ...raw, hourly_units: { sea_level_height_msl: "ft" } }, "tiaozini", date), null);
  assert.equal(core.readMarineForecast({ ...raw, hourly: { time: time.slice(0, 24), sea_level_height_msl: levels } }, "tiaozini", date), null);
  assert.equal(core.readMarineForecast({ ...raw, hourly: { time, sea_level_height_msl: [null, ...levels.slice(1)] } }, "tiaozini", date), null);
});

test("QWeather downloads use the selected reference station and the next Beijing midnight", async () => {
  const date = "2026-11-16";
  const tideHourly = Array.from({ length: 24 }, (_, hour) => ({
    fxTime: date + "T" + String(hour).padStart(2, "0") + ":00+08:00", height: String(hour / 10 - 0.9),
  }));
  const midnight = { fxTime: "2026-11-17T00:00+08:00", height: "1.42" };
  const { downloadTide } = require("../dist/fetch-tides.cjs");
  for (const [station, reference, id] of [["tiaozini", "弶港", "P2126"], ["badou", "弶港", "P2126"], ["dongsha", "大丰港", "P2372"]]) {
    const calls = [];
    const forecast = await downloadTide(station, date, "test.qweatherapi.com", "test-key", async (url, options) => {
      assert.equal(url.pathname, "/v7/ocean/tide");
      assert.equal(url.searchParams.get("location"), id);
      assert.equal(options.headers["X-QW-Api-Key"], "test-key");
      const day = url.searchParams.get("date");
      calls.push(day);
      return Response.json({ code: "200", tideHourly: day === "20261116" ? tideHourly : [midnight] });
    }, date);
    assert.deepEqual(calls, ["20261116", "20261117"]);
    assert.equal(forecast.station, station);
    assert.match(forecast.source, new RegExp(reference));
    assert.equal(forecast.levels[0], -0.9);
    assert.equal(forecast.levels[24], 1.42);
  }
  for (const badHour of [null, { ...tideHourly[0], height: "" }, { ...tideHourly[0], fxTime: date + "T00:00+00:00" }]) {
    const badDay = [badHour, ...tideHourly.slice(1)].filter(Boolean);
    await assert.rejects(downloadTide("badou", date, "test.qweatherapi.com", "test-key", async (url) =>
      Response.json({ code: "200", tideHourly: url.searchParams.get("date") === "20261116" ? badDay : [midnight] }),
    date), /完整/);
  }
});
