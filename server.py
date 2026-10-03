"""Local server for the showcase.

Like `python3 -m http.server`, but supports HTTP Range requests so videos can
seek (replay, fullscreen switch) and start playing without loading the whole file.

Usage: python3 server.py [port]
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

CHUNK = 1024 * 1024


class RangeHandler(SimpleHTTPRequestHandler):
    _range_left = None
    def send_head(self):
        path = self.translate_path(self.path)
        range_header = self.headers.get("Range")
        if not range_header or os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        size = os.path.getsize(path)
        if not match:
            return super().send_head()
        start_s, end_s = match.groups()
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:  # suffix range: last N bytes
            start = max(0, size - int(end_s))
            end = size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return f

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")  # always the latest files after editing
        super().end_headers()

    def copyfile(self, source, outputfile):
        left = getattr(self, "_range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        try:
            while left > 0:
                data = source.read(min(CHUNK, left))
                if not data:
                    break
                outputfile.write(data)
                left -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser cancelled the request (normal while seeking)
        finally:
            self._range_left = None

    def log_message(self, *args):
        pass  # keep the terminal quiet


if __name__ == "__main__":
    import webbrowser

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    # If the port is taken (e.g. by Docker), try the next ones
    for candidate in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), RangeHandler)
            break
        except OSError:
            continue
    else:
        sys.exit(f"No free port between {port} and {port + 19}")
    url = f"http://localhost:{candidate}"
    print(f"Showcase running at {url}  (close this window to stop)")
    webbrowser.open(url)
    server.serve_forever()
