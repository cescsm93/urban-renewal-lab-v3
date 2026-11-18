#!/usr/bin/env node
// 只检查官网公开目录的标题与链接，形成待人工审核清单；不下载正文，也不自动入政策库。
const fs = require('node:fs');
const path = require('node:path');

const sources = [
  { name: '国家住建部文件库', url: 'https://www.mohurd.gov.cn/gongkai/zc/wjk/index.html', host: 'www.mohurd.gov.cn' },
  { name: '江苏省政府公报', url: 'https://www.js.gov.cn/col/col81677/index.html', host: 'www.js.gov.cn' },
  { name: '南京市政府信息公开', url: 'https://www.nanjing.gov.cn/xxgkn/', host: 'www.nanjing.gov.cn' },
  { name: '南京市行政规范性文件库', url: 'https://www.nanjing.gov.cn/xxgkn/szgfxwj/', host: 'www.nanjing.gov.cn' }
];
const relevant = /城市更新|旧城|城中村|老旧小区|老旧街区|低效用地|存量土地|土地供应|规划|养老|公共服务|产业园|保障性住房|住宅修缮/;
const pending = /征求意见|意见稿|草案|解读|新闻|答记者问|公示/;
const storage = path.join(__dirname, '..', '.local-data', 'policy-watch');

function decode(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}
function entries(html, source) {
  const found = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decode(match[3]);
    if (!relevant.test(title) || title.length < 8 || title.length > 180) continue;
    let link;
    try { link = new URL(decode(match[2]), source.url); } catch { continue; }
    if (link.protocol !== 'https:' || link.hostname !== source.host) continue;
    link.hash = '';
    found.set(link.href, { source: source.name, title, url: link.href,
      status: pending.test(title) ? '待核对：可能是草案或解读' : '待核对：效力及适用范围' });
  }
  return [...found.values()].slice(0, 100);
}
async function main() {
  fs.mkdirSync(storage, { recursive: true });
  const snapshotFile = path.join(storage, 'official-links.json');
  const previous = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : { links: [] };
  const previousUrls = new Set(previous.links.map(item => item.url));
  const results = await Promise.all(sources.map(async source => {
    try {
      const response = await fetch(source.url, { headers: { 'User-Agent': 'UrbanRenewalLabPolicyReview/1.0' },
        signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length > 5_000_000) throw Error('页面过大');
      return { source: source.name, links: entries(html, source) };
    } catch (error) { return { source: source.name, error: error.message, links: [] }; }
  }));
  const links = [...new Map(results.flatMap(item => item.links).map(item => [item.url, item])).values()];
  const newLinks = links.filter(item => !previousUrls.has(item.url));
  const checkedAt = new Date().toISOString();
  // 某官网临时失败时保留历史快照，避免恢复后把旧文件误报为新增。
  const merged = [...new Map([...previous.links, ...links].map(item => [item.url, item])).values()];
  fs.writeFileSync(snapshotFile, JSON.stringify({ checkedAt, links: merged }, null, 2));
  const reviewFile = path.join(storage, 'review-' + checkedAt.slice(0, 10) + '.json');
  fs.writeFileSync(reviewFile, JSON.stringify({ checkedAt, newLinks, sources: results.map(({ source, error, links }) =>
    ({ source, error: error || null, count: links.length })) }, null, 2));
  for (const row of results) console.log(`${row.source}: ${row.error || row.links.length + ' 条候选链接'}`);
  console.log(`新增待人工审核 ${newLinks.length} 条；清单：${reviewFile}`);
  if (results.every(row => row.error)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { entries, decode };
