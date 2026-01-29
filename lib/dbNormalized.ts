/**
 * Biblioteca de acesso ao banco de dados normalizado
 * 
 * PRINCÍPIO: Uma pessoa existe UMA vez. Todas as consultas
 * retornam dados consolidados através de JOINs.
 */

import { getPool } from "./db";
import type {
  Pessoa,
  PessoaCompleta,
  Treinamento,
  TreinamentoComEstatisticas,
  Recrutador,
  RecrutadorCompleto,
  InscricaoV2,
  InscricaoCompletaV2,
  InscricaoStatusV2,
  InscricaoNota,
  PresencaV2,
  PresencaCompletaV2,
  AssociacaoStatusV2,
  FiltrosPessoas,
  FiltrosInscricoes,
  FiltrosPresencas,
  PaginacaoOpcoes,
  ResultadoPaginado,
} from "@/types/database";

const SCHEMA = "dashboard";

// ============================================
// PESSOAS
// ============================================

/**
 * Busca pessoa por ID
 */
export async function getPessoaById(id: number): Promise<PessoaCompleta | null> {
  const pool = getPool();
  
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    telefone: string | null;
    email: string | null;
    cidade: string | null;
    estado: string | null;
    profissao: string | null;
    origem: string | null;
    telefone_normalizado: string | null;
    email_normalizado: string | null;
    criado_em: Date;
    is_recrutador: boolean;
    recrutador_codigo: string | null;
    recrutador_nivel: number | null;
    total_inscricoes: string;
    total_presencas_aprovadas: string;
    ultimo_treinamento: string | null;
    indicado_por: string | null;
  }>(`
    SELECT * FROM ${SCHEMA}.pessoa_completa WHERE id = $1
  `, [id]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    email: row.email,
    cidade: row.cidade,
    estado: row.estado,
    profissao: row.profissao,
    origem: row.origem,
    telefoneNormalizado: row.telefone_normalizado,
    emailNormalizado: row.email_normalizado,
    criadoEm: row.criado_em.toISOString(),
    atualizadoEm: row.criado_em.toISOString(),
    isRecrutador: row.is_recrutador,
    recrutadorCodigo: row.recrutador_codigo,
    recrutadorNivel: row.recrutador_nivel,
    totalInscricoes: parseInt(row.total_inscricoes, 10),
    totalPresencasAprovadas: parseInt(row.total_presencas_aprovadas, 10),
    ultimoTreinamento: row.ultimo_treinamento,
    indicadoPor: row.indicado_por,
  };
}

/**
 * Busca pessoa por telefone
 */
export async function getPessoaByTelefone(telefone: string): Promise<Pessoa | null> {
  const pool = getPool();
  
  const { rows } = await pool.query(`
    SELECT * FROM ${SCHEMA}.pessoas 
    WHERE telefone_normalizado = ${SCHEMA}.normalizar_telefone($1)
  `, [telefone]);

  if (rows.length === 0) return null;
  return mapRowToPessoa(rows[0]);
}

/**
 * Busca pessoa por email
 */
export async function getPessoaByEmail(email: string): Promise<Pessoa | null> {
  const pool = getPool();
  
  const { rows } = await pool.query(`
    SELECT * FROM ${SCHEMA}.pessoas 
    WHERE email_normalizado = ${SCHEMA}.normalizar_email($1)
  `, [email]);

  if (rows.length === 0) return null;
  return mapRowToPessoa(rows[0]);
}

/**
 * Lista pessoas com filtros e paginação
 */
