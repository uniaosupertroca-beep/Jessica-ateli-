-- Ateliê Jessica — Fase 1: fundação do banco (Cloudflare D1 / SQLite).
-- Convenções:
--   * ids são TEXT (UUID gerado no Worker);
--   * dinheiro é INTEGER em centavos;
--   * datas comerciais são TEXT 'AAAA-MM-DD' no fuso America/Sao_Paulo;
--   * instantes são TEXT ISO-8601 em UTC;
--   * registros financeiros nunca são apagados nem alterados (correção por estorno).

-- ---------------------------------------------------------------------------
-- Usuários, sessões e limite de tentativas de login
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
  senha_hash    TEXT NOT NULL,
  papel         TEXT NOT NULL CHECK (papel IN ('admin','atendente','costureira')),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 do token (o token em si só existe no cookie)
  user_id     TEXT NOT NULL REFERENCES users(id),
  criada_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  chave         TEXT PRIMARY KEY,         -- e-mail ou IP
  falhas        INTEGER NOT NULL DEFAULT 0,
  janela_inicio TEXT NOT NULL,
  bloqueado_ate TEXT
);

-- ---------------------------------------------------------------------------
-- Configurações
-- ---------------------------------------------------------------------------
CREATE TABLE system_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  nome                TEXT NOT NULL,
  telefone            TEXT NOT NULL DEFAULT '',
  endereco            TEXT NOT NULL DEFAULT '',
  documento           TEXT NOT NULL DEFAULT '',
  rodape_os           TEXT NOT NULL DEFAULT '',
  capacidade_diaria   INTEGER NOT NULL DEFAULT 6 CHECK (capacidade_diaria >= 1),
  limite_quase_cheio  INTEGER NOT NULL DEFAULT 5 CHECK (limite_quase_cheio >= 1),
  atualizado_em       TEXT
);
INSERT INTO system_settings (id, nome, rodape_os) VALUES
  (1, 'Ateliê Jessica', 'Peças não retiradas em até 90 dias após a data de entrega poderão ser doadas. Confira a peça na retirada.');

CREATE TABLE payment_methods (
  id                 TEXT PRIMARY KEY,
  nome               TEXT NOT NULL UNIQUE,
  eh_dinheiro        INTEGER NOT NULL DEFAULT 0 CHECK (eh_dinheiro IN (0,1)),   -- entra na conferência da gaveta
  eh_credito_cliente INTEGER NOT NULL DEFAULT 0 CHECK (eh_credito_cliente IN (0,1)), -- uso de crédito: não é dinheiro novo
  ativo              INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ordem              INTEGER NOT NULL DEFAULT 0
);
INSERT INTO payment_methods (id, nome, eh_dinheiro, eh_credito_cliente, ordem) VALUES
  ('pm-dinheiro', 'Dinheiro', 1, 0, 1),
  ('pm-pix', 'Pix', 0, 0, 2),
  ('pm-debito', 'Cartão de débito', 0, 0, 3),
  ('pm-credito', 'Cartão de crédito', 0, 0, 4),
  ('pm-transferencia', 'Transferência', 0, 0, 5),
  ('pm-credito-cliente', 'Crédito da cliente', 0, 1, 99);

CREATE TABLE finance_categories (
  id      TEXT PRIMARY KEY,
  nome    TEXT NOT NULL,
  tipo    TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  sistema INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0,1)),
  ativo   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (nome, tipo)
);
INSERT INTO finance_categories (id, nome, tipo, sistema) VALUES
  ('fc-servicos', 'Serviços', 'entrada', 1),
  ('fc-credito', 'Crédito de cliente', 'entrada', 1),
  ('fc-venda', 'Venda de produtos', 'entrada', 0),
  ('fc-suprimento', 'Suprimento de caixa', 'entrada', 1),
  ('fc-outras-entradas', 'Outras entradas', 'entrada', 0),
  ('fc-material', 'Material / Aviamentos', 'saida', 0),
  ('fc-aluguel', 'Aluguel', 'saida', 0),
  ('fc-contas', 'Contas (luz, água, internet)', 'saida', 0),
  ('fc-manutencao', 'Manutenção', 'saida', 0),
  ('fc-pessoal', 'Funcionários / Pró-labore', 'saida', 0),
  ('fc-impostos', 'Impostos', 'saida', 0),
  ('fc-sangria', 'Sangria de caixa', 'saida', 1),
  ('fc-devolucao', 'Devolução a cliente', 'saida', 1),
  ('fc-outras-saidas', 'Outras saídas', 'saida', 0);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  nome_busca    TEXT NOT NULL DEFAULT '', -- nome em minúsculas e sem acentos (busca)
  telefone      TEXT,                     -- só dígitos, com DDD, sem +55
  whatsapp      TEXT,                     -- só dígitos; vazio = usar o telefone
  email         TEXT,
  nascimento    TEXT,
  endereco      TEXT,
  observacoes   TEXT NOT NULL DEFAULT '',
  preferencias  TEXT NOT NULL DEFAULT '',
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em     TEXT NOT NULL,
  criado_por    TEXT REFERENCES users(id),
  atualizado_em TEXT
);
CREATE INDEX idx_clients_nome ON clients(nome_busca);
CREATE INDEX idx_clients_telefone ON clients(telefone);
CREATE INDEX idx_clients_whatsapp ON clients(whatsapp);

