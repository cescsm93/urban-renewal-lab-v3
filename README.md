# Urban Renewal Lab · 城市更新工作台

Urban Renewal Lab 用地图组织城市更新项目。可以选中项目查看地块属性，导入空间图层，分析周边设施与步行可达性，并把分析结果整理成报告。公开首页使用虚构项目和合成几何，可直接用来体验地图交互。

## 运行地图演示

安装 Node.js 24，在仓库根目录执行以下命令。

```sh
npm ci
npm start
```

打开 [本机地图演示](http://127.0.0.1:4173/)。该入口由 `server.cjs` 提供，可以独立于 PostGIS 运行。高德道路、步行和 POI 查询需要在服务端配置自己的 `AMAP_WEB_KEY`。在线底图和外部查询需要网络连接。

## 运行 Vue 工作台

`apps/web` 使用 Vue 3、Vite、Pinia、Element Plus 和 MapLibre GL。`apps/api` 使用 Fastify 提供登录、项目、图层、导入和报告接口。`packages/contracts` 以 Zod 定义接口数据结构。业务账号和数据存放在本机 PostgreSQL / PostGIS。

**已有本机数据库和账号时**，保留现有的 `.local-data/postgis.env` 和数据卷。执行 `npm run build:contracts`，然后分别在两个终端运行 `npm run dev:api` 和 `npm run dev:web`。打开 [本机 Vue 工作台](http://127.0.0.1:4174/)，用自己的本机账号登录。可从 [API 健康检查](http://127.0.0.1:4190/api/v1/health) 和 [功能依赖状态](http://127.0.0.1:4190/api/v1/capabilities) 分别检查服务与数据库、知识库的状态。

**首次在空环境运行时**，先启动 Docker，再在仓库根目录用 PowerShell 初始化下列组件。此流程供全新的工作副本、空数据卷和空闲的 5432 端口使用。若本机已有该项目的数据库，请使用上面的已有环境步骤。

```powershell
powershell -File .\database\setup-local.ps1
node -e "require('./lib/shared-store.cjs').openSharedStore('.local-data')"
node scripts/migrate-shared-to-pg.cjs
Get-Content -Raw .\database\005_imports.sql | docker compose -f .\database\compose.yaml exec -T db psql -v ON_ERROR_STOP=1 -U renewal_lab -d renewal_lab
```

安装脚本会生成数据库连接文件并建立空间表。第二条命令生成本机 `admin` 账号及随机密码，第三条命令创建平台表并将账号导入空库，最后一条命令建立导入记录表。登录密码保存在本机 `.local-data/shared-admin.txt`。按上面的命令启动 API 和前端，便可登录空工作台。

## 公开代码和本机资料

| 随仓库提供 | 由使用者在本机管理 |
| --- | --- |
| 前后端源码、空间分析算法、SQL 表结构、测试和合成示例 | 真实项目名录、坐标、边界、原始 GIS 文件和导入历史 |
| 项目库、政策检索、场景库和机构库的接口实现 | 原文、附件、机构与联系人资料、OCR 文本、检索索引和模型文件 |
| 数据库和服务配置的读取逻辑 | 账号口令、地图密钥、数据库内容、备份和 `.local-data/` |

体验公开演示只需仓库中的合成示例。处理真实资料时，使用本机工作台及自己的数据目录。请勿将私有文件上传至公开演示、GitHub、公开部署或问题报告。知识问答需要使用者自行配置本机索引和 Ollama。

## 开发检查

```sh
npm test
npm run build:contracts
npm run check:contracts
npm run check -w @renewal/api
npm run build:web
```

空间分析模块位于 `gis/`，使用 Python 3.12、GeoPandas、Shapely、pyproj 和 NetworkX 等库。在 Python 虚拟环境中安装依赖后运行 GIS 测试。

```sh
python -m pip install -r requirements.txt
npm run test:gis
python -m unittest discover -s tests -p test_spatial.py -v
```

`tests/*integration*` 中的集成检查会连接本机服务并写入临时记录。请在专用测试库上按测试需要准备账号、图层或知识索引。

本项目代码使用 [MIT 许可证](LICENSE)。
