import functools
import http.server
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "127.0.0.1")


class AppHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "application/javascript",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(AppHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving app/ at http://{HOST}:{PORT}")
    server.serve_forever()
