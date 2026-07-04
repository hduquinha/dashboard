-- ============================================
-- MIGRACAO: Deduplicar Encontro Online por telefone + data
-- ============================================
-- Em alguns cadastros online a mesma pessoa ganhou clientId diferente.
-- Para Encontro Online, telefone + data ISO do encontro e a chave estavel.
-- Mantem o cadastro mais recente e guarda backup dos removidos.
-- ============================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS inscricoes;

CREATE TABLE IF NOT EXISTS inscricoes.online_duplicate_backups (
    id BIGSERIAL PRIMARY KEY,
    kept_id INTEGER NOT NULL,
    duplicate_id INTEGER NOT NULL,
    duplicate_key TEXT NOT NULL,
    duplicate_payload JSONB NOT NULL,
    duplicate_criado_em TIMESTAMP WITH TIME ZONE NOT NULL,
    backed_up_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reason TEXT NOT NULL DEFAULT 'online_training_duplicate_cleanup'
);

WITH online_records AS (
  SELECT
    id,
    payload,
    criado_em,
    COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) AS online_date,
    REGEXP_REPLACE(COALESCE(payload->>'telefone', payload->>'phone', payload->>'celular', payload->>'whatsapp', payload->>'dashboard_telefone', ''), '\D', '', 'g') AS phone_key
  FROM inscricoes.inscricoes
  WHERE LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
    AND COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) ~ '^\d{4}-\d{2}-\d{2}'
),
ranked AS (
  SELECT
    *,
    phone_key || '|online:' || online_date AS duplicate_key,
    FIRST_VALUE(id) OVER (
      PARTITION BY phone_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS kept_id,
    ROW_NUMBER() OVER (
      PARTITION BY phone_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS duplicate_rank
  FROM online_records
  WHERE LENGTH(phone_key) >= 10
)
INSERT INTO inscricoes.online_duplicate_backups (
  kept_id,
  duplicate_id,
  duplicate_key,
  duplicate_payload,
  duplicate_criado_em,
  reason
)
SELECT
  kept_id,
  id,
  duplicate_key,
  payload,
  criado_em,
  'online_phone_date_duplicate_cleanup'
FROM ranked
WHERE duplicate_rank > 1;

WITH online_records AS (
  SELECT
    id,
    criado_em,
    COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) AS online_date,
    REGEXP_REPLACE(COALESCE(payload->>'telefone', payload->>'phone', payload->>'celular', payload->>'whatsapp', payload->>'dashboard_telefone', ''), '\D', '', 'g') AS phone_key
  FROM inscricoes.inscricoes
  WHERE LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
    AND COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) ~ '^\d{4}-\d{2}-\d{2}'
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY phone_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS duplicate_rank
  FROM online_records
  WHERE LENGTH(phone_key) >= 10
)
DELETE FROM inscricoes.inscricoes AS i
USING ranked
WHERE i.id = ranked.id
  AND ranked.duplicate_rank > 1;

COMMIT;
