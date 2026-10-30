# Trilha instrumental ORIGINAL (gerada por código, sem amostras de terceiros): piano suave em arpejos, pad quente e baixo.
# Uso: python3 scripts/trilha.py <segundos> <saida.wav>
import sys, numpy as np, soundfile as sf

DUR = float(sys.argv[1]); OUT = sys.argv[2]
SR = 44100; BPM = 84; BEAT = 60 / BPM
rng = np.random.default_rng(7)
n = int(SR * (DUR + 4))
L = np.zeros(n); R = np.zeros(n)

def hz(m): return 440 * 2 ** ((m - 69) / 12)

def piano(m, dur, vel):
    t = np.arange(int(SR * dur)) / SR
    f = hz(m)
    env = np.exp(-t * (2.2 + m / 60)) * (1 - np.exp(-t * 300))
    s = sum(a * np.sin(2 * np.pi * f * k * t * (1 + 0.0004 * k)) for k, a in [(1, 1), (2, .42), (3, .18), (4, .08), (5, .04)])
    return s * env * vel

def pad(ms, dur, vel):
    t = np.arange(int(SR * dur)) / SR
    env = np.minimum(1, t / 1.6) * np.minimum(1, (dur - t) / 1.6).clip(0, 1)
    s = np.zeros_like(t)
    for m in ms:
        for det in (-0.08, 0.0, 0.07):
            f = hz(m + det)
            s += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.15 * t)
    return s * env * lfo * vel / (len(ms) * 3)

def add(buf, x, start, pan=0.0):
    i = int(start * SR); j = min(len(buf[0]), i + len(x))
    if i >= j: return
    buf[0][i:j] += x[: j - i] * (1 - pan) ** 0.5
    buf[1][i:j] += x[: j - i] * (1 + pan) ** 0.5

buf = (L, R)
# Progressão em Fá maior: Fmaj7 - Dm7 - B♭maj7 - C(sus) ; 2 compassos cada
PROG = [([53, 57, 60, 64], 41), ([50, 53, 57, 60], 38), ([46, 50, 53, 57], 34), ([48, 53, 55, 60], 36)]
bar = 4 * BEAT
t = 0.0; c = 0
while t < DUR + 2:
    notas, baixo = PROG[c % 4]
    dur = 2 * bar
    add(buf, pad([x + 12 for x in notas[:3]], dur + 1.2, 0.16), t)
    add(buf, piano(baixo, 3.5, 0.12), t)
    add(buf, piano(baixo, 3.0, 0.08), t + bar)
    # arpejo de colcheias, levemente humanizado
    arp = [notas[0] + 12, notas[1] + 12, notas[2] + 12, notas[3] + 12, notas[2] + 24, notas[3] + 12, notas[1] + 12, notas[2] + 12]
    for b in range(2):
        for i, m in enumerate(arp):
            if c >= 1 or b == 1 or i % 2 == 0:  # começa mais esparso
                vel = 0.10 + 0.05 * (i % 4 == 0) + rng.uniform(-0.015, 0.015)
                add(buf, piano(m, 1.8, vel), t + b * bar + i * BEAT / 2 + rng.uniform(-0.008, 0.008), pan=0.25 * np.sin(i))
    # melodia simples a cada 2 ciclos
    if c % 2 == 1:
        for i, m in enumerate([notas[3] + 24, notas[2] + 24, notas[3] + 24 + 2, notas[2] + 24]):
            add(buf, piano(m, 2.4, 0.07), t + i * BEAT * 1.5 + bar, pan=-0.2)
    t += dur; c += 1

mix_l, mix_r = L, R  # a ambiência (eco/reverberação) é aplicada pelo FFmpeg em seguida
st = np.stack([mix_l, mix_r], 1)[: int(SR * DUR)]
# fade in/out e normalização suave
fi, fo = int(SR * 2.0), int(SR * 4.0)
st[:fi] *= np.linspace(0, 1, fi)[:, None]
st[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
st = np.tanh(st / (np.abs(st).max() + 1e-9) * 1.2) * 0.7
sf.write(OUT + '.seco.wav', st.astype(np.float32), SR)
import subprocess
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', OUT + '.seco.wav', '-af', 'highpass=f=80,aecho=0.85:0.6:70|140|230:0.28|0.18|0.1,lowpass=f=9500,loudnorm=I=-20:TP=-3:LRA=7', '-ar', '44100', OUT], check=True)
import os; os.remove(OUT + '.seco.wav')
print(OUT, round(len(st) / SR, 1), 's')