-- ---------------------------------------------------------------------------
-- Medidas: campos configuráveis, fichas e versões imutáveis
-- ---------------------------------------------------------------------------
CREATE TABLE measurement_fields (
  id      TEXT PRIMARY KEY,
  nome    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unidade TEXT NOT NULL DEFAULT 'cm' CHECK (unidade IN ('cm')),
  ordem   INTEGER NOT NULL DEFAULT 0,
  ativo   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);
INSERT INTO measurement_fields (id, nome, ordem) VALUES
  ('mf-busto','Busto',1), ('mf-torax','Tórax',2), ('mf-cintura','Cintura',3), ('mf-quadril','Quadril',4),
  ('mf-ombros','Ombros',5), ('mf-braco','Braço',6), ('mf-manga','Manga',7), ('mf-punho','Punho',8),
  ('mf-comp-blusa','Comprimento de blusa',9), ('mf-comp-vestido','Comprimento de vestido',10),
  ('mf-comp-saia','Comprimento de saia',11), ('mf-comp-calca','Comprimento de calça',12),
  ('mf-entrepernas','Entrepernas',13), ('mf-altura','Altura',14);

CREATE TABLE client_measurements (          -- uma "ficha" (corporal ou de uma encomenda)
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  titulo        TEXT NOT NULL,
  order_item_id TEXT REFERENCES order_items(id),
  criado_em     TEXT NOT NULL,
  criado_por    TEXT REFERENCES users(id)
);
CREATE INDEX idx_fichas_client ON client_measurements(client_id);

CREATE TABLE measurement_versions (         -- cada medição é uma versão nova; nunca é alterada
  id          TEXT PRIMARY KEY,
  ficha_id    TEXT NOT NULL REFERENCES client_measurements(id),
  medido_em   TEXT NOT NULL,                -- data da medição
  medido_por  TEXT REFERENCES users(id),
  observacoes TEXT NOT NULL DEFAULT '',     -- caimento, preferências de folga etc.
  criado_em   TEXT NOT NULL
);
CREATE INDEX idx_mv_ficha ON measurement_versions(ficha_id, medido_em);

CREATE TABLE measurement_values (
  version_id TEXT NOT NULL REFERENCES measurement_versions(id),
  field_id   TEXT NOT NULL REFERENCES measurement_fields(id),
  valor      REAL NOT NULL CHECK (valor > 0 AND valor < 400),
  PRIMARY KEY (version_id, field_id)
);

CREATE TRIGGER mv_imutavel_upd BEFORE UPDATE ON measurement_versions BEGIN SELECT RAISE(ABORT, 'medida_imutavel'); END;
CREATE TRIGGER mv_imutavel_del BEFORE DELETE ON measurement_versions BEGIN SELECT RAISE(ABORT, 'medida_imutavel'); END;
CREATE TRIGGER mval_imutavel_upd BEFORE UPDATE ON measurement_values BEGIN SELECT RAISE(ABORT, 'medida_imutavel'); END;
CREATE TRIGGER mval_imutavel_del BEFORE DELETE ON measurement_values BEGIN SELECT RAISE(ABORT, 'medida_imutavel'); END;

