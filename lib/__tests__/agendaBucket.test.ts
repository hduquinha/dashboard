import { agendaBucket } from "@/lib/leadTasks";

/**
 * O balde da agenda é condição calculada — nunca status gravado. Estes casos
 * cobrem o bug que motivou a mudança: comparar só a DATA deixava a tarefa de
 * hoje às 10:00 em "Hoje" até a meia-noite, mesmo às 18:00.
 */
const AGORA = { date: "2026-08-12", time: "16:46" };

describe("agendaBucket", () => {
  it("conclui na frente de qualquer prazo", () => {
    expect(
      agendaBucket({ completedAt: "2026-08-01T12:00:00Z", dueDate: "2026-01-01", dueTime: "08:00" }, AGORA)
    ).toBe("concluida");
  });

  it("tarefa sem data fica em 'sem_data', nunca atrasada", () => {
    expect(agendaBucket({ dueDate: null, dueTime: null }, AGORA)).toBe("sem_data");
    expect(agendaBucket({ dueDate: null, dueTime: "07:00" }, AGORA)).toBe("sem_data");
  });

  it("data passada é atraso, com ou sem hora", () => {
    expect(agendaBucket({ dueDate: "2026-08-11", dueTime: null }, AGORA)).toBe("atrasada");
    expect(agendaBucket({ dueDate: "2026-08-11", dueTime: "23:59" }, AGORA)).toBe("atrasada");
  });

  it("hoje com hora já vencida é atraso", () => {
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "10:00" }, AGORA)).toBe("atrasada");
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "16:45" }, AGORA)).toBe("atrasada");
  });

  it("hoje na hora exata ainda não atrasou", () => {
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "16:46" }, AGORA)).toBe("hoje");
  });

  it("hoje com hora futura, ou sem hora, continua em 'hoje'", () => {
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "18:00" }, AGORA)).toBe("hoje");
    // Sem hora marcada o prazo vence no fim do dia — só atrasa amanhã.
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: null }, AGORA)).toBe("hoje");
  });

  it("data futura é 'proxima' mesmo com hora de madrugada", () => {
    expect(agendaBucket({ dueDate: "2026-08-13", dueTime: "00:01" }, AGORA)).toBe("proxima");
  });

  /**
   * Virada do dia: às 23:59 a tarefa das 00:00 do dia seguinte ainda é futura,
   * e um minuto depois a de hoje 23:59 vira atraso. Compara-se sempre data e
   * hora locais de São Paulo — nada de UTC, que viraria o dia às 21:00.
   */
  it("não confunde o dia na virada da meia-noite", () => {
    const quaseMeiaNoite = { date: "2026-08-12", time: "23:59" };
    expect(agendaBucket({ dueDate: "2026-08-13", dueTime: "00:00" }, quaseMeiaNoite)).toBe("proxima");
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "23:59" }, quaseMeiaNoite)).toBe("hoje");

    const logoDepois = { date: "2026-08-13", time: "00:00" };
    expect(agendaBucket({ dueDate: "2026-08-12", dueTime: "23:59" }, logoDepois)).toBe("atrasada");
    expect(agendaBucket({ dueDate: "2026-08-13", dueTime: "00:00" }, logoDepois)).toBe("hoje");
  });
});
