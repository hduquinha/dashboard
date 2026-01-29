-- ============================================
-- MIGRAÇÃO: Estrutura Normalizada do Dashboard
-- ============================================
-- Esta migração cria uma estrutura de dados normalizada
-- onde cada pessoa existe UMA vez e todas as informações
-- são relacionadas a ela.
-- ============================================

-- Schema separado para a nova estrutura
CREATE SCHEMA IF NOT EXISTS dashboard;

-- ============================================
-- TABELA: pessoas
-- Uma pessoa existe UMA vez. Todas as outras 
-- tabelas referenciam esta.
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.pessoas (
    id SERIAL PRIMARY KEY,
    
    -- Dados básicos (sempre atualizados em um lugar só)
    nome VARCHAR(255) NOT NULL,
    telefone VARCHAR(50),
    email VARCHAR(255),
    cidade VARCHAR(100),
    estado VARCHAR(50),
    profissao VARCHAR(100),
    
    -- Identificadores únicos para evitar duplicados
    telefone_normalizado VARCHAR(20), -- Só números
    email_normalizado VARCHAR(255),   -- Lowercase, sem espaços
    
    -- Metadados
    origem VARCHAR(100),              -- Como chegou (Meta Ads, RD Station, etc)
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Índices para busca rápida
    CONSTRAINT uk_pessoas_telefone UNIQUE (telefone_normalizado),
    CONSTRAINT uk_pessoas_email UNIQUE (email_normalizado)
);

-- Índices para busca
CREATE INDEX IF NOT EXISTS idx_pessoas_nome ON dashboard.pessoas(nome);
CREATE INDEX IF NOT EXISTS idx_pessoas_telefone ON dashboard.pessoas(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_pessoas_email ON dashboard.pessoas(email_normalizado);
CREATE INDEX IF NOT EXISTS idx_pessoas_criado_em ON dashboard.pessoas(criado_em DESC);

-- ============================================
-- TABELA: treinamentos
-- Cada treinamento/evento é uma entidade
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.treinamentos (
    id SERIAL PRIMARY KEY,
    
    -- Identificador único (ex: "2026-01-07" ou "turma-janeiro-2026")
    codigo VARCHAR(100) NOT NULL UNIQUE,
    
    -- Informações do treinamento
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    
    -- Datas
    data_inicio TIMESTAMP WITH TIME ZONE,
    data_fim TIMESTAMP WITH TIME ZONE,
    
    -- Status
    ativo BOOLEAN DEFAULT true,
    
    -- Metadados
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treinamentos_codigo ON dashboard.treinamentos(codigo);
CREATE INDEX IF NOT EXISTS idx_treinamentos_data ON dashboard.treinamentos(data_inicio DESC);

-- ============================================
-- TABELA: recrutadores
-- Pessoas que são recrutadores (tem código próprio)
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.recrutadores (
    id SERIAL PRIMARY KEY,
    
    -- Referência à pessoa (ÚNICA fonte de verdade)
    pessoa_id INTEGER NOT NULL REFERENCES dashboard.pessoas(id) ON DELETE CASCADE,
    
    -- Código do recrutador (único)
    codigo VARCHAR(50) NOT NULL UNIQUE,
    
    -- Recrutador que indicou este (hierarquia)
    recrutador_pai_id INTEGER REFERENCES dashboard.recrutadores(id),
    
    -- Nível na hierarquia (0 = raiz)
    nivel INTEGER DEFAULT 0,
    
    -- Status
    ativo BOOLEAN DEFAULT true,
    
    -- Metadados
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Uma pessoa só pode ser recrutador uma vez
    CONSTRAINT uk_recrutadores_pessoa UNIQUE (pessoa_id)
);

CREATE INDEX IF NOT EXISTS idx_recrutadores_codigo ON dashboard.recrutadores(codigo);
CREATE INDEX IF NOT EXISTS idx_recrutadores_pai ON dashboard.recrutadores(recrutador_pai_id);

-- ============================================
-- TABELA: inscricoes
-- Inscrição de uma pessoa em um treinamento
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.inscricoes_v2 (
    id SERIAL PRIMARY KEY,
    
    -- Referências (pessoa existe UMA vez)
    pessoa_id INTEGER NOT NULL REFERENCES dashboard.pessoas(id) ON DELETE CASCADE,
    treinamento_id INTEGER NOT NULL REFERENCES dashboard.treinamentos(id) ON DELETE CASCADE,
    
    -- Quem indicou (opcional)
    recrutador_id INTEGER REFERENCES dashboard.recrutadores(id),
    
    -- Status da inscrição
    status VARCHAR(20) DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'aprovado', 'rejeitado', 'cancelado')),
    status_atualizado_em TIMESTAMP WITH TIME ZONE,
    status_whatsapp_contatado BOOLEAN DEFAULT false,
    
    -- Notas/observações (JSON array)
    notas JSONB DEFAULT '[]'::jsonb,
    
    -- Dados extras da inscrição original (para não perder nada)
    dados_extras JSONB DEFAULT '{}'::jsonb,
    
    -- Metadados
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Uma pessoa só pode se inscrever uma vez por treinamento
    CONSTRAINT uk_inscricoes_pessoa_treinamento UNIQUE (pessoa_id, treinamento_id)
);

