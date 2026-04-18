"""
KineticLab — Arduino Serial Bridge
------------------------------------
Listens to the FastAPI WebSocket (ws://localhost:8000/ws) and translates
haptic/score messages into serial commands for the Arduino.

Run alongside the FastAPI backend:
    pip install websockets pyserial
    python arduino_bridge.py

The bridge auto-detects the Arduino port. If it fails, set ARDUINO_PORT env var:
    ARDUINO_PORT=/dev/ttyACM0 python arduino_bridge.py   # Linux
    ARDUINO_PORT=COM3 python arduino_bridge.py            # Windows
"""

import asyncio
import json
import os
import sys
import time

import serial
import serial.tools.list_ports
import websockets

WS_URL = os.environ.get("WS_URL", "ws://localhost:8000/ws")
BAUD_RATE = 9600
ARDUINO_PORT = os.environ.get("ARDUINO_PORT", None)


# ── Serial port detection ────────────────────────────────────────────────────

def find_arduino_port() -> str:
    """Auto-detect Arduino by checking common USB-serial descriptors."""
    if ARDUINO_PORT:
        return ARDUINO_PORT

    ports = list(serial.tools.list_ports.comports())
    keywords = ["arduino", "ch340", "ch341", "ftdi", "usbserial", "usbmodem", "acm"]
    for port in ports:
        desc = (port.description or "").lower()
        hwid = (port.hwid or "").lower()
        if any(k in desc or k in hwid for k in keywords):
            print(f"[Bridge] Auto-detected Arduino on {port.device}")
            return port.device

    # Fallback: return first available port
    if ports:
        print(f"[Bridge] No Arduino found by name — trying first port: {ports[0].device}")
        return ports[0].device

    raise RuntimeError(
        "No serial ports found. Connect Arduino and retry, or set ARDUINO_PORT env var."
    )


# ── Serial sender ────────────────────────────────────────────────────────────

class ArduinoBridge:
    def __init__(self, port: str):
        self.port = port
        self.ser = None

    def connect(self):
        self.ser = serial.Serial(self.port, BAUD_RATE, timeout=2)
        time.sleep(2)  # wait for Arduino to reset after serial open
        # drain the READY message
        if self.ser.in_waiting:
            line = self.ser.readline().decode().strip()
            print(f"[Arduino] {line}")

    def send(self, cmd: str):
        """Send a newline-terminated command and print Arduino's ACK."""
        if self.ser is None or not self.ser.is_open:
            print(f"[Bridge] WARNING: serial not open, dropping: {cmd}")
            return
        try:
            self.ser.write((cmd + "\n").encode())
            self.ser.flush()
            # read ACK (non-blocking)
            time.sleep(0.02)
            while self.ser.in_waiting:
                ack = self.ser.readline().decode().strip()
                print(f"[Arduino] {ack}")
        except serial.SerialException as e:
            print(f"[Bridge] Serial error: {e}")

    def close(self):
        if self.ser and self.ser.is_open:
            self.ser.close()


# ── WebSocket listener ───────────────────────────────────────────────────────

async def ws_listener(bridge: ArduinoBridge):
    """
    Connect to FastAPI WebSocket and translate incoming messages to Arduino cmds.

    Message types handled (from SCHEMA.md):
      haptic          → {mode: "buzz"|"vibrate", duration: int}
      fma_score       → {domain_a, domain_c, domain_e, total}
      exercise_event  → {target_hit, accuracy}   (triggers buzz)
      reset           → {}                        (clears LCD)
    """
    print(f"[Bridge] Connecting to WebSocket at {WS_URL} ...")

    while True:
        try:
            async with websockets.connect(WS_URL) as ws:
                print("[Bridge] WebSocket connected.")
                # Send HELLO handshake (matches KineticLabWebSocket._HELLO)
                hello = {
                    "type": "hello",
                    "payload": {"client": "arduino_bridge", "version": "1.0.0"}
                }
                await ws.send(json.dumps(hello))

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type", "")
                    payload = msg.get("payload", {})

                    if msg_type == "haptic":
                        mode = payload.get("mode", "buzz")
                        if mode == "buzz":
                            bridge.send("buzz")
                        elif mode == "vibrate":
                            bridge.send("vibrate")

                    elif msg_type == "fma_score":
                        total = payload.get("total", 0)
                        bridge.send(f"score:{total}")

                    elif msg_type == "exercise_event":
                        # target hit → buzz
                        if payload.get("target_hit"):
                            bridge.send("buzz")

                    elif msg_type == "reset":
                        bridge.send("reset")

                    elif msg_type == "pong":
                        pass  # ignore heartbeats

                    else:
                        pass  # silently ignore unknown types

        except (websockets.exceptions.ConnectionClosed,
                ConnectionRefusedError,
                OSError) as e:
            print(f"[Bridge] WebSocket error: {e}. Retrying in 3s...")
            await asyncio.sleep(3)


# ── Entry point ──────────────────────────────────────────────────────────────

async def main():
    port = find_arduino_port()
    bridge = ArduinoBridge(port)
    try:
        bridge.connect()
        print(f"[Bridge] Arduino connected on {port} at {BAUD_RATE} baud.")
        await ws_listener(bridge)
    finally:
        bridge.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")
