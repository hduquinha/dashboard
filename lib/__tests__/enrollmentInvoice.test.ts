import { normalizeEnrollmentInvoiceInput } from "@/lib/finance";

describe("controle de nota fiscal da matrícula", () => {
  it("exige número quando a nota é declarada emitida", () => {
    expect(() => normalizeEnrollmentInvoiceInput({ status: "emitida" })).toThrow(/número/i);
    expect(() => normalizeEnrollmentInvoiceInput({ status: "emitida", number: "   " })).toThrow(/número/i);
  });

  it("deixa a data em branco para o banco resolver como hoje", () => {
    expect(normalizeEnrollmentInvoiceInput({ status: "emitida", number: "1042" })).toEqual({
      status: "emitida",
      number: "1042",
      issuedAt: null,
      notes: null,
    });
  });

  it("recusa data de emissão fora do formato ISO", () => {
    expect(() =>
      normalizeEnrollmentInvoiceInput({ status: "emitida", number: "1042", issuedAt: "17/08/2026" })
    ).toThrow(/data de emissão/i);
  });

  it("exige motivo para tirar a matrícula da fila sem emitir nota", () => {
    expect(() => normalizeEnrollmentInvoiceInput({ status: "dispensada" })).toThrow(/por que/i);
    expect(
      normalizeEnrollmentInvoiceInput({ status: "dispensada", notes: " cortesia de lançamento " })
    ).toEqual({ status: "dispensada", number: null, issuedAt: null, notes: "cortesia de lançamento" });
  });

  // Voltar para pendente sem limpar número/data deixaria a fila de cobrança
  // exibindo uma pendência que já mostra número de nota emitida.
  it("descarta número e data ao voltar para pendente", () => {
    expect(
      normalizeEnrollmentInvoiceInput({
        status: "pendente",
        number: "1042",
        issuedAt: "2026-08-01",
        notes: "emitida por engano",
      })
    ).toEqual({ status: "pendente", number: null, issuedAt: null, notes: "emitida por engano" });
  });

  it("rejeita status desconhecido", () => {
    expect(() =>
      normalizeEnrollmentInvoiceInput({ status: "cancelada" as never })
    ).toThrow(/status de nota fiscal/i);
  });
});
