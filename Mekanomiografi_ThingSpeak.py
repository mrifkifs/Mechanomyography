import serial
import sys
import time
import requests
import threading
import pyqtgraph as pg
from pyqtgraph.Qt import QtWidgets, QtCore

# ================= SERIAL =================
PORT = 'COM7'    # Ganti sesuai port Arduino di Device Manager
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=0)
time.sleep(2)
ser.reset_input_buffer()

# ================= THINGSPEAK =================
TS_WRITE_KEY = 'WC2XYC0KG7764CLD'
TS_URL       = 'https://api.thingspeak.com/update'

# ================= STYLE =================
pg.setConfigOption('background', '#0d1117')
pg.setConfigOption('foreground', 'w')
pg.setConfigOptions(antialias=True)

# ================= APP =================
app = QtWidgets.QApplication(sys.argv)

win = pg.GraphicsLayoutWidget(show=True)
win.setWindowTitle("MMG Monitoring - Smooth Signal")

# ================= PLOT =================
plot1 = win.addPlot(title="MMG Sensor 1")
plot1.setLabel('left', 'Amplitude (ADC)')
plot1.setLabel('bottom', 'Time (seconds)')
plot1.setYRange(0, 1023)
plot1.setXRange(0, 10)
plot1.showGrid(x=True, y=True, alpha=0.3)

curve1 = plot1.plot(pen=pg.mkPen(color='#00ffcc', width=3))

# ================= DATA =================
time_data      = []
value_filtered = []

# ================= EMA FILTER =================
alpha     = 0.05
ema_value = 0

start_time     = time.time()
last_send_time = [0]

# ================= KIRIM THINGSPEAK =================
def kirim_thingspeak(amplitude):
    """Kirim amplitude ke ThingSpeak field1. Di thread terpisah."""
    try:
        res = requests.get(TS_URL, params={
            'api_key': TS_WRITE_KEY,
            'field1':  round(amplitude, 2),
        }, timeout=5)
        status = "OK" if res.text.strip() not in ['0', ''] else "Gagal"
        print(f"[ThingSpeak] {status} | Amplitude={amplitude:.2f}")
    except Exception as e:
        print(f"[ThingSpeak] Error: {e}")

# ================= UPDATE =================
def update():
    global start_time, ema_value

    current_time = time.time() - start_time

    # RESET setiap 10 detik
    if current_time >= 10:
        start_time = time.time()
        time_data.clear()
        value_filtered.clear()
        return

    while ser.in_waiting:
        raw   = ser.readline().decode(errors='ignore').strip()
        parts = raw.split(",")

        if len(parts) >= 1 and parts[0].isdigit():
            v1 = int(parts[0])

            # EMA FILTER
            ema_value = (alpha * v1) + ((1 - alpha) * ema_value)

            value_filtered.append(ema_value)
            time_data.append(current_time)

    curve1.setData(time_data, value_filtered)

    # Kirim ke ThingSpeak setiap 15 detik
    now = time.time()
    if now - last_send_time[0] >= 15 and len(value_filtered) > 0:
        last_send_time[0] = now
        threading.Thread(
            target=kirim_thingspeak,
            args=(ema_value,),
            daemon=True
        ).start()

# ================= TIMER =================
timer = QtCore.QTimer()
timer.timeout.connect(update)
timer.start(30)

# ================= EXIT =================
def close_app():
    ser.close()
    print("[Serial] Port ditutup.")
    app.quit()

win.keyPressEvent = lambda event: close_app() if event.text().lower() == 'q' else None

print("=" * 50)
print("  MMG Monitoring → ThingSpeak")
print(f"  Serial  : {PORT} @ {BAUD} baud")
print(f"  Channel : 3317158 | Field: amplitude")
print(f"  Interval: 15 detik")
print("  Tekan Q untuk keluar")
print("=" * 50)

sys.exit(app.exec())
