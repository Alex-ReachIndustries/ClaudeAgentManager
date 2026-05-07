import base64
import io

from Xlib import X
from PIL import Image

from coords import scaled_to_native


def capture(conn, region=None, window_id=None, scale=0.5, fmt="jpeg", quality=75):
    screen = conn.screen()

    if window_id:
        win = conn.create_resource_object("window", int(window_id, 16))
    else:
        win = screen.root

    geo = win.get_geometry()
    native_w, native_h = geo.width, geo.height

    if region:
        rx, ry, rw, rh = region
        nx, ny = scaled_to_native(rx, ry, scale)
        nw = int(rw / scale)
        nh = int(rh / scale)
        nx = max(0, min(nx, native_w - 1))
        ny = max(0, min(ny, native_h - 1))
        nw = min(nw, native_w - nx)
        nh = min(nh, native_h - ny)
    else:
        nx, ny = 0, 0
        nw, nh = native_w, native_h

    raw = win.get_image(nx, ny, nw, nh, X.ZPixmap, 0xFFFFFFFF)
    image = Image.frombytes("RGB", (nw, nh), raw.data, "raw", "BGRX")

    scaled_w = max(1, int(nw * scale))
    scaled_h = max(1, int(nh * scale))
    if scale < 1.0:
        image = image.resize((scaled_w, scaled_h), Image.LANCZOS)

    buf = io.BytesIO()
    if fmt == "png":
        image.save(buf, "PNG")
    else:
        image.save(buf, "JPEG", quality=quality)

    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {
        "image": b64,
        "coord_size": [scaled_w, scaled_h],
        "native_size": [native_w, native_h],
        "scale": scale,
        "format": fmt,
    }
