"""Import the partner workbook into Renewal Lab's private local data directory."""

import json
import sys
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook


FIELDS = (
    "序号", "类别", "机构名称", "机构性质", "所在地区", "地址", "专业方向",
    "联系人", "合作项目", "优势特长", "相关案例", "入库部门",
)


def clean(value):
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, str):
        return value.strip() or None
    return value


def import_workbook(source: Path, destination: Path) -> dict:
    workbook = load_workbook(source, read_only=True, data_only=True)
    try:
        if len(workbook.sheetnames) != 1:
            raise ValueError("合作伙伴文件应只有一张工作表，请先核对来源")
        sheet = workbook.active
        rows = sheet.iter_rows(values_only=True)
        next(rows, None)  # title
        header = tuple(clean(value) for value in next(rows, ()))[: len(FIELDS)]
        if header != FIELDS:
            raise ValueError("合作伙伴文件字段与预期不一致，请先核对来源")
        records = []
        category = None
        names = set()
        for excel_row, values in enumerate(rows, start=3):
            cells = [clean(value) for value in values[: len(FIELDS)]]
            if not cells or not any(value is not None for value in cells):
                continue
            row = dict(zip(FIELDS, cells))
            if row["类别"]:
                category = row["类别"]
            row["类别"] = category
            if not row["机构名称"] or not category:
                raise ValueError(f"第 {excel_row} 行缺少机构名称或类别")
            if row["机构名称"] in names:
                raise ValueError(f"第 {excel_row} 行机构名称重复")
            names.add(row["机构名称"])
            row["来源行"] = excel_row
            records.append(row)
        if not records:
            raise ValueError("没有找到合作伙伴记录")
        payload = {
            "kind": "partner-library",
            "source": source.name,
            "sheet": sheet.title,
            "importedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "fields": list(FIELDS),
            "records": records,
        }
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload
    finally:
        workbook.close()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit("用法：python scripts/import_partner_library.py <合作伙伴.xlsx> [本地输出.json]")
    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else Path(__file__).resolve().parents[1] / ".local-data" / "partner-library.json"
    result = import_workbook(input_path, output_path)
    print(f"已导入 {len(result['records'])} 条合作伙伴记录，保存到本地私有数据目录。")
