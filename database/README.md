# 本机 PostgreSQL + PostGIS 试验库

1. 打开 Docker Desktop，等状态显示运行中。
2. 在此目录运行 `powershell -ExecutionPolicy Bypass -File .\setup-local.ps1`。
3. 数据库只监听 `127.0.0.1:5432`。数据库名和用户名都是 `renewal_lab`；密码由脚本随机生成，存在仓库忽略的 `../.local-data/postgis.env`。
4. 用 `docker compose -f .\compose.yaml ps` 看状态；用 `docker compose -f .\compose.yaml stop` 暂停；用 `docker compose -f .\compose.yaml start` 恢复。请保留 Docker 数据卷。
5. 运行 `powershell -ExecutionPolicy Bypass -File .\backup-local.ps1`，把数据库备份到本机 `../.local-data/postgis-backups/`；备份还应另存到受控位置。

以后迁移到获准使用的服务器时，在目标机安装兼容版本的 PostgreSQL + PostGIS，先备份本机数据库，再用 `pg_restore` 导入 `.dump`。不要直接复制正在运行的数据卷，也不要把本机密码文件一并上传。政策 PDF、Obsidian 笔记、向量索引和其他四库原始文件不在这个数据库备份里，是否迁移须另行决定。

数据库包含 `workspaces`、`layers`、`features`、`feature_links`、`analysis_runs`：分别对应研究项目、保留原名的图层、包含原字段和几何的要素、项目与宗地建筑之间的关联、分析结果。几何统一存储为 EPSG:4326，并建立 GiST 空间索引；导入时必须核实原始坐标系和配准依据，不能只改坐标系标签。

现有 Renewal Lab 的主要数据仍按原方式使用浏览器存储和 SQLite 共享项目；仅“项目层”有以下 PostGIS 试点接口。其他图层和四库没有迁移，也没有把数据库接到 Vercel。下一步是逐层迁移、核对，再让编辑直接保存到 PostGIS。数据库口令和数据卷不要提交 GitHub。

## 项目层试点（本机和局域网）

目前已实现一层的复制与读回。打开“导入数据”，可把当前“项目层”复制到 PostGIS，再点“从 PostGIS 读回项目层”在地图和属性表核对。只允许第一次复制；再次复制返回冲突，不会覆盖已有记录。本次已用本机现有四层档案中的“项目层”完成试点，数据只在本机 PostGIS 数据卷。管理员可写入，已登录的同事可读回；公网 Vercel 不连接本机数据库。其余三层、现有在线编辑和共享项目仍沿用原存储，不能把试点当成完整迁移。若数据库在现有数据卷上启动，运行 setup-local.ps1 会应用 002_pilot.sql 的增量结构。迁移前先备份原有 SQLite、浏览器备份和 PostGIS dump。
