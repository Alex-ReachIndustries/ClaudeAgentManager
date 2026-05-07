import subprocess


def _run(cmd, display_str):
    env = {"DISPLAY": display_str, "PATH": "/usr/bin:/bin"}
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5, env=env)
    return result.stdout, result.stderr, result.returncode


def list_windows(display_str=":1"):
    stdout, _, _ = _run(["wmctrl", "-l", "-G", "-p"], display_str)
    windows = []
    for line in stdout.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split(None, 9)
        if len(parts) < 9:
            continue
        wid, desktop, pid, x, y, w, h, _host = parts[:8]
        title = parts[9] if len(parts) > 9 else (parts[8] if len(parts) > 8 else "")
        windows.append({
            "id": wid,
            "workspace": int(desktop),
            "pid": int(pid),
            "geometry": [int(x), int(y), int(w), int(h)],
            "title": title,
        })
    return {"windows": windows}


def find_window(display_str, search):
    stdout, _, _ = _run(
        ["xdotool", "search", "--name", search],
        display_str,
    )
    wids = [line.strip() for line in stdout.strip().split("\n") if line.strip()]
    hex_ids = [hex(int(wid)) for wid in wids]
    return {"window_ids": hex_ids}


def focus_window(display_str, window_id):
    wid = str(int(window_id, 16)) if window_id.startswith("0x") else window_id
    _run(["xdotool", "windowactivate", wid], display_str)
    return {"ok": True}


def close_window(display_str, window_id):
    _run(["wmctrl", "-i", "-c", window_id], display_str)
    return {"ok": True}


def move_window(display_str, window_id, x=0, y=0, width=-1, height=-1):
    geom = f"0,{x},{y},{width},{height}"
    _run(["wmctrl", "-i", "-r", window_id, "-e", geom], display_str)
    return {"ok": True}


def resize_window(display_str, window_id, width, height):
    return move_window(display_str, window_id, x=-1, y=-1, width=width, height=height)