-- ---------------------------------------------------------------------------
-- Catálogo de serviços (preços definidos pelo administrador; começa sem preços oficiais)
-- ---------------------------------------------------------------------------
CREATE TABLE service_categories (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ordem INTEGER NOT NULL DEFAULT 0
);
INSERT INTO service_categories (id, nome, ordem) VALUES
  ('sc-ajustes','Ajustes',1), ('sc-consertos','Consertos e reparos',2), ('sc-reformas','Reformas',3),
  ('sc-festa','Vestidos de festa',4), ('sc-medida','Confecção sob medida',5), ('sc-uniformes','Uniformes',6),
  ('sc-cortinas','Cortinas',7), ('sc-personalizados','Serviços personalizados',8);

CREATE TABLE service_catalog (
  id                       TEXT PRIMARY KEY,
  categoria_id             TEXT NOT NULL REFERENCES service_categories(id),
  nome                     TEXT NOT NULL,
  descricao                TEXT NOT NULL DEFAULT '',
  unidade                  TEXT NOT NULL DEFAULT 'un' CHECK (unidade IN ('un','m','cm','h')),
  preco_centavos           INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
  tempo_min                INTEGER NOT NULL DEFAULT 0 CHECK (tempo_min >= 0),
  custo_mao_obra_centavos  INTEGER NOT NULL DEFAULT 0 CHECK (custo_mao_obra_centavos >= 0),
  ativo                    INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em            TEXT,
  UNIQUE (categoria_id, nome)
);
-- Serviços iniciais SEM preço: o administrador define os valores em Configurações.
INSERT INTO service_catalog (id, categoria_id, nome) VALUES
  ('sv-barra-calca','sc-ajustes','Barra de calça'), ('sv-barra-vestido','sc-ajustes','Barra de vestido'),
  ('sv-barra-saia','sc-ajustes','Barra de saia'), ('sv-ajuste-cintura','sc-ajustes','Ajuste de cintura'),
  ('sv-ajuste-lateral','sc-ajustes','Ajuste de lateral'), ('sv-troca-ziper','sc-consertos','Troca de zíper'),
  ('sv-troca-botao','sc-consertos','Troca de botão'), ('sv-reparo','sc-consertos','Reparo / remendo'),
  ('sv-reforma','sc-reformas','Reforma de peça'), ('sv-ajuste-festa','sc-festa','Ajuste de vestido de festa'),
  ('sv-sob-medida','sc-medida','Confecção sob medida'), ('sv-uniforme','sc-uniformes','Uniforme'),
  ('sv-cortina','sc-cortinas','Cortina'), ('sv-personalizado','sc-personalizados','Serviço personalizado');

-- ---------------------------------------------------------------------------
-- Ordens de serviço, peças e serviços de cada peça
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,
  numero              INTEGER NOT NULL UNIQUE,
  client_id           TEXT NOT NULL REFERENCES clients(id),
  aberta_em           TEXT NOT NULL,        -- data
  prazo               TEXT NOT NULL CHECK (prazo >= aberta_em),
  responsavel_id      TEXT REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'recebida' CHECK (status IN (
                        'recebida','aguardando_aprovacao','aprovada','em_producao','aguardando_prova',
                        'ajustes_finais','pronta','entregue','pausada','cancelada')),
  status_antes_pausa  TEXT,
  desconto_centavos   INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  observacoes         TEXT NOT NULL DEFAULT '',
  motivo              TEXT,                 -- motivo do cancelamento ou da pausa
  entregue_em         TEXT,
  cancelada_em        TEXT,
  versao              INTEGER NOT NULL DEFAULT 1,   -- controle de concorrência otimista
  idempotency_key     TEXT UNIQUE,
  criado_em           TEXT NOT NULL,
  criado_por          TEXT REFERENCES users(id),
  atualizado_em       TEXT
);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_prazo ON orders(prazo, status);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (                  -- cada peça física recebida
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  seq             INTEGER NOT NULL,         -- nunca reutilizado dentro da OS
  codigo          TEXT NOT NULL UNIQUE,     -- ex.: 142-2 (vai na etiqueta)
  posicao         INTEGER NOT NULL DEFAULT 0,
  peca            TEXT NOT NULL,
  descricao       TEXT NOT NULL DEFAULT '',
  prazo           TEXT,
  responsavel_id  TEXT REFERENCES users(id),
  status_producao TEXT NOT NULL DEFAULT 'aguardando' CHECK (status_producao IN (
                    'aguardando','em_execucao','aguardando_prova','ajustes_finais','finalizado')),
  criado_em       TEXT NOT NULL,
  UNIQUE (order_id, seq)
);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_items_resp ON order_items(responsavel_id, status_producao);

