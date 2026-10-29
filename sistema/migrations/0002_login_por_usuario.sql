-- Login por nome de usuário (além do e-mail) e troca de senha obrigatória no primeiro acesso.
ALTER TABLE users ADD COLUMN login TEXT;
ALTER TABLE users ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0 CHECK (trocar_senha IN (0,1));
CREATE UNIQUE INDEX idx_users_login ON users(login COLLATE NOCASE) WHERE login IS NOT NULL;
