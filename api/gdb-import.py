"""Vercel endpoint for importing a small File Geodatabase archive."""

from http.server import BaseHTTPRequestHandler
import base64
import json

from gis.import_geodatabase import convert


MAX_REQUEST_BYTES = 4_100_000
MAX_RESPONSE_BYTES = 4_100_000


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_RESPONSE_BYTES:
            status = 413
            encoded = json.dumps({"error": "转换结果超过线上大小限制，请拆分数据后导入"}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        self._send(404, {"error": "线上未预装私人档案，请从当前设备上传"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                return self._send(413, {"error": "线上 GDB 压缩包请控制在 3 MB 以内"})
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            filename = str(payload.get("filename", ""))
            if not filename.lower().endswith((".rar", ".zip")):
                return self._send(400, {"error": "请选择 GDB RAR 或 ZIP 压缩包"})
            raw = base64.b64decode(payload.get("data", ""), validate=True)
            if len(raw) > 3_000_000:
                return self._send(413, {"error": "线上 GDB 压缩包请控制在 3 MB 以内"})
            return self._send(200, convert(raw, filename))
        except Exception as error:
            return self._send(400, {"error": str(error)[:500]})