CREATE INDEX IF NOT EXISTS idx_inscricoes_v2_pessoa ON dashboard.inscricoes_v2(pessoa_id);
CREATE INDEX IF NOT EXISTS idx_inscricoes_v2_treinamento ON dashboard.inscricoes_v2(treinamento_id);
CREATE INDEX IF NOT EXISTS idx_inscricoes_v2_recrutador ON dashboard.inscricoes_v2(recrutador_id);
CREATE INDEX IF NOT EXISTS idx_inscricoes_v2_status ON dashboard.inscricoes_v2(status);
CREATE INDEX IF NOT EXISTS idx_inscricoes_v2_criado_em ON dashboard.inscricoes_v2(criado_em DESC);

-- ============================================
-- TABELA: presencas
-- Registro de presença em encontros/lives
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.presencas (
    id SERIAL PRIMARY KEY,
    
    -- Referências
    pessoa_id INTEGER NOT NULL REFERENCES dashboard.pessoas(id) ON DELETE CASCADE,
    treinamento_id INTEGER NOT NULL REFERENCES dashboard.treinamentos(id) ON DELETE CASCADE,
    
    -- Nome usado no Zoom (pode ser diferente do cadastro)
    nome_zoom VARCHAR(255),
    email_zoom VARCHAR(255),
    
    -- Dados de presença
    tempo_total_minutos INTEGER NOT NULL DEFAULT 0,
    tempo_dinamica_minutos INTEGER NOT NULL DEFAULT 0,
    percentual_dinamica INTEGER NOT NULL DEFAULT 0,
    
    -- Validação
    aprovado BOOLEAN DEFAULT false,
    cumpriu_tempo_minimo BOOLEAN DEFAULT false,
    cumpriu_dinamica BOOLEAN DEFAULT false,
    
    -- Configuração usada na validação
    tempo_minimo_exigido INTEGER,
    percentual_minimo_exigido INTEGER,
    
    -- Status da associação
    associacao_status VARCHAR(20) DEFAULT 'auto-matched' 
        CHECK (associacao_status IN ('auto-matched', 'suggested', 'manual-pending', 'confirmed', 'rejected')),
    associacao_score INTEGER DEFAULT 0,
    
    -- Metadados
    validado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    validado_por VARCHAR(100),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Uma pessoa só tem uma presença por treinamento
    CONSTRAINT uk_presencas_pessoa_treinamento UNIQUE (pessoa_id, treinamento_id)
);

CREATE INDEX IF NOT EXISTS idx_presencas_pessoa ON dashboard.presencas(pessoa_id);
CREATE INDEX IF NOT EXISTS idx_presencas_treinamento ON dashboard.presencas(treinamento_id);
CREATE INDEX IF NOT EXISTS idx_presencas_aprovado ON dashboard.presencas(aprovado);

