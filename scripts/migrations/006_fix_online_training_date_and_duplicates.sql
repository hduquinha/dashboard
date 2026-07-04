-- ============================================
-- MIGRACAO: Corrigir data de Encontro Online e duplicados
-- ============================================
-- O painel antigo prioriza training_date antes de data_treinamento.
-- Em cadastros do Encontro Online, training_date ficou com a data velha
-- do Up Day Plus (ex.: 13/11/2025), enquanto data_treinamento tinha a
-- data correta do encontro online. Esta migracao:
-- 1) copia a data ISO correta para training_date/trainingDate;
-- 2) marca dashboard_treinamento como Encontro Online <data>;
-- 3) remove duplicados online por pessoa + data, com backup.
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

WITH online_candidates AS (
  SELECT
    id,
    COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), '')
    ) AS online_date
  FROM inscricoes.inscricoes
  WHERE LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
    AND COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), '')
    ) ~ '^\d{4}-\d{2}-\d{2}'
    AND NOT (
      LOWER(TRIM(COALESCE(
        NULLIF(TRIM(payload->>'treinamento'), ''),
        NULLIF(TRIM(payload->>'training'), ''),
        NULLIF(TRIM(payload->>'treinamento_nome'), ''),
        NULLIF(TRIM(payload->>'treinamentoNome'), ''),
        ''
      ))) LIKE '%up day%'
      OR LOWER(TRIM(COALESCE(payload->>'origem', payload->>'source', payload->>'origin', ''))) = 'landing-inscricao-agosto-2026'
      OR COALESCE(
        NULLIF(TRIM(payload->>'tamanho_camiseta'), ''),
        NULLIF(TRIM(payload->>'tamanhoCamiseta'), ''),
        NULLIF(TRIM(payload->>'multa_ciente'), ''),
        NULLIF(TRIM(payload->>'multaCiente'), ''),
        NULLIF(TRIM(payload->>'cancelamento_ciente'), ''),
        NULLIF(TRIM(payload->>'cancelamentoCiente'), '')
      ) IS NOT NULL
    )
),
normalized AS (
  SELECT
    id,
    online_date,
    'Encontro Online ' || TO_CHAR((online_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 'DD/MM/YYYY') AS online_label
  FROM online_candidates
)
UPDATE inscricoes.inscricoes AS i
SET payload =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(i.payload, '{training_date}', to_jsonb(normalized.online_date), true),
        '{trainingDate}',
        to_jsonb(normalized.online_date),
        true
      ),
      '{dashboard_treinamento}',
      to_jsonb(normalized.online_label),
      true
    ),
    '{dashboard_tags}',
    COALESCE(
      (
        SELECT jsonb_agg(tag)
        FROM jsonb_array_elements(COALESCE(i.payload->'dashboard_tags', '[]'::jsonb)) AS tag
        WHERE tag #>> '{}' NOT ILIKE 'Treinamento:%'
      ),
      '[]'::jsonb
    ) || jsonb_build_array('Treinamento: ' || normalized.online_label),
    true
  )
FROM normalized
WHERE i.id = normalized.id
  AND (
    COALESCE(i.payload->>'training_date', '') <> normalized.online_date
    OR COALESCE(i.payload->>'trainingDate', '') <> normalized.online_date
    OR COALESCE(i.payload->>'dashboard_treinamento', '') <> normalized.online_label
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
    COALESCE(
      NULLIF(TRIM(payload->>'clientId'), ''),
      NULLIF(TRIM(payload->>'client_id'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(payload->>'telefone', payload->>'phone', payload->>'celular', payload->>'whatsapp', payload->>'dashboard_telefone', ''), '\D', '', 'g'), ''),
      LOWER(NULLIF(TRIM(payload->>'email'), '')),
      'row:' || id::text
    ) AS person_key
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
    person_key || '|online:' || online_date AS duplicate_key,
    FIRST_VALUE(id) OVER (
      PARTITION BY person_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS kept_id,
    ROW_NUMBER() OVER (
      PARTITION BY person_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS duplicate_rank
  FROM online_records
  WHERE person_key NOT LIKE 'row:%'
)
INSERT INTO inscricoes.online_duplicate_backups (
  kept_id,
  duplicate_id,
  duplicate_key,
  duplicate_payload,
  duplicate_criado_em
)
SELECT
  kept_id,
  id,
  duplicate_key,
  payload,
  criado_em
FROM ranked
WHERE duplicate_rank > 1
ON CONFLICT DO NOTHING;

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
    COALESCE(
      NULLIF(TRIM(payload->>'clientId'), ''),
      NULLIF(TRIM(payload->>'client_id'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(payload->>'telefone', payload->>'phone', payload->>'celular', payload->>'whatsapp', payload->>'dashboard_telefone', ''), '\D', '', 'g'), ''),
      LOWER(NULLIF(TRIM(payload->>'email'), '')),
      'row:' || id::text
    ) AS person_key
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
      PARTITION BY person_key, online_date
      ORDER BY criado_em DESC, id DESC
    ) AS duplicate_rank
  FROM online_records
  WHERE person_key NOT LIKE 'row:%'
)
DELETE FROM inscricoes.inscricoes AS i
USING ranked
WHERE i.id = ranked.id
  AND ranked.duplicate_rank > 1;

COMMIT;
