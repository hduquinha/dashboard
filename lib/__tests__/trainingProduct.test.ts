import { classifyTrainingProduct } from "@/lib/trainings";

/**
 * Cartilha regra 4: `data_treinamento` em ISO é EXCLUSIVA do Encontro Online.
 * O bug que motivou estes casos: uma inscrição do Encontro Online que herdou
 * campos do UP Day (camiseta, multa, origem de importação antiga) de um cadastro
 * anterior da mesma pessoa marcava `is_upday` no SQL e, pelo BOOL_OR do grupo,
 * renomeava a TURMA INTEIRA para "Up Day Plus" no filtro de /inscricoes e jogava
 * o card de /treinamentos para a seção errada.
 */
describe("classifyTrainingProduct", () => {
  it("data ISO é Encontro Online mesmo com o payload marcado como UP Day", () => {
    expect(classifyTrainingProduct("2026-08-27T19:00:00-03:00", { isUpDay: true })).toBe("online");
    expect(classifyTrainingProduct("2026-08-27T19:00:00-03:00")).toBe("online");
  });

  it("turma configurada manda — inclusive os aliases ISO das turmas do UP Day", () => {
    expect(classifyTrainingProduct("2026-10-24T08:59:00-03:00")).toBe("up-day-plus");
    expect(classifyTrainingProduct("15 e 16/08")).toBe("up-day-plus");
  });

  it("data solta do UP Day continua UP Day", () => {
    expect(classifyTrainingProduct("24 e 25/10/2026")).toBe("up-day-plus");
    expect(classifyTrainingProduct("Inscrição UP Day - Outubro 2026")).toBe("up-day-plus");
    expect(classifyTrainingProduct("05/05/2026", { isUpDay: true })).toBe("up-day-plus");
  });

  it("cadastro da VozUP não é produto do Instituto UP", () => {
    expect(classifyTrainingProduct("Aula Exclusiva 25/08/2026")).toBeNull();
    expect(classifyTrainingProduct("Landing Page VozUP - Vendas")).toBeNull();
    expect(classifyTrainingProduct("")).toBeNull();
  });
});
