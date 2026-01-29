-- ============================================
-- MIGRAÇÃO: Importar dados da tabela antiga
-- ============================================
-- Este script migra os dados de inscricoes.inscricoes
-- para a nova estrutura normalizada em dashboard.*
-- ============================================

-- ============================================
-- PASSO 1: Criar treinamentos únicos
-- ============================================
INSERT INTO dashboard.treinamentos (codigo, nome, data_inicio)
SELECT DISTINCT
    TRIM(COALESCE(
        NULLIF(TRIM(payload->>'treinamento'), ''),
        NULLIF(TRIM(payload->>'training'), ''),
        NULLIF(TRIM(payload->>'training_date'), ''),
        NULLIF(TRIM(payload->>'data_treinamento'), ''),
        'sem-treinamento'
    )) AS codigo,
    TRIM(COALESCE(
        NULLIF(TRIM(payload->>'treinamento'), ''),
        NULLIF(TRIM(payload->>'training'), ''),
        NULLIF(TRIM(payload->>'training_date'), ''),
        NULLIF(TRIM(payload->>'data_treinamento'), ''),
        'Sem Treinamento'
    )) AS nome,
    -- Tenta extrair data se o código parecer uma data ISO
    CASE 
        WHEN TRIM(COALESCE(
            NULLIF(TRIM(payload->>'treinamento'), ''),
            'x'
        )) ~ '^\d{4}-\d{2}-\d{2}' 
        THEN TRIM(COALESCE(
            NULLIF(TRIM(payload->>'treinamento'), ''),
            NULLIF(TRIM(payload->>'training'), ''),
            NULLIF(TRIM(payload->>'training_date'), ''),
            NULLIF(TRIM(payload->>'data_treinamento'), ''),
            'sem-treinamento'
        ))::timestamp with time zone
        ELSE NULL
    END AS data_inicio
FROM inscricoes.inscricoes
WHERE TRIM(COALESCE(
    NULLIF(TRIM(payload->>'treinamento'), ''),
    NULLIF(TRIM(payload->>'training'), ''),
    NULLIF(TRIM(payload->>'training_date'), ''),
    NULLIF(TRIM(payload->>'data_treinamento'), ''),
    'sem-treinamento'
)) != 'sem-treinamento'
ON CONFLICT (codigo) DO NOTHING;

-- ============================================
-- PASSO 2: Criar pessoas únicas
-- ============================================
-- Primeiro, vamos criar uma tabela temporária para deduplicar
CREATE TEMP TABLE temp_pessoas_unicas AS
WITH ranked AS (
    SELECT 
        payload->>'nome' AS nome,
        payload->>'telefone' AS telefone,
        payload->>'email' AS email,
        payload->>'cidade' AS cidade,
        payload->>'estado' AS estado,
        payload->>'profissao' AS profissao,
        payload->>'origem' AS origem,
        criado_em,
        dashboard.normalizar_telefone(payload->>'telefone') AS telefone_norm,
        dashboard.normalizar_email(payload->>'email') AS email_norm,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(
                NULLIF(dashboard.normalizar_telefone(payload->>'telefone'), ''),
                NULLIF(dashboard.normalizar_email(payload->>'email'), ''),
                payload->>'nome' || '_' || id::text
            )
            ORDER BY criado_em ASC
        ) AS rn
    FROM inscricoes.inscricoes
    WHERE payload->>'nome' IS NOT NULL 
      AND TRIM(payload->>'nome') != ''
)
SELECT 
    nome,
    telefone,
    email,
    cidade,
    estado,
    profissao,
    origem,
    criado_em,
    telefone_norm,
    email_norm
FROM ranked
WHERE rn = 1;

-- Insere pessoas únicas
INSERT INTO dashboard.pessoas (
    nome, telefone, email, cidade, estado, profissao, origem, criado_em
)
SELECT 
    nome,
    telefone,
    email,
    cidade,
    estado,
    profissao,
    origem,
    criado_em
FROM temp_pessoas_unicas
ON CONFLICT (telefone_normalizado) DO NOTHING;

-- Para emails únicos que não entraram por telefone
INSERT INTO dashboard.pessoas (
    nome, telefone, email, cidade, estado, profissao, origem, criado_em
)
SELECT 
    t.nome,
    t.telefone,
    t.email,
    t.cidade,
    t.estado,
    t.profissao,
    t.origem,
    t.criado_em
FROM temp_pessoas_unicas t
WHERE t.telefone_norm IS NULL 
  AND t.email_norm IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM dashboard.pessoas p 
      WHERE p.email_normalizado = t.email_norm
  )
ON CONFLICT (email_normalizado) DO NOTHING;

DROP TABLE temp_pessoas_unicas;

-- ============================================
-- PASSO 3: Criar recrutadores
-- ============================================
INSERT INTO dashboard.recrutadores (pessoa_id, codigo)
SELECT DISTINCT
    p.id,
    UPPER(TRIM(COALESCE(
        NULLIF(TRIM(i.payload->>'codigoRecrutador'), ''),
        NULLIF(TRIM(i.payload->>'codigo_recrutador'), ''),
        NULLIF(TRIM(i.payload->>'codigo'), ''),
        NULLIF(TRIM(i.payload->>'codigoProprio'), ''),
        NULLIF(TRIM(i.payload->>'codigo_indicador_proprio'), '')
    ))) AS codigo