CREATE TABLE order_item_services (
  id                       TEXT PRIMARY KEY,
  item_id                  TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  service_id               TEXT REFERENCES service_catalog(id),
  descricao                TEXT NOT NULL,
  unidade                  TEXT NOT NULL DEFAULT 'un' CHECK (unidade IN ('un','m','cm','h')),
  quantidade               REAL NOT NULL CHECK (quantidade > 0 AND quantidade <= 100000),
  valor_unitario_centavos  INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  subtotal_centavos        INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  tempo_min                INTEGER NOT NULL DEFAULT 0 CHECK (tempo_min >= 0),
  posicao                  INTEGER NOT NULL DEFAULT 0,
  -- serviços contados em unidade só aceitam número inteiro (≥ 1 por causa do > 0 acima)
  CHECK (unidade <> 'un' OR quantidade = CAST(quantidade AS INTEGER))
);
CREATE INDEX idx_ois_item ON order_item_services(item_id);

CREATE TABLE order_status_history (
  id        TEXT PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders(id),
  item_id   TEXT REFERENCES order_items(id),
  de        TEXT,
  para      TEXT NOT NULL,
  motivo    TEXT,
  user_id   TEXT REFERENCES users(id),
  em        TEXT NOT NULL
);
CREATE INDEX idx_osh_order ON order_status_history(order_id, em);

CREATE TABLE order_photos (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  item_id      TEXT REFERENCES order_items(id),
  categoria    TEXT NOT NULL CHECK (categoria IN ('entrada','defeito','referencia','durante','concluida')),
  r2_key       TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  tamanho      INTEGER NOT NULL,
  legenda      TEXT NOT NULL DEFAULT '',
  criado_em    TEXT NOT NULL,
  criado_por   TEXT REFERENCES users(id),
  excluida_em  TEXT,
  excluida_por TEXT REFERENCES users(id)
);
CREATE INDEX idx_photos_order ON order_photos(order_id);

-- ---------------------------------------------------------------------------
-- Financeiro: caixa diário, razão de movimentos (imutável) e créditos de cliente
-- ---------------------------------------------------------------------------
CREATE TABLE cash_sessions (
  id                     TEXT PRIMARY KEY,
  data                   TEXT NOT NULL UNIQUE,
  saldo_inicial_centavos INTEGER NOT NULL CHECK (saldo_inicial_centavos >= 0),
  aberto_em              TEXT NOT NULL,
  aberto_por             TEXT REFERENCES users(id),
  fechado_em             TEXT,
  fechado_por            TEXT REFERENCES users(id),
  contado_centavos       INTEGER CHECK (contado_centavos >= 0),
  reaberto_em            TEXT,
  reaberto_por           TEXT REFERENCES users(id),
  observacoes            TEXT NOT NULL DEFAULT ''
);

-- Razão único de dinheiro: recebimentos de OS, crédito de cliente, entradas/saídas avulsas,
-- sangrias e estornos. Pagamentos de OS são os movimentos com order_id preenchido.
CREATE TABLE cash_movements (
  id              TEXT PRIMARY KEY,
  data            TEXT NOT NULL,            -- data do caixa
  tipo            TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  natureza        TEXT NOT NULL CHECK (natureza IN (
                    'recebimento_os','credito_cliente','avulso','sangria','suprimento','estorno')),
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  forma_id        TEXT NOT NULL REFERENCES payment_methods(id),
  categoria_id    TEXT NOT NULL REFERENCES finance_categories(id),
  descricao       TEXT NOT NULL,
  order_id        TEXT REFERENCES orders(id),
  client_id       TEXT REFERENCES clients(id),
  estorno_de      TEXT UNIQUE REFERENCES cash_movements(id),   -- um lançamento só é estornado uma vez
  idempotency_key TEXT UNIQUE,
  criado_em       TEXT NOT NULL,
  criado_por      TEXT REFERENCES users(id),
  CHECK (natureza <> 'estorno' OR estorno_de IS NOT NULL),
  CHECK (natureza <> 'recebimento_os' OR (order_id IS NOT NULL AND tipo = 'entrada'))
);
CREATE INDEX idx_cm_data ON cash_movements(data);
CREATE INDEX idx_cm_order ON cash_movements(order_id);
CREATE INDEX idx_cm_client ON cash_movements(client_id);