export async function listPessoas(
  filtros: FiltrosPessoas = {},
  opcoes: PaginacaoOpcoes = {}
): Promise<ResultadoPaginado<PessoaCompleta>> {
  const pool = getPool();
  const page = opcoes.page ?? 1;
  const pageSize = opcoes.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filtros.nome) {
    conditions.push(`nome ILIKE $${paramIndex++}`);
    params.push(`%${filtros.nome}%`);
  }

  if (filtros.telefone) {
    conditions.push(`telefone_normalizado LIKE $${paramIndex++}`);
    params.push(`%${filtros.telefone.replace(/\D/g, "")}%`);
  }

  if (filtros.email) {
    conditions.push(`email_normalizado ILIKE $${paramIndex++}`);
    params.push(`%${filtros.email.toLowerCase()}%`);
  }

  if (filtros.isRecrutador !== undefined) {
    conditions.push(`is_recrutador = $${paramIndex++}`);
    params.push(filtros.isRecrutador);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = opcoes.orderBy ?? "criado_em";
  const orderDir = opcoes.orderDirection ?? "desc";

  // Conta total
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ${SCHEMA}.pessoa_completa ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Busca página
  params.push(pageSize, offset);
  const { rows } = await pool.query(`
    SELECT * FROM ${SCHEMA}.pessoa_completa
    ${whereClause}
    ORDER BY ${orderBy} ${orderDir}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `, params);

  return {
    data: rows.map(mapRowToPessoaCompleta),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Cria ou atualiza pessoa (upsert por telefone/email)
 */
export async function upsertPessoa(data: {
  nome: string;
  telefone?: string | null;
  email?: string | null;
  cidade?: string | null;
  estado?: string | null;
  profissao?: string | null;
  origem?: string | null;
}): Promise<Pessoa> {
  const pool = getPool();

  const { rows } = await pool.query(`
    INSERT INTO ${SCHEMA}.pessoas (nome, telefone, email, cidade, estado, profissao, origem)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (telefone_normalizado) 
    DO UPDATE SET
      nome = COALESCE(EXCLUDED.nome, ${SCHEMA}.pessoas.nome),
      email = COALESCE(EXCLUDED.email, ${SCHEMA}.pessoas.email),
      cidade = COALESCE(EXCLUDED.cidade, ${SCHEMA}.pessoas.cidade),
      estado = COALESCE(EXCLUDED.estado, ${SCHEMA}.pessoas.estado),
      profissao = COALESCE(EXCLUDED.profissao, ${SCHEMA}.pessoas.profissao)
    RETURNING *
  `, [
    data.nome,
    data.telefone || null,
    data.email || null,
    data.cidade || null,
    data.estado || null,
    data.profissao || null,
    data.origem || null,
  ]);

  return mapRowToPessoa(rows[0]);
}

// ============================================
// TREINAMENTOS
// ============================================

/**
 * Lista treinamentos com estatísticas
 */
export async function listTreinamentosV2(): Promise<TreinamentoComEstatisticas[]> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT 
      t.*,
      COUNT(DISTINCT i.id) AS total_inscritos,
      COUNT(DISTINCT i.id) FILTER (WHERE r.id IS NULL) AS total_leads,
      COUNT(DISTINCT i.id) FILTER (WHERE r.id IS NOT NULL) AS total_recrutadores,
      COUNT(DISTINCT pr.id) FILTER (WHERE pr.aprovado = true) AS total_presencas_aprovadas,
      COUNT(DISTINCT i.id) FILTER (WHERE i.criado_em >= NOW() - INTERVAL '24 hours') AS ultimas_24h
    FROM ${SCHEMA}.treinamentos t
    LEFT JOIN ${SCHEMA}.inscricoes_v2 i ON i.treinamento_id = t.id
    LEFT JOIN ${SCHEMA}.recrutadores r ON r.pessoa_id = i.pessoa_id
    LEFT JOIN ${SCHEMA}.presencas pr ON pr.treinamento_id = t.id AND pr.pessoa_id = i.pessoa_id
    WHERE t.codigo != 'sem-treinamento'
    GROUP BY t.id
    ORDER BY t.data_inicio DESC NULLS LAST, t.criado_em DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    descricao: row.descricao,
    dataInicio: row.data_inicio?.toISOString() || null,
    dataFim: row.data_fim?.toISOString() || null,
    ativo: row.ativo,
    criadoEm: row.criado_em.toISOString(),
    atualizadoEm: row.atualizado_em.toISOString(),
    totalInscritos: parseInt(row.total_inscritos, 10),
    totalLeads: parseInt(row.total_leads, 10),
    totalRecrutadores: parseInt(row.total_recrutadores, 10),
    totalPresencasAprovadas: parseInt(row.total_presencas_aprovadas, 10),
    ultimasInscricoes24h: parseInt(row.ultimas_24h, 10),
  }));
}

