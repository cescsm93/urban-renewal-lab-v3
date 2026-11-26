"""Add conservative Obsidian tags and a local PDF tag catalog to a policy vault.

Only filenames and source directories are classified. Run --dry-run before writing.
The generated catalog contains paths and tags, never document text.
"""

import argparse
import json
import re
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path


REGIONS = (
    ("国家", ("国家政策",)),
    ("江苏", ("江苏省政策",)),
    ("南京", ("南京市政策文件",)),
    ("苏州", ("苏州市政策文件",)),
    ("无锡", ("无锡市政策文件",)),
    ("泰州", ("泰州市政策文件",)),
    ("连云港", ("连云港市政策文件",)),
    ("上海", ("上海市城市更新相关文件",)),
    ("深圳", ("深圳市城市更新相关文件",)),
    ("北京", ("北京市城市更新相关文件",)),
    ("广州", ("广州市城市更新相关文件",)),
)
TOPICS = (
    ("城市更新", r"城市更新|旧城改造|旧区改造"),
    ("土地规划", r"用地|土地|地价|规划|容积率|征收|征地|不动产"),
    ("住房建筑", r"住房|住宅|房屋|建筑|危旧房|租赁"),
    ("产业商业", r"产业|工业|商业|商办|园区|市场|楼宇"),
    ("公共服务", r"公共服务|养老|教育|学校|医疗|社区服务|公共空间"),
    ("历史文化", r"历史文化|历史风貌|文物|文化遗产"),
    ("生态环境", r"生态|环境|绿色|低碳|海绵城市"),
    ("资金金融", r"资金|金融|专项债|财政|税收|融资"),
    ("项目实施", r"项目管理|实施|审批|试点|评估|申报"),
    ("技术标准", r"技术|标准|规范|导则|指引"),
)
OBJECTS = (
    ("老旧小区", r"老旧小区|旧住宅小区"),
    ("城中村", r"城中村"),
    ("工业用地", r"工业用地|低效产业用地"),
    ("商业", r"商业|商办|商场|购物中心"),
    ("历史街区", r"历史街区|历史文化街区"),
)
STATES = (
    ("征求意见", r"征求意见|征求公众意见"),
    ("草案", r"草案|送审稿|讨论稿"),
)


def relative(file, root):
    return file.relative_to(root).as_posix()


def classify(source_path, title):
    folder = re.sub(r"^\d{2}", "", source_path.split("/", 1)[0])
    regions = [name for name, prefixes in REGIONS if any(folder.startswith(p) for p in prefixes)]
    if not regions:
        names = [name for name, _ in REGIONS if name in title]
        if len(names) == 1:
            regions = names
    tags = ["政策库/原文", f"地区/{regions[0]}" if len(regions) == 1 else "地区/综合待核"]
    tags += [f"主题/{name}" for name, pattern in TOPICS if re.search(pattern, title)]
    tags += [f"对象/{name}" for name, pattern in OBJECTS if re.search(pattern, title)]
    tags += [f"状态/{name}" for name, pattern in STATES if re.search(pattern, title)]
    return tags


def frontmatter(lines):
    if not lines or lines[0].lstrip("\ufeff").strip() != "---":
        return None, {}
    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), None)
    if end is None:
        return None, {}
    fields = {}
    for line in lines[1:end]:
        if ":" in line and not line[0].isspace():
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip().strip('"')
    return end, fields


def existing_tags(lines, end):
    if end is None:
        return []
    for i in range(1, end):
        match = re.match(r"^tags:\s*(.*)$", lines[i])
        if not match:
            continue
        value = match.group(1).strip()
        if value.startswith("[") and value.endswith("]"):
            return [part.strip().strip('"\'') for part in value[1:-1].split(",") if part.strip()]
        result = []
        for line in lines[i + 1 : end]:
            match = re.match(r"^\s+-\s+(.+)$", line)
            if not match:
                break
            result.append(match.group(1).strip().strip('"\''))
        return result
    return []


def set_tags(lines, end, tags):
    newline = "\r\n" if any(line.endswith("\r\n") for line in lines[:5]) else "\n"
    block = [f"tags:{newline}"] + [f"  - {tag}{newline}" for tag in tags]
    start = next((i for i in range(1, end) if re.match(r"^tags:\s*", lines[i])), None)
    if start is None:
        return "".join(lines[:end] + block + lines[end:])
    stop = start + 1
    while stop < end and re.match(r"^\s+-\s+", lines[stop]):
        stop += 1
    return "".join(lines[:start] + block + lines[stop:])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("vault", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.vault.resolve(strict=True)
    pdf_files = sorted(root.rglob("*.pdf"))
    notes = sorted(root.rglob("*.md"))
    pdf_by_name = {}
    for file in pdf_files:
        pdf_by_name.setdefault(file.name, []).append(file)
    catalog = {relative(file, root): classify(relative(file, root), file.stem) for file in pdf_files}
    changes = []
    stats = Counter()
    linked_pdfs = set()
    for file in notes:
        with file.open("r", encoding="utf-8-sig", newline="") as stream:
            lines = stream.readlines()
        end, fields = frontmatter(lines)
        current = existing_tags(lines, end)
        source = fields.get("来源文件", "").replace("\\", "/")
        title = fields.get("title", file.stem)
        linked_pdf = None
        if source:
            candidate = root / source
            if candidate.is_file() and candidate.suffix.lower() == ".pdf":
                linked_pdf = candidate
            elif len(pdf_by_name.get(Path(source).name, [])) == 1:
                linked_pdf = pdf_by_name[Path(source).name][0]
        if end is not None and source and (not current or "政策库/原文" in current):
            source_path = relative(linked_pdf, root) if linked_pdf else source
            tags = classify(source_path, title)
            if tags != current:
                changes.append((file, set_tags(lines, end, tags)))
                stats["updated_tagged_notes" if current else "newly_tagged_notes"] += 1
            else:
                stats["unchanged_tagged_notes"] += 1
        elif current:
            tags = current
            stats["existing_tagged_notes"] += 1
        else:
            tags = []
            stats["untagged_other_notes"] += 1
        if linked_pdf:
            stats["linked_pdf_notes"] += 1
            linked_pdfs.add(relative(linked_pdf, root))
        catalog[relative(file, root)] = tags
    stats["pdf_files"] = len(pdf_files)
    stats["notes"] = len(notes)
    stats["pdfs_with_mirror_notes"] = len(linked_pdfs)
    stats["region_unknown_pdfs"] = sum("地区/综合待核" in tags for key, tags in catalog.items() if key.endswith(".pdf"))
    result = {"vault": str(root), "dry_run": args.dry_run, "summary": dict(stats),
              "tag_counts": dict(Counter(tag for tags in catalog.values() for tag in tags).most_common())}
    if not args.dry_run:
        backup = root.parent / f"{root.name}-标签前笔记备份-{datetime.now():%Y%m%d-%H%M%S}.zip"
        with zipfile.ZipFile(backup, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in notes:
                archive.write(file, relative(file, root))
        for file, content in changes:
            with file.open("w", encoding="utf-8", newline="") as stream:
                stream.write(content)
        output = root / ".policy-tags.json"
        output.write_text(json.dumps({"version": 1, "documents": catalog}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        result["backup"] = str(backup)
        result["catalog"] = str(output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
