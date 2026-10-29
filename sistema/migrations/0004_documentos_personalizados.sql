-- Documentos personalizados: logo (guardado no R2 privado), cor e textos dos documentos impressos.
ALTER TABLE system_settings ADD COLUMN logo_key TEXT;
ALTER TABLE system_settings ADD COLUMN logo_tipo TEXT;
ALTER TABLE system_settings ADD COLUMN doc_cor TEXT NOT NULL DEFAULT '#C92D6A' CHECK (length(doc_cor) = 7 AND substr(doc_cor, 1, 1) = '#' AND trim(lower(substr(doc_cor, 2)), '0123456789abcdef') = '');
ALTER TABLE system_settings ADD COLUMN doc_cabecalho TEXT NOT NULL DEFAULT '';
ALTER TABLE system_settings ADD COLUMN doc_termos_orcamento TEXT NOT NULL DEFAULT 'Orçamento válido pelo prazo indicado. O prazo de entrega começa a contar a partir da aprovação.';
ALTER TABLE system_settings ADD COLUMN doc_validade_orcamento_dias INTEGER NOT NULL DEFAULT 7 CHECK (doc_validade_orcamento_dias BETWEEN 1 AND 365);
ALTER TABLE system_settings ADD COLUMN doc_texto_retirada TEXT NOT NULL DEFAULT 'Declaro que retirei as peças abaixo e conferi o serviço realizado.';
ALTER TABLE system_settings ADD COLUMN doc_assinatura TEXT NOT NULL DEFAULT '';
ALTER TABLE system_settings ADD COLUMN doc_logo_etiqueta INTEGER NOT NULL DEFAULT 1 CHECK (doc_logo_etiqueta IN (0,1));
ALTER TABLE system_settings ADD COLUMN doc_mostrar_telefone_cliente INTEGER NOT NULL DEFAULT 1 CHECK (doc_mostrar_telefone_cliente IN (0,1));
