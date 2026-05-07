import time

from Xlib import X
from Xlib.ext import xtest

from coords import scaled_to_native


def _move(conn, x, y):
    xtest.fake_input(conn, X.MotionNotify, x=x, y=y)
    conn.flush()


def _press(conn, button):
    xtest.fake_input(conn, X.ButtonPress, button)
    conn.flush()


def _release(conn, button):
    xtest.fake_input(conn, X.ButtonRelease, button)
    conn.flush()


def move(conn, x, y, scale=1.0):
    nx, ny = scaled_to_native(x, y, scale)
    _move(conn, nx, ny)
    return {"ok": True, "native_position": [nx, ny]}


def click(conn, x, y, button=1, scale=1.0, delay_ms=50):
    nx, ny = scaled_to_native(x, y, scale)
    _move(conn, nx, ny)
    time.sleep(0.01)
    _press(conn, button)
    time.sleep(delay_ms / 1000.0)
    _release(conn, button)
    return {"ok": True, "native_position": [nx, ny]}


def double_click(conn, x, y, button=1, scale=1.0):
    nx, ny = scaled_to_native(x, y, scale)
    _move(conn, nx, ny)
    for _ in range(2):
        time.sleep(0.01)
        _press(conn, button)
        time.sleep(0.03)
        _release(conn, button)
        time.sleep(0.1)
    return {"ok": True, "native_position": [nx, ny]}


def right_click(conn, x, y, scale=1.0):
    return click(conn, x, y, button=3, scale=scale)


def middle_click(conn, x, y, scale=1.0):
    return click(conn, x, y, button=2, scale=scale)


def drag(conn, x, y, end_x, end_y, button=1, scale=1.0, steps=20):
    nx, ny = scaled_to_native(x, y, scale)
    nex, ney = scaled_to_native(end_x, end_y, scale)
    _move(conn, nx, ny)
    time.sleep(0.05)
    _press(conn, button)
    for i in range(1, steps + 1):
        ix = nx + (nex - nx) * i // steps
        iy = ny + (ney - ny) * i // steps
        _move(conn, ix, iy)
        time.sleep(0.01)
    time.sleep(0.05)
    _release(conn, button)
    return {"ok": True, "native_position": [nex, ney]}


def scroll(conn, x, y, amount, scale=1.0):
    nx, ny = scaled_to_native(x, y, scale)
    _move(conn, nx, ny)
    button = 4 if amount > 0 else 5
    for _ in range(abs(amount)):
        time.sleep(0.02)
        _press(conn, button)
        time.sleep(0.02)
        _release(conn, button)
    return {"ok": True, "native_position": [nx, ny]}