CREATE TABLE customer_credits (             -- razão do crédito de cada cliente (+ entra, − usa)
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(id),
  valor_centavos   INTEGER NOT NULL CHECK (valor_centavos <> 0),
  descricao        TEXT NOT NULL,
  cash_movement_id TEXT NOT NULL REFERENCES cash_movements(id),
  order_id         TEXT REFERENCES orders(id),
  criado_em        TEXT NOT NULL,
  criado_por       TEXT REFERENCES users(id)
);
CREATE INDEX idx_cc_client ON customer_credits(client_id);

-- Totais da OS calculados sempre a partir dos registros (nunca guardados à parte).
CREATE VIEW vw_order_totals AS
SELECT o.id AS order_id,
       COALESCE((SELECT SUM(s.subtotal_centavos) FROM order_item_services s
                   JOIN order_items i ON i.id = s.item_id WHERE i.order_id = o.id), 0) AS soma_itens,
       o.desconto_centavos AS desconto,
       COALESCE((SELECT SUM(s.subtotal_centavos) FROM order_item_services s
                   JOIN order_items i ON i.id = s.item_id WHERE i.order_id = o.id), 0) - o.desconto_centavos AS total,
       COALESCE((SELECT SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END)
                   FROM cash_movements m WHERE m.order_id = o.id), 0) AS pago
FROM orders o;

CREATE VIEW vw_client_credit AS
SELECT client_id, SUM(valor_centavos) AS saldo FROM customer_credits GROUP BY client_id;

-- Lançamentos são imutáveis (só a descrição pode ser corrigida).
CREATE TRIGGER cm_sem_delete BEFORE DELETE ON cash_movements
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;
CREATE TRIGGER cm_sem_update BEFORE UPDATE OF data, tipo, natureza, valor_centavos, forma_id, categoria_id,
  order_id, client_id, estorno_de, idempotency_key, criado_em, criado_por ON cash_movements
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;

-- Só se lança em caixa aberto.
CREATE TRIGGER cm_caixa_aberto BEFORE INSERT ON cash_movements
WHEN NOT EXISTS (SELECT 1 FROM cash_sessions WHERE data = NEW.data AND fechado_em IS NULL)
BEGIN SELECT RAISE(ABORT, 'caixa_fechado'); END;

-- Recebimento de OS nunca ultrapassa o saldo devido (o excedente vira crédito formal da cliente).
CREATE TRIGGER cm_sem_excesso BEFORE INSERT ON cash_movements
WHEN NEW.natureza = 'recebimento_os'
 AND NEW.valor_centavos > (SELECT total - pago FROM vw_order_totals WHERE order_id = NEW.order_id)
BEGIN SELECT RAISE(ABORT, 'pagamento_excede_saldo'); END;

-- Não se recebe em OS cancelada.
CREATE TRIGGER cm_os_cancelada BEFORE INSERT ON cash_movements
WHEN NEW.natureza = 'recebimento_os'
 AND (SELECT status FROM orders WHERE id = NEW.order_id) = 'cancelada'
BEGIN SELECT RAISE(ABORT, 'os_cancelada'); END;

-- Estorno: tipo oposto, mesmo valor, mesma OS/cliente, e não se estorna um estorno.
CREATE TRIGGER cm_estorno_valido BEFORE INSERT ON cash_movements
WHEN NEW.estorno_de IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cash_movements o WHERE o.id = NEW.estorno_de AND o.natureza <> 'estorno'
     AND o.tipo <> NEW.tipo AND o.valor_centavos = NEW.valor_centavos
     AND o.order_id IS NEW.order_id AND o.client_id IS NEW.client_id AND o.forma_id = NEW.forma_id)
BEGIN SELECT RAISE(ABORT, 'estorno_invalido'); END;

