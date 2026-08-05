import { getPool } from "@/lib/db";
import { LEAD_AD_ID } from "@/lib/metaAds";

/**
 * De onde veio cada matrícula do mês.
 *
 * O relatório mensal precisa responder aos sócios "quanto do faturamento veio
 * de anúncio", e a resposta honesta hoje é: só dá para saber por conciliação de
 * NOME, porque o Financeiro não guarda de qual lead veio a matrícula
 * (`finance_revenues.lead_inscricao_id` existe e nunca é preenchido).
 *
 * Por isso a classificação é conservadora e assumida na tela:
 * - `anuncio`: a matrícula casou com um lead que tem anúncio de origem.
 * - `crm_sem_anuncio`: casou com um lead do CRM que entrou por outro caminho
 *   (formulário orgânico, aula experimental, indicação já cadastrada).
 * - `sem_cadastro`: não existe lead com esse nome — venda fora do funil digital
 *   (boca a boca, indicação, presencial). **Não é erro**: é o caso mais comum
 *   numa escola que vende no relacionamento, e some do relatório se a gente
 *   fingir que todo faturamento tem origem rastreada.
 *
 * O que NUNCA pode acontecer: contar etapa do CRM como venda. Um lead na etapa
 * "ganho" sem matrícula no Financeiro é oportunidade, não receita.
 */

/** Nome comparável: sem acento, sem espaço duplicado, caixa alta. */
function normalizedName(expression: string): string {
  return `UPPER(TRIM(REGEXP_REPLACE(TRANSLATE(${expression},
    'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\\s+', ' ', 'g')))`;
}

export type EnrollmentOriginKind = "anuncio" | "crm_sem_anuncio" | "sem_cadastro";

export interface EnrollmentOriginRow {
  enrollmentId: number;
  student: string;
  amount: number;
  saleDate: string;
  kind: EnrollmentOriginKind;
  /** Lead do CRM que casou pelo nome, quando houve. */
  leadId: number | null;
  leadOrigem: string | null;
  adId: string | null;
  campaignName: string | null;
}

export interface EnrollmentOriginBucket {
  count: number;
  amount: number;
}

export interface EnrollmentOriginSummary {
  total: number;
  totalAmount: number;
  anuncio: EnrollmentOriginBucket;
  crmSemAnuncio: EnrollmentOriginBucket;
  semCadastro: EnrollmentOriginBucket;
  rows: EnrollmentOriginRow[];
}

function emptyBucket(): EnrollmentOriginBucket {
  return { count: 0, amount: 0 };
}

export function summarizeEnrollmentOrigins(rows: EnrollmentOriginRow[]): EnrollmentOriginSummary {
  const summary: EnrollmentOriginSummary = {
    total: rows.length,
    totalAmount: rows.reduce((total, row) => total + row.amount, 0),
    anuncio: emptyBucket(),
    crmSemAnuncio: emptyBucket(),
    semCadastro: emptyBucket(),
    rows,
  };

  for (const row of rows) {
    const bucket =
      row.kind === "anuncio" ? summary.anuncio : row.kind === "crm_sem_anuncio" ? summary.crmSemAnuncio : summary.semCadastro;
    bucket.count += 1;
    bucket.amount += row.amount;
  }

  return summary;
}

interface QueryRow {
  enrollment_id: number;
  student: string;
  amount: string | null;
  sale_date: string;
  lead_id: number | null;
  lead_origem: string | null;
  ad_id: string | null;
  campaign_name: string | null;
}

/**
 * Matrículas vendidas no intervalo, cada uma com o lead que casou pelo nome (o
 * de anúncio tem preferência; empate resolve pelo cadastro mais recente).
 */
export async function getEnrollmentOrigins(from: string, to: string): Promise<EnrollmentOriginSummary> {
  const { rows } = await getPool().query<QueryRow>(
    `
    WITH enrollments AS (
      SELECT e.id, e.student, e.total_amount, e.sale_date::text AS sale_date,
             ${normalizedName("e.student")} AS name_key
      FROM dashboard.finance_enrollments e
      WHERE e.sale_date BETWEEN $1::date AND $2::date
    ),
    matches AS (
      SELECT en.id AS enrollment_id,
             i.id AS lead_id,
             NULLIF(TRIM(i.payload->>'origem'), '') AS lead_origem,
             ${LEAD_AD_ID} AS ad_id,
             ROW_NUMBER() OVER (
               PARTITION BY en.id
               ORDER BY (${LEAD_AD_ID}) IS NOT NULL DESC, i.criado_em DESC
             ) AS rn
      FROM enrollments en
      JOIN inscricoes.inscricoes i
        ON ${normalizedName("COALESCE(i.payload->>'nome', '')")} = en.name_key
      WHERE COALESCE(i.payload->>'dashboard_excluido', '') != 'true'
        AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''
    )
    SELECT en.id AS enrollment_id, en.student, en.total_amount::text AS amount, en.sale_date,
           m.lead_id, m.lead_origem, m.ad_id,
           c.name AS campaign_name
    FROM enrollments en
    LEFT JOIN matches m ON m.enrollment_id = en.id AND m.rn = 1
    LEFT JOIN meta_ads.ads a ON a.ad_id = m.ad_id
    LEFT JOIN meta_ads.campaigns c ON c.campaign_id = a.campaign_id
    ORDER BY en.sale_date, en.id
    `,
    [from, to]
  );

  return summarizeEnrollmentOrigins(
    rows.map((row) => ({
      enrollmentId: Number(row.enrollment_id),
      student: row.student,
      amount: Number.parseFloat(row.amount ?? "0") || 0,
      saleDate: row.sale_date,
      kind: row.ad_id ? "anuncio" : row.lead_id ? "crm_sem_anuncio" : "sem_cadastro",
      leadId: row.lead_id === null ? null : Number(row.lead_id),
      leadOrigem: row.lead_origem,
      adId: row.ad_id,
      campaignName: row.campaign_name,
    }))
  );
}
