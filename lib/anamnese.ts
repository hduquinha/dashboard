import { getPool } from "@/lib/db";

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

const CREATE_TABLE_QUERY = `
    CREATE TABLE IF NOT EXISTS anamnese_respostas (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255),
        telefone VARCHAR(50),
        cidade VARCHAR(255),
        momento_atual TEXT,
        dificuldade_barreira TEXT,
        maior_medo TEXT,
        tempo_disponivel TEXT,
        visao_instituto TEXT,
        visao_futuro TEXT,
        contribuicao TEXT,
        sonhos_objetivos TEXT,
        o_que_falta TEXT,
        como_ajudar TEXT,
        renda_necessaria TEXT,
        data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

const ADD_COLUMN_QUERY = `
    ALTER TABLE anamnese_respostas 
    ADD COLUMN IF NOT EXISTS recrutador_codigo VARCHAR(50);
`;

async function ensureTable() {
  const pool = getPool();
  try {
    await pool.query(CREATE_TABLE_QUERY);
    await pool.query(ADD_COLUMN_QUERY);
  } catch (error) {
    console.error("Failed to ensure anamnese table structure", error);
    // Continue anyway, maybe it exists and we just lack permissions or something
  }
}

export async function listUnlinkedAnamneses(): Promise<AnamneseResposta[]> {
  try {
    await ensureTable();
    const pool = getPool();
    const res = await pool.query(`
      SELECT * FROM anamnese_respostas 
      WHERE recrutador_codigo IS NULL 
      ORDER BY data_envio DESC
    `);
    
    return res.rows.map(row => ({
      ...row,
      data_envio: row.data_envio ? new Date(row.data_envio).toISOString() : null
    }));
  } catch (error) {
    console.error("Failed to list unlinked anamneses.", error);
    return [];
  }
}

export async function linkAnamneseToRecruiter(anamneseId: number, recruiterCode: string): Promise<void> {
  try {
    await ensureTable();
    const pool = getPool();
    await pool.query(
      `UPDATE anamnese_respostas SET recrutador_codigo = $1 WHERE id = $2`,
      [recruiterCode, anamneseId]
    );
  } catch (error) {
    console.error("Failed to link anamnese.", error);
    throw error;
  }
}

export async function getAnamneseByRecruiter(recruiterCode: string): Promise<AnamneseResposta[]> {
  try {
    await ensureTable();
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM anamnese_respostas WHERE recrutador_codigo = $1 ORDER BY data_envio DESC`,
      [recruiterCode]
    );
    return res.rows.map(row => ({
      ...row,
      data_envio: row.data_envio ? new Date(row.data_envio).toISOString() : null
    }));
  } catch (error) {
    console.error("Failed to get anamneses by recruiter.", error);
    return [];
  }
}
