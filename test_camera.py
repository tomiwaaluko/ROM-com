import cv2
print("Testing cameras...")
for i in range(3):
    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    if cap.isOpened():
        ret, frame = cap.read()
        print(f"  Camera {i}: OK ({frame.shape if ret else 'no frame'})")
        cap.release()
    else:
        print(f"  Camera {i}: NOT available")
print("Done.")