/**
 * Busca treinamento por código
 */
export async function getTreinamentoByCodigo(codigo: string): Promise<Treinamento | null> {
  const pool = getPool();
  
  const { rows } = await pool.query(
    `SELECT * FROM ${SCHEMA}.treinamentos WHERE codigo = $1`,
    [codigo]
  );

  if (rows.length === 0) return null;
  return mapRowToTreinamento(rows[0]);
}

/**
 * Cria treinamento
 */
export async function criarTreinamento(data: {
  codigo: string;
  nome: string;
  descricao?: string;
  dataInicio?: string;
  dataFim?: string;
}): Promise<Treinamento> {
  const pool = getPool();

  const { rows } = await pool.query(`
    INSERT INTO ${SCHEMA}.treinamentos (codigo, nome, descricao, data_inicio, data_fim)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (codigo) DO UPDATE SET
      nome = EXCLUDED.nome,
      descricao = COALESCE(EXCLUDED.descricao, ${SCHEMA}.treinamentos.descricao),
      data_inicio = COALESCE(EXCLUDED.data_inicio, ${SCHEMA}.treinamentos.data_inicio),
      data_fim = COALESCE(EXCLUDED.data_fim, ${SCHEMA}.treinamentos.data_fim)
    RETURNING *
  `, [
    data.codigo,
    data.nome,
    data.descricao || null,
    data.dataInicio || null,
    data.dataFim || null,
  ]);

  return mapRowToTreinamento(rows[0]);
}

// ============================================
// INSCRIÇÕES
// ============================================

/**
 * Lista inscrições de um treinamento
 */
