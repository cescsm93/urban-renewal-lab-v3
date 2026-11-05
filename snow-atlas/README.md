# SNOW ATLAS 全球滑雪场图鉴

**[在线浏览 → https://urban-renewal-lab-1.vercel.app/snow-atlas/](https://urban-renewal-lab-1.vercel.app/snow-atlas/)**

85座雪场，包括20座中国雪场。全球地图、真实DEM模型、有依据的社区线路、收藏、我去过（金色高亮）、两场对比和DeepSeek Copilot。

新增条目的运营网站来自OpenSkiData社区记录，HTTP访问不等于身份核实；未确认链接/照片/票价明确标注。没有编造线路，模型不代表完整官方雪道或实时雪况。
来源及原始快照见 data/，逐场模型范围与线路数见 models/index.json。原始数据使用OpenStreetMap/ODbL及OpenSkiData，DEM归属见模型sources。

本地源码：本目录。测试：node --test tests/*.test.mjs。主站后端配置沿用现有Vercel环境；密钥不进入浏览器。
