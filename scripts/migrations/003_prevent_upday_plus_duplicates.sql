-- ============================================
-- MIGRACAO: Evitar duplicidade no Up Day Plus
-- ============================================
-- O formulario do Up Day Plus salva uma linha a cada etapa.
-- Esta migracao transforma novas linhas repetidas em atualizacoes
-- do mesmo cadastro, usando CPF + turma como chave principal.
-- Antes de remover duplicados existentes, os registros apagados
-- sao copiados para inscricoes.upday_duplicate_backups.
-- ============================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS inscricoes;

CREATE TABLE IF NOT EXISTS inscricoes.upday_duplicate_backups (
    id BIGSERIAL PRIMARY KEY,
    kept_id INTEGER NOT NULL,
    duplicate_id INTEGER NOT NULL,
    duplicate_key TEXT NOT NULL,
    duplicate_payload JSONB NOT NULL,
    duplicate_criado_em TIMESTAMP WITH TIME ZONE NOT NULL,
    backed_up_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reason TEXT NOT NULL DEFAULT 'upday_plus_duplicate_cleanup'
);

CREATE OR REPLACE FUNCTION inscricoes.upday_json_text(data JSONB, VARIADIC keys TEXT[])
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    key TEXT;
    value TEXT;
BEGIN
    IF data IS NULL THEN
        RETURN '';
    END IF;

    FOREACH key IN ARRAY keys LOOP
        value := NULLIF(BTRIM(data ->> key), '');
        IF value IS NOT NULL THEN
            RETURN value;
        END IF;

        value := NULLIF(BTRIM(data #>> ARRAY['dados_extras', key]), '');
        IF value IS NOT NULL THEN
            RETURN value;
        END IF;

        value := NULLIF(BTRIM(data #>> ARRAY['dadosExtras', key]), '');
        IF value IS NOT NULL THEN
            RETURN value;
        END IF;

        value := NULLIF(BTRIM(data #>> ARRAY['pessoa', key]), '');
        IF value IS NOT NULL THEN
            RETURN value;
        END IF;
    END LOOP;

    RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_normalize_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT LOWER(REGEXP_REPLACE(BTRIM(COALESCE($1, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_digits(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT REGEXP_REPLACE(COALESCE($1, ''), '\D', '', 'g');
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_jsonb_has_value(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE JSONB_TYPEOF($1)
        WHEN 'null' THEN FALSE
        WHEN 'string' THEN BTRIM($1 #>> '{}') <> ''
        WHEN 'array' THEN $1 <> '[]'::JSONB
        WHEN 'object' THEN $1 <> '{}'::JSONB
        ELSE $1 IS NOT NULL
    END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_is_payload(data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    training_name TEXT;
    origin_name TEXT;
BEGIN
    training_name := inscricoes.upday_normalize_text(inscricoes.upday_json_text(
        data,
        'treinamento_nome',
        'treinamentoNome',
        'nome_treinamento',
        'trainingName',
        'treinamento',
        'training'
    ));
    origin_name := inscricoes.upday_normalize_text(inscricoes.upday_json_text(
        data,
        'origem',
        'source',
        'origin'
    ));

    RETURN training_name LIKE '%up day%'
        OR origin_name = 'landing-inscricao-agosto-2026'
        OR (
            inscricoes.upday_json_text(data, 'tamanho_camiseta', 'multa_ciente', 'cancelamento_ciente') <> ''
            AND inscricoes.upday_json_text(data, 'data_treinamento', 'dataTreinamento', 'data_treinamento_extenso') <> ''
        );
END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_training_key(data JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    training_name TEXT;
    training_date TEXT;
    training_start TEXT;
BEGIN
    training_name := inscricoes.upday_normalize_text(inscricoes.upday_json_text(
        data,
        'treinamento_nome',
        'treinamentoNome',
        'nome_treinamento',
        'trainingName',
        'treinamento',
        'training'
    ));
    training_date := inscricoes.upday_normalize_text(inscricoes.upday_json_text(
        data,
        'data_treinamento',
        'dataTreinamento',
        'training_date',
        'trainingDate',
        'data_treinamento_extenso',
        'dataTreinamentoExtenso'
    ));
    training_start := inscricoes.upday_normalize_text(inscricoes.upday_json_text(
        data,
        'treinamento_inicio',
        'treinamentoInicio',
        'training_start',
        'trainingStart'
    ));

    RETURN CONCAT_WS(
        '|',
        NULLIF(training_name, ''),
        NULLIF(training_date, ''),
        NULLIF(training_start, '')
    );
END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_person_key(data JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cpf_digits TEXT;
    email_value TEXT;
    phone_digits TEXT;
    client_id TEXT;
BEGIN
    cpf_digits := inscricoes.upday_digits(inscricoes.upday_json_text(data, 'cpf', 'documento', 'document'));
    IF LENGTH(cpf_digits) >= 11 THEN
        RETURN 'cpf:' || cpf_digits;
    END IF;

    email_value := inscricoes.upday_normalize_text(inscricoes.upday_json_text(data, 'email', 'e-mail'));
    IF email_value LIKE '%@%' THEN
        RETURN 'email:' || email_value;
    END IF;

    phone_digits := inscricoes.upday_digits(inscricoes.upday_json_text(
        data,
        'telefone',
        'phone',
        'celular',
        'whatsapp'
    ));
    IF LENGTH(phone_digits) >= 10 THEN
        RETURN 'phone:' || phone_digits;
    END IF;

    client_id := inscricoes.upday_normalize_text(inscricoes.upday_json_text(data, 'clientId', 'client_id'));
    IF client_id <> '' THEN
        RETURN 'client:' || client_id;
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_client_key(data JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(inscricoes.upday_normalize_text(inscricoes.upday_json_text($1, 'clientId', 'client_id')), '');
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_duplicate_key(data JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    person_key TEXT;
    training_key TEXT;
BEGIN
    IF NOT inscricoes.upday_is_payload(data) THEN
        RETURN NULL;
    END IF;

    person_key := inscricoes.upday_person_key(data);
    IF person_key IS NULL THEN
        RETURN NULL;
    END IF;

    training_key := inscricoes.upday_training_key(data);
    IF training_key = '' THEN
        training_key := 'sem-turma';
    END IF;

    RETURN person_key || '|training:' || training_key;
END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_payload_score(data JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COUNT(*)::INTEGER
    FROM JSONB_EACH(COALESCE($1, '{}'::JSONB)) AS item(key, value)
    WHERE inscricoes.upday_jsonb_has_value(item.value);
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_payload_step(data JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN COALESCE($1 ->> '_step', '') ~ '^\d+$' THEN ($1 ->> '_step')::INTEGER
        ELSE 0
    END;
$$;

CREATE OR REPLACE FUNCTION inscricoes.upday_merge_payload(existing JSONB, incoming JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    WITH keys AS (
        SELECT JSONB_OBJECT_KEYS(COALESCE(existing, '{}'::JSONB)) AS key
        UNION
        SELECT JSONB_OBJECT_KEYS(COALESCE(incoming, '{}'::JSONB)) AS key
    ),
    merged AS (
        SELECT
            key,
            CASE
                WHEN key = '_final' THEN TO_JSONB(
                    COALESCE((existing ->> key) = 'true', FALSE)
                    OR COALESCE((incoming ->> key) = 'true', FALSE)
                )
                WHEN key = '_step' THEN TO_JSONB(GREATEST(
                    CASE
                        WHEN COALESCE(existing ->> key, '') ~ '^\d+$' THEN (existing ->> key)::INTEGER
                        ELSE 0
                    END,
                    CASE
                        WHEN COALESCE(incoming ->> key, '') ~ '^\d+$' THEN (incoming ->> key)::INTEGER
                        ELSE 0
                    END
                ))
                WHEN incoming ? key AND inscricoes.upday_jsonb_has_value(incoming -> key) THEN incoming -> key
                ELSE existing -> key
            END AS value
        FROM keys
    )
    SELECT COALESCE(JSONB_OBJECT_AGG(key, value), '{}'::JSONB)
    FROM merged
    WHERE value IS NOT NULL;
$$;

DO $$
DECLARE
    duplicate_group RECORD;
    duplicate_row RECORD;
    keep_id INTEGER;
    merged_payload JSONB;
    latest_created_at TIMESTAMP WITH TIME ZONE;
    deleted_in_group INTEGER;
    deleted_total INTEGER := 0;
    group_total INTEGER := 0;
BEGIN
    FOR duplicate_group IN
        SELECT duplicate_key, ARRAY_AGG(id ORDER BY criado_em, id) AS ids
        FROM (
            SELECT id, criado_em, inscricoes.upday_duplicate_key(payload) AS duplicate_key
            FROM inscricoes.inscricoes
        ) keyed
        WHERE duplicate_key IS NOT NULL
        GROUP BY duplicate_key
        HAVING COUNT(*) > 1
    LOOP
        group_total := group_total + 1;
        merged_payload := '{}'::JSONB;
        latest_created_at := NULL;

        FOR duplicate_row IN
            SELECT id, payload, criado_em
            FROM inscricoes.inscricoes
            WHERE id = ANY(duplicate_group.ids)
            ORDER BY criado_em, id
        LOOP
            merged_payload := inscricoes.upday_merge_payload(merged_payload, duplicate_row.payload);
            latest_created_at := GREATEST(COALESCE(latest_created_at, duplicate_row.criado_em), duplicate_row.criado_em);
        END LOOP;

        SELECT id
        INTO keep_id
        FROM inscricoes.inscricoes
        WHERE id = ANY(duplicate_group.ids)
        ORDER BY
            COALESCE((payload ->> '_final') = 'true', FALSE) DESC,
            inscricoes.upday_payload_step(payload) DESC,
            inscricoes.upday_payload_score(payload) DESC,
            criado_em DESC,
            id DESC
        LIMIT 1;

        UPDATE inscricoes.inscricoes
        SET payload = merged_payload,
            criado_em = latest_created_at
        WHERE id = keep_id;

        INSERT INTO inscricoes.upday_duplicate_backups (
            kept_id,
            duplicate_id,
            duplicate_key,
            duplicate_payload,
            duplicate_criado_em
        )
        SELECT
            keep_id,
            id,
            duplicate_group.duplicate_key,
            payload,
            criado_em
        FROM inscricoes.inscricoes
        WHERE id = ANY(duplicate_group.ids)
          AND id <> keep_id;

        DELETE FROM inscricoes.inscricoes
        WHERE id = ANY(duplicate_group.ids)
          AND id <> keep_id;

        GET DIAGNOSTICS deleted_in_group = ROW_COUNT;
        deleted_total := deleted_total + deleted_in_group;
    END LOOP;

    RAISE NOTICE 'Up Day Plus duplicate cleanup: % groups merged, % duplicate rows backed up and removed.', group_total, deleted_total;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_inscricoes_upday_duplicate_key
ON inscricoes.inscricoes ((inscricoes.upday_duplicate_key(payload)))
WHERE inscricoes.upday_duplicate_key(payload) IS NOT NULL;

CREATE OR REPLACE FUNCTION inscricoes.merge_upday_duplicate_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    duplicate_key TEXT;
    client_key TEXT;
    target_id INTEGER;
BEGIN
    duplicate_key := inscricoes.upday_duplicate_key(NEW.payload);
    client_key := inscricoes.upday_client_key(NEW.payload);

    IF duplicate_key IS NULL AND client_key IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXTEXTENDED(
        'inscricoes.upday:' || COALESCE(duplicate_key, 'client:' || client_key),
        0
    ));

    SELECT id
    INTO target_id
    FROM inscricoes.inscricoes
    WHERE (
        duplicate_key IS NOT NULL
        AND inscricoes.upday_duplicate_key(payload) = duplicate_key
    )
    OR (
        client_key IS NOT NULL
        AND inscricoes.upday_client_key(payload) = client_key
        AND inscricoes.upday_is_payload(payload)
    )
    ORDER BY
        COALESCE((payload ->> '_final') = 'true', FALSE) DESC,
        inscricoes.upday_payload_step(payload) DESC,
        inscricoes.upday_payload_score(payload) DESC,
        criado_em DESC,
        id DESC
    LIMIT 1;

    IF target_id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE inscricoes.inscricoes
    SET payload = inscricoes.upday_merge_payload(payload, NEW.payload),
        criado_em = GREATEST(criado_em, COALESCE(NEW.criado_em, NOW()))
    WHERE id = target_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS merge_upday_duplicate_before_insert ON inscricoes.inscricoes;

CREATE TRIGGER merge_upday_duplicate_before_insert
BEFORE INSERT ON inscricoes.inscricoes
FOR EACH ROW
EXECUTE FUNCTION inscricoes.merge_upday_duplicate_before_insert();

COMMIT;
