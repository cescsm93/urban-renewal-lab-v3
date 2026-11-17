# 本机 PostgreSQL + PostGIS

## 启动与备份

1. 启动 Docker Desktop，在本目录运行 `powershell -ExecutionPolicy Bypass -File .\setup-local.ps1`。脚本会创建数据库并应用增量结构。
2. 数据库只监听 `127.0.0.1:5432`。数据库名和用户名均为 `renewal_lab`；随机生成的密码保存在 Git 忽略的 `../.local-data/postgis.env`，请勿公开。
3. 用 `docker compose -f .\compose.yaml ps` 看状态；用 `stop` 暂停、`start` 恢复。不要删除数据卷。
4. 运行 `powershell -ExecutionPolicy Bypass -File .\backup-local.ps1` 生成 `../.local-data/postgis-backups/*.dump`，并将备份另存到获准使用的受控位置。恢复时先停写入，在兼容版本的 PostgreSQL + PostGIS 中使用 `pg_restore`，核对四层数量和位置，再恢复访问。

数据库备份包含空间档案及授权记录，不包含政策 PDF、Obsidian 笔记、向量索引、资源库原始表和其他本机文件。这些资料须分别备份。网页的 JSON 下载只是核查副本，不能作为 PostGIS 的恢复工具。

## 建宁路四层档案

本机已从用户提供的四层 GDB 压缩包，经先前的**示意配准**结果导入工作区 `建宁路片区`：项目层 12、宗地层 269、建筑层 2544、规划用地层 115，共 2940 条。原图层名称和原始属性字段保留在 `layers`、`features`；几何以 EPSG:4326 存储并建立空间索引。导入脚本为 `node .\import-jianning.cjs`，会校验四层数量并拒绝覆盖已有工作区。

原 GDB 使用南京 92 一类的地方坐标，缺少可靠转换参数。这次 WGS84 位置来自参考轮廓和影像的示意配准，**不可用来确定法定边界、精确距离或面积**。后续拿到控制点或正式转换参数时应重新转换，并保留原始压缩包和配准记录供核查。

局域网网页的“导入数据”自动读取本机 PostGIS。访客可查看；管理员可修改四层字段和边界，并可在“导入数据 → 四层档案编辑权限”给已有的具名同事账号授权或撤销。共享项目的编辑权限与四层档案编辑权限是两回事。所有写入都在服务端检查登录身份；浏览器页面只隐藏按钮不足以授权。旧“更新资源管理器”入口已移除。

本机 PostGIS、GDB 原始文件和数据库口令均不发布到 GitHub、GitHub Pages 或 Vercel。未来迁移到服务器前，先按单位数据管理要求决定哪些资料允许迁移。
