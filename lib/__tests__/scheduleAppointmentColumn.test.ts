import { pickAppointmentColumn } from "@/lib/scheduleStage";

/**
 * Compromisso de lead não pode nascer no backlog de ideias do time: o quadro
 * Comercial tem uma coluna própria para lead, e é ela que deve vencer a ordem
 * de posição.
 */
describe("pickAppointmentColumn", () => {
  const comercial = [
    { id: 10, name: "📥 Backlog / Ideias", completes: false },
    { id: 11, name: "🎯 Prioridade da semana", completes: false },
    { id: 12, name: "✅ Concluído", completes: true },
    { id: 22, name: "Leads", completes: false },
  ];

  it("prefere a coluna de lead mesmo estando por último", () => {
    expect(pickAppointmentColumn(comercial)?.id).toBe(22);
  });

  it("sem coluna dedicada, cai na primeira que não conclui", () => {
    const semLeads = comercial.filter((column) => column.name !== "Leads");
    expect(pickAppointmentColumn(semLeads)?.id).toBe(10);
  });

  it("nunca escolhe a coluna de conclusão quando há outra", () => {
    expect(pickAppointmentColumn(comercial)?.completes).toBe(false);
  });

  it("quadro só com coluna de conclusão devolve o que existe", () => {
    const so = [{ id: 12, name: "✅ Concluído", completes: true }];
    expect(pickAppointmentColumn(so)?.id).toBe(12);
  });

  it("quadro sem colunas não quebra", () => {
    expect(pickAppointmentColumn([])).toBeUndefined();
  });
});
