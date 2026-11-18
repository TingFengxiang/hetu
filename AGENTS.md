# 鹤途维护说明

本文件适用于 `hetu/`。鹤途是面向盐城黄海湿地的本地网页，包含潮汐预警、候鸟识别、研学打卡和农户提醒。

## 工作范围

- Git 由用户通过其他工具管理。按当前请求修改工作区文件，保留已有改动。暂存、提交、分支操作、推送和发布以用户当次明确授权为准。
- 以当前源码和 [README](README.md) 为运行依据。上一级的旧网页运行版、答辩 ZIP 和交接报告是历史资料。用户指定处理这些材料时，再按对应请求操作。
- `.training/` 保存本机 Python 环境、权重、训练照片和评测记录。`.preview/` 保存验证产物。改动功能时保留这些资料以及浏览器里的打卡、导入和订阅记录。

## 运行入口与代码位置

- `dist/index.html` 加载同目录下的原生 HTML、CSS 和 JavaScript，可双击预览，无需构建。完整体验从 `hetu/` 运行 `./.training/bird-env/Scripts/python.exe -m backend.serve`，再访问 `http://127.0.0.1:8765/`。
- `dist/app.js` 处理路由、请求和本地状态，`dist/views.js` 渲染页面，`dist/content.js` 定义点位、物种和路线，`dist/core.js` 提供数据校验和业务逻辑，`dist/poster.js` 生成 PNG。
- `backend/serve.py` 提供页面与 `POST /api/birds/recognize`。`backend/birds.py` 通过 YOLOX-M 检测鸟框，用 BioCLIP 2 逐只分类。文件预览的候鸟页提供本机服务入口。样例和上传照片走同一个推理接口。
- 模型通过 `backend/fetch_models.py` 下载至 `.training/bird-backend/models/`。本机校准配置优先，随项目的 `backend/deployed-config.json` 提供默认配置。安装依赖及下载命令见 README。

## 维护时保留的行为

- 条子泥、巴斗和东沙使用 Open-Meteo Marine API。进入潮位视图或切换日期、点位时重新查询。没有有效响应时显示暂无数据，禁止用模拟曲线补位。保留和风天气逐小时 JSON 的手动下载和导入，密钥由环境变量 `QWEATHER_API_KEY` 读取。首页模型潮位卡片只显示 Open-Meteo 的来源链接。
- 一条研学路线的全部站点完成后可导出 PNG 成果海报。海报以路线名为标题，避免出现“研学海报”字样。任务有图片时，将图片及适用的来源署名放入海报。
- 打卡、潮位导入、订阅和消息保存在浏览器的 `localStorage`。文件预览和本机 HTTP 页面分别保存数据。清理缓存时避免清除用户记录。

## 验证

在 `hetu/` 运行与改动相关的检查。

```powershell
node --test tests/core.test.cjs tests/bird-detector.test.cjs tests/bird-training.test.cjs
node tests/browser.cjs
./.training/bird-env/Scripts/python.exe -m unittest discover -s tests
```

浏览器测试需要本机 Chrome，路径可用 `HETU_CHROME` 指定。该测试使用固定响应验证潮位和识鸟界面。真实识鸟用本机服务提交实图验证。Python 的固定留出集测试需要 `.training/samples.json` 和 `.training/test-split.json`。
