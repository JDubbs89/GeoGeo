import numpy as np
from scipy.io import wavfile

def generate_sound(lat, lon):
    SR = 44100
    DUR = 2.0  # seconds per loop
    t = np.linspace(0, DUR, int(SR * DUR), endpoint=False)

    # --- Pollutant data (normalized 0=clean, 1=terrible) ---
    EXPECTED = {
        "ch4": (1600, 2200),  # ppb
        "co2": (380, 460),    # ppm
        "no2": (0, 100),      # ppb
    }
    data = {"ch4": 1923.5, "co2": 421.3, "no2": 34.7}
    norm = {g: np.clip((data[g] - EXPECTED[g][0]) / (EXPECTED[g][1] - EXPECTED[g][0]), 0, 1)
            for g in data}
    # e.g. norm = {"ch4": 0.54, "co2": 0.27, "no2": 0.35}

    BASE_FREQ = 220.0  # A3 — pleasant, middle register

    # --- 1. Build the base sine ---
    base = np.sin(2 * np.pi * BASE_FREQ * t)

    # --- 2. Add harmonics (CH₄ controls "edge" / harmonic richness) ---
    # 0 harmonics = pure sine, 20+ harmonics ≈ sawtooth
    n_harm = int(norm["ch4"] * 20)
    for n in range(2, n_harm + 1):
        base += (1 / n) * np.sin(2 * np.pi * BASE_FREQ * n * t)

    # --- 3. Detune & beat (CO₂ controls "wobble" / instability) ---
    # A slight frequency offset creates a slow beating that feels "off"
    detune = 1 + norm["co2"] * 0.02  # up to 2% detune
    wobble = np.sin(2 * np.pi * BASE_FREQ * detune * t)
    base = base * (1 - norm["co2"] * 0.5) + wobble * (norm["co2"] * 0.5)

    # --- 4. Noise injection (NO₂ controls "grit" / broadband harshness) ---
    rng = np.random.default_rng(42)
    noise = rng.standard_normal(len(t))
    # Low-pass the noise so it sounds like "hiss" not "crackle"
    from scipy.signal import butter, filtfilt
    b, a = butter(4, norm["no2"] * 0.7 + 0.05, btype='low', fs=SR)
    noise = filtfilt(b, a, noise)
    base += norm["no2"] * 0.4 * noise

    # --- 5. Amplitude envelope (subtle breathing, faster when "bad") ---
    overall_badness = (norm["ch4"] + norm["co2"] + norm["no2"]) / 3
    breathe_rate = 1 + overall_badness * 3  # cycles per loop
    env = 0.8 + 0.2 * np.sin(2 * np.pi * breathe_rate * t)
    base *= env

    # --- 6. Normalize, crossfade seam, write ---
    base /= np.max(np.abs(base))
    fade = int(SR * 0.02)
    base[-fade:] *= np.linspace(1, 0, fade)
    base[:fade]  *= np.linspace(0, 1, fade)

    wavfile.write("air_warp.wav", SR, (base * 32767).astype(np.int16))   