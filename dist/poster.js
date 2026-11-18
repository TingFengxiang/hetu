(function (root) {
  "use strict";

  const width = 1080;
  const margin = 64;
  const bodyWidth = width - 2 * margin;
  const padding = 32;
  const innerWidth = bodyWidth - 2 * padding;
  const fonts = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
  const ink = "#18352a";
  const muted = "#52665b";

  function useFont(context, size, weight) {
    context.font = `${weight} ${size}px ${fonts}`;
  }

  function wrap(context, text, size, weight, maxWidth = innerWidth) {
    useFont(context, size, weight);
    const lines = [];
    let line = "";
    for (const { segment } of segmenter.segment(text.trim().replace(/\s+/g, " "))) {
      if (line && context.measureText(line + segment).width > maxWidth) {
        if (/^[，。！？；：、）》】”’％,.!?;:%)]$/u.test(segment)) {
          const last = segmenter.segment(line).containing(line.length - 1);
          if (last.index > 0) {
            lines.push(line.slice(0, last.index).trimEnd());
            line = last.segment + segment;
            continue;
          }
        }
        lines.push(line.trimEnd());
        line = segment.trimStart();
      } else {
        line += segment;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function text(context, value, x, y, size, color, weight = 400) {
    useFont(context, size, weight);
    context.fillStyle = color;
    context.fillText(value, x, y);
  }

  function lines(context, values, x, y, size, lineHeight, color, weight = 400) {
    values.forEach((value, index) => text(context, value, x, y + index * lineHeight, size, color, weight));
  }

  function panel(context, x, y, w, h, color, radius = 22) {
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
    context.fillStyle = color;
    context.fill();
  }

  function header(context, route, date) {
    const gradient = context.createLinearGradient(0, 0, width, 304);
    gradient.addColorStop(0, "#102e28");
    gradient.addColorStop(1, "#285747");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, 304);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, 304);
    context.clip();
    context.strokeStyle = "#d9be8b36";
    context.lineWidth = 2;
    for (let index = 0; index < 7; index++) {
      context.beginPath();
      context.ellipse(1015, 92, 140 + index * 25, 43 + index * 17, -0.28, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    text(context, "鹤途 · 黄海湿地", margin, 46, 29, "#f4d5a4", 700);
    text(context, route.title, margin, 115, 68, "#fffaf0", 700);
    text(context, route.location + "  ·  " + date + " 完成", margin, 228, 30, "#dceae0");
  }

  async function loadPhoto(photo) {
    const image = new Image();
    image.src = photo.dataUri;
    await image.decode();
    return image;
  }

  function drawPhoto(context, photo, x, y, column) {
    const { image, caption } = photo;
    const scale = Math.min(column / image.naturalWidth, 340 / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    const imageX = x + (column - imageWidth) / 2;
    context.save();
    context.beginPath();
    context.roundRect(imageX, y, imageWidth, imageHeight, 14);
    context.clip();
    context.drawImage(image, imageX, y, imageWidth, imageHeight);
    context.restore();
    lines(context, caption, x, y + imageHeight + 10, 19, 27, muted);
  }

  async function create(route, records, summary, date) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    const context = canvas.getContext("2d");
    const question = wrap(context, route.question, 38, 700);
    const conclusion = wrap(context, summary, 32, 400);
    const photoWidth = 350;
    const columnGap = 28;
    const stops = await Promise.all(records.map(async ({ name, mode, note, photo }, index) => {
      const image = photo ? await loadPhoto(photo) : null;
      const inset = image ? 0 : index % 2 === 0 ? 0 : 52;
      const textWidth = innerWidth - inset - (image ? photoWidth + columnGap : 0);
      const noteLines = wrap(context, note, 30, 400, textWidth);
      const caption = image ? wrap(context, photo.caption, 19, 400, photoWidth) : [];
      const photoHeight = image ? Math.min(340, photoWidth * image.naturalHeight / image.naturalWidth) + 10 + caption.length * 27 : 0;
      return { name, mode, noteLines, inset, photo: image && { image, caption }, height: 100 + Math.max(noteLines.length * 43, photoHeight) };
    }));
    const questionHeight = 94 + question.length * 51;
    const sectionHeight = stops.reduce((total, stop) => total + stop.height + 16, 0);
    const summaryHeight = conclusion.length ? 90 + conclusion.length * 46 : 0;
    const questionTop = 344;
    const stationTitleTop = questionTop + questionHeight + 39;
    const stationsTop = stationTitleTop + 60;
    const summaryTop = stationsTop + sectionHeight + 12;
    canvas.height = summaryTop + summaryHeight + 42;
    context.textBaseline = "top";
    context.fillStyle = "#f4f3e9";
    context.fillRect(0, 0, width, canvas.height);
    header(context, route, date);

    const x = margin + padding;
    panel(context, margin, questionTop, bodyWidth, questionHeight, "#e1ece0");
    text(context, "探究问题", x, questionTop + 24, 27, "#315b48", 700);
    lines(context, question, x, questionTop + 66, 38, 51, ink, 700);
    text(context, "站点记录", margin, stationTitleTop, 34, ink, 700);

    let top = stationsTop;
    for (const [index, stop] of stops.entries()) {
      const left = x + stop.inset;
      panel(context, margin + stop.inset, top, bodyWidth - stop.inset, stop.height, stop.photo ? "#f9ecd7" : "#fffefa");
      text(context, stop.name, left, top + 22, 32, ink, 700);
      const chip = stop.mode === "展陈资料" ? "#ead7b7" : "#e5efe5";
      panel(context, width - margin - padding - 126, top + 20, 126, 38, chip, 12);
      context.textAlign = "center";
      text(context, stop.mode, width - margin - padding - 63, top + 24, 22, ink, 700);
      context.textAlign = "left";
      const photoOnLeft = stop.photo && index % 2 === 1;
      const noteX = photoOnLeft ? left + photoWidth + columnGap : left;
      if (stop.photo) drawPhoto(context, stop.photo, photoOnLeft ? left : left + innerWidth - photoWidth, top + 74, photoWidth);
      lines(context, stop.noteLines, noteX, top + 74, 30, 43, muted);
      top += stop.height + 16;
    }

    if (conclusion.length) {
      panel(context, margin, summaryTop, bodyWidth, summaryHeight, "#f3e7cf");
      text(context, "路线小结", x, summaryTop + 24, 32, ink, 700);
      lines(context, conclusion, x, summaryTop + 70, 32, 46, ink);
    }

    return canvas.toDataURL("image/png");
  }

  root.HetuPoster = { create };
})(window);
