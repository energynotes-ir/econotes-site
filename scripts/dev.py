"""Start web, API and the local multi-source data refresh worker together."""

from __future__ import annotations

import signal
import subprocess
import sys
import time


def main() -> None:
    commands = [
        [sys.executable, "-m", "uvicorn", "api.app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
        [sys.executable, "-m", "api.app.refresh_data"],
        ["npm", "run", "dev"],
    ]
    processes = []
    try:
        for command in commands:
            processes.append(subprocess.Popen(command))
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
