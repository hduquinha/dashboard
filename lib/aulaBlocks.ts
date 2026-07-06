/**
 * Helpers puros (sem dependência de banco) da pasta de aulas da área VozUP.
 * Cada aula (turma + data) é um bloco separado, identificado pelo campo
 * data_treinamento do payload — ex.: "Aula Exclusiva 02/07/2026".
 *
 * Fica em módulo próprio porque também é usado no client (CreateLeadModal);
 * lib/vozupFolders.ts importa lib/db.ts e não pode entrar no bundle do browser.
 */

/** Sufixo do bloco que agrupa leads de aula sem data identificada. */
export const AULA_SEM_DATA_SUFFIX = " (sem data)";

/**
 * Converte o rótulo de um bloco de aula nos campos gravados em um lead criado
 * manualmente, de forma que ele apareça exatamente nesse bloco:
 *
 *   "Aula Exclusiva 02/07/2026"    → origem "Aula Exclusiva" + data_treinamento
 *   "Aula Experimental (sem data)" → origem "Aula Experimental" (sem data_treinamento)
 */
export function aulaBlockToLeadFields(bloco: string): {
  origem: string;
  data_treinamento?: string;
} {
  if (bloco.endsWith(AULA_SEM_DATA_SUFFIX)) {
    const origem = bloco.slice(0, -AULA_SEM_DATA_SUFFIX.length).trim();
    return { origem: origem || bloco };
  }
  const match = bloco.match(/^(.+?)\s*\d{2}\/\d{2}\/\d{4}$/);
  if (match && match[1].trim()) {
    return { origem: match[1].trim(), data_treinamento: bloco };
  }
  // Rótulo sem data reconhecível: data_treinamento era um texto livre — gravar
  // igual mantém o lead no mesmo bloco.
  return { origem: bloco, data_treinamento: bloco };
}
