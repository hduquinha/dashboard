-- ============================================
-- MIGRACAO: Equipe (auth propria) e preparacao para remocao do Chatwoot
-- ============================================
-- Cria dashboard.team_members, que passa a ser a fonte de login e de
-- "vendedores/equipe" no lugar dos agentes do Chatwoot.
-- O ALTER TABLE de limpeza das colunas de fechamento via Chatwoot em
-- commercial_leads fica comentado nesta migracao -- so deve ser executado
-- depois que lib/commercial.ts parar de ler essas colunas (ver plano).
-- ============================================

CREATE SCHEMA IF NOT EXISTS dashboard;

CREATE TABLE IF NOT EXISTS dashboard.team_members (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    active BOOLEAN NOT NULL DEFAULT true,
    distribution_position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_members_active
    ON dashboard.team_members(active);

CREATE INDEX IF NOT EXISTS idx_team_members_role
    ON dashboard.team_members(role);

CREATE INDEX IF NOT EXISTS idx_commercial_events_actor_created
    ON dashboard.commercial_events(actor_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_events_to_stage_created
    ON dashboard.commercial_events(to_stage, created_at DESC);

-- Rodar SO depois que lib/commercial.ts parar de ler essas colunas
-- (fase de remocao do Chatwoot):
-- ALTER TABLE dashboard.commercial_leads
--     DROP COLUMN IF EXISTS closing_inbox_id,
--     DROP COLUMN IF EXISTS closing_inbox_name,
--     DROP COLUMN IF EXISTS closing_conversation_id,
--     DROP COLUMN IF EXISTS closing_conversation_display_id,
--     DROP COLUMN IF EXISTS closing_conversation_url,
--     DROP COLUMN IF EXISTS first_contact_inbox_id,
--     DROP COLUMN IF EXISTS first_contact_inbox_name;
