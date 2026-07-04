-- ============================================
-- MIGRACAO: Corrigir Up Day Plus de agosto e data fantasma
-- ============================================
-- 1) Canonicaliza a turma de agosto para o rotulo usado no painel.
-- 2) Remove campos de treinamento da data 01/01/2026 / 01/0102026,
--    que nao corresponde a um encontro real.
-- ============================================

BEGIN;

WITH august_upday AS (
  SELECT id
  FROM inscricoes.inscricoes
  WHERE
    LOWER(TRIM(COALESCE(payload->>'origem', payload->>'source', payload->>'origin', ''))) = 'landing-inscricao-agosto-2026'
    OR COALESCE(payload->>'treinamento_inicio', payload->>'treinamentoInicio', payload->>'training_start', payload->>'trainingStart', '') LIKE '2026-08-15%'
    OR LOWER(TRIM(COALESCE(payload->>'treinamento_nome', payload->>'treinamentoNome', payload->>'treinamento', payload->>'training', ''))) LIKE '%agosto 2026%'
)
UPDATE inscricoes.inscricoes AS i
SET payload =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(i.payload, '{data_treinamento}', to_jsonb('15 e 16/08'::text), true),
          '{dataTreinamento}',
          to_jsonb('15 e 16/08'::text),
          true
        ),
        '{data_treinamento_extenso}',
        to_jsonb('15 e 16 de Agosto de 2026'::text),
        true
      ),
      '{dashboard_treinamento}',
      to_jsonb('Up Day Plus 15 e 16/08/2026'::text),
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
    ) || jsonb_build_array('Treinamento: Up Day Plus 15 e 16/08/2026'),
    true
  )
FROM august_upday
WHERE i.id = august_upday.id;

UPDATE inscricoes.inscricoes AS i
SET payload =
  jsonb_set(
    jsonb_set(
      i.payload,
      '{dashboard_treinamento}',
      to_jsonb('Up Day Plus 15 e 16/08/2026'::text),
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
    ) || jsonb_build_array('Treinamento: Up Day Plus 15 e 16/08/2026'),
    true
  )
WHERE payload->>'data_treinamento' = '15 e 16/08';

WITH fake_training AS (
  SELECT id
  FROM inscricoes.inscricoes
  WHERE
    COALESCE(
      NULLIF(TRIM(payload->>'treinamento'), ''),
      NULLIF(TRIM(payload->>'training'), ''),
      NULLIF(TRIM(payload->>'training_id'), ''),
      NULLIF(TRIM(payload->>'trainingId'), ''),
      NULLIF(TRIM(payload->>'training_code'), ''),
      NULLIF(TRIM(payload->>'trainingCode'), ''),
      NULLIF(TRIM(payload->>'treinamento_id'), ''),
      NULLIF(TRIM(payload->>'treinamento_nome'), ''),
      NULLIF(TRIM(payload->>'treinamentoNome'), ''),
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), ''),
      NULLIF(TRIM(payload->>'dashboard_treinamento'), ''),
      ''
    ) IN ('01/0102026', '01/010/2026', '01/01/02026', '2026-01-01', '2026-01-01T00:00:00-03:00', '2026-01-01T19:00:00-03:00')
    OR COALESCE(payload->>'dashboard_treinamento', '') ILIKE '%01/0102026%'
    OR COALESCE(payload->>'dashboard_treinamento', '') ILIKE '%01/01/2026%'
)
UPDATE inscricoes.inscricoes AS i
SET payload =
  jsonb_set(
    i.payload
      - 'treinamento'
      - 'training'
      - 'training_id'
      - 'trainingId'
      - 'training_code'
      - 'trainingCode'
      - 'treinamento_id'
      - 'treinamento_nome'
      - 'treinamentoNome'
      - 'training_option'
      - 'trainingOption'
      - 'data_treinamento'
      - 'dataTreinamento'
      - 'training_date'
      - 'trainingDate'
      - 'data_treinamento_extenso'
      - 'dataTreinamentoExtenso'
      - 'dashboard_treinamento'
      - 'presenca_treinamento_id',
    '{dashboard_tags}',
    COALESCE(
      (
        SELECT jsonb_agg(tag)
        FROM jsonb_array_elements(COALESCE(i.payload->'dashboard_tags', '[]'::jsonb)) AS tag
        WHERE tag #>> '{}' NOT ILIKE 'Treinamento:%01/0102026%'
          AND tag #>> '{}' NOT ILIKE 'Treinamento:%01/01/2026%'
      ),
      '[]'::jsonb
    ),
    true
  )
FROM fake_training
WHERE i.id = fake_training.id;

COMMIT;
