-- Várias unidades (filiais) no mesmo sistema.
-- Os dados que já existem passam a pertencer à "Matriz"; nada é apagado.
-- Compartilhado entre as unidades: clientes, medidas, catálogo de serviços, materiais (cadastro), configurações.
-- Separado por unidade: OS, caixa, lançamentos, saldo de estoque, agenda, contas a pagar (ou "grupo"), equipe.
PRAGMA defer_foreign_keys = true;

CREATE TABLE units (
  id                    TEXT PRIMARY KEY,
  nome                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sigla                 TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(sigla) BETWEEN 2 AND 5),
  endereco              TEXT NOT NULL DEFAULT '',
  telefone              TEXT NOT NULL DEFAULT '',
  documento             TEXT NOT NULL DEFAULT '',
  capacidade_diaria     INTEGER NOT NULL DEFAULT 6 CHECK (capacidade_diaria >= 1),
  limite_quase_cheio    INTEGER NOT NULL DEFAULT 5 CHECK (limite_quase_cheio >= 1),
  capacidade_provas_dia INTEGER NOT NULL DEFAULT 8 CHECK (capacidade_provas_dia >= 1),
  horario_inicio        TEXT NOT NULL DEFAULT '09:00',
  horario_fim           TEXT NOT NULL DEFAULT '18:00',
  ativo                 INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em             TEXT NOT NULL,
  atualizado_em         TEXT
);
INSERT INTO units (id, nome, sigla, endereco, telefone, documento, capacidade_diaria, limite_quase_cheio, capacidade_provas_dia, horario_inicio, horario_fim, criado_em)
  SELECT 'u-matriz', 'Matriz', 'MAT', endereco, telefone, documento, capacidade_diaria, limite_quase_cheio, capacidade_provas_dia, horario_inicio, horario_fim,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM system_settings WHERE id = 1;
CREATE TRIGGER units_sem_delete BEFORE DELETE ON units BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;

-- Em quais unidades cada pessoa trabalha (a administradora vê todas).
CREATE TABLE user_units (
  user_id TEXT NOT NULL REFERENCES users(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  PRIMARY KEY (user_id, unit_id)
);
INSERT INTO user_units (user_id, unit_id) SELECT id, 'u-matriz' FROM users;

-- Unidade de cada registro (colunas novas valem "Matriz" para o que já existe).
ALTER TABLE orders ADD COLUMN unit_id TEXT NOT NULL DEFAULT 'u-matriz';
CREATE INDEX idx_orders_unit ON orders(unit_id, status, prazo);
ALTER TABLE appointments ADD COLUMN unit_id TEXT NOT NULL DEFAULT 'u-matriz';
CREATE INDEX idx_ap_unit ON appointments(unit_id, dia);
ALTER TABLE payables ADD COLUMN unit_id TEXT DEFAULT 'u-matriz';   -- NULL = despesa do grupo
ALTER TABLE purchases ADD COLUMN unit_id TEXT NOT NULL DEFAULT 'u-matriz';
ALTER TABLE cash_movements ADD COLUMN unit_id TEXT NOT NULL DEFAULT 'u-matriz';
CREATE INDEX idx_cm_unit ON cash_movements(unit_id, data);

-- Gatilhos que apontam para as tabelas recriadas saem antes e voltam depois.
DROP TRIGGER cm_caixa_aberto;
DROP TRIGGER mat_saldo_protegido;

-- Caixa: um por unidade por dia (a tabela é recriada para trocar a regra "um caixa por dia").
CREATE TABLE cash_sessions_nova (
  id                     TEXT PRIMARY KEY,
  data                   TEXT NOT NULL,
  unit_id                TEXT NOT NULL DEFAULT 'u-matriz' REFERENCES units(id),
  saldo_inicial_centavos INTEGER NOT NULL CHECK (saldo_inicial_centavos >= 0),
  aberto_em              TEXT NOT NULL,
  aberto_por             TEXT REFERENCES users(id),
  fechado_em             TEXT,
  fechado_por            TEXT REFERENCES users(id),
  contado_centavos       INTEGER CHECK (contado_centavos >= 0),
  reaberto_em            TEXT,
  reaberto_por           TEXT REFERENCES users(id),
  observacoes            TEXT NOT NULL DEFAULT '',
  UNIQUE (data, unit_id)
);
INSERT INTO cash_sessions_nova (id, data, unit_id, saldo_inicial_centavos, aberto_em, aberto_por, fechado_em, fechado_por, contado_centavos, reaberto_em, reaberto_por, observacoes)
  SELECT id, data, 'u-matriz', saldo_inicial_centavos, aberto_em, aberto_por, fechado_em, fechado_por, contado_centavos, reaberto_em, reaberto_por, observacoes FROM cash_sessions;
DROP TABLE cash_sessions;
ALTER TABLE cash_sessions_nova RENAME TO cash_sessions;
CREATE TRIGGER caixa_fechado_imutavel BEFORE UPDATE ON cash_sessions
WHEN OLD.fechado_em IS NOT NULL AND NEW.fechado_em IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'caixa_fechado'); END;
CREATE TRIGGER caixa_sem_delete BEFORE DELETE ON cash_sessions
BEGIN SELECT RAISE(ABORT, 'caixa_imutavel'); END;

