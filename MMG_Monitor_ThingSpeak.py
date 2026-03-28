import serial
import sys
import time
import math
import threading
import requests
import pyqtgraph as pg
from pyqtgraph.Qt import QtWidgets, QtCore

# ================= SERIAL =================
PORT = 'COM7'       # Ganti sesuai port Arduino (cek di Device Manager)
BAUD = 115200

# ── Mode: True = simulasi (tanpa Arduino), False = pakai Arduino ──
SIMULASI_SERIAL = False

if not SIMULASI_SERIAL:
    ser = serial.Serial(PORT, BAUD, timeout=0)
    time.sleep(2)
    ser.reset_input_buffer()
else:
    ser = None
    print("[INFO] Mode simulasi aktif — Arduino tidak diperlukan")

# ================= THINGSPEAK =================
TS_CHANNEL_ID = '3317158'
TS_WRITE_KEY  = 'WC2XYC0KG7764CLD'
TS_URL        = 'https://api.thingspeak.com/update'
# ================= STYLE =================
pg.setConfigOption('background', '#0d1117')
pg.setConfigOption('foreground', 'w')
pg.setConfigOptions(antialias=True)

# ================= APP =================
app = QtWidgets.QApplication(sys.argv)

win = pg.GraphicsLayoutWidget(show=True)
win.setWindowTitle("MMG Monitoring - Mechanomyography")

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
alpha     = 0.05   # semakin kecil semakin halus (0.03–0.07 ideal)
ema_value = 0

start_time = time.time()

# ================= VARIABEL THINGSPEAK =================
last_send_time = [0]      # pakai list agar bisa diubah di dalam fungsi
kontraksi_count = [0]     # jumlah kontraksi terdeteksi
THRESHOLD_KONTRAKSI = 600 # ADC > 600 dianggap kontraksi (sesuaikan)
sedang_kontraksi    = [False]

# ================= FUNGSI KIRIM THINGSPEAK =================
def kirim_antares(amplitude_ema, rms_val, freq_val, grip_pct, fatigue_pct, kontraksi):
    """
    Kirim data MMG ke ThingSpeak.
    Dipanggil di thread terpisah agar tidak mengganggu UI.
    ThingSpeak format: field1..field6 via HTTP GET/POST
    """
    try:
        params = {
            'api_key':  TS_WRITE_KEY,
            'field1':   round(amplitude_ema, 2),   # amplitude (mV)
            'field2':   round(freq_val, 1),         # frequency (Hz)
            'field3':   round(rms_val, 2),           # rms (mV)
            'field4':   round(grip_pct, 1),          # grip_pct (%)
            'field5':   round(fatigue_pct, 1),       # fatigue_pct (%)
            'field6':   kontraksi,                   # jumlah kontraksi
        }
        res = requests.get(TS_URL, params=params, timeout=5)
        # ThingSpeak return entry_id jika sukses (angka > 0)
        status = "OK" if res.text.strip() not in ['0', ''] else f"Error: {res.text}"
        print(f"[ThingSpeak] {status} | Amp={amplitude_ema:.1f} RMS={rms_val:.1f} Grip={grip_pct:.1f}% Fatigue={fatigue_pct:.1f}%")
    except Exception as e:
        print(f"[ThingSpeak] Gagal kirim: {e}")

# ================= HITUNG RMS =================
def hitung_rms(data, n=50):
    """Hitung Root Mean Square dari n sampel terakhir."""
    sampel = data[-n:] if len(data) >= n else data
    if not sampel:
        return 0.0
    return math.sqrt(sum(v ** 2 for v in sampel) / len(sampel))

# ================= HITUNG FREKUENSI DOMINAN (zero-crossing) =================
def hitung_frekuensi(data, time_arr, n=100):
    """
    Estimasi frekuensi dominan sinyal menggunakan zero-crossing.
    Cocok untuk sinyal MMG yang belum diproses FFT.
    """
    if len(data) < n or len(time_arr) < n:
        return 0.0
    sampel   = data[-n:]
    t_sampel = time_arr[-n:]
    mean_val = sum(sampel) / len(sampel)
    crossings = 0
    for i in range(1, len(sampel)):
        if (sampel[i - 1] - mean_val) * (sampel[i] - mean_val) < 0:
            crossings += 1
    durasi = t_sampel[-1] - t_sampel[0]
    if durasi <= 0:
        return 0.0
    frekuensi = (crossings / 2) / durasi  # Hz
    return round(min(frekuensi, 500), 1)  # cap 500 Hz

