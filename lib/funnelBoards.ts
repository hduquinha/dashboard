/**
 * Quadros de um funil.
 *
 * O funil continua sendo UM só (mesmas etapas, mesmo `kind`, mesma contagem em
 * relatório) — o que muda é em qual quadro cada etapa é desenhada. Foi assim, e
 * não com um funil novo, porque `commercial_stage_kind` é lido da etapa ATUAL
 * do lead: mandar um cliente fechado para outro funil o faria nascer numa etapa
 * `entry` e sumir dos ganhos de /campanhas, do ranking e do CAC. Etapa de
 * pós-venda com `kind = 'won'` e etapa de espera com `kind = 'lost'` mantêm
 * todo relatório contando o mesmo de antes.
 *
 * - `principal`: o funil de prospecção do dia a dia.
 * - `clientes`:  quem já assinou contrato — acompanhamento e oferta de outros
 *                produtos. Etapas aqui são `won` (a venda já aconteceu).
 * - `espera`:    lead do repique que a operação decidiu não trabalhar agora.
 *                Etapas aqui são `lost` (ele continua perdido, só sai da
 *                frente). Entrar aqui vindo do Desinteresse **não** conta um
 *                repique novo — ver `setCommercialStage`.
 */
export const FUNNEL_BOARDS = [
  { key: "principal", label: "Prospecção" },
  { key: "clientes", label: "Clientes" },
  { key: "espera", label: "Em espera" },
] as const;

export type FunnelBoard = (typeof FUNNEL_BOARDS)[number]["key"];

export const DEFAULT_FUNNEL_BOARD: FunnelBoard = "principal";

export function normalizeFunnelBoard(value: unknown): FunnelBoard {
  return FUNNEL_BOARDS.some((board) => board.key === value)
    ? (value as FunnelBoard)
    : DEFAULT_FUNNEL_BOARD;
}

export function funnelBoardLabel(board: FunnelBoard): string {
  return FUNNEL_BOARDS.find((item) => item.key === board)?.label ?? board;
}
