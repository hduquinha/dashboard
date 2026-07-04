/**
 * Posicionamento fracionário para drag-and-drop do Kanban comercial.
 * Cada lead tem um `position` (double) por coluna; reordenar não exige
 * reescrever as outras linhas — só recalcular o ponto médio entre vizinhos.
 */

const REBALANCE_STEP = 1000;
const MIN_GAP = 1e-7;

/**
 * Calcula a nova posição de um card solto entre `before` (posição do card
 * imediatamente acima, ou null se soltou no topo) e `after` (posição do
 * card imediatamente abaixo, ou null se soltou no fim).
 */
export function computeDropPosition(before: number | null, after: number | null): number {
  if (before === null && after === null) {
    return 0;
  }
  if (before === null) {
    return (after as number) - REBALANCE_STEP;
  }
  if (after === null) {
    return before + REBALANCE_STEP;
  }
  return (before + after) / 2;
}

/**
 * Verdadeiro quando `before`/`after` convergiram tanto (por sucessivas
 * inserções no mesmo intervalo) que não há mais espaço de ponto flutuante
 * para inserir um valor entre eles — sinal de que a coluna precisa ser
 * respaçada antes de calcular a posição.
 */
export function needsRebalance(before: number | null, after: number | null): boolean {
  if (before === null || after === null) {
    return false;
  }
  return after - before < MIN_GAP;
}

/**
 * Respaça todas as posições de uma coluna em passos inteiros, preservando
 * a ordem relativa atual. Use quando `needsRebalance` indicar colisão.
 */
export function rebalancePositions(orderedIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  orderedIds.forEach((id, index) => {
    result.set(id, index * REBALANCE_STEP);
  });
  return result;
}
