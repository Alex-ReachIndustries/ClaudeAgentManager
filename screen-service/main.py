import os
import sys
import time
import subprocess

from flask import Flask, request, jsonify

from display_manager import dm
import screenshot as ss
import mouse
import keyboard
import window

app = Flask(__name__)
START_TIME = time.time()
DEFAULT_DISPLAY = os.environ.get("SCREEN_DEFAULT_DISPLAY", ":1")
DEFAULT_RESOLUTION = os.environ.get("SCREEN_DEFAULT_RESOLUTION", "1920x1080")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "displays": dm.list_displays(),
        "uptime": int(time.time() - START_TIME),
    })


@app.route("/screenshot", methods=["POST"])
def take_screenshot():
    data = request.get_json(force=True, silent=True) or {}
    display_str = data.get("display", DEFAULT_DISPLAY)
    try:
        conn = dm.get_connection(display_str)
        result = ss.capture(
            conn,
            region=data.get("region"),
            window_id=data.get("window_id"),
            scale=data.get("scale", 0.5),
            fmt=data.get("format", "jpeg"),
            quality=data.get("quality", 75),
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/mouse", methods=["POST"])
def mouse_action():
    data = request.get_json(force=True, silent=True) or {}
    display_str = data.get("display", DEFAULT_DISPLAY)
    action = data.get("action", "click")
    scale = data.get("scale", 0.5)
    x = data.get("x", 0)
    y = data.get("y", 0)

    try:
        conn = dm.get_connection(display_str)
        if action == "click":
            result = mouse.click(conn, x, y, data.get("button", 1), scale, data.get("delay_ms", 50))
        elif action == "double_click":
            result = mouse.double_click(conn, x, y, data.get("button", 1), scale)
        elif action == "right_click":
            result = mouse.right_click(conn, x, y, scale)
        elif action == "middle_click":
            result = mouse.middle_click(conn, x, y, scale)
        elif action == "move":
            result = mouse.move(conn, x, y, scale)
        elif action == "drag":
            result = mouse.drag(
                conn, x, y,
                data.get("end_x", x), data.get("end_y", y),
                data.get("button", 1), scale,
            )
        elif action == "scroll":
            result = mouse.scroll(conn, x, y, data.get("scroll_amount", -3), scale)
        else:
            return jsonify({"error": f"Unknown mouse action: {action}"}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/keyboard", methods=["POST"])
def keyboard_action():
    data = request.get_json(force=True, silent=True) or {}
    display_str = data.get("display", DEFAULT_DISPLAY)
    action = data.get("action", "type")

    try:
        if action == "type":
            text = data.get("text", "")
            result = keyboard.type_text(display_str, text, data.get("delay_ms", 12))
        elif action == "key":
            conn = dm.get_connection(display_str)
            result = keyboard.key_combo(conn, data.get("keys", ""))
        elif action == "keydown":
            conn = dm.get_connection(display_str)
            result = keyboard.key_down(conn, data.get("keys", ""))
        elif action == "keyup":
            conn = dm.get_connection(display_str)
            result = keyboard.key_up(conn, data.get("keys", ""))
        else:
            return jsonify({"error": f"Unknown keyboard action: {action}"}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/window", methods=["POST"])
def window_action():
    data = request.get_json(force=True, silent=True) or {}
    display_str = data.get("display", DEFAULT_DISPLAY)
    action = data.get("action", "list")

    try:
        if action == "list":
            result = window.list_windows(display_str)
        elif action == "find":
            result = window.find_window(display_str, data.get("search", ""))
        elif action == "focus":
            result = window.focus_window(display_str, data["window_id"])
        elif action == "close":
            result = window.close_window(display_str, data["window_id"])
        elif action == "move":
            result = window.move_window(
                display_str, data["window_id"],
                data.get("x", 0), data.get("y", 0),
                data.get("width", -1), data.get("height", -1),
            )
        elif action == "resize":
            result = window.resize_window(
                display_str, data["window_id"],
                data.get("width", 800), data.get("height", 600),
            )
        else:
            return jsonify({"error": f"Unknown window action: {action}"}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/display", methods=["POST"])
def display_action():
    data = request.get_json(force=True, silent=True) or {}
    action = data.get("action", "list")

    try:
        if action == "list":
            return jsonify({"displays": dm.list_displays()})
        elif action == "create":
            display_num = int(data.get("display", ":1").lstrip(":"))
            resolution = data.get("resolution", DEFAULT_RESOLUTION)
            display_type = data.get("type", "xephyr")
            result = dm.create_display(display_num, resolution, display_type)
            return jsonify(result)
        elif action == "destroy":
            display_str = data.get("display", ":1")
            dm.destroy_display(display_str)
            return jsonify({"ok": True, "display": display_str})
        elif action == "status":
            display_str = data.get("display", ":1")
            displays = dm.list_displays()
            if display_str in displays:
                return jsonify(displays[display_str])
            return jsonify({"error": f"Display {display_str} not found"}), 404
        else:
            return jsonify({"error": f"Unknown display action: {action}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/launch", methods=["POST"])
def launch_app():
    data = request.get_json(force=True, silent=True) or {}
    display_str = data.get("display", DEFAULT_DISPLAY)
    command = data.get("command")
    if not command:
        return jsonify({"error": "command is required"}), 400

    args = data.get("args", [])
    cmd = [command] + args

    try:
        env = os.environ.copy()
        env["DISPLAY"] = display_str
        proc = subprocess.Popen(
            cmd, env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if data.get("wait", False):
            proc.wait(timeout=60)
            return jsonify({"pid": proc.pid, "display": display_str, "returncode": proc.returncode})
        return jsonify({"pid": proc.pid, "display": display_str})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def main():
    port = int(os.environ.get("SCREEN_SERVICE_PORT", "3002"))
    print(f"Creating default Xephyr display on {DEFAULT_DISPLAY} at {DEFAULT_RESOLUTION}")
    try:
        display_num = int(DEFAULT_DISPLAY.lstrip(":"))
        dm.create_display(display_num, DEFAULT_RESOLUTION, "xephyr")
        print(f"Xephyr {DEFAULT_DISPLAY} started with openbox")
    except Exception as e:
        print(f"Warning: could not create default display: {e}", file=sys.stderr)

    print(f"Screen service starting on port {port}")
    app.run(host="127.0.0.1", port=port, threaded=True)


if __name__ == "__main__":
    main()
