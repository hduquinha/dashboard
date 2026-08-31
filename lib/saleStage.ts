/**
 * Etapa em que a venda é registrada.
 *
 * Fica isolado num módulo sem dependência de banco porque tanto o Kanban
 * (client) quanto as rotas de API precisam da mesma definição.
 *
 * A chave `fechamento` é a etapa "Fechado" do Funil VozUP e "Fechamento" do
 * Funil Aula Exclusiva — é onde o vendedor de fato fecha o negócio.
 *
 * Histórico: até 2026-08-13 o `kind = 'won'` do Funil VozUP estava na etapa
 * "Follow-Up", que na operação é acompanhamento de quem **não** fechou. O
 * resultado é que `/campanhas` contava 5 ganhos de R$ 0 e ignorava a única
 * venda real (R$ 6.000, que estava em "Fechado"). O `won` foi movido para
 * "Fechado" e Follow-Up virou `normal`.
 *
 * **Cuidado no Funil Aula Exclusiva (id 3): lá o `won` continua na etapa
 * "Ganho", separada de "Fechamento".** Por isso a regra segue valendo: lógica
 * de negócio opera por `kind`, e a venda em si por esta constante.
 */
export const SALE_STAGE_KEY = "fechamento";

export function isSaleStage(stageKey: string | null | undefined): boolean {
  return stageKey === SALE_STAGE_KEY;
}
