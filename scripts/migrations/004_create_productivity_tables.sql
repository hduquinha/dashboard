-- ============================================
-- MIGRACAO: Produtividade diaria e distribuicao
-- ============================================
-- Cria os modelos usados pela rota /produtividade:
-- 1. Diario de bordo / produtividade por consultor
-- 2. Fechamento e producao diaria
-- Alem da ordem de usuarios para distribuir leads no Chatwoot.
-- ============================================

CREATE SCHEMA IF NOT EXISTS dashboard;

CREATE TABLE IF NOT EXISTS dashboard.productivity_daily_boards (
    id SERIAL PRIMARY KEY,
    consultant_user_id INTEGER,
    consultant_email TEXT NOT NULL,
    consultant_name TEXT NOT NULL,
    report_date DATE NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id INTEGER,
    created_by_email TEXT,
    created_by_name TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by_user_id INTEGER,
    verified_by_email TEXT,
    verified_by_name TEXT,
    manager_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_productivity_daily_consultant_date UNIQUE (consultant_email, report_date)
);

CREATE TABLE IF NOT EXISTS dashboard.productivity_closing_boards (
    id SERIAL PRIMARY KEY,
    consultant_user_id INTEGER,
    consultant_email TEXT NOT NULL,
    consultant_name TEXT NOT NULL,
    report_date DATE NOT NULL,
    no_show_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    production_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    delivery_date DATE,
    specialist_signature TEXT,
    created_by_user_id INTEGER,
    created_by_email TEXT,
    created_by_name TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by_user_id INTEGER,
    verified_by_email TEXT,
    verified_by_name TEXT,
    manager_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_productivity_closing_consultant_date UNIQUE (consultant_email, report_date)
);

CREATE TABLE IF NOT EXISTS dashboard.productivity_lead_agents (
    id SERIAL PRIMARY KEY,
    chatwoot_user_id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard.productivity_lead_assignments (
    id SERIAL PRIMARY KEY,
    dashboard_inscricao_id INTEGER UNIQUE,
    chatwoot_conversation_id INTEGER UNIQUE,
    chatwoot_conversation_display_id INTEGER,
    chatwoot_assignee_id INTEGER NOT NULL,
    assignee_email TEXT NOT NULL,
    assignee_name TEXT NOT NULL,
    assigned_by_user_id INTEGER,
    assigned_by_email TEXT,
    assigned_by_name TEXT,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productivity_daily_date
    ON dashboard.productivity_daily_boards(report_date DESC);

CREATE INDEX IF NOT EXISTS idx_productivity_daily_consultant
    ON dashboard.productivity_daily_boards(consultant_email);

CREATE INDEX IF NOT EXISTS idx_productivity_closing_date
    ON dashboard.productivity_closing_boards(report_date DESC);

CREATE INDEX IF NOT EXISTS idx_productivity_closing_consultant
    ON dashboard.productivity_closing_boards(consultant_email);

CREATE INDEX IF NOT EXISTS idx_productivity_lead_agents_position
    ON dashboard.productivity_lead_agents(position ASC);

CREATE INDEX IF NOT EXISTS idx_productivity_lead_assignments_assignee
    ON dashboard.productivity_lead_assignments(chatwoot_assignee_id, assigned_at DESC);
