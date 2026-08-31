-- Define quais perfis podem receber leads. O default true preserva os
-- integrantes existentes; novos usuarios sao criados pela aplicacao com false
-- e entram na distribuicao apenas depois de marcados como vendedores.

ALTER TABLE dashboard.team_members
  ADD COLUMN IF NOT EXISTS is_seller BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_team_members_active_seller
  ON dashboard.team_members (active, is_seller);