FROM inscricoes.inscricoes i
JOIN dashboard.pessoas p ON (
    p.telefone_normalizado = dashboard.normalizar_telefone(i.payload->>'telefone')
    OR (p.telefone_normalizado IS NULL AND p.email_normalizado = dashboard.normalizar_email(i.payload->>'email'))
)
WHERE COALESCE(
    NULLIF(TRIM(i.payload->>'codigoRecrutador'), ''),
    NULLIF(TRIM(i.payload->>'codigo_recrutador'), ''),
    NULLIF(TRIM(i.payload->>'codigo'), ''),
    NULLIF(TRIM(i.payload->>'codigoProprio'), ''),
    NULLIF(TRIM(i.payload->>'codigo_indicador_proprio'), '')
) IS NOT NULL
ON CONFLICT (codigo) DO NOTHING;

-- ============================================
-- PASSO 4: Criar inscrições
-- ============================================
INSERT INTO dashboard.inscricoes_v2 (
    pessoa_id,
    treinamento_id,
    recrutador_id,
    status,
    notas,
    dados_extras,
    criado_em
)
SELECT 
    p.id AS pessoa_id,
    t.id AS treinamento_id,
    r.id AS recrutador_id,
    COALESCE(
        NULLIF(LOWER(TRIM(i.payload->>'dashboard_status')), ''),
        NULLIF(LOWER(TRIM(i.payload->>'status')), ''),
        'aguardando'
    ) AS status,
    COALESCE(i.payload->'dashboard_notes', '[]'::jsonb) AS notas,
    i.payload AS dados_extras,
    i.criado_em
FROM inscricoes.inscricoes i
JOIN dashboard.pessoas p ON (
    p.telefone_normalizado = dashboard.normalizar_telefone(i.payload->>'telefone')
    OR (p.telefone_normalizado IS NULL AND p.email_normalizado = dashboard.normalizar_email(i.payload->>'email'))
)
LEFT JOIN dashboard.treinamentos t ON t.codigo = TRIM(COALESCE(
    NULLIF(TRIM(i.payload->>'treinamento'), ''),
    NULLIF(TRIM(i.payload->>'training'), ''),
    NULLIF(TRIM(i.payload->>'training_date'), ''),
    NULLIF(TRIM(i.payload->>'data_treinamento'), ''),
    'sem-treinamento'
))
LEFT JOIN dashboard.recrutadores r ON r.codigo = UPPER(TRIM(COALESCE(
    NULLIF(TRIM(i.payload->>'traffic_source'), ''),
    NULLIF(TRIM(i.payload->>'indicacao'), '')
)))
ON CONFLICT (pessoa_id, treinamento_id) DO UPDATE SET
    status = EXCLUDED.status,
    notas = EXCLUDED.notas,
    dados_extras = EXCLUDED.dados_extras;

-- ============================================
-- PASSO 5: Migrar presenças já validadas
-- ============================================
INSERT INTO dashboard.presencas (
    pessoa_id,
    treinamento_id,
    nome_zoom,
    tempo_total_minutos,
    tempo_dinamica_minutos,
    percentual_dinamica,
    aprovado,
    cumpriu_tempo_minimo,
    cumpriu_dinamica,
    validado_em
)
SELECT 
    p.id AS pessoa_id,
    t.id AS treinamento_id,
    i.payload->>'presenca_participante_nome' AS nome_zoom,
    (i.payload->>'presenca_tempo_total_minutos')::integer AS tempo_total_minutos,
    (i.payload->>'presenca_tempo_dinamica_minutos')::integer AS tempo_dinamica_minutos,
    (i.payload->>'presenca_percentual_dinamica')::integer AS percentual_dinamica,
    (i.payload->>'presenca_aprovada')::boolean AS aprovado,
    true AS cumpriu_tempo_minimo,
    true AS cumpriu_dinamica,
    (i.payload->>'presenca_validada_em')::timestamp with time zone AS validado_em
FROM inscricoes.inscricoes i
JOIN dashboard.pessoas p ON (
    p.telefone_normalizado = dashboard.normalizar_telefone(i.payload->>'telefone')
    OR (p.telefone_normalizado IS NULL AND p.email_normalizado = dashboard.normalizar_email(i.payload->>'email'))
)
LEFT JOIN dashboard.treinamentos t ON t.codigo = TRIM(COALESCE(
    NULLIF(TRIM(i.payload->>'presenca_treinamento_id'), ''),
    NULLIF(TRIM(i.payload->>'treinamento'), ''),
    'sem-treinamento'
))
WHERE i.payload->>'presenca_validada' = 'true'
ON CONFLICT (pessoa_id, treinamento_id) DO NOTHING;

-- ============================================
-- Resumo da migração
-- ============================================
SELECT 'Migração concluída!' AS status;
SELECT 'Pessoas:' AS tabela, COUNT(*) AS total FROM dashboard.pessoas
UNION ALL
SELECT 'Treinamentos:', COUNT(*) FROM dashboard.treinamentos
UNION ALL
SELECT 'Recrutadores:', COUNT(*) FROM dashboard.recrutadores
UNION ALL
SELECT 'Inscrições:', COUNT(*) FROM dashboard.inscricoes_v2
UNION ALL
SELECT 'Presenças:', COUNT(*) FROM dashboard.presencas;
