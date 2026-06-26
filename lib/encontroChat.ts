import { getPool } from "@/lib/db";
export { isLeadMatch, normalizeForMatch, parseChatHistory } from "@/lib/encontroChatUtils";

const SCHEMA = "dashboard";
const TABLE = `${SCHEMA}.encontro_chat`;

export interface ChatMessage {
  horario: string;
  nome: string;
  mensagem: string;
}

export interface ChatDate {
  data_encontro: string;
  count: number;
}

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id SERIAL PRIMARY KEY,
      data_encontro DATE NOT NULL,
      horario TEXT NOT NULL,
      nome_participante TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_encontro_chat_data ON ${TABLE}(data_encontro);
  `);
  tableReady = true;
}

export async function importChatMessages(
  dataEncontro: string,
  messages: ChatMessage[]
): Promise<{ inserted: number }> {
  await ensureTable();
  const pool = getPool();
  await pool.query(`DELETE FROM ${TABLE} WHERE data_encontro = $1`, [dataEncontro]);
  if (messages.length === 0) return { inserted: 0 };

  const values: unknown[] = [];
  const placeholders = messages.map((m, i) => {
    const base = i * 4;
    values.push(dataEncontro, m.horario, m.nome, m.mensagem);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await pool.query(
    `INSERT INTO ${TABLE} (data_encontro, horario, nome_participante, mensagem) VALUES ${placeholders.join(",")}`,
    values
  );

  return { inserted: messages.length };
}

export async function getChatMessages(dataEncontro: string): Promise<ChatMessage[]> {
  await ensureTable();
  const result = await getPool().query(
    `SELECT horario, nome_participante AS nome, mensagem
     FROM ${TABLE}
     WHERE data_encontro = $1
     ORDER BY id`,
    [dataEncontro]
  );
  return result.rows as ChatMessage[];
}

export async function listChatDates(): Promise<ChatDate[]> {
  await ensureTable();
  const result = await getPool().query(
    `SELECT data_encontro::text, COUNT(*)::int AS count
     FROM ${TABLE}
     GROUP BY data_encontro
     ORDER BY data_encontro DESC`
  );
  return result.rows as ChatDate[];
}


