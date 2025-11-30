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

export async function listUnlinkedAnamneses(): Promise<AnamneseResposta[]> {
  try {
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
    console.error("Failed to list unlinked anamneses. Table might be missing.", error);
    return [];
  }
}

export async function linkAnamneseToRecruiter(anamneseId: number, recruiterCode: string): Promise<void> {
  try {
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
