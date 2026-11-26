"""Convert a user-provided File Geodatabase archive into named WGS84 GeoJSON layers."""
import base64
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import zipfile

import geopandas as gpd
import pyogrio

MAX_ARCHIVE = 20 * 1024 * 1024
MAX_UNPACKED = 120 * 1024 * 1024
MAX_FEATURES = 5000


def archive_names(path):
    result = subprocess.run(["tar", "-tf", str(path)], capture_output=True, timeout=15)
    if result.returncode:
        raise ValueError("无法读取 RAR 目录，请确认文件完整")
    for codec in ("utf-8", "gbk"):
        try:
            return result.stdout.decode(codec).splitlines()
        except UnicodeDecodeError:
            pass
    raise ValueError("RAR 文件名编码无法识别")


def extract_rar_with_7zip(archive, folder):
    """Extract the GDB into one flat directory after checking every archive entry."""
    source = Path(__file__).parent / "bin" / "7zzs"
    if not source.is_file():
        raise ValueError("线上 RAR 解压工具未安装")
    executable = folder / "7zzs"
    shutil.copy2(source, executable)
    executable.chmod(0o700)
    listing = subprocess.run([str(executable), "l", "-slt", str(archive)],
                             capture_output=True, timeout=15)
    if listing.returncode:
        raise ValueError("无法读取 RAR 目录，请确认文件完整")
    output = listing.stdout.decode("utf-8", errors="replace")
    if "----------" not in output:
        raise ValueError("RAR 文件目录读取失败")
    entries = []
    for block in output.split("----------", 1)[1].split("\n\n"):
        fields = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
        name = fields.get("Path", "")
        if not name:
            continue
        parts = safe_parts(name)
        if fields.get("Folder") == "+":
            continue
        if len(parts) != 2:
            raise ValueError("RAR 只能包含一个地理数据库文件夹及其中的文件")
        if "L" in fields.get("Attributes", ""):
            raise ValueError("RAR 包含不支持的链接文件")
        entries.append((parts, int(fields.get("Size", "0"))))
    if not entries or len(entries) > 1000 or sum(size for _, size in entries) > MAX_UNPACKED:
        raise ValueError("RAR 内容为空或超过 1000 个文件、120 MB")
    if len({parts[0] for parts, _ in entries}) != 1 or len({parts[1] for parts, _ in entries}) != len(entries):
        raise ValueError("RAR 包含多个地理数据库或重名文件")
    destination = folder / "input.gdb"
    destination.mkdir()
    extracted = subprocess.run([str(executable), "e", "-y", f"-o{destination}", str(archive)],
                               capture_output=True, timeout=30)
    if extracted.returncode:
        raise ValueError("RAR 解压失败，请检查压缩包")
    files = [p for p in destination.iterdir() if p.is_file()]
    if len(files) > 1000 or sum(p.stat().st_size for p in files) > MAX_UNPACKED:
        raise ValueError("RAR 解压内容超过 1000 个文件或 120 MB")
    if any(p.is_symlink() for p in destination.iterdir()):
        raise ValueError("RAR 包含不支持的链接文件")
    if not (destination / "a00000001.gdbtable").is_file():
        raise ValueError("RAR 中缺少完整的地理数据库")
    return destination


def safe_parts(name):
    raw = name.replace("\\", "/")
    parts = PurePosixPath(raw).parts
    if not parts or raw.startswith("/") or any(part in ("", ".", "..") for part in parts) or ":" in raw:
        raise ValueError("压缩包包含不安全的路径")
    return parts


def extract_archive(archive, folder):
    if archive.suffix.lower() == ".zip":
        with zipfile.ZipFile(archive) as zipped:
            entries = zipped.infolist()
            if len(entries) > 1000 or sum(entry.file_size for entry in entries) > MAX_UNPACKED:
                raise ValueError("压缩包内容超过 1000 个文件或 120 MB")
            for entry in entries:
                parts = safe_parts(entry.filename)
                if entry.is_dir():
                    continue
                target = folder.joinpath(*parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(entry) as source, target.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
    else:
        if not shutil.which("tar"):
            return extract_rar_with_7zip(archive, folder)
        names = archive_names(archive)
        if len(names) > 1000:
            raise ValueError("RAR 文件超过 1000 个条目")
        for name in names:
            safe_parts(name)
        details = subprocess.run(["tar", "-tvf", str(archive)], capture_output=True, timeout=15)
        if details.returncode:
            raise ValueError("RAR 文件目录读取失败")
        if any(line[:1] not in (b"-", b"d") for line in details.stdout.splitlines()):
            raise ValueError("RAR 包含不支持的链接或特殊文件")
        result = subprocess.run(["tar", "-xf", str(archive), "-C", str(folder)],
                                capture_output=True, timeout=30)
        if result.returncode:
            raise ValueError("RAR 解压失败，请检查压缩包")
    files = [p for p in folder.rglob("*") if p.is_file()]
    if len(files) > 1000 or sum(p.stat().st_size for p in files) > MAX_UNPACKED:
        raise ValueError("解压内容超过 1000 个文件或 120 MB")
    if any(p.is_symlink() for p in folder.rglob("*")):
        raise ValueError("压缩包包含链接文件")
    roots = [p for p in folder.rglob("a00000001.gdbtable") if p.is_file()]
    if len(roots) != 1:
        raise ValueError("压缩包需包含一套完整的 .gdb 文件夹")
    source = roots[0].parent
    destination = folder / "input.gdb"
    if source != destination:
        source.rename(destination)
    return destination


def convert(raw, filename):
    if len(raw) > MAX_ARCHIVE:
        raise ValueError("压缩文件最多 20 MB")
    with tempfile.TemporaryDirectory(prefix="renewal-geodatabase-") as temporary:
        folder = Path(temporary)
        archive = folder / ("archive.zip" if filename.lower().endswith(".zip") else "archive.rar")
        archive.write_bytes(raw)
        gdb = extract_archive(archive, folder)
        layers = []
        source_crs = set()
        for name, geometry_type in pyogrio.list_layers(gdb):
            info = pyogrio.read_info(gdb, layer=name)
            if info["features"] > MAX_FEATURES:
                raise ValueError(f"{name} 超过 5000 条，请裁剪后导入")
            frame = gpd.read_file(gdb, layer=name, engine="pyogrio")
            if frame.crs is None:
                raise ValueError(f"{name} 缺少坐标系，请先在 GIS 软件中定义")
            source_crs.add(str(frame.crs))
            frame = frame.to_crs("EPSG:4326")
            collection = json.loads(frame.to_json(drop_id=True, na="null", default=str))
            layers.append({"name": str(name), "collection": collection})
        if not layers:
            raise ValueError("地理数据库中没有可显示的图层")
        if len(layers) > 16:
            raise ValueError("本次最多导入 16 个图层")
        return {"layers": layers, "sourceCRS": ", ".join(sorted(source_crs)) + " → EPSG:4326"}


def main():
    try:
        payload = json.load(sys.stdin)
        filename = str(payload.get("filename", ""))
        if not filename.lower().endswith((".rar", ".zip")):
            raise ValueError("请选择 GDB 的 RAR 或 ZIP 压缩包")
        data = base64.b64decode(payload.get("data", ""), validate=True)
        print(json.dumps(convert(data, filename), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
