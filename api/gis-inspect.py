"""Production Vercel Function for the same GeoPandas/Shapely inspection as local preview."""
from http.server import BaseHTTPRequestHandler
import json

from gis.inspect_data import inspect

MAX_REQUEST_BYTES = 4_100_000
MAX_RESPONSE_BYTES = 4_100_000


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        if len(encoded) > MAX_RESPONSE_BYTES:
            status = 413
            encoded = json.dumps({'error': '检查结果超过线上大小限制，请拆分数据后重试'}, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                return self._send(413, {'error': '线上单次检查最多约 3 MB 文件，请拆分数据后重试'})
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            result = inspect(payload)
            return self._send(200, result)
        except Exception as error:
            return self._send(400, {'error': str(error)[:500]})

    def do_GET(self):
        return self._send(405, {'error': '仅支持 POST'})
