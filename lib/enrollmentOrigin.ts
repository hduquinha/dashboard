import { getPool } from "@/lib/db";
import { LEAD_AD_ID } from "@/lib/metaAds";

/**
 * De onde veio cada matrícula do mês.
 *
 * O relatório mensal precisa responder aos sócios "quanto do faturamento veio
 * de anúncio". Vendas registradas pelo CRM carregam o lead de origem
 * (`finance_enrollments.lead_inscricao_id`) e são atribuídas com certeza;
 * matrículas lançadas direto no Financeiro continuam dependendo de conciliação
 * por NOME, que é palpite e por isso segue conservadora.
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
  /** Anúncio (criativo) de origem, quando a venda veio de mídia. */
  adName: string | null;
  /** Curso vendido, como está na matrícula. */
  course: string | null;
  /** Vendedor que fechou. */
  seller: string | null;
  /**
   * `direto` = a venda foi registrada a partir do lead (lead_inscricao_id);
   * `nome` = conciliação por nome, que é palpite. Precisa aparecer na tela para
   * ninguém apresentar um número inferido como se fosse declarado.
   */
  linkKind: "direto" | "nome" | null;
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
  ad_name: string | null;
  course: string | null;
  seller: string | null;
  direct_link: boolean | null;
}

/**
 * Matrículas vendidas no intervalo com o lead de origem.
 *
 * Duas fontes, nesta ordem: o **vínculo direto** (`lead_inscricao_id`, gravado
 * quando a venda é registrada a partir do card no Kanban) e, para as
 * matrículas lançadas direto no Financeiro, o velho casamento por NOME. O
 * vínculo direto sempre ganha — ele é declarado por quem fez a venda, não
 * inferido.
 */
export async function getEnrollmentOrigins(from: string, to: string): Promise<EnrollmentOriginSummary> {
  const { rows } = await getPool().query<QueryRow>(
    `
    WITH enrollments AS (
      SELECT e.id, e.student, e.total_amount, e.sale_date::text AS sale_date,
             e.lead_inscricao_id,
             fc.name AS course,
             fs.name AS seller,
             ${normalizedName("e.student")} AS name_key
      FROM dashboard.finance_enrollments e
      LEFT JOIN dashboard.finance_courses fc ON fc.id = e.course_id
      LEFT JOIN dashboard.finance_sellers fs ON fs.id = e.seller_id
      WHERE e.sale_date BETWEEN $1::date AND $2::date
    ),
    matches AS (
      SELECT en.id AS enrollment_id,
             i.id AS lead_id,
             NULLIF(TRIM(i.payload->>'origem'), '') AS lead_origem,
             (i.id = en.lead_inscricao_id) AS direct_link,
             ${LEAD_AD_ID} AS ad_id,
             ROW_NUMBER() OVER (
               PARTITION BY en.id
               ORDER BY
                 (i.id = en.lead_inscricao_id) DESC,
                 (${LEAD_AD_ID}) IS NOT NULL DESC,
                 i.criado_em DESC
             ) AS rn
      FROM enrollments en
      JOIN inscricoes.inscricoes i
        ON i.id = en.lead_inscricao_id
        OR (en.lead_inscricao_id IS NULL
            AND ${normalizedName("COALESCE(i.payload->>'nome', '')")} = en.name_key)
      -- Cadastro excluído/mesclado não serve para ADIVINHAR origem pelo nome,
      -- mas se a venda declarou aquele lead o vínculo vale mesmo assim: apagar
      -- o lead depois não desfaz de onde a venda veio.
      WHERE i.id = en.lead_inscricao_id
         OR (COALESCE(i.payload->>'dashboard_excluido', '') != 'true'
             AND COALESCE(i.payload->>'dashboard_merged_into', '') = '')
    )
    SELECT en.id AS enrollment_id, en.student, en.total_amount::text AS amount, en.sale_date,
           en.course, en.seller,
           m.lead_id, m.lead_origem, m.ad_id, m.direct_link,
           c.name AS campaign_name,
           a.name AS ad_name
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
      adName: row.ad_name,
      course: row.course,
      seller: row.seller,
      linkKind: row.lead_id === null ? null : row.direct_link ? "direto" : "nome",
    }))
  );
}
