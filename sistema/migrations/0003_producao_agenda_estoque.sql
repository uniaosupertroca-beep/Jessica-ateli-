-- Fases 2 a 4: produção (Kanban e tempos), agenda com provas e capacidade por horas,
-- estoque de materiais, fornecedores, compras e contas a pagar.

-- ---------------------------------------------------------------------------
-- Profissionais: capacidade de produção por dia (minutos) e dias de trabalho
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN capacidade_min_dia INTEGER NOT NULL DEFAULT 0 CHECK (capacidade_min_dia >= 0 AND capacidade_min_dia <= 1440);
ALTER TABLE users ADD COLUMN dias_trabalho TEXT NOT NULL DEFAULT '12345';  -- dias da semana (0 = domingo)

-- Precificação e agenda
ALTER TABLE system_settings ADD COLUMN custo_hora_centavos INTEGER NOT NULL DEFAULT 0 CHECK (custo_hora_centavos >= 0);
ALTER TABLE system_settings ADD COLUMN despesas_indiretas_pct REAL NOT NULL DEFAULT 0 CHECK (despesas_indiretas_pct >= 0 AND despesas_indiretas_pct <= 500);
ALTER TABLE system_settings ADD COLUMN margem_pct REAL NOT NULL DEFAULT 0 CHECK (margem_pct >= 0 AND margem_pct <= 1000);
ALTER TABLE system_settings ADD COLUMN capacidade_provas_dia INTEGER NOT NULL DEFAULT 8 CHECK (capacidade_provas_dia >= 1);
ALTER TABLE system_settings ADD COLUMN horario_inicio TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE system_settings ADD COLUMN horario_fim TEXT NOT NULL DEFAULT '18:00';

-- ---------------------------------------------------------------------------
-- Produção: tempos e eventos por peça
-- ---------------------------------------------------------------------------
ALTER TABLE order_items ADD COLUMN iniciado_em TEXT;          -- início da execução atual (para somar o tempo real)
ALTER TABLE order_items ADD COLUMN finalizado_em TEXT;
ALTER TABLE order_items ADD COLUMN tempo_real_min INTEGER NOT NULL DEFAULT 0 CHECK (tempo_real_min >= 0);
ALTER TABLE order_items ADD COLUMN retrabalhos INTEGER NOT NULL DEFAULT 0 CHECK (retrabalhos >= 0);
ALTER TABLE order_items ADD COLUMN urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0,1));
ALTER TABLE order_items ADD COLUMN obs_interna TEXT NOT NULL DEFAULT '';

CREATE TABLE production_events (
  id        TEXT PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders(id),
  item_id   TEXT REFERENCES order_items(id),
  tipo      TEXT NOT NULL CHECK (tipo IN ('inicio','pausa','fim','retrabalho','atribuicao','observacao','tempo','urgencia')),
  minutos   INTEGER,
  texto     TEXT NOT NULL DEFAULT '',
  user_id   TEXT REFERENCES users(id),
  em        TEXT NOT NULL
);
CREATE INDEX idx_pe_item ON production_events(item_id, em);
CREATE INDEX idx_pe_em ON production_events(em);

-- ---------------------------------------------------------------------------
-- Agenda: provas, entregas, retiradas, recebimentos, atendimentos, prazos e ausências
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
  id               TEXT PRIMARY KEY,
  tipo             TEXT NOT NULL CHECK (tipo IN ('prova','entrega','retirada','recebimento','atendimento','prazo_producao','ausencia')),
  titulo           TEXT NOT NULL,
  dia              TEXT NOT NULL,           -- AAAA-MM-DD (São Paulo)
  hora_inicio      TEXT,                    -- HH:MM; vazio = o dia todo
  hora_fim         TEXT,
  client_id        TEXT REFERENCES clients(id),
  order_id         TEXT REFERENCES orders(id),
  item_id          TEXT REFERENCES order_items(id),
  profissional_id  TEXT REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','realizado','cancelado','faltou')),
  observacoes      TEXT NOT NULL DEFAULT '',
  excecao          TEXT,                    -- justificativa quando passa da capacidade ou conflita
  criado_em        TEXT NOT NULL,
  criado_por       TEXT REFERENCES users(id),
  atualizado_em    TEXT,
  CHECK (hora_fim IS NULL OR hora_inicio IS NULL OR hora_fim > hora_inicio),
  CHECK (tipo <> 'ausencia' OR profissional_id IS NOT NULL)
);
CREATE INDEX idx_ap_dia ON appointments(dia, status);
CREATE INDEX idx_ap_order ON appointments(order_id);
CREATE INDEX idx_ap_prof ON appointments(profissional_id, dia);

