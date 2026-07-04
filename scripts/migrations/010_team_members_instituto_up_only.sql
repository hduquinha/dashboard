-- ============================================
-- MIGRACAO: Restricao "somente Instituto UP" por usuario
-- ============================================
-- Adiciona uma flag em dashboard.team_members que, quando true, esconde
-- a secao "Leads VozUP" do menu e bloqueia o acesso direto a rota /vozup
-- para aquele usuario. O resto do sistema (CRM, Kanban, etiquetas de
-- origem VozUP em leads) continua normal.
-- ============================================

ALTER TABLE dashboard.team_members
    ADD COLUMN IF NOT EXISTS instituto_up_only BOOLEAN NOT NULL DEFAULT false;
