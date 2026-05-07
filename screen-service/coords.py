def scaled_to_native(x, y, scale):
    if scale <= 0 or scale > 1:
        scale = 1.0
    return int(x / scale), int(y / scale)


def native_to_scaled(x, y, scale):
    if scale <= 0 or scale > 1:
        scale = 1.0
    return int(x * scale), int(y * scale)
