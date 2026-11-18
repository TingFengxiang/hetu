"use strict";

const { writeFile } = require("node:fs/promises");
const { localDate, offsetDate, readTideData } = require("./core.js");
const { stations } = require("./content.js");

async function requestDay(host, apiKey, stationId, date, fetchDay) {
  const url = new URL("https://" + host + "/v7/ocean/tide");
  url.search = new URLSearchParams({ location: stationId, date: date.replaceAll("-", "") });
  const response = await fetchDay(url, {
    headers: { "X-QW-Api-Key": apiKey },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new Error("无法连接和风天气，请检查网络及 API Host。");
  });
  if (!response.ok) throw new Error("和风天气请求失败（HTTP " + response.status + "）。");
  const raw = await response.json();
  if (raw?.code !== "200" || !Array.isArray(raw.tideHourly)) {
    throw new Error("和风天气未返回逐小时潮位，请检查接口权限及所选日期。");
  }
  return raw.tideHourly;
}

function readHourlyLevels(records, date, count) {
  const levels = new Map();
  for (const { fxTime, height } of records.filter(Boolean)) {
    if (typeof fxTime !== "string" || !fxTime.startsWith(date + "T")) continue;
    levels.set(fxTime, !levels.has(fxTime) && typeof height === "string" && /^-?\d+(?:\.\d+)?$/.test(height)
      ? Number(height) : NaN);
  }
  return Array.from({ length: count }, (_, hour) =>
    levels.get(date + "T" + String(hour).padStart(2, "0") + ":00+08:00"));
}

async function downloadTide(station, date, host, apiKey, fetchDay = fetch, today = localDate()) {
  const reference = stations.find(({ id }) => id === station)?.reference;
  if (!reference) throw new Error("请选择 tiaozini、badou 或 dongsha。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > offsetDate(today, 8)
      || localDate(new Date(date + "T12:00:00+08:00")) !== date) {
    throw new Error("请输入今天至未来 8 天内的北京时间日期（YYYY-MM-DD）。");
  }
  if (!/^(?:[a-z0-9-]+\.)+qweatherapi\.com$/i.test(host) || !apiKey) {
    throw new Error("请设置 QWEATHER_API_HOST 和 QWEATHER_API_KEY 环境变量。");
  }

  const nextDate = offsetDate(date, 1);
  const hours = await requestDay(host, apiKey, reference.qweatherId, date, fetchDay);
  const nextDay = await requestDay(host, apiKey, reference.qweatherId, nextDate, fetchDay);
  const data = readTideData({
    station, date,
    source: "和风天气 · " + reference.name + "站（" + reference.qweatherId + "）港口参考预报",
    datum: "接口文档未注明潮高基面",
    levels: [...readHourlyLevels(hours, date, 24), ...readHourlyLevels(nextDay, nextDate, 1)],
  });
  if (!data) throw new Error("缺少完整的北京时间逐小时潮位，未生成文件。");
  return data;
}

async function main() {
  const [station, date = localDate()] = process.argv.slice(2);
  if (!station) throw new Error("用法：node fetch-tides.cjs <tiaozini|badou|dongsha> [YYYY-MM-DD]");
  const data = await downloadTide(station, date, process.env.QWEATHER_API_HOST, process.env.QWEATHER_API_KEY);
  const filename = station + "-" + date + ".json";
  await writeFile(filename, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  console.log("已生成 " + filename + "，请在鹤途潮汐页选择此 JSON 文件。");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.code === "EEXIST" ? "同名潮位文件已存在，请先改名或移走。" : error.message);
    process.exitCode = 1;
  });
}

module.exports = { downloadTide };
