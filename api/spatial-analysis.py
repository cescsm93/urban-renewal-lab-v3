"""Vercel endpoint for bounded spatial analyses."""
from http.server import BaseHTTPRequestHandler
import json
from gis.spatial_analysis import analyze

class handler(BaseHTTPRequestHandler):
    def respond(self, code, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
        if len(body) > 4_100_000:
            code, body = 413, b'{"error":"result too large"}'
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 4_100_000:
                return self.respond(413, {'error':'单次数据上限约 4 MB，请裁剪范围'})
            return self.respond(200, analyze(json.loads(self.rfile.read(size))))
        except Exception as error:
            return self.respond(400, {'error':str(error)[:500]})

    def do_GET(self):
        return self.respond(405, {'error':'仅支持 POST'})