-- Lançamento só em caixa aberto DA UNIDADE; a unidade do lançamento também é imutável.
CREATE TRIGGER cm_caixa_aberto BEFORE INSERT ON cash_movements
WHEN NOT EXISTS (SELECT 1 FROM cash_sessions WHERE data = NEW.data AND unit_id = NEW.unit_id AND fechado_em IS NULL)
BEGIN SELECT RAISE(ABORT, 'caixa_fechado'); END;
DROP TRIGGER cm_sem_update;
CREATE TRIGGER cm_sem_update BEFORE UPDATE OF data, tipo, natureza, valor_centavos, forma_id, categoria_id,
  order_id, client_id, estorno_de, idempotency_key, criado_em, criado_por, unit_id, payable_id ON cash_movements
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;

-- Estoque: saldo por unidade e transferência entre unidades (a tabela é recriada para o novo tipo de movimento).
CREATE TABLE stock_movements_nova (
  id                      TEXT PRIMARY KEY,
  material_id             TEXT NOT NULL REFERENCES materials(id),
  unit_id                 TEXT NOT NULL DEFAULT 'u-matriz' REFERENCES units(id),
  tipo                    TEXT NOT NULL CHECK (tipo IN ('compra','consumo','devolucao','perda','ajuste','reversao','transferencia')),
  quantidade              REAL NOT NULL CHECK (quantidade <> 0),
  custo_unitario_centavos REAL NOT NULL DEFAULT 0 CHECK (custo_unitario_centavos >= 0),
  order_id                TEXT REFERENCES orders(id),
  item_id                 TEXT REFERENCES order_items(id),
  purchase_id             TEXT REFERENCES purchases(id),
  reverte_de              TEXT UNIQUE REFERENCES stock_movements(id),
  transferencia_id        TEXT,                   -- liga a saída e a entrada de uma transferência
  motivo                  TEXT NOT NULL DEFAULT '',
  autorizado_negativo     INTEGER NOT NULL DEFAULT 0 CHECK (autorizado_negativo IN (0,1)),
  idempotency_key         TEXT UNIQUE,
  criado_em               TEXT NOT NULL,
  criado_por              TEXT REFERENCES users(id),
  CHECK (tipo <> 'consumo' OR (quantidade < 0 AND order_id IS NOT NULL)),
  CHECK (tipo <> 'compra' OR quantidade > 0),
  CHECK (tipo <> 'perda' OR quantidade < 0),
  CHECK (tipo <> 'reversao' OR reverte_de IS NOT NULL),
  CHECK (tipo <> 'transferencia' OR transferencia_id IS NOT NULL)
);
INSERT INTO stock_movements_nova (id, material_id, unit_id, tipo, quantidade, custo_unitario_centavos, order_id, item_id, purchase_id, reverte_de, motivo,
    autorizado_negativo, idempotency_key, criado_em, criado_por)
  SELECT id, material_id, 'u-matriz', tipo, quantidade, custo_unitario_centavos, order_id, item_id, purchase_id, reverte_de, motivo,
    autorizado_negativo, idempotency_key, criado_em, criado_por FROM stock_movements;
DROP TABLE stock_movements;
ALTER TABLE stock_movements_nova RENAME TO stock_movements;
CREATE INDEX idx_sm_mat ON stock_movements(material_id, unit_id, criado_em);
CREATE INDEX idx_sm_order ON stock_movements(order_id);
CREATE INDEX idx_sm_transf ON stock_movements(transferencia_id);

-- Saldo de cada material em cada unidade.
CREATE VIEW vw_estoque_unidade AS
SELECT material_id, unit_id, ROUND(SUM(quantidade), 3) AS quantidade FROM stock_movements GROUP BY material_id, unit_id;

-- Não fica negativo NA UNIDADE, a não ser com autorização.
CREATE TRIGGER sm_sem_negativo BEFORE INSERT ON stock_movements
WHEN NEW.autorizado_negativo = 0
 AND ROUND(COALESCE((SELECT SUM(quantidade) FROM stock_movements WHERE material_id = NEW.material_id AND unit_id = NEW.unit_id), 0) + NEW.quantidade, 3) < 0
BEGIN SELECT RAISE(ABORT, 'estoque_insuficiente'); END;
CREATE TRIGGER sm_reversao_valida BEFORE INSERT ON stock_movements
WHEN NEW.reverte_de IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM stock_movements o WHERE o.id = NEW.reverte_de AND o.tipo NOT IN ('reversao','transferencia')
     AND o.material_id = NEW.material_id AND o.unit_id = NEW.unit_id AND ROUND(o.quantidade + NEW.quantidade, 3) = 0)
BEGIN SELECT RAISE(ABORT, 'reversao_invalida'); END;
-- materials.quantidade continua sendo o total de todas as unidades.
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
-- O saldo total do material continua sendo a soma de todas as movimentações.
CREATE TRIGGER mat_saldo_protegido BEFORE UPDATE OF quantidade ON materials
WHEN ROUND(NEW.quantidade, 3) <> ROUND((SELECT COALESCE(SUM(quantidade), 0) FROM stock_movements WHERE material_id = NEW.id), 3)
BEGIN SELECT RAISE(ABORT, 'saldo_protegido'); END;