# ================= NORMALISASI GRIP & FATIGUE =================
def hitung_grip_pct(ema, max_adc=1023):
    """
    Estimasi kekuatan grip sebagai persentase dari nilai ADC maksimum.
    Nanti bisa dikalibrasi dengan nilai grip nyata dari dinamometer.
    """
    return round(min((ema / max_adc) * 100, 100), 1)

def hitung_fatigue_pct(rms_history, window=20):
    """
    Estimasi fatigue: semakin RMS menurun dari awal sesi,
    semakin tinggi fatigue.
    """
    if len(rms_history) < window * 2:
        return 0.0
    rms_awal  = sum(rms_history[:window]) / window
    rms_kini  = sum(rms_history[-window:]) / window
    if rms_awal == 0:
        return 0.0
    penurunan = (rms_awal - rms_kini) / rms_awal * 100
    return round(max(0, min(penurunan, 100)), 1)

# ================= HISTORY RMS (untuk fatigue) =================
rms_history = []

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

    # ── Baca data: dari Arduino atau simulasi ──────────────
    if SIMULASI_SERIAL:
        # Simulasi sinyal MMG realistis tanpa Arduino
        import random, math as _math
        v1 = int(512 + 300 * _math.sin(current_time * 6.28 * 2)
                     + random.uniform(-80, 80))
        v1 = max(0, min(1023, v1))

        ema_value = (alpha * v1) + ((1 - alpha) * ema_value)
        value_filtered.append(ema_value)
        time_data.append(current_time)

        if ema_value > THRESHOLD_KONTRAKSI:
            if not sedang_kontraksi[0]:
                kontraksi_count[0] += 1
                sedang_kontraksi[0]  = True
        else:
            sedang_kontraksi[0] = False

    else:
        while ser.in_waiting:
            raw   = ser.readline().decode(errors='ignore').strip()
            parts = raw.split(",")

            if len(parts) >= 1 and parts[0].isdigit():
                v1 = int(parts[0])

                # EMA FILTER
                ema_value = (alpha * v1) + ((1 - alpha) * ema_value)

                value_filtered.append(ema_value)
                time_data.append(current_time)

                # ── Deteksi kontraksi ──────────────────────────────
                if ema_value > THRESHOLD_KONTRAKSI:
                    if not sedang_kontraksi[0]:
                        kontraksi_count[0] += 1
                        sedang_kontraksi[0]  = True
                else:
                    sedang_kontraksi[0] = False

    # Update grafik
    curve1.setData(time_data, value_filtered)

    # ── Kirim ke ThingSpeak setiap 15 detik ─────────────────────
    now = time.time()
    if now - last_send_time[0] >= 15 and len(value_filtered) > 10:
        last_send_time[0] = now

        # Hitung semua parameter
        rms_val     = hitung_rms(value_filtered, n=50)
        freq_val    = hitung_frekuensi(value_filtered, time_data, n=100)
        grip_pct    = hitung_grip_pct(ema_value)
        rms_history.append(rms_val)
        fatigue_pct = hitung_fatigue_pct(rms_history, window=20)

        # Kirim di thread terpisah (tidak blok UI)
        threading.Thread(
            target=kirim_antares,
            args=(ema_value, rms_val, freq_val,
                  grip_pct, fatigue_pct, kontraksi_count[0]),
            daemon=True
        ).start()

# ================= TIMER =================
timer = QtCore.QTimer()
timer.timeout.connect(update)
timer.start(30)

# ================= EXIT =================
def close_app():
    if ser:
        ser.close()
        print("[Serial] Port ditutup.")
    app.quit()

win.keyPressEvent = lambda event: close_app() if event.text().lower() == 'q' else None

print("=" * 50)
print("  MMG Monitoring → ThingSpeak IoT")
print(f"  Serial   : {PORT} @ {BAUD} baud")
print(f"  Channel  : {TS_CHANNEL_ID}")
print(f"  Interval : 15 detik (ThingSpeak free limit)")
print("  Tekan Q untuk keluar")
print("=" * 50)

sys.exit(app.exec())
