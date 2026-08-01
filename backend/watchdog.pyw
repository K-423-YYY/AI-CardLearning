import socket
import subprocess
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
APP_PORT = 8686


def _port_open() -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    try:
        return sock.connect_ex(("127.0.0.1", APP_PORT)) == 0
    finally:
        sock.close()


def _ensure_server() -> None:
    if _port_open():
        return
    python = BASE_DIR / "venv" / "Scripts" / "pythonw.exe"
    out = (BASE_DIR / "server2.log").open("ab", buffering=0)
    err = (BASE_DIR / "server2.err.log").open("ab", buffering=0)
    subprocess.Popen(
        [str(python), "run.py"],
        cwd=str(BASE_DIR),
        stdout=out,
        stderr=err,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
    )


if __name__ == "__main__":
    while True:
        try:
            _ensure_server()
        except Exception:
            pass
        time.sleep(30)
