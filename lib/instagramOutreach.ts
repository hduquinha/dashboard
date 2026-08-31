import { getPool } from "@/lib/db";

/**
 * Prospecção no Instagram: quantas pessoas o vendedor abordou no direct, quantas
 * responderam e quantas confirmaram presença na Aula Exclusiva.
 *
 * **Por que é lançamento manual.** A API de mensagens da Meta só permite
 * responder quem escreveu primeiro — não existe forma de iniciar conversa por
 * API, e quando o vendedor chama pelo perfil pessoal nenhuma integração enxerga
 * nada. Não há caminho automático para DM frio; o número digitado é a única
 * fonte possível.
 *
 * **Por que tabela própria e não `task_production_entries`.** A produção de
 * rotina existe para indicadores CONFIGURÁVEIS por tarefa. Aqui as três
 * perguntas são fixas e de negócio, e o registro é chaveado por vendedor + dia
 * — o mesmo eixo do painel de movimentação, o que faz os dois se cruzarem numa
 * linha. Reusar aquela estrutura obrigaria a duplicar a definição dos
 * indicadores em cada card de painel, ou a manter uma tarefa fantasma só para
 * abrigá-los.
 *
 * A regra de idempotência é a mesma de lá, e de propósito: UNIQUE por
 * (vendedor, dia) faz relançar virar edição do dia, não um segundo registro.
 */

const SCHEMA = "dashboard";
const TZ = "America/Sao_Paulo";

let schemaReady = false;

