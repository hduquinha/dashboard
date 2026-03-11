-- ============================================
-- MIGRAÇÃO: Tabelas do Encontro Online
-- ============================================
-- Armazena dados de presença de aulas gravadas
-- vindos do sistema externo "Encontro Online".
-- O campo `phone` (telefone limpo, só dígitos)
-- é a chave de associação com inscritos.
-- ============================================

CREATE SCHEMA IF NOT EXISTS encontro_online;

-- ============================================
-- TABELA: participants
-- Quem se cadastrou no encontro online
-- ============================================
CREATE TABLE IF NOT EXISTS encontro_online.participants (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eo_participants_phone
    ON encontro_online.participants(phone);

-- ============================================
-- TABELA: attendance
-- Status de presença, % assistido, tempo
-- ============================================
CREATE TABLE IF NOT EXISTS encontro_online.attendance (
    id SERIAL PRIMARY KEY,
    oder_id UUID NOT NULL,
    phone VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('concluido','assistindo','iniciou','nao_assistiu')),
    percent_watched SMALLINT NOT NULL DEFAULT 0,
    total_watched_seconds INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    first_access_at TIMESTAMP WITH TIME ZONE,
    last_access_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_eo_attendance_phone
    ON encontro_online.attendance(phone);

-- ============================================
-- TABELA: engagement
-- Sessões, foco, skips, velocidade, segmentos
-- ============================================
CREATE TABLE IF NOT EXISTS encontro_online.engagement (
    id SERIAL PRIMARY KEY,
    oder_id UUID NOT NULL,
    phone VARCHAR(20) NOT NULL,
    sessions INTEGER NOT NULL DEFAULT 0,
    farthest_point INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    forward_skips INTEGER NOT NULL DEFAULT 0,
    rewatch_count INTEGER NOT NULL DEFAULT 0,
    playback_speed REAL NOT NULL DEFAULT 1.0,
    focus_percent SMALLINT NOT NULL DEFAULT 0,
    segment_data INTEGER[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_eo_engagement_phone
    ON encontro_online.engagement(phone);
