"""Build a local Obsidian partner vault from the source workbook without changing it."""

import argparse
import hashlib
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

import openpyxl


FIELDS = ["序号", "类别", "机构名称", "机构性质", "所在地区", "地址", "专业方向", "联系人",
          "合作项目", "优势特长", "相关案例", "入库部门", "原表M列（无标题）"]


def text(value):
    return "" if value is None else str(value).strip()


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\[\]]', "-", value).strip(" .")
    return re.sub(r"\s+", " ", value)[:90] or "未命名"


def regions(value):
    places = []
    for raw in re.split(r"[、,，;/；]+", value):
        raw = raw.strip()
        if not raw:
            continue
        for name in ("南京", "北京", "上海", "深圳", "东莞", "成都", "西宁", "贵阳",
                     "拉萨", "盐城", "连云港", "苏州", "扬州", "无锡", "杭州", "济南", "重庆", "芜湖"):
            if name in raw:
                raw = name
                break
        if raw not in places:
            places.append(raw)
    return places or ["未录入"]


def yaml_text(value):
    return json.dumps(value, ensure_ascii=False)


def field_block(label, value):
    value = text(value)
    if not value:
        value = "未录入"
    return f"## {label}\n\n" + "\n".join(f"> {line}" for line in value.splitlines()) + "\n\n"


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def build(source, target):
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"目标仓库不是空目录，停止以免覆盖：{target}")
    workbook = openpyxl.load_workbook(source, read_only=False, data_only=True)
    sheet = workbook["外部资源库"]
    actual = [text(sheet.cell(2, column).value) for column in range(1, 13)]
    if actual != FIELDS[:12]:
        raise SystemExit("表头与预期不符，停止转换")
    entries = []
    current_category = "未分类"
    for row in range(3, sheet.max_row + 1):
        values = {field: sheet.cell(row, column).value for column, field in enumerate(FIELDS, 1)}
        if not text(values["机构名称"]):
            continue
        if text(values["类别"]):
            current_category = text(values["类别"])
        values["类别"] = current_category
        number = text(values["序号"])
        if not number:
            raise SystemExit(f"第 {row} 行缺少序号")
        stem = f"{int(float(number)):03d} {safe_name(text(values['机构名称']))}"
        entries.append({"row": row, "stem": stem, "values": values,
                        "category": current_category, "regions": regions(text(values["所在地区"]))})
    if len({entry["stem"] for entry in entries}) != len(entries):
        raise SystemExit("机构文件名有重复，停止转换")
    (target / "机构").mkdir(parents=True, exist_ok=True)
    (target / "分类").mkdir(exist_ok=True)
    (target / "地区").mkdir(exist_ok=True)
    (target / "原始文件").mkdir(exist_ok=True)
    source_copy = target / "原始文件" / source.name
    shutil.copy2(source, source_copy)
    if digest(source) != digest(source_copy):
        raise SystemExit("原始工作簿复制校验失败")
    categories = defaultdict(list)
    areas = defaultdict(list)
    for entry in entries:
        values = entry["values"]
        name = text(values["机构名称"])
        category = entry["category"]
        category_file = safe_name(category)
        region_links = [f"[[地区/{safe_name(region)}|{region}]]" for region in entry["regions"]]
        filename = f"机构/{entry['stem']}"
        link = f"[[{filename}|{name}]]"
        categories[category].append(link)
        for region in entry["regions"]:
            areas[region].append(link)
        lines = ["---", "tags:", "  - 资源库/合作伙伴",
                 f"  - 类别/{safe_name(category).replace(' ', '')}",
                 *[f"  - 地区/{safe_name(region).replace(' ', '')}" for region in entry["regions"]],
                 f"源表行: {entry['row']}", f"机构名称: {yaml_text(name)}",
                 f"类别: {yaml_text(category)}", "---", "", f"# {name}", "",
                 f"类别：[[分类/{category_file}|{category}]]  ",
                 f"地区：{'、'.join(region_links)}  ",
                 f"来源：[[原始文件/{source.name}|原始工作簿]]，外部资源库第 {entry['row']} 行", ""]
        for field in FIELDS[3:]:
            lines.append(field_block(field, values[field]))
        (target / "机构" / f"{entry['stem']}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    for category, links in categories.items():
        content = f"# {category}\n\n返回 [[00-资源库总览]]。\n\n" + "\n".join(f"- {link}" for link in links) + "\n"
        (target / "分类" / f"{safe_name(category)}.md").write_text(content, encoding="utf-8")
    for region, links in areas.items():
        content = f"# {region}\n\n返回 [[00-资源库总览]]。\n\n" + "\n".join(f"- {link}" for link in links) + "\n"
        (target / "地区" / f"{safe_name(region)}.md").write_text(content, encoding="utf-8")
    overview = ["# 合作伙伴资源库", "", f"从原始工作簿的“外部资源库”工作表整理，共 {len(entries)} 家机构。",
                "点击类别或地区可查看机构；Obsidian 图谱展示这些笔记之间的链接。", "",
                "## 按类别", ""]
    overview += [f"- [[分类/{safe_name(category)}|{category}]]（{len(links)} 家）" for category, links in categories.items()]
    overview += ["", "## 按地区", ""]
    overview += [f"- [[地区/{safe_name(region)}|{region}]]（{len(links)} 家）" for region, links in areas.items()]
    overview += ["", "## 数据来源", "", f"- [[原始文件/{source.name}|原始工作簿]]",
                 "- 机构笔记保留表中字段；空白项标为“未录入”。",
                 "- 类别按原表合并单元格向下归属；地区图谱节点作城市归一，笔记中仍保留原始地区值。",
                 "- 图谱链接仅表示同类或同地区，不表示已合作或推荐结论。", ""]
    (target / "00-资源库总览.md").write_text("\n".join(overview), encoding="utf-8")
    return {"source": str(source), "vault": str(target), "partners": len(entries),
            "categories": {key: len(value) for key, value in categories.items()},
            "regions": len(areas), "source_sha256": digest(source)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.source.resolve(strict=True), args.target.resolve()), ensure_ascii=False, indent=2))
