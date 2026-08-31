import { getPool } from "@/lib/db";

/**
 * Cupons de cortesia do Encontro Online.
 *
 * Até 2026-08-10 os códigos viviam só na variável de ambiente
 * `CUPONS_ENCONTRO_ONLINE` da Vercel: criar uma cortesia exigia editar a
 * variável e redeployar o formulário, e não havia como saber quantas pessoas
 * já tinham usado sem ler o banco na mão. Aqui eles passam a ser dado, numa
 * tabela que o CRM edita e que `instituto-up-formulario/api/inscricao.js` lê na
 * hora de validar — o formulário da Vercel escreve nesta MESMA base
 * (`inscricoes.inscricoes`), então não há ponte HTTP nem token no meio.
 *
 * O uso NÃO é contado numa tabela própria de resgates. Ele sai de onde já
 * estava: o payload do lead carimbado por `applyCouponToPayload`
 * (`cupom_codigo` + `cupom_aplicado`). Manter um segundo livro-caixa criaria
 * duas verdades sobre o mesmo fato e deixaria de fora as cortesias que já
 * aconteceram antes desta tela existir.
 */

const SCHEMA = "dashboard";

/** Chave própria (não colide com metaAds/googleAds) para serializar o DDL. */
const SCHEMA_ADVISORY_LOCK_KEY = 872351;

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

/** Espelha `normalizeCouponCode` de instituto-up-formulario/api/inscricao.js.
 *  Divergir daqui significa cadastrar um código que o formulário nunca aceita. */
export const MAX_COUPON_LENGTH = 40;
export const MIN_COUPON_LENGTH = 3;

export function normalizeCouponCode(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toUpperCase()
    .slice(0, MAX_COUPON_LENGTH);
}

export type CouponStatus = "ativo" | "inativo" | "expirado" | "esgotado";

export interface CouponUse {
  inscricaoId: number;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  usadoEm: string;
}

export interface Coupon {
  id: number;
  code: string;
  description: string | null;
  /** null = sem limite de usos. */
  maxUses: number | null;
  /** null = sem validade. Vale até o fim deste dia, no horário de Brasília. */
  validUntil: string | null;
  active: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Quantas pessoas já entraram de graça com este código. */
  uses: number;
  /** Quantos usos ainda cabem; null quando não há limite. */
  remaining: number | null;
  status: CouponStatus;
  lastUsedAt: string | null;
}

export interface CouponInput {
  code: string;
  description?: string | null;
  maxUses?: number | null;
  validUntil?: string | null;
  active?: boolean;
}

/** Código que já foi usado em algum lead mas não existe na tabela — o rastro
 *  dos cupons que ainda moram na variável de ambiente da Vercel. */
export interface UnregisteredCouponCode {
  code: string;
  uses: number;
  lastUsedAt: string;
}

