import subprocess
import shlex

from Xlib import X, XK
from Xlib.ext import xtest


MODIFIER_MAP = {
    "ctrl": "Control_L",
    "control": "Control_L",
    "alt": "Alt_L",
    "shift": "Shift_L",
    "super": "Super_L",
    "meta": "Super_L",
}

SPECIAL_KEYS = {
    "return": "Return",
    "enter": "Return",
    "tab": "Tab",
    "escape": "Escape",
    "esc": "Escape",
    "backspace": "BackSpace",
    "delete": "Delete",
    "space": "space",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "home": "Home",
    "end": "End",
    "pageup": "Prior",
    "pagedown": "Next",
    "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4",
    "f5": "F5", "f6": "F6", "f7": "F7", "f8": "F8",
    "f9": "F9", "f10": "F10", "f11": "F11", "f12": "F12",
}


def _keysym_to_keycode(conn, keysym_name):
    keysym = XK.string_to_keysym(keysym_name)
    if keysym == 0:
        return None
    keycode = conn.keysym_to_keycode(keysym)
    return keycode if keycode else None


def _resolve_key(name):
    lower = name.lower()
    if lower in MODIFIER_MAP:
        return MODIFIER_MAP[lower]
    if lower in SPECIAL_KEYS:
        return SPECIAL_KEYS[lower]
    if len(name) == 1:
        return name
    return name


def key_combo(conn, keys_str):
    parts = [p.strip() for p in keys_str.split("+")]
    resolved = [_resolve_key(p) for p in parts]
    keycodes = []
    for name in resolved:
        kc = _keysym_to_keycode(conn, name)
        if kc is None:
            raise ValueError(f"Unknown key: {name}")
        keycodes.append(kc)

    for kc in keycodes:
        xtest.fake_input(conn, X.KeyPress, kc)
        conn.flush()

    for kc in reversed(keycodes):
        xtest.fake_input(conn, X.KeyRelease, kc)
        conn.flush()

    return {"ok": True}


def key_down(conn, key_str):
    name = _resolve_key(key_str.strip())
    kc = _keysym_to_keycode(conn, name)
    if kc is None:
        raise ValueError(f"Unknown key: {key_str}")
    xtest.fake_input(conn, X.KeyPress, kc)
    conn.flush()
    return {"ok": True}


def key_up(conn, key_str):
    name = _resolve_key(key_str.strip())
    kc = _keysym_to_keycode(conn, name)
    if kc is None:
        raise ValueError(f"Unknown key: {key_str}")
    xtest.fake_input(conn, X.KeyRelease, kc)
    conn.flush()
    return {"ok": True}


def type_text(display_str, text, delay_ms=12):
    import os
    cmd = [
        "xdotool", "type",
        "--delay", str(delay_ms),
        "--clearmodifiers",
        "--", text,
    ]
    env = os.environ.copy()
    env["DISPLAY"] = display_str
    subprocess.run(cmd, check=True, timeout=30, env=env)
    return {"ok": True}
