-- Busca de OS pelo nome da peça sem diferenciar acentos (como já é feito com o nome da cliente).
ALTER TABLE order_items ADD COLUMN peca_busca TEXT NOT NULL DEFAULT '';
-- Preenche as peças que já existem (acentos mais comuns do português).
UPDATE order_items SET peca_busca =
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
  lower(peca), 'á','a'),'à','a'),'â','a'),'ã','a'),'é','e'),'ê','e'),'í','i'),'ó','o'),'ô','o'),'õ','o'),'ú','u'),'ü','u'),'ç','c'),'Ç','c');
CREATE INDEX idx_items_peca_busca ON order_items(peca_busca);
