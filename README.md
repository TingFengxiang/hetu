# 鹤途 · 黄海湿地

鹤途是面向盐城黄海湿地的答辩演示网页。完整运行入口由本机 Python 服务提供，页面和资源位于 `dist`。识别权重加载后可断网使用，在线潮位查询需要联网。

## 启动鹤途

在 PowerShell 中进入 `hetu` 目录。已配置本项目环境的答辩电脑运行下列命令，然后打开 [鹤途首页](http://127.0.0.1:8765/) 或 [候鸟识别](http://127.0.0.1:8765/#birds)。关闭此终端或按 Ctrl+C 可停止服务。

```powershell
.\.training\bird-env\Scripts\python.exe -m backend.serve
```

服务只监听本机回环地址。网页把照片发给本机服务，在内存中自动检测并逐只鉴定。单张图片上限 15 MiB、4000 万像素，无法确定时返回未确定。模型目录和 Python 环境位于 `.training`。双击 `dist/index.html` 可预览网页，候鸟页会提供本机服务入口。浏览器按页面来源保存打卡、订阅和消息，文件预览和本机服务各有独立记录。

## 答辩操作

1. **潮汐预警**。首次打开潮位视图，或每次切换日期、点位时，页面都会自动查询 Open-Meteo。日期覆盖取决于上游数据，查询失败或缺少完整潮位时显示“暂无潮位数据”。可通过“国家海洋信息中心 · 全球潮汐”查看港口参考资料，也可按需导入逐时潮位 JSON。填模板时，从当天 00:00 到次日 00:00 按顺序填入 25 个整点潮位，单位为米。
2. **候鸟识别**。选择照片或点击示例，结果中的编号与图中的鸟框对应。当前支持丹顶鹤、勺嘴鹬、大滨鹬，并用五类对照鸟校验相似物种。
3. **研学打卡**。选择条子泥潮间带、黄海湿地博物馆师范研学或丹顶鹤湿地生态课堂，完成站点任务并记下观察笔记。在“打卡记录”里查看进度。完成一条路线的全部站点后，可保存路线小结并下载包含任务图片的 PNG 成果海报。
4. **农户提醒**。选择关注区域并订阅，点击“发送一条演示提醒”，在通知中心查看。通过 HTTPS 或本机 HTTP 打开时，支持的浏览器可启用系统通知。打卡、订阅和消息保存在当前浏览器。

## 数据和适用范围

- 默认在线数据经 Open-Meteo 免费非商业接口读取，使用 Météo-France SMOC / Copernicus Marine 的近海网格海面高度，以全球平均海平面为基面。模型潮位用于趋势参考，现场开放时段以管理方公告为准。[Open-Meteo 海洋 API](https://open-meteo.com/en/docs/marine-weather-api) · [免费接口条款](https://open-meteo.com/en/pricing)
- 官方港口参考资料中，条子泥和巴斗参考弶港，盐城外海的东沙参考大丰港。官方平台提供港口潮高基面和时区。[国家海洋信息中心全球潮汐](https://global-tide.nmdis.org.cn/) · [国家海洋环境预报中心](https://www.nmefc.cn/)
- 在固定留出集里按每张照片检测得分最高的鸟框计分，YOLOX-M + BioCLIP 2 的目标鸟正确数由 14/53 提高至 35/53。丹顶鹤 10/12，勺嘴鹬 8/16，大滨鹬 17/25。目标鸟中 17 张未确定、1 张未检出；41 张其他鸟的主框误报由 3 张降至 0 张。查看全部鸟框时，5 张其他鸟照片有附加框报出目标鸟种，照片级标签无法判定这些附加框的真实物种。
- 在 RTX 5070 Ti Laptop 上，Chrome 从选择照片到显示结果，40 张单框照片 P95 为 48.1 毫秒，52 张多框照片 P95 为 147.5 毫秒。94 张照片的全部鸟框物种输出均与后端评测一致。测试在模型预热后运行，照片长边为 400 至 500 像素。原始记录在 `.training/bird-backend/holdout.json` 和 `browser-latency.json`。
- 农户到访提醒来自公开季节资料，不连接实时观测站。系统通知由打开网页触发，关闭网页后的自动推送需要后端服务。首页滩涂图由图像生成工具制作，作为场景示意。

## 从和风天气下载逐时潮位

已开通和风天气海洋数据服务时，可使用 Node.js 24 在本机下载港口参考潮位。每份文件请求当天和次日两个日期，生成 25 个北京时间整点的米制数据。可选日期为今日至未来 8 天，省略日期时使用当天。海洋 API 按次计费，脚本只在手动运行时发出请求。[潮汐 API](https://dev.qweather.com/docs/api/ocean/tide/) · [计费说明](https://dev.qweather.com/docs/finance/pricing/#台风和海洋)

在 PowerShell 7 中进入 `hetu` 目录并执行以下命令。演示 ZIP 解压后，在含 `index.html` 的目录执行，把脚本路径改为 `./fetch-tides.cjs`。

```powershell
$env:QWEATHER_API_HOST = Read-Host '填写控制台的专属 API Host'
$env:QWEATHER_API_KEY = Read-Host '填写 API Key' -MaskInput
node ./dist/fetch-tides.cjs tiaozini
Remove-Item Env:QWEATHER_API_KEY
```

下载巴斗或东沙时，分别将点位参数改为 `badou` 或 `dongsha`。生成的 JSON 位于当前目录，用潮汐页的“选择 JSON 文件”导入。和风天气的接口文档未注明潮高基面，导入信息会如实显示这一点。曲线的高低点从整点采样估算，精确潮时和基面请查官方平台。[和风天气站点表](https://github.com/qwd/LocationList/blob/master/POI-Tide-Station-List-latest.csv)

## 维护与打包

`backend/serve.py` 提供页面和识别接口，`backend/birds.py` 负责检测及分类，`backend/evaluate.py` 校准和评测模型。`dist/views.js` 与 `dist/app.js` 展示网页和处理交互。新电脑按下文安装 Python 依赖并下载权重后即可启动。单独复制 `dist` 仅能打开静态网页。

## 验证

`node --test tests/core.test.cjs tests/bird-detector.test.cjs tests/bird-training.test.cjs` 检查潮汐数据、提醒、打卡、裁切、分类规则与训练划分。`node tests/browser.cjs` 检查 Chrome 中桌面和手机尺寸的交互，默认启动本地静态测试服务，用固定接口响应验证界面。可用 `HETU_CHROME` 指定 Chrome 路径。

安装 Python 依赖后，可用 `python -m unittest discover -s tests` 运行后端测试。测试 `test_frozen_split_untouched` 需要本地的 `.training/samples.json` 和 `.training/test-split.json`。浏览器识鸟计时另外需要本机服务、原测试照片和留出集评测结果。

## 首次安装 GPU 识鸟环境

在 Windows PowerShell 中进入 `hetu`，准备 Python、`curl` 和可用的 NVIDIA GPU 驱动。以下命令使用支持 RTX 50 系的 CUDA 版 PyTorch。下载脚本将模型保存到 `.training/bird-backend/models/`，并校验下载文件的 SHA-256。

```powershell
python -m venv .training/bird-env
$birdPython = '.\.training\bird-env\Scripts\python.exe'
& $birdPython -m pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128
& $birdPython -m pip install open_clip_torch==3.2.0 onnxruntime-gpu==1.23.2
& $birdPython -m backend.fetch_models yolox-m bioclip-2
& $birdPython -m backend.serve
```

浏览器打开 [鹤途首页](http://127.0.0.1:8765/)。`backend/deployed-config.json` 随源码提供，包含分类头参数和拒识阈值。

## 开发评测

开发评测需要 `.training/photos`、样本清单、固定测试名单、裁图缓存及原 YOLOX-Nano ONNX。标注的框选区域存于 `.training/crops.json`，格式为以文件名为键、值为归一化的 `[左, 上, 右, 下]` 坐标。比较 BioCLIP 2.5 Huge 并复核留出集时，在同一个 PowerShell 会话运行：

```powershell
& $birdPython -m backend.fetch_models bioclip-2.5
& $birdPython -m backend.evaluate select --huge bird-backend/models/bioclip-2.5
& $birdPython -m backend.evaluate holdout
```

`selection.json` 记录训练侧选型，本机校准生成的 `.training/bird-backend/config.json` 优先于随源码提供的配置。浏览器端计时在服务运行后使用 `node tests/bird-latency.cjs`。评测集每张照片只标注一个物种，多鸟照片按检测分最高的主框计入准确率，其余框单独统计。

YOLOX 使用官方 0.1.1rc0 发布的 ONNX 权重，仓库许可 Apache-2.0。BioCLIP 2 和 2.5 Huge 的官方模型卡标注 MIT，固定版本见下载脚本。仓库附带 [YOLOX 许可](backend/YOLOX-LICENSE.txt)和 [BioCLIP 许可](backend/BIOCLIP-LICENSE.txt)。样本照片使用各自的来源许可。[YOLOX 发布页](https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0) · [BioCLIP 2](https://huggingface.co/imageomics/bioclip-2) · [BioCLIP 2.5 Huge](https://huggingface.co/imageomics/bioclip-2.5-vith14)
