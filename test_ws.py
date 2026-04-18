import asyncio
import json
import websockets

async def test():
    uri = "ws://localhost:8000/ws"
    async with websockets.connect(uri) as ws:
        print("✅ Connected to /ws")
        await ws.send(json.dumps({"type": "ping", "payload": {}, "timestamp": 0}))
        response = await ws.recv()
        print(f"← Pong: {response}")
        print("⏳ Listening for 15s. Fire the curl broadcast now in another tab.")
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=15.0)
                print(f"📨 BROADCAST: {msg}")
        except asyncio.TimeoutError:
            print("✅ Done")

asyncio.run(test())
