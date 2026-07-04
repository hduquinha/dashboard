-- ============================================
-- MIGRACAO: Corrigir cadastros de Encontro Online com treinamento antigo
-- ============================================
-- Alguns cadastros do Encontro Online foram sincronizados com
-- dashboard_treinamento/dashboard_tags antigos de Up Day Plus.
-- Quando existe data_treinamento/training_date e o payload nao tem sinais
-- de formulario Up Day, a data deve representar Encontro Online.
-- ============================================

BEGIN;

WITH candidates AS (
  SELECT
    id,
    payload,
    COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), ''),
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) AS online_date
  FROM inscricoes.inscricoes
  WHERE LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
    AND COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), ''),
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), '')
    ) IS NOT NULL
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
)
UPDATE inscricoes.inscricoes AS i
SET payload =
  jsonb_set(
    jsonb_set(
      i.payload - 'dashboard_treinamento',
      '{dashboard_treinamento}',
      to_jsonb('Encontro Online ' || candidates.online_date),
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
    ) || jsonb_build_array('Treinamento: Encontro Online ' || candidates.online_date),
    true
  )
FROM candidates
WHERE i.id = candidates.id
  AND COALESCE(i.payload->>'dashboard_treinamento', '') ILIKE 'Up Day Plus%';

COMMIT;
