import { getPool } from "@/lib/db";
import { LEAD_AD_ID } from "@/lib/metaAds";
import { ensureTrainingCatalogSchema } from "@/lib/trainingCatalog";

/**
 * De onde veio cada venda e quanto ela gerou.
 *
 * Diferente de `lib/enrollmentOrigin.ts`, que precisa adivinhar a origem
 * casando nome de aluno com nome de lead, aqui a ligação é dura: só entram
 * matrículas com `lead_inscricao_id`, ou seja, vendas registradas a partir do
 * lead no CRM. Por isso este relatório é menor que o faturamento total da
 * escola — e é justamente o pedaço sobre o qual dá para afirmar de onde veio.
 *
 * Duas colunas de dinheiro, nunca somadas:
 * - **contratado**: o valor fechado, independente de ter sido pago;
 * - **recebido**: o que já entrou no caixa dessas vendas.
 */

const SCHEMA = "dashboard";

export type SaleOriginKind = "anuncio" | "organico" | "sem_origem";

export interface SaleRow {
  enrollmentId: number;
  leadId: number;
  student: string;
  courseName: string | null;
  amount: number;
  received: number;
  saleDate: string;
  sellerName: string | null;
  kind: SaleOriginKind;
  campaignName: string | null;
  adName: string | null;
  origem: string | null;
}

export interface SalesOriginGroup {
  key: string;
  label: string;
  kind: SaleOriginKind;
  sales: number;
  contracted: number;
  received: number;
}

export interface SalesOriginReport {
  from: string;
  to: string;
  totals: { sales: number; contracted: number; received: number; discount: number };
  byOrigin: SalesOriginGroup[];
  byTraining: SalesOriginGroup[];
  rows: SaleRow[];
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupBy(rows: SaleRow[], pick: (row: SaleRow) => { key: string; label: string }): SalesOriginGroup[] {
  const map = new Map<string, SalesOriginGroup>();
  for (const row of rows) {
    const { key, label } = pick(row);
    const current = map.get(key) ?? { key, label, kind: row.kind, sales: 0, contracted: 0, received: 0 };
    current.sales += 1;
    current.contracted += row.amount;
    current.received += row.received;
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.contracted - a.contracted);
}

export async function getSalesOriginReport(from: string, to: string): Promise<SalesOriginReport> {
  await ensureTrainingCatalogSchema();

  const { rows } = await getPool().query(
    `
    WITH vendas AS (
      SELECT e.id, e.lead_inscricao_id, e.student, e.total_amount, e.sale_date::text AS sale_date,
             e.list_price, e.discount_amount,
             c.name AS course_name,
             s.name AS seller_name,
             COALESCE((
               SELECT SUM(p.amount)
               FROM ${SCHEMA}.finance_enrollment_payments p
               WHERE p.enrollment_id = e.id
             ), 0) AS received
      FROM ${SCHEMA}.finance_enrollments e
      LEFT JOIN ${SCHEMA}.finance_courses c ON c.id = e.course_id
      LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
      WHERE e.lead_inscricao_id IS NOT NULL
        AND e.sale_date BETWEEN $1::date AND $2::date
    ),
    -- MATERIALIZED porque LEAD_AD_ID é uma cascata de subconsultas correlacionadas:
    -- sem isso o Postgres pode reavaliá-la a cada uso do CTE.
    atribuicao AS MATERIALIZED (
      SELECT v.id AS enrollment_id,
             NULLIF(TRIM(i.payload->>'origem'), '') AS origem,
             ${LEAD_AD_ID} AS ad_id
      FROM vendas v
      JOIN inscricoes.inscricoes i ON i.id = v.lead_inscricao_id
    )
    SELECT v.*,
           attr.origem,
           attr.ad_id,
           a.name AS ad_name,
           camp.name AS campaign_name
    FROM vendas v
    LEFT JOIN atribuicao attr ON attr.enrollment_id = v.id
    LEFT JOIN meta_ads.ads a ON a.ad_id = attr.ad_id
    LEFT JOIN meta_ads.campaigns camp ON camp.campaign_id = a.campaign_id
    ORDER BY v.sale_date DESC, v.id DESC
    `,
    [from, to]
  );

  const saleRows: SaleRow[] = rows.map((row) => ({
    enrollmentId: Number(row.id),
    leadId: Number(row.lead_inscricao_id),
    student: String(row.student ?? ""),
    courseName: row.course_name ?? null,
    amount: num(row.total_amount),
    received: num(row.received),
    saleDate: row.sale_date,
    sellerName: row.seller_name ?? null,
    kind: row.ad_id ? "anuncio" : row.origem ? "organico" : "sem_origem",
    campaignName: row.campaign_name ?? null,
    adName: row.ad_name ?? null,
    origem: row.origem ?? null,
  }));

  return {
    from,
    to,
    totals: {
      sales: saleRows.length,
      contracted: saleRows.reduce((total, row) => total + row.amount, 0),
      received: saleRows.reduce((total, row) => total + row.received, 0),
      discount: rows.reduce((total, row) => total + num(row.discount_amount), 0),
    },
    byOrigin: groupBy(saleRows, (row) => {
      if (row.campaignName) return { key: `campanha:${row.campaignName}`, label: row.campaignName };
      if (row.origem) return { key: `origem:${row.origem}`, label: row.origem };
      return { key: "sem_origem", label: "Sem origem registrada" };
    }),
    byTraining: groupBy(saleRows, (row) => ({
      key: row.courseName ?? "sem_treinamento",
      label: row.courseName ?? "Sem treinamento",
    })),
    rows: saleRows,
  };
}