async function ensureCouponSchemaOnce(): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    // O dashboard sobe 3 workers. Sem este lock, dois deles chegam juntos no
    // CREATE TABLE IF NOT EXISTS: o "IF NOT EXISTS" só olha se a tabela existia
    // no início do comando, então o perdedor da corrida ainda tenta criar a
    // sequence `coupons_id_seq` e morre com 23505 em pg_class — foi o que
    // derrubou /cupons no primeiro acesso depois do deploy.
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.coupons (
      id              SERIAL PRIMARY KEY,
      code            TEXT NOT NULL UNIQUE,
      description     TEXT,
      max_uses        INTEGER,
      valid_until     DATE,
      active          BOOLEAN NOT NULL DEFAULT TRUE,
      -- Hoje só o Encontro Online tem cortesia. A coluna existe para que o dia
      -- em que outro produto ganhar cupom não vire "todo cupom vale em tudo",
      -- que é justamente o que a cartilha de produtos proíbe.
      product         TEXT NOT NULL DEFAULT 'encontro-online',
      created_by_name TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- O formulário procura o cupom pelo código já normalizado; o índice existe
    -- porque essa busca roda no caminho crítico de cada inscrição.
    CREATE INDEX IF NOT EXISTS idx_coupons_code_active
      ON ${SCHEMA}.coupons (code) WHERE active;
    `);
    await client.query("COMMIT");
    schemaReady = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureCouponSchema(): Promise<void> {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = ensureCouponSchemaOnce().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

/** Hoje no fuso de Brasília (UTC-3, sem horário de verão desde 2019) — a mesma
 *  régua de `isCouponExpired` no formulário. */
function brasiliaToday(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function resolveStatus(coupon: {
  active: boolean;
  validUntil: string | null;
  maxUses: number | null;
  uses: number;
}): CouponStatus {
  if (!coupon.active) return "inativo";
  if (coupon.validUntil && brasiliaToday() > coupon.validUntil) return "expirado";
  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) return "esgotado";
  return "ativo";
}

/**
 * Lista os cupons com o uso real de cada um.
 *
 * A contagem vem do payload do lead — a mesma condição que o formulário usa
 * para decidir se o cupom esgotou —, então a tela nunca diverge da regra que
 * de fato barra alguém no checkout.
 */
export async function listCoupons(): Promise<Coupon[]> {
  await ensureCouponSchema();

  const { rows } = await getPool().query(`
    WITH usos AS (
      SELECT payload->>'cupom_codigo' AS code,
             COUNT(*)::int            AS uses,
             MAX(criado_em)           AS last_used_at
      FROM inscricoes.inscricoes
      WHERE payload->>'cupom_aplicado' = 'true'
        AND COALESCE(payload->>'cupom_codigo', '') <> ''
      GROUP BY 1
    )
    SELECT c.id, c.code, c.description, c.max_uses, c.valid_until, c.active,
           c.created_by_name, c.created_at, c.updated_at,
           COALESCE(u.uses, 0) AS uses,
           u.last_used_at
    FROM ${SCHEMA}.coupons c
    LEFT JOIN usos u ON u.code = c.code
    ORDER BY c.active DESC, c.created_at DESC
  `);

  return rows.map((row) => {
    const maxUses = row.max_uses === null ? null : Number(row.max_uses);
    const uses = Number(row.uses) || 0;
    const validUntil = toIsoDate(row.valid_until);
    return {
      id: Number(row.id),
      code: row.code,
      description: row.description ?? null,
      maxUses,
      validUntil,
      active: Boolean(row.active),
      createdByName: row.created_by_name ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      uses,
      remaining: maxUses === null ? null : Math.max(0, maxUses - uses),
      status: resolveStatus({ active: Boolean(row.active), validUntil, maxUses, uses }),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    };
  });
}

/**
 * Códigos que já deram cortesia a alguém mas não têm cadastro aqui.
 *
 * Enquanto a variável `CUPONS_ENCONTRO_ONLINE` continuar existindo na Vercel,
 * é por esta lista que a tela mostra o que ainda falta migrar — sem ela, um
 * código antigo sumiria da gestão embora continue valendo no formulário.
 */
export async function listUnregisteredCouponCodes(): Promise<UnregisteredCouponCode[]> {
  await ensureCouponSchema();

  const { rows } = await getPool().query(`
    SELECT i.payload->>'cupom_codigo' AS code,
           COUNT(*)::int              AS uses,
           MAX(i.criado_em)           AS last_used_at
    FROM inscricoes.inscricoes i
    WHERE i.payload->>'cupom_aplicado' = 'true'
      AND COALESCE(i.payload->>'cupom_codigo', '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM ${SCHEMA}.coupons c WHERE c.code = i.payload->>'cupom_codigo'
      )
    GROUP BY 1
    ORDER BY 2 DESC
  `);

  return rows.map((row) => ({
    code: row.code,
    uses: Number(row.uses) || 0,
    lastUsedAt: new Date(row.last_used_at).toISOString(),
  }));
}

/** Quem entrou de graça com um código — a resposta para "quantas pessoas já
 *  usaram" quando o número sozinho não basta. */
export async function listCouponUses(code: string): Promise<CouponUse[]> {
  await ensureCouponSchema();

  const normalized = normalizeCouponCode(code);
  if (!normalized) return [];

  const { rows } = await getPool().query(
    `SELECT i.id,
            COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), '')) AS nome,
            COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), '')) AS telefone,
            NULLIF(TRIM(i.payload->>'email'), '') AS email,
            i.criado_em
     FROM inscricoes.inscricoes i
     WHERE i.payload->>'cupom_codigo' = $1
       AND i.payload->>'cupom_aplicado' = 'true'
     ORDER BY i.criado_em DESC`,
    [normalized]
  );

  return rows.map((row) => ({
    inscricaoId: Number(row.id),
    nome: row.nome ?? null,
    telefone: row.telefone ?? null,
    email: row.email ?? null,
    usadoEm: new Date(row.criado_em).toISOString(),
  }));
}

function validateInput(input: CouponInput): {
  code: string;
  description: string | null;
  maxUses: number | null;
  validUntil: string | null;
  active: boolean;
} {
  const code = normalizeCouponCode(input.code);
  if (code.length < MIN_COUPON_LENGTH) {
    throw new Error(
      `O código precisa de pelo menos ${MIN_COUPON_LENGTH} caracteres (letras, números, ponto, hífen ou underline).`
    );
  }

  const maxUsesRaw = input.maxUses;
  let maxUses: number | null = null;
  if (maxUsesRaw !== null && maxUsesRaw !== undefined && String(maxUsesRaw) !== "") {
    const parsed = Number(maxUsesRaw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("O limite de usos precisa ser um número maior que zero, ou ficar vazio para ilimitado.");
    }
    maxUses = Math.floor(parsed);
  }

  const validUntil = toIsoDate(input.validUntil);
  if (input.validUntil && !validUntil) {
    throw new Error("Data de validade inválida — use o formato AAAA-MM-DD.");
  }

  return {
    code,
    description: input.description?.trim() ? input.description.trim() : null,
    maxUses,
    validUntil,
    active: input.active === undefined ? true : Boolean(input.active),
  };
}

export async function createCoupon(input: CouponInput, createdByName?: string | null): Promise<number> {
  await ensureCouponSchema();
  const data = validateInput(input);

  try {
    const { rows } = await getPool().query(
      `INSERT INTO ${SCHEMA}.coupons (code, description, max_uses, valid_until, active, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [data.code, data.description, data.maxUses, data.validUntil, data.active, createdByName ?? null]
    );
    return Number(rows[0].id);
  } catch (error) {
    // 23505 = unique_violation. Dois cupons com o mesmo código dariam limites
    // diferentes para a mesma palavra digitada no checkout.
    if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
      throw new Error(`O cupom ${data.code} já está cadastrado.`);
    }
    throw error;
  }
}

export async function updateCoupon(id: number, input: CouponInput): Promise<void> {
  await ensureCouponSchema();
  const data = validateInput(input);

  try {
    const result = await getPool().query(
      `UPDATE ${SCHEMA}.coupons
          SET code = $2, description = $3, max_uses = $4, valid_until = $5, active = $6, updated_at = NOW()
        WHERE id = $1`,
      [id, data.code, data.description, data.maxUses, data.validUntil, data.active]
    );
    if (result.rowCount === 0) {
      throw new Error("Cupom não encontrado.");
    }
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
      throw new Error(`O cupom ${data.code} já está cadastrado.`);
    }
    throw error;
  }
}

/**
 * Apagar o cupom NÃO apaga as cortesias já concedidas: elas estão no payload
 * dos leads e continuam contando na aba de quem usou. O que a exclusão faz é
 * parar de aceitar o código dali para a frente.
 */
export async function deleteCoupon(id: number): Promise<void> {
  await ensureCouponSchema();
  const result = await getPool().query(`DELETE FROM ${SCHEMA}.coupons WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    throw new Error("Cupom não encontrado.");
  }
}