-- ---------------------------------------------------------------------------
-- Estoque
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefone    TEXT,
  email       TEXT,
  documento   TEXT,
  observacoes TEXT NOT NULL DEFAULT '',
  ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em   TEXT NOT NULL
);

CREATE TABLE materials (
  id                    TEXT PRIMARY KEY,
  codigo                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome                  TEXT NOT NULL,
  categoria             TEXT NOT NULL CHECK (categoria IN ('tecido','linha','ziper','botao','elastico','entretela','agulha','aviamento','outro')),
  unidade               TEXT NOT NULL CHECK (unidade IN ('un','m','cm','pct','rolo','kg','g','cx')),
  quantidade            REAL NOT NULL DEFAULT 0,      -- mantida pelas movimentações (trigger)
  estoque_minimo        REAL NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  custo_medio_centavos  REAL NOT NULL DEFAULT 0 CHECK (custo_medio_centavos >= 0),  -- por unidade
  supplier_id           TEXT REFERENCES suppliers(id),
  localizacao           TEXT NOT NULL DEFAULT '',
  ativo                 INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em             TEXT NOT NULL,
  atualizado_em         TEXT
);
CREATE INDEX idx_mat_nome ON materials(nome COLLATE NOCASE);

CREATE TABLE purchases (
  id              TEXT PRIMARY KEY,
  supplier_id     TEXT REFERENCES suppliers(id),
  data            TEXT NOT NULL,
  documento       TEXT NOT NULL DEFAULT '',   -- nota fiscal / recibo
  total_centavos  INTEGER NOT NULL CHECK (total_centavos >= 0),
  criado_em       TEXT NOT NULL,
  criado_por      TEXT REFERENCES users(id)
);

CREATE TABLE stock_movements (
  id                      TEXT PRIMARY KEY,
  material_id             TEXT NOT NULL REFERENCES materials(id),
  tipo                    TEXT NOT NULL CHECK (tipo IN ('compra','consumo','devolucao','perda','ajuste','reversao')),
  quantidade              REAL NOT NULL CHECK (quantidade <> 0),   -- + entra, − sai
  custo_unitario_centavos REAL NOT NULL DEFAULT 0 CHECK (custo_unitario_centavos >= 0),
  order_id                TEXT REFERENCES orders(id),
  item_id                 TEXT REFERENCES order_items(id),
  purchase_id             TEXT REFERENCES purchases(id),
  reverte_de              TEXT UNIQUE REFERENCES stock_movements(id),  -- uma movimentação só é revertida uma vez
  motivo                  TEXT NOT NULL DEFAULT '',
  autorizado_negativo     INTEGER NOT NULL DEFAULT 0 CHECK (autorizado_negativo IN (0,1)),
  idempotency_key         TEXT UNIQUE,
  criado_em               TEXT NOT NULL,
  criado_por              TEXT REFERENCES users(id),
  CHECK (tipo <> 'consumo' OR (quantidade < 0 AND order_id IS NOT NULL)),
  CHECK (tipo <> 'compra' OR quantidade > 0),
  CHECK (tipo <> 'perda' OR quantidade < 0),
  CHECK (tipo <> 'reversao' OR reverte_de IS NOT NULL)
);
CREATE INDEX idx_sm_mat ON stock_movements(material_id, criado_em);
CREATE INDEX idx_sm_order ON stock_movements(order_id);

-- Saldo nunca fica negativo, a não ser com autorização explícita.
CREATE TRIGGER sm_sem_negativo BEFORE INSERT ON stock_movements
WHEN NEW.autorizado_negativo = 0
 AND ROUND((SELECT quantidade FROM materials WHERE id = NEW.material_id) + NEW.quantidade, 3) < 0
