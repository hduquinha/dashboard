-- ============================================
-- MIGRACAO: Super master e permissoes granulares
-- ============================================
-- Expande dashboard.team_members para suportar:
-- - role super_master
-- - nivel de prioridade
-- - lista JSONB de permissoes efetivas
-- Henrique e promovido automaticamente pelo e-mail padrao local.
-- ============================================

ALTER TABLE dashboard.team_members
    ADD COLUMN IF NOT EXISTS priority_level INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS permissions JSONB,
    ADD COLUMN IF NOT EXISTS instituto_up_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE dashboard.team_members
    DROP CONSTRAINT IF EXISTS team_members_role_check;

ALTER TABLE dashboard.team_members
    ADD CONSTRAINT team_members_role_check
    CHECK (role IN ('super_master', 'admin', 'member'));

CREATE INDEX IF NOT EXISTS idx_team_members_priority
    ON dashboard.team_members(priority_level DESC);

UPDATE dashboard.team_members
SET role = 'super_master',
    priority_level = GREATEST(priority_level, 100),
    updated_at = NOW()
WHERE LOWER(email) IN ('henrique@escolavozup.com');
