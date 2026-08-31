import {
  actionKindLabel,
  movedBySomeoneElse,
  summarizeActions,
  summarizeMovements,
  type LeadActionRow,
  type LeadMovementRow,
} from "@/lib/leadMovementLog";

const MAYARA = "mayara@escolavozup.com";
const ANDREA = "andrea@escolavozup.com";

function row(patch: Partial<LeadMovementRow> = {}): LeadMovementRow {
  return {
    eventId: 1,
    date: "2026-08-21",
    time: "10:00",
    leadId: 100,
    leadName: "João Silva",
    fromStage: "Conexão",
    toStage: "Agendado",
    ownerName: "Mayara Oliveira",
    ownerEmail: MAYARA,
    actorName: "Mayara Oliveira",
    actorEmail: MAYARA,
    byOther: false,
    ...patch,
  };
}

describe("movedBySomeoneElse", () => {
  it("marca quando o lead era do vendedor e outra pessoa moveu", () => {
    expect(movedBySomeoneElse(MAYARA, ANDREA, MAYARA)).toBe(true);
  });

  it("não marca o movimento do próprio dono", () => {
    expect(movedBySomeoneElse(MAYARA, MAYARA, MAYARA)).toBe(false);
  });

  it("não marca o vendedor mexendo em lead de outro — não é anomalia no painel dele", () => {
    expect(movedBySomeoneElse(ANDREA, MAYARA, MAYARA)).toBe(false);
  });

  it("ignora caixa e espaço no e-mail, que vêm do que foi gravado no dia", () => {
    expect(movedBySomeoneElse(" Mayara@EscolaVozUp.com ", ANDREA, MAYARA)).toBe(true);
  });

  it("lead sem dono na hora não vira movimento de ninguém", () => {
    expect(movedBySomeoneElse(null, ANDREA, MAYARA)).toBe(false);
  });
});

describe("summarizeMovements", () => {
  it("conta leads distintos e movimentações separadamente", () => {
    // O mesmo lead indo e voltando no dia é UMA pessoa trabalhada, mas três
    // movimentações — misturar os dois números infla o desempenho.
    const rows = [
      row({ eventId: 1, leadId: 100, fromStage: "Novo", toStage: "Conexão" }),
      row({ eventId: 2, leadId: 100, fromStage: "Conexão", toStage: "Agendado" }),
      row({ eventId: 3, leadId: 100, fromStage: "Agendado", toStage: "Conexão" }),
      row({ eventId: 4, leadId: 200, fromStage: "Novo", toStage: "Conexão" }),
    ];
    const resumo = summarizeMovements(rows, MAYARA);
    expect(resumo.moved).toBe(2);
    expect(resumo.movements).toBe(4);
  });

  it("não credita ao vendedor o que outra pessoa moveu no lead dele", () => {
    const rows = [
      row({ eventId: 1, leadId: 100 }),
      row({ eventId: 2, leadId: 200, actorEmail: ANDREA, actorName: "Andrea" }),
    ];
    const resumo = summarizeMovements(rows, MAYARA);
    expect(resumo.moved).toBe(1);
    expect(resumo.movements).toBe(1);
    expect(resumo.transitions).toHaveLength(1);
  });

  it("agrupa a distribuição por transição e ordena pela maior", () => {
    const rows = [
      row({ eventId: 1, leadId: 1, fromStage: "Conexão", toStage: "Agendado" }),
      row({ eventId: 2, leadId: 2, fromStage: "Conexão", toStage: "Agendado" }),
      row({ eventId: 3, leadId: 3, fromStage: "Conexão", toStage: "Agendado" }),
      row({ eventId: 4, leadId: 4, fromStage: "Agendado", toStage: "Fechado" }),
    ];
    const resumo = summarizeMovements(rows, MAYARA);
    expect(resumo.transitions).toEqual([
      { fromStage: "Conexão", toStage: "Agendado", count: 3 },
      { fromStage: "Agendado", toStage: "Fechado", count: 1 },
    ]);
  });

  it("etapa sem rótulo vira travessão em vez de sumir da distribuição", () => {
    const rows = [row({ fromStage: null, toStage: "Agendado" })];
    expect(summarizeMovements(rows, MAYARA).transitions).toEqual([
      { fromStage: "—", toStage: "Agendado", count: 1 },
    ]);
  });

  it("dia sem movimentação devolve tudo zerado, não erro", () => {
    const resumo = summarizeMovements([], MAYARA);
    expect(resumo).toEqual({ moved: 0, movements: 0, transitions: [] });
  });

  it("compara e-mail sem depender do nome gravado — o mesmo vendedor aparece como Thiago e Thiago Cardoso", () => {
    const rows = [
      row({ eventId: 1, leadId: 1, actorName: "Thiago", actorEmail: "thiago@escolavozup.com" }),
      row({ eventId: 2, leadId: 2, actorName: "Thiago Cardoso", actorEmail: "thiago@escolavozup.com" }),
    ];
    expect(summarizeMovements(rows, "thiago@escolavozup.com").moved).toBe(2);
  });
});

function acao(patch: Partial<LeadActionRow> = {}): LeadActionRow {
  return {
    eventId: 1,
    date: "2026-08-21",
    time: "10:00",
    leadId: 100,
    leadName: "João Silva",
    kind: "ligacao",
    action: "Ligação feita",
    ownerName: "Mayara Oliveira",
    ownerEmail: MAYARA,
    actorName: "Mayara Oliveira",
    actorEmail: MAYARA,
    byOther: false,
    ...patch,
  };
}

describe("summarizeActions", () => {
  it("separa 'ligação feita' de 'não atendida' — o mesmo tipo, descrição diferente", () => {
    const rows = [
      acao({ eventId: 1, action: "Ligação feita" }),
      acao({ eventId: 2, action: "Ligação feita" }),
      acao({ eventId: 3, action: "Ligação não atendida" }),
    ];
    const resumo = summarizeActions(rows, MAYARA);
    expect(resumo.byAction).toEqual([
      { kind: "ligacao", action: "Ligação feita", count: 2 },
      { kind: "ligacao", action: "Ligação não atendida", count: 1 },
    ]);
    // Por tipo elas voltam a ser a mesma coisa — e é por isso que agrupar só
    // por tipo não responderia "quantas não atenderam".
    expect(resumo.byKind).toEqual([{ kind: "ligacao", count: 3 }]);
    expect(resumo.total).toBe(3);
  });

  it("não credita ao vendedor a ação que outra pessoa registrou no lead dele", () => {
    const rows = [
      acao({ eventId: 1 }),
      acao({ eventId: 2, actorEmail: ANDREA, actorName: "Andrea", byOther: true }),
    ];
    const resumo = summarizeActions(rows, MAYARA);
    expect(resumo.total).toBe(1);
    // A linha do outro continua na lista detalhada, marcada.
    expect(resumo.rows).toHaveLength(2);
  });

  it("período sem ação devolve tudo vazio, não erro", () => {
    expect(summarizeActions([], MAYARA)).toEqual({
      total: 0,
      byAction: [],
      byKind: [],
      rows: [],
    });
  });
});

describe("actionKindLabel", () => {
  it("traduz os tipos conhecidos e não quebra com um tipo novo", () => {
    expect(actionKindLabel("ligacao")).toBe("Ligação");
    expect(actionKindLabel("whatsapp")).toBe("WhatsApp");
    expect(actionKindLabel("coisa_nova")).toBe("Outro");
    expect(actionKindLabel(null)).toBe("Outro");
  });
});