export async function ensureInstagramOutreachSchema(): Promise<void> {
  if (schemaReady) return;

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.instagram_outreach (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES ${SCHEMA}.team_members(id) ON DELETE CASCADE,
      entry_date DATE NOT NULL,
      -- Pessoas chamadas no direct.
      reached INTEGER NOT NULL DEFAULT 0,
      -- Quantas dessas responderam.
      replied INTEGER NOT NULL DEFAULT 0,
      -- Quantas confirmaram presença na Aula Exclusiva.
      confirmed INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER REFERENCES ${SCHEMA}.team_members(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_instagram_outreach_day UNIQUE (member_id, entry_date),
      -- Negativo é erro de digitação. Não existe teto entre os três: quem
      -- responde hoje pode ter sido chamado ontem, então "responderam maior que
      -- abordados" é um dia legítimo, não uma inconsistência a barrar.
      CONSTRAINT instagram_outreach_nao_negativo
        CHECK (reached >= 0 AND replied >= 0 AND confirmed >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_instagram_outreach_dia
      ON ${SCHEMA}.instagram_outreach (entry_date DESC);
  `);

  schemaReady = true;
}

export interface InstagramOutreachDay {
  date: string;
  reached: number;
  replied: number;
  confirmed: number;
  note: string | null;
  updatedAt: string | null;
  createdByName: string | null;
}

export interface InstagramOutreachReport {
  reached: number;
  replied: number;
  confirmed: number;
  /** Um item por dia com lançamento; dia sem registro não aparece. */
  days: InstagramOutreachDay[];
}

interface Row {
  entry_date: string;
  reached: number;
  replied: number;
  confirmed: number;
  note: string | null;
  updated_at: Date | string | null;
  created_by_name: string | null;
}

/**
 * Contagem digitada à mão: campo vazio, texto e negativo viram zero; o teto
 * evita que um dedo preso no teclado grave um número absurdo no relatório.
 * Exportada para teste — é a única lógica pura desta lib.
 */
export function normalizeOutreachCount(value: unknown, maximo = 100000): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.trunc(parsed), 0), maximo);
}

/** Lançamentos de um vendedor no período, com os totais já somados. */
export async function getInstagramOutreach(params: {
  memberId: number;
  from: string;
  to: string;
}): Promise<InstagramOutreachReport> {
  await ensureInstagramOutreachSchema();

  const { rows } = await getPool().query<Row>(
    `SELECT o.entry_date::text AS entry_date,
            o.reached, o.replied, o.confirmed, o.note, o.updated_at,
            autor.name AS created_by_name
       FROM ${SCHEMA}.instagram_outreach o
       LEFT JOIN ${SCHEMA}.team_members autor ON autor.id = o.created_by
      WHERE o.member_id = $1
        AND o.entry_date BETWEEN $2::date AND $3::date
      ORDER BY o.entry_date ASC`,
    [params.memberId, params.from, params.to]
  );

  const days = rows.map((row) => ({
    date: row.entry_date,
    reached: Number(row.reached),
    replied: Number(row.replied),
    confirmed: Number(row.confirmed),
    note: row.note,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    createdByName: row.created_by_name,
  }));

  return {
    reached: days.reduce((soma, dia) => soma + dia.reached, 0),
    replied: days.reduce((soma, dia) => soma + dia.replied, 0),
    confirmed: days.reduce((soma, dia) => soma + dia.confirmed, 0),
    days,
  };
}

/**
 * Grava (ou corrige) o lançamento de um dia. `member_id` é o VENDEDOR de quem
 * é o número; `created_by` é quem digitou — um gestor pode lançar pelo
 * vendedor, e o relatório precisa continuar dizendo de quem é o trabalho.
 */
export async function saveInstagramOutreach(input: {
  memberId: number;
  date: string;
  reached: unknown;
  replied: unknown;
  confirmed: unknown;
  note?: unknown;
  createdBy: number | null;
}): Promise<void> {
  await ensureInstagramOutreachSchema();

  const nota = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;

  await getPool().query(
    `INSERT INTO ${SCHEMA}.instagram_outreach
       (member_id, entry_date, reached, replied, confirmed, note, created_by)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7)
     ON CONFLICT (member_id, entry_date) DO UPDATE SET
       reached = EXCLUDED.reached,
       replied = EXCLUDED.replied,
       confirmed = EXCLUDED.confirmed,
       note = EXCLUDED.note,
       created_by = EXCLUDED.created_by,
       updated_at = NOW()`,
    [
      input.memberId,
      input.date,
      normalizeOutreachCount(input.reached),
      normalizeOutreachCount(input.replied),
      normalizeOutreachCount(input.confirmed),
      nota,
      input.createdBy,
    ]
  );
}

/** Apaga o lançamento do dia — para desfazer um lançamento errado. */
export async function deleteInstagramOutreach(memberId: number, date: string): Promise<void> {
  await ensureInstagramOutreachSchema();
  await getPool().query(
    `DELETE FROM ${SCHEMA}.instagram_outreach WHERE member_id = $1 AND entry_date = $2::date`,
    [memberId, date]
  );
}

export interface TeamInstagramOutreachRow {
  memberId: number;
  reached: number;
  replied: number;
  confirmed: number;
}

/** Totais por vendedor no período — base da seção Instagram do PDF geral. */
export async function listTeamInstagramOutreach(params: {
  from: string;
  to: string;
}): Promise<TeamInstagramOutreachRow[]> {
  await ensureInstagramOutreachSchema();

  const { rows } = await getPool().query<{
    member_id: number;
    reached: string;
    replied: string;
    confirmed: string;
  }>(
    `SELECT member_id,
            SUM(reached)::text   AS reached,
            SUM(replied)::text   AS replied,
            SUM(confirmed)::text AS confirmed
       FROM ${SCHEMA}.instagram_outreach
      WHERE entry_date BETWEEN $1::date AND $2::date
      GROUP BY member_id`,
    [params.from, params.to]
  );

  return rows.map((row) => ({
    memberId: Number(row.member_id),
    reached: Number(row.reached),
    replied: Number(row.replied),
    confirmed: Number(row.confirmed),
  }));
}

/** Hoje no fuso da operação — o dia do lançamento é o dia daqui, não o UTC. */
export function hojeNoFusoDaOperacao(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
