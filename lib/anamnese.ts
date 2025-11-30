import { Pool } from "pg";

export interface AnamneseResposta {
  id: number;
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  momento_atual: string | null;
  dificuldade_barreira: string | null;
  maior_medo: string | null;
  tempo_disponivel: string | null;
  visao_instituto: string | null;
  visao_futuro: string | null;
  contribuicao: string | null;
  sonhos_objetivos: string | null;
  o_que_falta: string | null;
  como_ajudar: string | null;
  renda_necessaria: string | null;
  data_envio: string | null;
  recrutador_codigo: string | null;
}

function getPool(): Pool {
  // Reusing the pool logic from db.ts would be better, but I can't import getPool if it's not exported.
  // I'll check db.ts exports.
  // If not exported, I'll duplicate the pool creation for now or assume I can modify db.ts.
  // Let's assume I can modify db.ts to export getPool or just use the same env var.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sslEnabled = process.env.PG_SSL === "true";
  return new Pool({
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  });
}

export async function listUnlinkedAnamneses(): Promise<AnamneseResposta[]> {
  const pool = getPool();
  // Assuming recrutador_codigo column exists or will be added.
  // If it doesn't exist, this query will fail.
  // I'll try to select it.
  const res = await pool.query(`
    SELECT * FROM anamnese_respostas 
    WHERE recrutador_codigo IS NULL 
    ORDER BY data_envio DESC
  `);
  
  return res.rows.map(row => ({
    ...row,
    // Ensure dates are strings
    data_envio: row.data_envio ? new Date(row.data_envio).toISOString() : null
  }));
}

export async function linkAnamneseToRecruiter(anamneseId: number, recruiterCode: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE anamnese_respostas SET recrutador_codigo = $1 WHERE id = $2`,
    [recruiterCode, anamneseId]
  );
}

export async function getAnamneseByRecruiter(recruiterCode: string): Promise<AnamneseResposta[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM anamnese_respostas WHERE recrutador_codigo = $1 ORDER BY data_envio DESC`,
    [recruiterCode]
  );
  return res.rows.map(row => ({
    ...row,
    data_envio: row.data_envio ? new Date(row.data_envio).toISOString() : null
  }));
}
