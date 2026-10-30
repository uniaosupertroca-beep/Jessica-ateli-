-- Aceite do orçamento, confirmação de entrega, origem da cliente e permissões por pessoa.
-- Só acrescenta colunas e uma tabela; nada é apagado.

-- Como e quando a cliente aprovou o orçamento; quem retirou as peças.
ALTER TABLE orders ADD COLUMN aprovacao_meio TEXT CHECK (aprovacao_meio IS NULL OR aprovacao_meio IN ('presencial','whatsapp','telefone','outro'));
ALTER TABLE orders ADD COLUMN aprovada_em TEXT;
ALTER TABLE orders ADD COLUMN aprovada_por TEXT;            -- usuário que registrou o aceite
ALTER TABLE orders ADD COLUMN retirado_por_nome TEXT;       -- quem levou as peças (a própria cliente ou outra pessoa)
ALTER TABLE orders ADD COLUMN entregue_por TEXT;            -- usuário que fez a entrega

-- Como a cliente conheceu o ateliê.
ALTER TABLE clients ADD COLUMN origem TEXT CHECK (origem IS NULL OR origem IN ('indicacao','instagram','facebook','google','whatsapp','passou_na_frente','cliente_antiga','outro'));

-- Ajustes de permissão por pessoa, além do perfil (concedida = 1 dá, 0 tira).
CREATE TABLE user_permissions (
  user_id    TEXT NOT NULL REFERENCES users(id),
  permissao  TEXT NOT NULL,
  concedida  INTEGER NOT NULL CHECK (concedida IN (0,1)),
  PRIMARY KEY (user_id, permissao)
);
