import { isNonEmptyStageKey } from "@/lib/db";

/**
 * Regressão de 2026-07-31: o filtro de etapa do Kanban só era aplicado quando a
 * chave estava numa lista fixa das 8 etapas legadas. Uma etapa criada no editor
 * de funis ("Compra futura") não estava lá, o filtro era silenciosamente
 * ignorado e a coluna nova mostrava o funil inteiro — 276 leads repetidos das
 * outras colunas. Etapa é livre por funil; quem valida a chave é a rota do
 * kanban, contra as etapas do funil.
 */
describe("isNonEmptyStageKey", () => {
  it("aceita as etapas criadas no editor de funis", () => {
    expect(isNonEmptyStageKey("compra_futura")).toBe(true);
    expect(isNonEmptyStageKey("aula_exclusiva")).toBe(true);
    expect(isNonEmptyStageKey("qualquer_etapa_nova_de_2027")).toBe(true);
  });

  it("continua aceitando as etapas legadas", () => {
    for (const stage of ["novo", "primeiro_contato", "em_atendimento", "agendado", "fechamento", "ganho", "perdido", "no_show"]) {
      expect(isNonEmptyStageKey(stage)).toBe(true);
    }
  });

  it("recusa ausência de etapa, para o filtro não virar condição vazia", () => {
    expect(isNonEmptyStageKey(null)).toBe(false);
    expect(isNonEmptyStageKey(undefined)).toBe(false);
    expect(isNonEmptyStageKey("")).toBe(false);
    expect(isNonEmptyStageKey("   ")).toBe(false);
  });
});
