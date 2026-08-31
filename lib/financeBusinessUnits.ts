/**
 * Unidade de negócio de um lançamento financeiro.
 *
 * Receita e despesa das duas empresas entram na mesma base — é assim que a
 * operação funciona — mas a leitura precisa separar uma da outra. Esta é a
 * dimensão que faz isso, e é independente de `finance_branches` (unidade
 * física, hoje com uma linha só, "Matriz") e de `unidade_negocio` do payload do
 * lead, que classifica produto e não dinheiro.
 */

export type FinanceBusinessUnit = "vozup" | "instituto";

export const FINANCE_BUSINESS_UNITS: readonly FinanceBusinessUnit[] = ["vozup", "instituto"];

export const FINANCE_BUSINESS_UNIT_LABELS: Record<FinanceBusinessUnit, string> = {
  vozup: "Voz UP",
  instituto: "Instituto UP",
};

/**
 * Valor gravado no banco. Tudo que não for reconhecido vira `vozup`: era a
 * única operação até a separação existir, então é o padrão que não reescreve
 * história.
 */
export function normalizeBusinessUnit(value: unknown): FinanceBusinessUnit {
  return value === "instituto" ? "instituto" : "vozup";
}

/**
 * Valor do FILTRO de tela, onde "sem escolha" significa somar as duas — por
 * isso ele devolve `undefined` em vez de cair no padrão `vozup`. Trocar um pelo
 * outro faria "Tudo" mostrar só a VozUP.
 */
export function parseBusinessUnitFilter(value: unknown): FinanceBusinessUnit | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "instituto") return "instituto";
  if (normalized === "vozup") return "vozup";
  return undefined;
}

export function businessUnitLabel(value: unknown): string {
  return FINANCE_BUSINESS_UNIT_LABELS[normalizeBusinessUnit(value)];
}
