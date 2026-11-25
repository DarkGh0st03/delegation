#!/usr/bin/env python3
"""Transparent JSON-RPC counting proxy for Phase 1b (standard library only).

Forwards every POST to the upstream node unchanged and records, per JSON-RPC
method, the number of calls and the upstream round-trip time. Control:
  POST /__reset  -> clears counters
  GET  /__stats  -> {"requests": n, "calls": n, "methods": {m: n}, "upstream_ms": t}
Usage: python3 -I rpc_count_proxy.py <listen_port> <upstream_url>
"""
import json
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
STATE = {"requests": 0, "calls": 0, "methods": {}, "upstream_ms": 0.0}
UPSTREAM = sys.argv[2]


def reset():
    with LOCK:
        STATE.update(requests=0, calls=0, methods={}, upstream_ms=0.0)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _reply(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/__stats":
            with LOCK:
                body = json.dumps(STATE).encode()
            return self._reply(200, body)
        self._reply(404, b"{}")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/__reset":
            reset()
            return self._reply(200, b"{}")
        try:
            parsed = json.loads(body)
            calls = parsed if isinstance(parsed, list) else [parsed]
            methods = [c.get("method", "?") for c in calls]
        except Exception:
            methods = ["<unparsable>"]
        req = urllib.request.Request(UPSTREAM, data=body,
                                     headers={"Content-Type": "application/json"})
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = resp.read()
            status = resp.status
        dt = (time.perf_counter() - t0) * 1000
        with LOCK:
            STATE["requests"] += 1
            STATE["calls"] += len(methods)
            STATE["upstream_ms"] += dt
            for m in methods:
                STATE["methods"][m] = STATE["methods"].get(m, 0) + 1
        self._reply(status, out)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
