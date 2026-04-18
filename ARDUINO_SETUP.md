# KineticLab — Arduino Wiring & Setup Guide

## What you need (from your kit)
- Arduino (Uno or compatible) + USB cable
- Grove Base Shield (plug it onto the Arduino)
- Grove Buzzer → D6
- Grove LED Socket Kit → D3  (put your green LED in it)
- Grove Vibration motor → D8  (if available)
- Grove LCD RGB Backlight V4.0 → any I2C port

## Wiring (with Grove Base Shield — takes 2 minutes)
Just plug the Grove cables straight in:

| Component          | Grove Base Shield Port |
|--------------------|------------------------|
| Grove Buzzer       | D6                     |
| Grove LED Socket   | D3                     |
| Grove Vibration    | D8                     |
| Grove LCD RGB      | I2C (any of the 3)     |

No breadboard needed when using the Grove shield.

## If using bare LED + breadboard (no Grove shield)
- LED long leg (anode) → 1.2kΩ resistor → Arduino D3
- LED short leg (cathode) → Arduino GND
- The 1.2kΩ resistors in your kit are exactly right for this.

## Arduino IDE setup
1. Open Arduino IDE
2. Install library: Tools → Manage Libraries → search "Grove LCD RGB" → install
   "Grove - LCD RGB Backlight" by Seeed Studio
3. Open kineticlab_haptics/kineticlab_haptics.ino
4. Select board: Tools → Board → Arduino Uno
5. Select port: Tools → Port → (your Arduino port)
6. Upload (Ctrl+U)
7. Open Serial Monitor at 9600 baud — you should see "READY"

## Python bridge setup
```bash
pip install websockets pyserial
python arduino_bridge.py
```

The bridge auto-detects your Arduino port. If it fails:
```bash
# Mac/Linux:
ARDUINO_PORT=/dev/tty.usbmodem14101 python arduino_bridge.py

# Windows:
ARDUINO_PORT=COM3 python arduino_bridge.py
```

## Quick smoke test (without the full backend)
Open Arduino Serial Monitor (9600 baud), type these and hit Send:
- `buzz`     → LED flashes + buzzer chirps
- `vibrate`  → vibration pulse
- `score:47` → LCD shows "FMA-UE: 47/52" in orange
- `score:52` → LCD turns green  
- `reset`    → clears everything

## What each event triggers in-game
| Game event         | Arduino response                    |
|--------------------|-------------------------------------|
| Target hit         | buzz + LED flash (120ms)            |
| Path complete      | vibrate (200ms)                     |
| FMA-UE score update| LCD updates + colour changes + flash|
| Session reset      | All off, LCD resets                 |

## LCD colour coding
- Red   → FMA-UE 0–19   (severe)
- Orange→ FMA-UE 20–47  (moderate)  
- Green → FMA-UE 48–52  (mild — your target demo score)

## Demo tip
During the pitch, the LCD showing "FMA-UE: 47/52" in orange
then ticking up to "52/52" in green is your physical wow moment.
Point to it when you say "the system generates a Fugl-Meyer score
after every session."
