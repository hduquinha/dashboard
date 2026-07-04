import { getPool, autoMergeNewLeadByPhone } from "@/lib/db";

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const LOCK_KEY = "dashboard.merge_sweep";

interface PendingRow {
  id: number;
  inscricao_id: number;
}

/**
 * Consome dashboard.pending_merge_checks (enfileirada pelo trigger
 * enqueue_merge_check_after_insert, migracao 011) e roda o merge por
 * telefone (autoMergeNewLeadByPhone) para cada lead novo, nao importa
 * qual dos ~8 servicos externos o inseriu.
 *
 * Usa um lock consultivo do Postgres para que, se no futuro existir mais
 * de um processo/container chamando isso ao mesmo tempo, so um de fato
 * processe o lote por vez.
 */
export async function runMergeSweepOnce(): Promise<{ processed: number; skipped: number }> {
  const client = await getPool().connect();
  let processed = 0;
  let skipped = 0;

  try {
    const { rows: lockRows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [LOCK_KEY]
    );
    if (!lockRows[0]?.locked) {
      return { processed: 0, skipped: 0 };
    }

    try {
      const { rows: pending } = await client.query<PendingRow>(
        `SELECT id, inscricao_id
         FROM dashboard.pending_merge_checks
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE]
      );

      for (const row of pending) {
        try {
          const { rows: leadRows } = await client.query<{ payload: Record<string, unknown> }>(
            "SELECT payload FROM inscricoes.inscricoes WHERE id = $1",
            [row.inscricao_id]
          );
          const payload = leadRows[0]?.payload;
          const alreadyMerged = Boolean(payload?.dashboard_merged_into);
          const phone = String(
            payload?.telefone ?? payload?.phone ?? payload?.celular ?? payload?.whatsapp ?? ""
          ).trim();

          if (!payload || alreadyMerged || !phone) {
            await client.query(
              "UPDATE dashboard.pending_merge_checks SET status = 'skipped', processed_at = NOW() WHERE id = $1",
              [row.id]
            );
            skipped += 1;
            continue;
          }

          await autoMergeNewLeadByPhone(row.inscricao_id, phone);

          await client.query(
            "UPDATE dashboard.pending_merge_checks SET status = 'done', processed_at = NOW() WHERE id = $1",
            [row.id]
          );
          processed += 1;
        } catch (err) {
          await client.query(
            `UPDATE dashboard.pending_merge_checks
             SET status = CASE WHEN attempts >= $2 THEN 'error' ELSE 'pending' END,
                 attempts = attempts + 1,
                 last_error = $3
             WHERE id = $1`,
            [row.id, MAX_ATTEMPTS, String((err as Error)?.message ?? err)]
          );
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  return { processed, skipped };
}
