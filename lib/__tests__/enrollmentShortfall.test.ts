import { planShortfallRedistribution, type EnrollmentScheduleLine } from "@/lib/finance";

/** Contrato de 6x800 = 4.800, nada recebido ainda. */
function schedule(overrides: Partial<EnrollmentScheduleLine>[] = []): EnrollmentScheduleLine[] {
  return Array.from({ length: 6 }, (_, index) => ({
    revenueId: index + 1,
    amount: 800,
    allocated: 0,
    selected: false,
    cancelled: false,
    installmentNumber: index + 1,
    ...(overrides[index] ?? {}),
  }));
}

describe("remanejamento quando o recebimento é menor que as parcelas marcadas", () => {
  // O caso que motivou a regra: marca 3 parcelas de 800 e paga 2.000.
  it("quita as três marcadas e joga os 400 nas parcelas em aberto", () => {
    const lines = schedule([
      { selected: true, allocated: 800 },
      { selected: true, allocated: 800 },
      { selected: true, allocated: 400 },
    ]);

    expect(planShortfallRedistribution(lines)).toEqual([
      { revenueId: 3, before: 800, after: 400 },
      { revenueId: 4, before: 800, after: 933.33 },
      { revenueId: 5, before: 800, after: 933.33 },
      { revenueId: 6, before: 800, after: 933.34 },
    ]);
  });

  it("mantém a soma das parcelas igual ao valor do contrato", () => {
    const lines = schedule([
      { selected: true, allocated: 800 },
      { selected: true, allocated: 800 },
      { selected: true, allocated: 400 },
    ]);
    const shift = new Map(planShortfallRedistribution(lines).map((entry) => [entry.revenueId, entry.after]));
    const total = lines.reduce((sum, line) => sum + (shift.get(line.revenueId) ?? line.amount), 0);

    expect(Math.round(total * 100) / 100).toBe(4800);
  });

  it("não mexe em nada quando o pagamento cobre o saldo marcado", () => {
    const lines = schedule([
      { selected: true, allocated: 800 },
      { selected: true, allocated: 800 },
    ]);

    expect(planShortfallRedistribution(lines)).toEqual([]);
  });

  // Decisão do usuário: sem parcela para absorver, vale a cascata de sempre e
  // a última marcada fica parcial — nada de reduzir o valor do contrato.
  it("desiste do remanejamento quando não sobra parcela em aberto", () => {
    const lines = schedule([
      { allocated: 800 },
      { allocated: 800 },
      { allocated: 800 },
      { selected: true, allocated: 800 },
      { selected: true, allocated: 800 },
      { selected: true, allocated: 400 },
    ]);

    expect(planShortfallRedistribution(lines)).toEqual([]);
  });

  // Quitar uma parcela que não recebeu um centavo seria fabricar quitação.
  it("deixa aberta a parcela marcada que não recebeu nada", () => {
    const lines = schedule([
      { selected: true, allocated: 300 },
      { selected: true, allocated: 0 },
      { selected: true, allocated: 0 },
    ]);

    expect(planShortfallRedistribution(lines)).toEqual([
      { revenueId: 1, before: 800, after: 300 },
      { revenueId: 4, before: 800, after: 966.66 },
      { revenueId: 5, before: 800, after: 966.66 },
      { revenueId: 6, before: 800, after: 966.68 },
    ]);
  });

  it("não usa a entrada nem parcela cancelada como absorvedor", () => {
    const lines: EnrollmentScheduleLine[] = [
      { revenueId: 10, amount: 1000, allocated: 0, selected: false, cancelled: false, installmentNumber: 0 },
      { revenueId: 11, amount: 800, allocated: 500, selected: true, cancelled: false, installmentNumber: 1 },
      { revenueId: 12, amount: 800, allocated: 0, selected: false, cancelled: true, installmentNumber: 2 },
      { revenueId: 13, amount: 800, allocated: 0, selected: false, cancelled: false, installmentNumber: 3 },
    ];

    expect(planShortfallRedistribution(lines)).toEqual([
      { revenueId: 11, before: 800, after: 500 },
      { revenueId: 13, before: 800, after: 1100 },
    ]);
  });

  // Parcela já paga por outro recebimento não vira absorvedora: mexer nela
  // reescreveria um valor que o caixa já confirmou.
  it("ignora parcela que já recebeu de outro pagamento", () => {
    const lines = schedule([
      { selected: true, allocated: 600 },
      { allocated: 800 },
      { allocated: 200 },
    ]);

    expect(planShortfallRedistribution(lines)).toEqual([
      { revenueId: 1, before: 800, after: 600 },
      { revenueId: 4, before: 800, after: 866.66 },
      { revenueId: 5, before: 800, after: 866.66 },
      { revenueId: 6, before: 800, after: 866.68 },
    ]);
  });
});
