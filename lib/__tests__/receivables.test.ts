import {
  classifyPaymentHealth,
  daysOverdue,
  guessPaymentMethodKey,
  receivableDueDate,
  receivableStatus,
} from "@/lib/receivables";
import type { FinanceRevenue } from "@/types/finance";

type Parcela = Pick<FinanceRevenue, "amount" | "paidAmount" | "dueDate" | "date" | "status" | "enrollmentId">;

function parcela(overrides: Partial<Parcela> = {}): Parcela {
  return {
    amount: 500,
    paidAmount: 0,
    dueDate: "2026-08-10",
    date: "2026-08-01",
    status: "previsto",
    enrollmentId: 42,
    ...overrides,
  };
}

describe("receivableDueDate", () => {
  it("prefere o vencimento acordado à competência", () => {
    expect(receivableDueDate({ dueDate: "2026-08-10", date: "2026-08-01" })).toBe("2026-08-10");
  });

  it("cai na competência quando a parcela não tem vencimento", () => {
    expect(receivableDueDate({ dueDate: null, date: "2026-08-01" })).toBe("2026-08-01");
  });
});

describe("receivableStatus", () => {
  it("parcela vencida e sem recebimento é atraso, mesmo gravada como previsto", () => {
    // O caso real: a rotina de recálculo só roda quando alguém mexe num
    // pagamento daquela matrícula, então o banco fica para trás.
    expect(receivableStatus(parcela(), "2026-08-19")).toBe("atrasado");
  });

  it("parcela que ainda não venceu continua prevista", () => {
    expect(receivableStatus(parcela(), "2026-08-01")).toBe("previsto");
  });

  it("no dia do vencimento ainda não é atraso", () => {
    expect(receivableStatus(parcela(), "2026-08-10")).toBe("previsto");
  });

  it("recebimento parcial não vira atraso nem quitação", () => {
    expect(receivableStatus(parcela({ paidAmount: 200 }), "2026-08-19")).toBe("parcial");
  });

  it("recebido o valor cheio quita, mesmo com o status antigo no banco", () => {
    expect(receivableStatus(parcela({ paidAmount: 500 }), "2026-08-19")).toBe("recebido");
  });

  it("pagar a mais (juros, arredondamento do boleto) não desfaz a quitação", () => {
    expect(receivableStatus(parcela({ paidAmount: 512.35 }), "2026-08-19")).toBe("recebido");
  });

  it("cancelada continua cancelada — é decisão humana, não se deduz de valor", () => {
    expect(receivableStatus(parcela({ status: "cancelado" }), "2026-08-19")).toBe("cancelado");
  });

  it("receita avulsa mantém o status declarado", () => {
    expect(receivableStatus(parcela({ enrollmentId: null, status: "recebido" }), "2026-08-19")).toBe("recebido");
  });
});

describe("daysOverdue", () => {
  it("conta os dias corridos desde o vencimento", () => {
    expect(daysOverdue("2026-08-10", "2026-08-19")).toBe(9);
  });

  it("é zero no dia do vencimento e antes dele", () => {
    expect(daysOverdue("2026-08-10", "2026-08-10")).toBe(0);
    expect(daysOverdue("2026-08-10", "2026-08-01")).toBe(0);
  });

  it("atravessa a virada do mês sem errar", () => {
    expect(daysOverdue("2026-07-30", "2026-08-02")).toBe(3);
  });
});

describe("guessPaymentMethodKey", () => {
  it("reconhece os nomes que existem no catálogo hoje", () => {
    expect(guessPaymentMethodKey("PIX")).toBe("pix");
    expect(guessPaymentMethodKey("Boleto Parcelado")).toBe("boleto");
    expect(guessPaymentMethodKey("Cartão Parcelado")).toBe("credito");
    expect(guessPaymentMethodKey("Crédito à Vista")).toBe("credito");
    expect(guessPaymentMethodKey("Débito")).toBe("debito");
    expect(guessPaymentMethodKey("Transferência")).toBe("transferencia");
    expect(guessPaymentMethodKey("Dinheiro")).toBe("dinheiro");
  });

  it("débito não é confundido com crédito", () => {
    expect(guessPaymentMethodKey("Cartão de Débito")).toBe("debito");
  });

  it("nome desconhecido ou vazio cai em outros, nunca num palpite errado", () => {
    expect(guessPaymentMethodKey("Permuta")).toBe("outros");
    expect(guessPaymentMethodKey("")).toBe("outros");
    expect(guessPaymentMethodKey(null)).toBe("outros");
  });
});

describe("classifyPaymentHealth", () => {
  const base = { scheduleCount: 10, openAmount: 4000, overdueCount: 0, overdueAmount: 0, creditAmount: 0 };

  it("sem parcela lançada não tem vencimento a acompanhar", () => {
    expect(classifyPaymentHealth({ ...base, scheduleCount: 0, openAmount: 0 }).status).toBe("sem_cronograma");
  });

  it("cronograma sem saldo é quitado", () => {
    expect(classifyPaymentHealth({ ...base, openAmount: 0 }).status).toBe("quitado");
  });

  it("saldo alto de contrato novo é em dia, não dívida", () => {
    expect(classifyPaymentHealth(base).status).toBe("em_dia");
  });

  it("parcela vencida sem dinheiro correspondente é atraso", () => {
    const result = classifyPaymentHealth({ ...base, overdueCount: 2, overdueAmount: 1000 });
    expect(result.status).toBe("atrasado");
    expect(result.uncoveredAmount).toBe(1000);
  });

  it("desconta o crédito já pago: cobra só o que falta de verdade", () => {
    const result = classifyPaymentHealth({ ...base, overdueCount: 2, overdueAmount: 1000, creditAmount: 400 });
    expect(result.status).toBe("atrasado");
    expect(result.uncoveredAmount).toBe(600);
  });

  it("quem pagou e teve o rateio preso na 1ª parcela é conciliação, não inadimplência", () => {
    // Caso real do contrato #3: R$ 3.000 pagos, todos alocados na parcela 1 de
    // R$ 1.000 — a parcela 2 aparece vencida sem que exista dívida.
    const result = classifyPaymentHealth({
      scheduleCount: 5,
      openAmount: 4000,
      overdueCount: 1,
      overdueAmount: 1000,
      creditAmount: 2000,
    });
    expect(result.status).toBe("a_conciliar");
    expect(result.uncoveredAmount).toBe(0);
  });
});
