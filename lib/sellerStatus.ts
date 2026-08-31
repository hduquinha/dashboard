/**
 * Disponibilidade que o próprio vendedor declara no Kanban, para quem
 * distribui lead saber quem está de fato atendendo agora.
 *
 * É declaração, não presença automática: ninguém fica "online" só por ter o
 * navegador aberto, e ninguém fica "offline" por trocar de aba. Quem sabe se
 * pode receber lead é a pessoa.
 *
 * O status **avisa, não bloqueia** (decisão da operação em 2026-08-13): em
 * urgência o distribuidor ainda manda lead para quem está offline.
 */
import { getPool } from "@/lib/db";

const SCHEMA = "dashboard";

let schemaReady = false;

export type SellerAvailability = "online" | "offline";

export interface SellerStatus {
  memberId: number;
  status: SellerAvailability;
  updatedAt: string | null;
  /** Recado curto opcional: "em reunião até 15h", "almoço". */
  note: string | null;
}

async function ensureSellerStatusSchema(): Promise<void> {
  if (schemaReady) return;

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.seller_status (
      member_id  INTEGER PRIMARY KEY,
      status     TEXT NOT NULL DEFAULT 'offline',
      note       TEXT,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  schemaReady = true;
}

function normalize(value: unknown): SellerAvailability {
  return value === "online" ? "online" : "offline";
}

/** Status de todo mundo, indexado por member_id (= chatwootUserId do vendedor). */
export async function listSellerStatuses(): Promise<Map<number, SellerStatus>> {
  await ensureSellerStatusSchema();

  const { rows } = await getPool().query<{
    member_id: number;
    status: string;
    note: string | null;
    updated_at: Date | string;
  }>(`SELECT member_id, status, note, updated_at FROM ${SCHEMA}.seller_status`);

  const map = new Map<number, SellerStatus>();
  for (const row of rows) {
    const memberId = Number(row.member_id);
    if (!Number.isFinite(memberId)) continue;
    map.set(memberId, {
      memberId,
      status: normalize(row.status),
      note: row.note ?? null,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    });
  }
  return map;
}

export async function getSellerStatus(memberId: number): Promise<SellerStatus> {
  const all = await listSellerStatuses();
  return (
    all.get(memberId) ?? { memberId, status: "offline", note: null, updatedAt: null }
  );
}

/**
 * Só o próprio vendedor muda o seu status — quem chama já validou a sessão.
 * Não há caminho para um gestor marcar outro como online: seria dizer por
 * alguém que ele está disponível.
 */
export async function setSellerStatus(
  memberId: number,
  status: SellerAvailability,
  note?: string | null
): Promise<SellerStatus> {
  await ensureSellerStatusSchema();

  const cleanNote = typeof note === "string" ? note.trim().slice(0, 120) || null : null;

  await getPool().query(
    `INSERT INTO ${SCHEMA}.seller_status (member_id, status, note, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (member_id) DO UPDATE
       SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = NOW()`,
    [memberId, normalize(status), cleanNote]
  );

  return { memberId, status: normalize(status), note: cleanNote, updatedAt: new Date().toISOString() };
}
