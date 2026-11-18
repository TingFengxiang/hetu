const HetuContent = {
  sources: {
    heritage: "https://whc.unesco.org/en/list/1606/",
    wetland: "https://www.mee.gov.cn/home/ztbd/2021/mlhwyxalzjhd/algs/jss/202109/t20210906_900030.shtml",
    coast: "https://m.nmc.cn/publish/marine/seaarea.html",
    tidePlatform: "https://global-tide.nmdis.org.cn/",
    marine: "https://open-meteo.com/en/docs/marine-weather-api",
    marineModel: "https://doi.org/10.48670/moi-00017",
    qweather: "https://www.qweather.com",
    oceanWarnings: "https://www.nmefc.cn/",
    tide: "https://www.js.msa.gov.cn/module/download/downfile.jsp?classid=0&filename=20e11b04b1bc4920af362e587da13c24.pdf",
    protection: "https://www.forestry.gov.cn/html/main/main_5461/20210205122239482485322/file/20210205122347636743107.pdf",
    routes: "https://www.yancheng.gov.cn/art/2026/3/18/art_34154_4410764.html",
    winter: "https://www.yancheng.gov.cn/art/2026/11/15/art_45136_4468049.html",
    spring: "https://jsychb.yancheng.gov.cn/module/download/downfile.jsp?classid=0&filename=0c5527a031c64d6ab502a7211c83e537.pdf",
    autumn: "https://www.yancheng.gov.cn/art/2025/7/30/art_34154_4342995.html",
  },

  stations: [
    { id: "tiaozini", name: "条子泥", area: "东台沿海 · 景区观鸟点", marine: [32.76, 121.11], reference: { name: "弶港", qweatherId: "P2126" }, advice: "在开放观鸟平台或栈道观察，留意景区广播，禁止自行下滩。" },
    { id: "badou", name: "巴斗", area: "东台沿海 · 渔村岸段", marine: [32.98, 121.02], reference: { name: "弶港", qweatherId: "P2126" }, advice: "在公开道路或岸上指定区域观察，远离港汊、潮沟及作业水域。" },
    { id: "dongsha", name: "东沙", area: "盐城外海 · 辐射沙洲", marine: [33.11, 121.30], reference: { name: "大丰港", qweatherId: "P2372" }, advice: "仅作潮汐科普展示。请勿自行登滩或穿越潮沟。" },
  ],

  birds: {
    crane: {
      name: "丹顶鹤", latin: "Grus japonensis", protection: "国家一级",
      season: "深秋抵达盐城越冬，次年春季北返",
      features: "成鸟头顶有红色裸皮，身体以白色为主，颈部和部分飞羽为黑色。",
      habitat: "常在浅水湿地、盐沼等处觅食。观察时应保持距离，避免惊飞。",
    },
    spoon: {
      name: "勺嘴鹬", latin: "Calidris pygmaea", protection: "国家一级",
      season: "春秋迁飞期间在黄海沿岸停歇补给",
      features: "嘴端向两侧展开，呈小勺状。非繁殖羽背部偏灰，腹部浅色。",
      habitat: "常在开阔泥滩觅食。可用望远镜辨认嘴形，勿靠近鸟群。",
    },
    knot: {
      name: "大滨鹬", latin: "Calidris tenuirostris", protection: "国家二级",
      season: "春秋迁徙均可经过盐城滨海湿地",
      features: "体形较敦实，直嘴偏长。繁殖羽胸侧和腹侧常有深色斑纹。",
      habitat: "常成群在潮间带寻找底栖动物，高潮时转移到可栖息的高处。",
    },
  },

  studyMaterials: {
    tidal: {
      label: "生态环境部 · 条子泥岸段图文",
      url: "https://www.mee.gov.cn/home/ztbd/2021/mlhwyxalzjhd/algs/jss/202109/t20210906_900030.shtml",
      summary: "潮沟像树枝一样分布在滩涂上。潮水退去时，水鸟可在露出的泥滩觅食。涨潮淹没泥滩后，条子泥的 720 亩高潮位栖息地可为水鸟提供休息空间。",
    },
    flyway: {
      label: "候鸟迁飞通道保护修复中国行动计划 · 图 3",
      url: "https://www.ndrc.gov.cn/xwdt/tzgg/202406/P020240624571885456082.pdf#page=22",
      summary: "东亚—澳大利西亚迁飞通道经过黄海沿岸。盐城黄海湿地的滩涂为迁徙水鸟提供停歇和觅食补给的场所。",
    },
    museum: {
      label: "盐城市人民政府 · 黄海湿地博物馆展陈介绍",
      url: "https://www.yancheng.gov.cn/art/2026/8/31/art_45136_4450297.html",
      summary: "博物馆的湿地展陈有鸟类标本、湿地场景复原和多媒体互动。候鸟迁徙与淤泥质海岸是其中的两个主题。",
    },
    crane: {
      label: "盐城市情网 · 盐城年鉴《风物揽胜》",
      url: "https://szw.yancheng.gov.cn/jblm/jjbz/ycnj/2015/html/Noname007.html",
      summary: "丹顶鹤在盐城沿海湿地越冬，常见于开阔的芦苇荡和草沼，可取食鱼、虾、贝类和植物根茎。",
    },
    birdwatching: {
      label: "盐城市文广旅局 · 观鸟指南",
      url: "https://whgdj.yancheng.gov.cn/art/2024/11/27/art_2241_4259450.html",
      summary: "观鸟时应跟鸟群保持距离，尽量减少惊扰，也不要随意投喂。可以用望远镜从允许停留的位置观察。",
    },
  },

  routes: [
    {
      id: "tidal", title: "条子泥潮间带观察", subtitle: "从潮沟到“720高地”，理解水鸟为何追着潮水移动。",
      time: "约 2 小时", location: "东台 · 条子泥", theme: "野外观察", icon: "waves",
      question: "潮水涨落怎样改变水鸟觅食和休息的位置？",
      summaryHint: "选一条站点记录作为依据，说说涨潮和退潮时水鸟可能在哪里活动。",
      stops: [
        { id: "visitor", name: "条子泥游客中心", duration: "20 分钟", task: "核对当日开放公告，在图上找出游客路线与潮沟的位置。",
          alternative: { material: "tidal", task: "从展陈图或资料中的「潮汐森林」航拍图找出潮沟，说明它和岸上游客步道有什么不同。手边有游客导览图时，可以把两者标在图上。" } },
        { id: "platform", name: "景区开放观鸟平台", duration: "45 分钟", task: "用望远镜记录三类取食行为，并观察水边界移动的方向。",
          alternative: { material: "tidal", task: "用展陈或图文资料比较涨潮和退潮时露出的泥滩范围，推测水鸟会到哪里觅食。资料里有水鸟照片或视频时，再记下一项看得清的行为。" } },
        { id: "roost", name: "720 高地外围公开观察点", duration: "30 分钟", task: "比较滩涂与高潮位栖息地的作用。",
          alternative: { material: "tidal", task: "根据游客中心展陈或条子泥图文资料，比较退潮后露出的滩涂和 720 高地：水鸟分别能在那里做什么？" } },
      ],
    },
    {
      id: "museum", title: "湿地博物馆师范研学", subtitle: "沿展陈认识湿地生态，设计一节面向中学生的观鸟课。",
      time: "约 1.5 小时", location: "盐城 · 黄海湿地博物馆", theme: "师范实践", icon: "book",
      question: "怎样用一件展品向中学生解释候鸟为什么会在盐城停歇？",
      summaryHint: "选一件展品或一幅图，写下学生要观察的线索，再设计一道讨论题。",
      stops: [
        { id: "lobby", name: "黄海湿地博物馆 · 序厅", duration: "15 分钟", task: "挑一幅湿地图，标出它能帮助学生理解的两个现象。",
          alternative: { material: "tidal", task: "选用展陈图或条子泥岸段公开图文。挑出两个想请学生留意的湿地现象，并各写一句怎么从图文中找到线索。" } },
        { id: "flyway", name: "候鸟迁徙相关展陈", duration: "30 分钟", task: "画出东亚—澳大利西亚迁飞路线的一段，说明盐城作为停歇地的作用。",
          alternative: { material: "flyway", task: "用展陈图或公开迁飞通道示意图找出黄海沿岸的一段，说明盐城湿地能为经过的候鸟提供什么。" } },
        { id: "lesson", name: "参观总结与课程设计", duration: "25 分钟", task: "写下一道中学课堂探究题，设计观察、记录和交流三个步骤。",
          alternative: { material: "museum", task: "从展陈介绍中选一类教学材料，提出一道中学生能探究的问题，再给学生各写一句观察、记录和交流的指令。" } },
      ],
    },
    {
      id: "cranes", title: "丹顶鹤湿地生态课堂", subtitle: "在开放区域观察丹顶鹤形态和活动环境，练习低干扰记录。",
      time: "约 2 小时", location: "盐城 · 丹顶鹤湿地生态旅游区", theme: "物种科普", icon: "feather",
      question: "保持距离时，你能用哪些特征描述看到的丹顶鹤？",
      summaryHint: "写下一项看清的特征和一项还不确定的细节，注明依据来自现场还是资料。",
      stops: [
        { id: "entrance", name: "旅游区入口与科普区", duration: "25 分钟", task: "查找丹顶鹤食物、越冬和栖息地的资料，列出三条观察问题。",
          alternative: { material: "crane", task: "阅读展陈或盐城年鉴资料，分别围绕丹顶鹤吃什么、在哪里越冬、喜欢怎样的栖息地，各写一条观察问题。" } },
        { id: "lookout", name: "开放观鹤区域", duration: "45 分钟", task: "保持距离，记录鸟喙、足、羽色三个特征及观察时段。",
          alternative: { photo: "crane", task: "观察展陈或下方丹顶鹤照片，描述鸟喙、足和羽色。照片中看不清的部位可记为「不可辨」。" } },
        { id: "review", name: "返程集合点", duration: "20 分钟", task: "分享一项观察结果和一条低干扰观鸟规范。",
          alternative: { material: "birdwatching", task: "用自己的前站记录、展陈或照片举出一项观察结果，再结合观鸟指南写下一条低干扰做法。" } },
      ],
    },
  ],

  areas: [
    { id: "tiaozini", name: "条子泥周边" },
    { id: "badou", name: "巴斗周边" },
    { id: "coast", name: "盐城沿海" },
  ],

  alerts: [
    {
      id: "winter", title: "丹顶鹤越冬季", season: "11 月至次年 3 月中旬", badge: "越冬季",
      summary: "丹顶鹤秋末陆续抵达盐城沿海越冬，沿海湿地及周边农田应加强低干扰巡查。",
    },
    {
      id: "spring", title: "春季北迁过境", season: "3 月下旬至 5 月中旬", badge: "春迁季",
      summary: "鸻鹬等迁徙水鸟陆续经过盐城沿海。留意农田边缘、沟渠附近的群集活动。",
    },
    {
      id: "autumn", title: "鸻鹬类秋迁停歇", season: "7 月中旬至 10 月末", badge: "秋迁季",
      summary: "鸻鹬类陆续在条子泥等湿地停歇和换羽。可提前安排田间巡查和成熟作物收储。",
    },
  ],
};

if (typeof module === "object" && module.exports) module.exports = HetuContent;
else window.HetuContent = HetuContent;
