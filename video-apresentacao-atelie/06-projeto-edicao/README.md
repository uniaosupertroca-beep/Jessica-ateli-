# Projeto de edição — vídeos do Ateliê Jessica

Tudo o que é preciso para refazer ou atualizar os vídeos quando o sistema mudar.
Nada aqui altera o sistema: os vídeos gravam as telas **reais** do app rodando num **servidor local isolado**
(mesmo código da homologação), com um banco próprio cheio de **dados fictícios**.

## O que tem aqui

| Pasta/arquivo | Para que serve |
|---|---|
| `roteiro.json` | Textos da narração, títulos de cada cena (vídeo completo e comercial curto) |
| `narracao/` | Falas geradas (WAV, uma por cena) e `duracoes.json` |
| `trilha/` | Trilha instrumental **original**, gerada por código (`scripts/trilha.py`, sempre igual) — sem direitos de terceiros. Os WAV não vão para o git: gere com o passo 3 |
| `fontes/` | Bricolage Grotesque e Figtree (licença OFL, as mesmas do app) |
| `cenas/` | Páginas animadas da marca: abertura, encerramento, computador + celular (HTML/CSS) |
| `scripts/seed-demo.mjs` | Cria o ateliê de demonstração (clientes, OS, estoque, agenda, financeiro) pela API do sistema |
| `scripts/datar-historico.mjs` | Espalha o histórico fictício pelos últimos 6 meses (para os gráficos) |
| `scripts/marca-demo.mjs` | Coloca o ícone do app como logo dos documentos da demonstração |
| `scripts/gravador.cjs` | Gravador (Playwright + captura de quadros do Chromium), cursor e zoom suave |
| `scripts/gravar-completo.cjs` | Roteiro de gravação do vídeo horizontal (10 cenas) |
| `scripts/gravar-curto.cjs` | Roteiro de gravação do comercial vertical (6 cenas, layout de celular) |
| `scripts/legendas.mjs` | Legendas `.srt` e títulos/legendas estilizados `.ass` |
| `scripts/montar.mjs` | Montagem final com FFmpeg (transições, voz, trilha com abaixamento automático, legendas) |
| `scripts/narrar.py` | Narração com voz feminina pt-BR (modelo aberto Kokoro, voz `pf_dora`, roda localmente) |

## Como refazer

Pré-requisitos: Node 20+, Python 3 com `kokoro-onnx soundfile numpy`, FFmpeg com libass, Playwright (Chromium).

```bash
cd video-apresentacao-atelie/06-projeto-edicao
TRAB=/tmp/video   # pasta de trabalho (quadros e clipes; não vai para o git)

# 1. ambiente de demonstração isolado (porta 8791) + dados fictícios
scripts/demo-do-zero.sh $TRAB/demo-db $TRAB/demo.log

# 2. narração (baixe kokoro-v1.0.onnx e voices-v1.0.bin de github.com/thewh1teagle/kokoro-onnx/releases)
python3 scripts/narrar.py <pasta-dos-modelos>

# 3. trilha original
python3 scripts/trilha.py 190 trilha/trilha-completa.wav && python3 scripts/trilha.py 64 trilha/trilha-curta.wav

# 4. gravação das telas (pode refazer só uma cena: ... c04)
node scripts/gravar-completo.cjs $TRAB
node scripts/gravar-curto.cjs $TRAB

# 5. montagem
node scripts/montar.mjs completo $TRAB ../01-apresentacao-completa.mp4
node scripts/montar.mjs curto $TRAB ../02-comercial-whatsapp.mp4
```

Para mudar uma fala: edite `roteiro.json`, rode o passo 2 e o passo 5. Para mudar o que aparece numa tela: edite a cena em
`gravar-completo.cjs`/`gravar-curto.cjs` e regrave só ela (`node scripts/gravar-completo.cjs $TRAB c05`).

## Notas técnicas

- Gravação em 1440×810 pontos com escala 4/3 (sai em 1920×1080 nítido); celular em 405×720 com escala 8/3 (1080×1920).
- Navegador em pt-BR (`--lang=pt-BR`), para os campos de data aparecerem em DD/MM/AAAA.
- A proteção contra excesso de requisições do sistema (600/min) vale também para a carga da demonstração; o script espera e tenta de novo.
- Algumas cenas são levemente aceleradas na montagem (10% a 30%, ver `VELOCIDADE` em `montar.mjs`).
- Música ~9 dB abaixo da voz e abaixa sozinha quando a narradora fala; volume final normalizado (~-16 LUFS).

## Regras seguidas

- Só telas e funções que existem e funcionam no sistema; nada simulado.
- Dados fictícios, num banco local separado — homologação e produção não são tocadas.
- O WhatsApp aparece abrindo a mensagem pronta para conferir (o sistema **não** envia sozinho).
- Sem QR Code (foi removido do sistema a pedido da Jessica).
- Um aviso discreto "Demonstração com dados fictícios" aparece nas telas do sistema.
