/**
 * Carga de trabalho por vendedor, para quem distribui lead decidir com dado
 * em vez de memória.
 *
 * Antes desta tela o distribuidor escolhia o vendedor num `<select>` que só
 * mostrava nome e e-mail: não dava para saber quem já estava afogado nem quem
 * tinha uma pilha parada no repique.
 *
 * **A lista fria (funil de Triagem) fica de fora.** Ela tem distribuição e
 * ritmo próprios, e misturada aqui distorcia tudo: um vendedor aparecia com 98
 * leads quando 45 eram contatos frios ainda por conferir.
 */
import { getPool } from "@/lib/db";
import { effectiveOriginSql } from "@/lib/leadOriginPriority";

const SCHEMA = "dashboard";

export interface SellerWorkloadBucket {
  key: string;
  label: string;
  count: number;
}

export interface SellerWorkload {
  sellerId: number;
  /** Total de leads ativos (fora de ganho/perda). */
  total: number;
  /** Quantos estão no repique — etapa `lost`, "Desinteresse" no Funil VozUP. */
  repique: number;
  byStage: SellerWorkloadBucket[];
  byOrigin: SellerWorkloadBucket[];
}

/**
 * Uma consulta por recorte, as duas agrupando em cima da mesma base. Não vale
 * a pena unir num único SELECT: seriam dois GROUP BY diferentes sobre o mesmo
 * conjunto e o resultado teria que ser desmontado no Node de qualquer jeito.
 *
 * A extração de origem é cara (JSONB, ver `effectiveOriginSql`), então ela só
 * roda no recorte que precisa dela.
 */
export async function listSellerWorkloads(): Promise<Map<number, SellerWorkload>> {
  const pool = getPool();

  const [stageRows, originRows] = await Promise.all([
    pool.query<{
      seller_id: number;
      stage_key: string | null;
      stage_label: string | null;
      stage_kind: string | null;
      total: string;
    }>(
      `
        SELECT cl.assigned_seller_id AS seller_id,
               cl.commercial_stage   AS stage_key,
               COALESCE(s.label, cl.commercial_stage) AS stage_label,
               cl.commercial_stage_kind AS stage_kind,
               COUNT(*)::text AS total
          FROM ${SCHEMA}.commercial_leads cl
          LEFT JOIN ${SCHEMA}.funnel_stages s
                 ON s.funnel_id = cl.funnel_id AND s.key = cl.commercial_stage
          LEFT JOIN ${SCHEMA}.funnels f ON f.id = cl.funnel_id
         WHERE cl.assigned_seller_id IS NOT NULL
           AND NOT COALESCE(f.is_triage, false)
         GROUP BY 1, 2, 3, 4
      `
    ),
    pool.query<{ seller_id: number; origem: string | null; total: string }>(
      `
        SELECT cl.assigned_seller_id AS seller_id,
               COALESCE(NULLIF(TRIM(${effectiveOriginSql("i")}), ''), 'Sem origem') AS origem,
               COUNT(*)::text AS total
          FROM ${SCHEMA}.commercial_leads cl
          JOIN inscricoes.inscricoes i ON i.id = cl.inscricao_id
          LEFT JOIN ${SCHEMA}.funnels f ON f.id = cl.funnel_id
         WHERE cl.assigned_seller_id IS NOT NULL
           AND NOT COALESCE(f.is_triage, false)
           -- Só a carteira viva interessa para distribuir: quem já ganhou ou
           -- perdeu não ocupa o tempo do vendedor.
           AND COALESCE(cl.commercial_stage_kind, 'normal') NOT IN ('won', 'lost')
         GROUP BY 1, 2
      `
    ),
  ]);

  const workloads = new Map<number, SellerWorkload>();

  function ensure(sellerId: number): SellerWorkload {
    let entry = workloads.get(sellerId);
    if (!entry) {
      entry = { sellerId, total: 0, repique: 0, byStage: [], byOrigin: [] };
      workloads.set(sellerId, entry);
    }
    return entry;
  }

  for (const row of stageRows.rows) {
    const sellerId = Number(row.seller_id);
    if (!Number.isFinite(sellerId)) continue;
    const count = Number(row.total) || 0;
    const entry = ensure(sellerId);

    if (row.stage_kind === "lost") {
      entry.repique += count;
      continue;
    }
    // Ganho não conta como carga: o vendedor não trabalha mais esse lead.
    if (row.stage_kind === "won") continue;

    entry.total += count;
    entry.byStage.push({
      key: row.stage_key ?? "sem_etapa",
      label: row.stage_label ?? "Sem etapa",
      count,
    });
  }

  for (const row of originRows.rows) {
    const sellerId = Number(row.seller_id);
    if (!Number.isFinite(sellerId)) continue;
    const entry = ensure(sellerId);
    entry.byOrigin.push({
      key: row.origem ?? "Sem origem",
      label: row.origem ?? "Sem origem",
      count: Number(row.total) || 0,
    });
  }

  for (const entry of workloads.values()) {
    entry.byStage.sort((a, b) => b.count - a.count);
    entry.byOrigin.sort((a, b) => b.count - a.count);
  }

  return workloads;
}