CREATE TRIGGER cc_sem_delete BEFORE DELETE ON customer_credits
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;
CREATE TRIGGER cc_sem_update BEFORE UPDATE ON customer_credits
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;
CREATE TRIGGER cc_sem_negativo BEFORE INSERT ON customer_credits
WHEN NEW.valor_centavos < 0
 AND COALESCE((SELECT SUM(valor_centavos) FROM customer_credits WHERE client_id = NEW.client_id), 0) + NEW.valor_centavos < 0
BEGIN SELECT RAISE(ABORT, 'credito_insuficiente'); END;

-- Caixa fechado não pode ser alterado, exceto para reabrir (que fica registrado).
CREATE TRIGGER caixa_fechado_imutavel BEFORE UPDATE ON cash_sessions
WHEN OLD.fechado_em IS NOT NULL AND NEW.fechado_em IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'caixa_fechado'); END;
CREATE TRIGGER caixa_sem_delete BEFORE DELETE ON cash_sessions
BEGIN SELECT RAISE(ABORT, 'caixa_imutavel'); END;

-- ---------------------------------------------------------------------------
-- Guardas: um INSERT nesta tabela aborta o lote inteiro (usado para validar
-- condições que dependem de várias tabelas dentro do mesmo lote/transação).
-- ---------------------------------------------------------------------------
CREATE TABLE guards (motivo TEXT NOT NULL);
CREATE TRIGGER guard_total_menor_pago BEFORE INSERT ON guards WHEN NEW.motivo = 'total_menor_que_pago'
BEGIN SELECT RAISE(ABORT, 'total_menor_que_pago'); END;
CREATE TRIGGER guard_versao BEFORE INSERT ON guards WHEN NEW.motivo = 'versao_desatualizada'
BEGIN SELECT RAISE(ABORT, 'versao_desatualizada'); END;
CREATE TRIGGER guard_os_bloqueada BEFORE INSERT ON guards WHEN NEW.motivo = 'os_bloqueada'
BEGIN SELECT RAISE(ABORT, 'os_bloqueada'); END;
CREATE TRIGGER guard_os_com_pagamento BEFORE INSERT ON guards WHEN NEW.motivo = 'os_com_pagamento'
BEGIN SELECT RAISE(ABORT, 'os_com_pagamento'); END;
CREATE TRIGGER guard_saldo_mudou BEFORE INSERT ON guards WHEN NEW.motivo = 'saldo_mudou'
BEGIN SELECT RAISE(ABORT, 'saldo_mudou'); END;
CREATE TRIGGER guard_generico BEFORE INSERT ON guards
WHEN NEW.motivo NOT IN ('total_menor_que_pago','versao_desatualizada','os_bloqueada','os_com_pagamento','saldo_mudou')
BEGIN SELECT RAISE(ABORT, 'guarda'); END;

-- Impede apagar peças que já têm fotos (as fotos não podem ficar órfãs).
CREATE TRIGGER item_com_foto BEFORE DELETE ON order_items
WHEN EXISTS (SELECT 1 FROM order_photos WHERE item_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'peca_com_fotos'); END;

-- Ordens e clientes não são apagados (só desativados / cancelados).
CREATE TRIGGER orders_sem_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;
CREATE TRIGGER clients_sem_delete BEFORE DELETE ON clients
BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;

-- ---------------------------------------------------------------------------
-- WhatsApp (registro de links abertos — não confirma envio) e auditoria
-- ---------------------------------------------------------------------------
CREATE TABLE message_logs (
  id        TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  order_id  TEXT REFERENCES orders(id),
  modelo    TEXT NOT NULL,
  canal     TEXT NOT NULL DEFAULT 'whatsapp_link',
  situacao  TEXT NOT NULL DEFAULT 'link_aberto' CHECK (situacao IN ('link_aberto','enviada','falhou')),
  texto     TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  criado_por TEXT REFERENCES users(id)
);
CREATE INDEX idx_ml_order ON message_logs(order_id);

CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  acao       TEXT NOT NULL,
  entidade   TEXT NOT NULL,
  entidade_id TEXT,
  dados      TEXT,                          -- JSON resumido (sem senhas)
  ip         TEXT,
  em         TEXT NOT NULL
);
CREATE INDEX idx_audit_ent ON audit_logs(entidade, entidade_id);
CREATE INDEX idx_audit_em ON audit_logs(em);
CREATE TRIGGER audit_sem_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;
CREATE TRIGGER audit_sem_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'registro_protegido'); END;