export async function listInscricoesV2(
  filtros: FiltrosInscricoes = {},
  opcoes: PaginacaoOpcoes = {}
): Promise<ResultadoPaginado<InscricaoCompletaV2>> {
  const pool = getPool();
  const page = opcoes.page ?? 1;
  const pageSize = opcoes.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filtros.treinamentoId) {
    conditions.push(`i.treinamento_id = $${paramIndex++}`);
    params.push(filtros.treinamentoId);
  }

  if (filtros.pessoaId) {
    conditions.push(`i.pessoa_id = $${paramIndex++}`);
    params.push(filtros.pessoaId);
  }

  if (filtros.recrutadorId) {
    conditions.push(`i.recrutador_id = $${paramIndex++}`);
    params.push(filtros.recrutadorId);
  }

  if (filtros.status) {
    conditions.push(`i.status = $${paramIndex++}`);
    params.push(filtros.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Conta total
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ${SCHEMA}.inscricoes_v2 i ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Busca com JOINs
  params.push(pageSize, offset);
  const { rows } = await pool.query(`
    SELECT 
      i.*,
      -- Pessoa
      p.id AS pessoa_id, p.nome AS pessoa_nome, p.telefone AS pessoa_telefone,
      p.email AS pessoa_email, p.cidade AS pessoa_cidade, p.profissao AS pessoa_profissao,
      -- Treinamento
      t.codigo AS treinamento_codigo, t.nome AS treinamento_nome, t.data_inicio AS treinamento_data,
      -- Recrutador
      r.codigo AS recrutador_codigo, rp.nome AS recrutador_nome,
      -- Presença
      pr.aprovado AS presenca_aprovada, pr.tempo_total_minutos AS presenca_tempo
    FROM ${SCHEMA}.inscricoes_v2 i
    JOIN ${SCHEMA}.pessoas p ON p.id = i.pessoa_id
    JOIN ${SCHEMA}.treinamentos t ON t.id = i.treinamento_id
    LEFT JOIN ${SCHEMA}.recrutadores r ON r.id = i.recrutador_id
    LEFT JOIN ${SCHEMA}.pessoas rp ON rp.id = r.pessoa_id
    LEFT JOIN ${SCHEMA}.presencas pr ON pr.pessoa_id = i.pessoa_id AND pr.treinamento_id = i.treinamento_id
    ${whereClause}
    ORDER BY i.criado_em DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `, params);

  return {
    data: rows.map(mapRowToInscricaoCompleta),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Cria inscrição
 */
export async function criarInscricaoV2(data: {
  pessoaId: number;
  treinamentoId: number;
  recrutadorId?: number | null;
  status?: InscricaoStatusV2;
  dadosExtras?: Record<string, unknown>;
}): Promise<InscricaoV2> {
  const pool = getPool();

  const { rows } = await pool.query(`
    INSERT INTO ${SCHEMA}.inscricoes_v2 (pessoa_id, treinamento_id, recrutador_id, status, dados_extras)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (pessoa_id, treinamento_id) DO NOTHING
    RETURNING *
  `, [
    data.pessoaId,
    data.treinamentoId,
    data.recrutadorId || null,
    data.status || "aguardando",
    JSON.stringify(data.dadosExtras || {}),
  ]);

  return mapRowToInscricao(rows[0]);
}

// ============================================
// PRESENÇAS
// ============================================

/**
 * Lista presenças de um treinamento
 */
export async function listPresencasV2(
  filtros: FiltrosPresencas = {},
  opcoes: PaginacaoOpcoes = {}
): Promise<ResultadoPaginado<PresencaCompletaV2>> {
  const pool = getPool();
  const page = opcoes.page ?? 1;
  const pageSize = opcoes.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filtros.treinamentoId) {
    conditions.push(`pr.treinamento_id = $${paramIndex++}`);
    params.push(filtros.treinamentoId);
  }

  if (filtros.pessoaId) {
    conditions.push(`pr.pessoa_id = $${paramIndex++}`);
    params.push(filtros.pessoaId);
  }

  if (filtros.aprovado !== undefined) {
    conditions.push(`pr.aprovado = $${paramIndex++}`);
    params.push(filtros.aprovado);
  }

  if (filtros.associacaoStatus) {
    conditions.push(`pr.associacao_status = $${paramIndex++}`);
    params.push(filtros.associacaoStatus);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Conta total
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ${SCHEMA}.presencas pr ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Busca com JOINs
  params.push(pageSize, offset);
  const { rows } = await pool.query(`
    SELECT 
      pr.*,
      p.nome AS pessoa_nome, p.telefone AS pessoa_telefone, p.email AS pessoa_email,
      t.codigo AS treinamento_codigo, t.nome AS treinamento_nome
    FROM ${SCHEMA}.presencas pr
    JOIN ${SCHEMA}.pessoas p ON p.id = pr.pessoa_id
    JOIN ${SCHEMA}.treinamentos t ON t.id = pr.treinamento_id
    ${whereClause}
    ORDER BY pr.validado_em DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `, params);

  return {
    data: rows.map(mapRowToPresencaCompleta),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Salva presença validada
 */
export async function salvarPresencaV2(data: {
  pessoaId: number;
  treinamentoId: number;
  nomeZoom?: string;
  emailZoom?: string;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  aprovado: boolean;
  cumpriuTempoMinimo: boolean;
  cumpriuDinamica: boolean;
  tempoMinimoExigido?: number;
  percentualMinimoExigido?: number;
  associacaoStatus: AssociacaoStatusV2;
  associacaoScore: number;
  validadoPor?: string;
}): Promise<PresencaV2> {
  const pool = getPool();

  const { rows } = await pool.query(`
    INSERT INTO ${SCHEMA}.presencas (
      pessoa_id, treinamento_id, nome_zoom, email_zoom,
      tempo_total_minutos, tempo_dinamica_minutos, percentual_dinamica,
      aprovado, cumpriu_tempo_minimo, cumpriu_dinamica,
      tempo_minimo_exigido, percentual_minimo_exigido,
      associacao_status, associacao_score, validado_por
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (pessoa_id, treinamento_id) DO UPDATE SET
      tempo_total_minutos = EXCLUDED.tempo_total_minutos,
      tempo_dinamica_minutos = EXCLUDED.tempo_dinamica_minutos,
      percentual_dinamica = EXCLUDED.percentual_dinamica,
      aprovado = EXCLUDED.aprovado,
      cumpriu_tempo_minimo = EXCLUDED.cumpriu_tempo_minimo,
      cumpriu_dinamica = EXCLUDED.cumpriu_dinamica,
      associacao_status = EXCLUDED.associacao_status,
      associacao_score = EXCLUDED.associacao_score,
      validado_em = NOW()
    RETURNING *
  `, [
    data.pessoaId,
    data.treinamentoId,
    data.nomeZoom || null,
    data.emailZoom || null,
    data.tempoTotalMinutos,
    data.tempoDinamicaMinutos,
    data.percentualDinamica,
    data.aprovado,
    data.cumpriuTempoMinimo,
    data.cumpriuDinamica,
    data.tempoMinimoExigido || null,
    data.percentualMinimoExigido || null,
    data.associacaoStatus,
    data.associacaoScore,
    data.validadoPor || null,
  ]);

  return mapRowToPresenca(rows[0]);
}

// ============================================
// HELPERS
// ============================================

function mapRowToPessoa(row: Record<string, unknown>): Pessoa {
  return {
    id: row.id as number,
    nome: row.nome as string,
    telefone: row.telefone as string | null,
    email: row.email as string | null,
    cidade: row.cidade as string | null,
    estado: row.estado as string | null,
    profissao: row.profissao as string | null,
    origem: row.origem as string | null,
    telefoneNormalizado: row.telefone_normalizado as string | null,
    emailNormalizado: row.email_normalizado as string | null,
    criadoEm: (row.criado_em as Date).toISOString(),
    atualizadoEm: (row.atualizado_em as Date || row.criado_em as Date).toISOString(),
  };
}

function mapRowToPessoaCompleta(row: Record<string, unknown>): PessoaCompleta {
  return {
    ...mapRowToPessoa(row),
    isRecrutador: row.is_recrutador as boolean,
    recrutadorCodigo: row.recrutador_codigo as string | null,
    recrutadorNivel: row.recrutador_nivel as number | null,
    totalInscricoes: parseInt(row.total_inscricoes as string, 10),
    totalPresencasAprovadas: parseInt(row.total_presencas_aprovadas as string, 10),
    ultimoTreinamento: row.ultimo_treinamento as string | null,
    indicadoPor: row.indicado_por as string | null,
  };
}

function mapRowToTreinamento(row: Record<string, unknown>): Treinamento {
  return {
    id: row.id as number,
    codigo: row.codigo as string,
    nome: row.nome as string,
    descricao: row.descricao as string | null,
    dataInicio: row.data_inicio ? (row.data_inicio as Date).toISOString() : null,
    dataFim: row.data_fim ? (row.data_fim as Date).toISOString() : null,
    ativo: row.ativo as boolean,
    criadoEm: (row.criado_em as Date).toISOString(),
    atualizadoEm: (row.atualizado_em as Date).toISOString(),
  };
}

function mapRowToInscricao(row: Record<string, unknown>): InscricaoV2 {
  return {
    id: row.id as number,
    pessoaId: row.pessoa_id as number,
    treinamentoId: row.treinamento_id as number,
    recrutadorId: row.recrutador_id as number | null,
    status: row.status as InscricaoStatusV2,
    statusAtualizadoEm: row.status_atualizado_em ? (row.status_atualizado_em as Date).toISOString() : null,
    statusWhatsappContatado: row.status_whatsapp_contatado as boolean,
    notas: row.notas as InscricaoNota[],
    dadosExtras: row.dados_extras as Record<string, unknown>,
    criadoEm: (row.criado_em as Date).toISOString(),
    atualizadoEm: (row.atualizado_em as Date || row.criado_em as Date).toISOString(),
  };
}

function mapRowToInscricaoCompleta(row: Record<string, unknown>): InscricaoCompletaV2 {
  const inscricao = mapRowToInscricao(row);
  
  return {
    ...inscricao,
    pessoa: {
      id: row.pessoa_id as number,
      nome: row.pessoa_nome as string,
      telefone: row.pessoa_telefone as string | null,
      email: row.pessoa_email as string | null,
      cidade: row.pessoa_cidade as string | null,
      estado: null,
      profissao: row.pessoa_profissao as string | null,
      origem: null,
      telefoneNormalizado: null,
      emailNormalizado: null,
      criadoEm: inscricao.criadoEm,
      atualizadoEm: inscricao.criadoEm,
    },
    treinamento: {
      id: row.treinamento_id as number,
      codigo: row.treinamento_codigo as string,
      nome: row.treinamento_nome as string,
      descricao: null,
      dataInicio: row.treinamento_data ? (row.treinamento_data as Date).toISOString() : null,
      dataFim: null,
      ativo: true,
      criadoEm: inscricao.criadoEm,
      atualizadoEm: inscricao.criadoEm,
    },
    recrutador: row.recrutador_codigo ? {
      id: row.recrutador_id as number,
      pessoaId: 0,
      codigo: row.recrutador_codigo as string,
      recrutadorPaiId: null,
      nivel: 0,
      ativo: true,
      criadoEm: inscricao.criadoEm,
      atualizadoEm: inscricao.criadoEm,
      pessoa: {
        id: 0,
        nome: row.recrutador_nome as string,
        telefone: null,
        email: null,
        cidade: null,
        estado: null,
        profissao: null,
        origem: null,
        telefoneNormalizado: null,
        emailNormalizado: null,
        criadoEm: inscricao.criadoEm,
        atualizadoEm: inscricao.criadoEm,
      },
      recrutadorPai: null,
      totalIndicados: 0,
    } : null,
    presenca: row.presenca_aprovada !== null ? {
      id: 0,
      pessoaId: row.pessoa_id as number,
      treinamentoId: row.treinamento_id as number,
      nomeZoom: null,
      emailZoom: null,
      tempoTotalMinutos: row.presenca_tempo as number || 0,
      tempoDinamicaMinutos: 0,
      percentualDinamica: 0,
      aprovado: row.presenca_aprovada as boolean,
      cumpriuTempoMinimo: true,
      cumpriuDinamica: true,
      tempoMinimoExigido: null,
      percentualMinimoExigido: null,
      associacaoStatus: "confirmed",
      associacaoScore: 100,
      validadoEm: inscricao.criadoEm,
      validadoPor: null,
      criadoEm: inscricao.criadoEm,
    } : null,
  };
}

function mapRowToPresenca(row: Record<string, unknown>): PresencaV2 {
  return {
    id: row.id as number,
    pessoaId: row.pessoa_id as number,
    treinamentoId: row.treinamento_id as number,
    nomeZoom: row.nome_zoom as string | null,
    emailZoom: row.email_zoom as string | null,
    tempoTotalMinutos: row.tempo_total_minutos as number,
    tempoDinamicaMinutos: row.tempo_dinamica_minutos as number,
    percentualDinamica: row.percentual_dinamica as number,
    aprovado: row.aprovado as boolean,
    cumpriuTempoMinimo: row.cumpriu_tempo_minimo as boolean,
    cumpriuDinamica: row.cumpriu_dinamica as boolean,
    tempoMinimoExigido: row.tempo_minimo_exigido as number | null,
    percentualMinimoExigido: row.percentual_minimo_exigido as number | null,
    associacaoStatus: row.associacao_status as AssociacaoStatusV2,
    associacaoScore: row.associacao_score as number,
    validadoEm: (row.validado_em as Date).toISOString(),
    validadoPor: row.validado_por as string | null,
    criadoEm: (row.criado_em as Date).toISOString(),
  };
}

function mapRowToPresencaCompleta(row: Record<string, unknown>): PresencaCompletaV2 {
  const presenca = mapRowToPresenca(row);
  
  return {
    ...presenca,
    pessoa: {
      id: row.pessoa_id as number,
      nome: row.pessoa_nome as string,
      telefone: row.pessoa_telefone as string | null,
      email: row.pessoa_email as string | null,
      cidade: null,
      estado: null,
      profissao: null,
      origem: null,
      telefoneNormalizado: null,
      emailNormalizado: null,
      criadoEm: presenca.criadoEm,
      atualizadoEm: presenca.criadoEm,
    },
    treinamento: {
      id: row.treinamento_id as number,
      codigo: row.treinamento_codigo as string,
      nome: row.treinamento_nome as string,
      descricao: null,
      dataInicio: null,
      dataFim: null,
      ativo: true,
      criadoEm: presenca.criadoEm,
      atualizadoEm: presenca.criadoEm,
    },
  };
}
