#!/usr/bin/env python3
"""Testserver für die semantische Suche: liefert Modelldateien unter dem Pfad wie bei Hugging Face, nur auf 127.0.0.1.

  tools/tbtest/modelserver.py <ordner> <port>

<ordner> enthält config.json, tokenizer.json, tokenizer_config.json und onnx/model_fp16.onnx (wie im Repository des
Modells). Das Add-on prüft jede Datei selbst mit den Prüfsummen aus semantic/models.js.
"""
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[1])
PREFIX = "/jinaai/jina-embeddings-v2-base-de/resolve/3f9eede875721714945b6a99a3198299243cf2be/"
FILES = {"config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_fp16.onnx"}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        rel = self.path[len(PREFIX):] if self.path.startswith(PREFIX) else None
        if rel not in FILES:
            self.send_error(404)
            return
        path = os.path.join(ROOT, *rel.split("/"))
        if not os.path.isfile(path):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        with open(path, "rb") as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
