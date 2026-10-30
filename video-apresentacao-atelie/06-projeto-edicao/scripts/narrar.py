# Gera a narração (voz feminina pt-BR "pf_dora", modelo aberto Kokoro, rodando localmente) para cada trecho do roteiro.
# Uso: python3 scripts/narrar.py <pasta-dos-modelos> ; grava narracao/<id>.wav e narracao/duracoes.json
import json, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
modelos = sys.argv[1]
k = Kokoro(f"{modelos}/kokoro-v1.0.onnx", f"{modelos}/voices-v1.0.bin")
rot = json.load(open("roteiro.json"))
dur = {}
for parte in ("completo", "curto"):
    for c in rot[parte]:
        a, sr = k.create(c["texto"], voice="pf_dora", speed=0.95 if parte == "completo" else 1.02, lang="pt-br")
        a = np.concatenate([np.zeros(int(sr * 0.05)), a, np.zeros(int(sr * 0.15))])
        sf.write(f"narracao/{c['id']}.wav", a, sr)
        dur[c["id"]] = round(len(a) / sr, 3)
        print(c["id"], dur[c["id"]])
json.dump(dur, open("narracao/duracoes.json", "w"), indent=1)
print("total completo", round(sum(v for k_, v in dur.items() if k_.startswith("c")), 1), "curto", round(sum(v for k_, v in dur.items() if k_.startswith("v")), 1))