-- ============================================
-- TABELA: anamneses
-- Respostas de anamnese vinculadas à pessoa
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard.anamneses (
    id SERIAL PRIMARY KEY,
    
    -- Referência à pessoa
    pessoa_id INTEGER NOT NULL REFERENCES dashboard.pessoas(id) ON DELETE CASCADE,
    treinamento_id INTEGER REFERENCES dashboard.treinamentos(id),
    
    -- Dados da anamnese
    respostas JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Link único do formulário
    link_hash VARCHAR(100),
    respondido_em TIMESTAMP WITH TIME ZONE,
    
    -- Metadados
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anamneses_pessoa ON dashboard.anamneses(pessoa_id);
CREATE INDEX IF NOT EXISTS idx_anamneses_link ON dashboard.anamneses(link_hash);

-- ============================================
-- VIEW: pessoa_completa
-- Mostra todos os dados de uma pessoa em uma consulta
-- ============================================
CREATE OR REPLACE VIEW dashboard.pessoa_completa AS
SELECT 
    p.id,
    p.nome,
    p.telefone,
    p.email,
    p.cidade,
    p.estado,
    p.profissao,
    p.origem,
    p.criado_em,
    
    -- É recrutador?
    r.id IS NOT NULL AS is_recrutador,
    r.codigo AS recrutador_codigo,
    r.nivel AS recrutador_nivel,
    
    -- Contadores
    (SELECT COUNT(*) FROM dashboard.inscricoes_v2 i WHERE i.pessoa_id = p.id) AS total_inscricoes,
    (SELECT COUNT(*) FROM dashboard.presencas pr WHERE pr.pessoa_id = p.id AND pr.aprovado = true) AS total_presencas_aprovadas,
    
    -- Última inscrição
    (SELECT t.nome FROM dashboard.inscricoes_v2 i 
     JOIN dashboard.treinamentos t ON t.id = i.treinamento_id 
     WHERE i.pessoa_id = p.id 
     ORDER BY i.criado_em DESC LIMIT 1) AS ultimo_treinamento,
    
    -- Quem indicou
    (SELECT rp.nome FROM dashboard.inscricoes_v2 i 
     JOIN dashboard.recrutadores rec ON rec.id = i.recrutador_id
     JOIN dashboard.pessoas rp ON rp.id = rec.pessoa_id
     WHERE i.pessoa_id = p.id 
     ORDER BY i.criado_em DESC LIMIT 1) AS indicado_por

FROM dashboard.pessoas p
LEFT JOIN dashboard.recrutadores r ON r.pessoa_id = p.id;

-- ============================================
-- FUNÇÃO: normalizar_telefone
-- Remove tudo exceto números
-- ============================================
CREATE OR REPLACE FUNCTION dashboard.normalizar_telefone(tel VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
    IF tel IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN REGEXP_REPLACE(tel, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- FUNÇÃO: normalizar_email
-- Lowercase e trim
-- ============================================
CREATE OR REPLACE FUNCTION dashboard.normalizar_email(email VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
    IF email IS NULL OR TRIM(email) = '' THEN
        RETURN NULL;
    END IF;
    RETURN LOWER(TRIM(email));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- TRIGGER: atualizar timestamps
-- ============================================
CREATE OR REPLACE FUNCTION dashboard.trigger_atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplica trigger em todas as tabelas
DO $$
DECLARE
    tabela TEXT;
BEGIN
    FOREACH tabela IN ARRAY ARRAY['pessoas', 'treinamentos', 'recrutadores', 'inscricoes_v2', 'anamneses']
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trigger_atualizado_em ON dashboard.%I;
            CREATE TRIGGER trigger_atualizado_em
            BEFORE UPDATE ON dashboard.%I
            FOR EACH ROW
            EXECUTE FUNCTION dashboard.trigger_atualizar_timestamp();
        ', tabela, tabela);
    END LOOP;
END;
$$;

-- ============================================
-- TRIGGER: normalizar dados na inserção
-- ============================================
CREATE OR REPLACE FUNCTION dashboard.trigger_normalizar_pessoa()
RETURNS TRIGGER AS $$
BEGIN
    NEW.telefone_normalizado = dashboard.normalizar_telefone(NEW.telefone);
    NEW.email_normalizado = dashboard.normalizar_email(NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_normalizar ON dashboard.pessoas;
CREATE TRIGGER trigger_normalizar
BEFORE INSERT OR UPDATE ON dashboard.pessoas
FOR EACH ROW
EXECUTE FUNCTION dashboard.trigger_normalizar_pessoa();

-- ============================================
-- Comentários nas tabelas
-- ============================================
COMMENT ON TABLE dashboard.pessoas IS 'Tabela principal de pessoas. Cada pessoa existe UMA vez aqui.';
COMMENT ON TABLE dashboard.treinamentos IS 'Treinamentos/eventos. Cada treinamento é único.';
COMMENT ON TABLE dashboard.recrutadores IS 'Pessoas que são recrutadores. Referencia pessoas.';
COMMENT ON TABLE dashboard.inscricoes_v2 IS 'Inscrições de pessoas em treinamentos.';
COMMENT ON TABLE dashboard.presencas IS 'Registro de presença em encontros/lives.';
COMMENT ON TABLE dashboard.anamneses IS 'Respostas de anamnese vinculadas a pessoas.';
COMMENT ON VIEW dashboard.pessoa_completa IS 'View que mostra todos os dados de uma pessoa consolidados.';
