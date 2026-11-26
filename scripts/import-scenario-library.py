"""Import the supplied scenario DOCX archive into the local, ignored library."""
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from docx import Document


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def main(archive_path):
    archive = Path(archive_path)
    target = Path(__file__).resolve().parents[1] / ".local-data"
    originals = target / "scenario-docs"
    originals.mkdir(parents=True, exist_ok=True)
    records = []
    references = []
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            if item.is_dir() or not item.filename.lower().endswith(".docx"):
                continue
            if item.file_size > 40 * 1024 * 1024:
                raise ValueError("DOCX is too large: " + item.filename)
            document_bytes = source.read(item)
            name = Path(item.filename).name
            output = originals / f"{len(records) + len(references) + 1:02d}-{name}"
            output.write_bytes(document_bytes)
            document = Document(io.BytesIO(document_bytes))
            fields = {}
            for table in document.tables:
                for row in table.rows:
                    if len(row.cells) < 2:
                        continue
                    label, value = clean(row.cells[0].text), clean(row.cells[1].text)
                    if label == value and "总体目标" in label[:12]:
                        fields["总体目标"] = label.split("总体目标", 1)[1].split("主要内容")[0].strip()[:3000]
                    if label and value and label != value and label not in fields:
                        fields[label] = value[:3000]
            title = fields.get("场景名称") or re.sub(r"^产品场景建设申报表[-—]", "", name[:-5])
            record = {
                "名称": clean(title),
                "适用项目": clean(fields.get("适用项目") or fields.get("适用场景") or title),
                "描述": clean(fields.get("总体目标") or fields.get("场景简介") or fields.get("场景描述"))[:1200],
                "标签": clean(title),
                "来源文件": output.name,
                "字段": fields,
            }
            if "/总体/" in item.filename:
                references.append({"名称": name[:-5], "来源文件": output.name, "字段": fields})
            else:
                records.append(record)
    payload = {"kind": "scenario-library", "source": archive.name,
               "fields": ["名称", "适用项目", "描述", "标签", "来源文件"],
               "records": records, "references": references}
    (target / "scenario-library.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"scenarios": len(records), "references": len(references),
                      "with_description": sum(bool(row["描述"]) for row in records)}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
