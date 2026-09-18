/**
 * Avaliações de satisfação do Workshop VozUP.
 *
 * Quem escreve nesta tabela é o formulário `avaliacao-workshop` (Vercel), que
 * a participante responde no fim do evento. O CRM aqui **só lê**: o dono do
 * DDL é o formulário, e dois donos do mesmo CREATE TABLE é o tipo de corrida
 * que já derrubou /cupons no primeiro acesso depois de um deploy.
 *
 * A avaliação NÃO é lead (ver docs/cartilha-formularios-produtos.md §2): ela
 * mora em tabela separada justamente para não inflar contagem de lead nem
 * abrir bloco fantasma em /vozup. Quem respondeu quase sempre já é lead de
 * outro formulário, e é por isso que esta tela liga uma coisa na outra pelo
 * telefone — a única chave que as duas pontas têm em comum.
 *
 * Aqui ficam só os tipos e a contagem, sem tocar no banco: a tela é um
 * componente de cliente e qualquer import de `lib/db` a partir dela arrasta o
 * driver `pg` para o bundle do navegador (o build quebra citando
 * `pg/lib/stream.js`). A consulta mora em `lib/workshopReviewsData.ts`.
 */

export interface WorkshopReview {
  id: number;
  respondidoEm: string;
  /** Rótulo do evento, no formato "Workshop DD/MM/AAAA". */
  workshop: string;
  nome: string;
  telefone: string;
  nota: number | null;
  momento: string;
  interesse: string;
  /** Ficha do CRM com o mesmo telefone, quando existe. */
  inscricaoId: number | null;
}

export interface WorkshopReviewCount {
  label: string;
  total: number;
}

export interface WorkshopReviewSummary {
  respostas: number;
  /** Média das notas de 0 a 10; null quando ninguém respondeu. */
  notaMedia: number | null;
  /** Quantas notas 9 ou 10. */
  notasAltas: number;
  /** Quantas notas de 0 a 6. */
  notasBaixas: number;
  querProximosPassos: number;
  /** Quantos já têm ficha no CRM. */
  comLead: number;
  /** Uma entrada para cada nota de 0 a 10, inclusive as que ninguém deu. */
  distribuicaoNotas: WorkshopReviewCount[];
  porMomento: WorkshopReviewCount[];
  porInteresse: WorkshopReviewCount[];
}

/** A única resposta sem gancho comercial: todas as outras pedem contato. */
export const INTERESSE_SEM_CONTATO = "Não tenho interesse em continuar neste momento";

/** Pediu algum próximo passo — consultoria, plano ou só "me expliquem". */
export function querProximoPasso(review: WorkshopReview): boolean {
  return review.interesse !== "" && review.interesse !== INTERESSE_SEM_CONTATO;
}

/**
 * Conta o que a tela mostra. Puro de propósito: é a mesma função para o total
 * e para cada workshop filtrado, então filtro e KPI nunca discordam.
 *
 * Nota é contada como resposta, não como valor "preenchido": 0 é a crítica
 * mais valiosa que a pesquisa pode receber e não pode sumir de média nenhuma.
 */
export function summarizeWorkshopReviews(reviews: WorkshopReview[]): WorkshopReviewSummary {
  const notas = reviews.map((review) => review.nota).filter((nota): nota is number => nota !== null);
  const soma = notas.reduce((total, nota) => total + nota, 0);

  const contar = (valores: string[]): WorkshopReviewCount[] => {
    const mapa = new Map<string, number>();
    for (const valor of valores) {
      if (!valor) continue;
      mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
    }
    return Array.from(mapa, ([label, total]) => ({ label, total })).sort(
      (a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR")
    );
  };

  return {
    respostas: reviews.length,
    notaMedia: notas.length ? soma / notas.length : null,
    notasAltas: notas.filter((nota) => nota >= 9).length,
    notasBaixas: notas.filter((nota) => nota <= 6).length,
    querProximosPassos: reviews.filter(querProximoPasso).length,
    comLead: reviews.filter((review) => review.inscricaoId !== null).length,
    distribuicaoNotas: Array.from({ length: 11 }, (_, nota) => ({
      label: String(nota),
      total: notas.filter((valor) => valor === nota).length,
    })),
    porMomento: contar(reviews.map((review) => review.momento)),
    porInteresse: contar(reviews.map((review) => review.interesse)),
  };
}
