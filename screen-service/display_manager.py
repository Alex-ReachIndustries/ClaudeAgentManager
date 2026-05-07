import subprocess
import time
import os
import signal
import atexit
from Xlib import display as xdisplay


class DisplayManager:
    def __init__(self):
        self._connections = {}
        self._processes = {}
        atexit.register(self.cleanup)

    def get_connection(self, display_str=":1"):
        if display_str not in self._connections:
            try:
                conn = xdisplay.Display(display_str)
                self._connections[display_str] = conn
            except Exception as e:
                raise RuntimeError(f"Cannot connect to display {display_str}: {e}")
        return self._connections[display_str]

    def close_connection(self, display_str):
        conn = self._connections.pop(display_str, None)
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    def create_display(self, display_num=1, resolution="1920x1080", display_type="xephyr"):
        display_str = f":{display_num}"
        if display_str in self._processes:
            info = self._processes[display_str]
            if info["proc"].poll() is None:
                return {
                    "display": display_str,
                    "resolution": info["resolution"],
                    "pid": info["proc"].pid,
                    "status": "running",
                    "type": info["type"],
                }
            self._cleanup_display(display_str)

        if display_type == "xvfb":
            proc = subprocess.Popen(
                ["Xvfb", display_str, "-screen", "0", f"{resolution}x24"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            proc = subprocess.Popen(
                ["Xephyr", display_str, "-screen", resolution, "-ac", "-resizeable"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        time.sleep(1)
        if proc.poll() is not None:
            raise RuntimeError(f"Failed to start {display_type} on {display_str}")

        self._processes[display_str] = {
            "proc": proc,
            "resolution": resolution,
            "type": display_type,
            "wm_proc": None,
        }

        env = os.environ.copy()
        env["DISPLAY"] = display_str
        wm_proc = subprocess.Popen(
            ["openbox"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._processes[display_str]["wm_proc"] = wm_proc

        return {
            "display": display_str,
            "resolution": resolution,
            "pid": proc.pid,
            "status": "running",
            "type": display_type,
            "wm": "openbox",
        }

    def destroy_display(self, display_str):
        self.close_connection(display_str)
        self._cleanup_display(display_str)

    def _cleanup_display(self, display_str):
        info = self._processes.pop(display_str, None)
        if not info:
            return
        for key in ("wm_proc", "proc"):
            proc = info.get(key)
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()

    def list_displays(self):
        result = {}
        for display_str, info in list(self._processes.items()):
            alive = info["proc"].poll() is None
            if not alive:
                self._cleanup_display(display_str)
                continue
            result[display_str] = {
                "resolution": info["resolution"],
                "pid": info["proc"].pid,
                "type": info["type"],
                "status": "running",
            }
        return result

    def cleanup(self):
        for display_str in list(self._processes.keys()):
            self.close_connection(display_str)
            self._cleanup_display(display_str)


dm = DisplayManager()