BEGIN SELECT RAISE(ABORT, 'estoque_insuficiente'); END;

-- Reversão: quantidade oposta, mesmo material, e não se reverte uma reversão.
CREATE TRIGGER sm_reversao_valida BEFORE INSERT ON stock_movements
WHEN NEW.reverte_de IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM stock_movements o WHERE o.id = NEW.reverte_de AND o.tipo <> 'reversao'
     AND o.material_id = NEW.material_id AND ROUND(o.quantidade + NEW.quantidade, 3) = 0)
BEGIN SELECT RAISE(ABORT, 'reversao_invalida'); END;

-- Atualiza saldo e custo médio (média ponderada nas entradas com custo).
CREATE TRIGGER sm_atualiza_saldo AFTER INSERT ON stock_movements
BEGIN
  UPDATE materials SET
    custo_medio_centavos = CASE
      WHEN NEW.quantidade > 0 AND NEW.custo_unitario_centavos > 0 AND NEW.tipo IN ('compra','ajuste','devolucao')
        THEN ROUND(((MAX(quantidade, 0) * custo_medio_centavos) + (NEW.quantidade * NEW.custo_unitario_centavos)) / (MAX(quantidade, 0) + NEW.quantidade), 4)
      ELSE custo_medio_centavos END,
    quantidade = ROUND(quantidade + NEW.quantidade, 3),
    atualizado_em = NEW.criado_em
  WHERE id = NEW.material_id;
END;

CREATE TRIGGER sm_sem_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'movimento_imutavel'); END;
CREATE TRIGGER sm_sem_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'movimento_imutavel'); END;
-- O saldo só muda pelas movimentações: tem de ser sempre igual à soma delas.
CREATE TRIGGER mat_saldo_protegido BEFORE UPDATE OF quantidade ON materials
WHEN ROUND(NEW.quantidade, 3) <> ROUND((SELECT COALESCE(SUM(quantidade), 0) FROM stock_movements WHERE material_id = NEW.id), 3)
BEGIN SELECT RAISE(ABORT, 'saldo_protegido'); END;
CREATE TRIGGER mat_sem_delete BEFORE DELETE ON materials BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;

-- ---------------------------------------------------------------------------
-- Contas a pagar
-- ---------------------------------------------------------------------------
CREATE TABLE payables (
  id               TEXT PRIMARY KEY,
  descricao        TEXT NOT NULL,
  categoria_id     TEXT NOT NULL REFERENCES finance_categories(id),
  supplier_id      TEXT REFERENCES suppliers(id),
  purchase_id      TEXT REFERENCES purchases(id),
  valor_centavos   INTEGER NOT NULL CHECK (valor_centavos > 0),
  vencimento       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
  paga_em          TEXT,
  motivo_cancelamento TEXT,
  observacoes      TEXT NOT NULL DEFAULT '',
  criado_em        TEXT NOT NULL,
  criado_por       TEXT REFERENCES users(id)
);
CREATE INDEX idx_pay_venc ON payables(status, vencimento);
CREATE TRIGGER pay_sem_delete BEFORE DELETE ON payables BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;

ALTER TABLE cash_movements ADD COLUMN payable_id TEXT REFERENCES payables(id);

-- Guarda usada ao pagar: a conta precisa estar aberta.
CREATE TRIGGER guard_conta_nao_aberta BEFORE INSERT ON guards WHEN NEW.motivo = 'conta_nao_aberta'
BEGIN SELECT RAISE(ABORT, 'conta_nao_aberta'); END;
DROP TRIGGER guard_generico;
CREATE TRIGGER guard_generico BEFORE INSERT ON guards
WHEN NEW.motivo NOT IN ('total_menor_que_pago','versao_desatualizada','os_bloqueada','os_com_pagamento','saldo_mudou','conta_nao_aberta')
BEGIN SELECT RAISE(ABORT, 'guarda'); END;

-- Novo modelo de mensagem: lembrete de prova.
-- (message_logs.modelo é texto livre validado pela API; nada a alterar no banco)
