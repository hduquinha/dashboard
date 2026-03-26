import {
  sanitizeImportFilename,
  sanitizeImportedRecord,
  sanitizeImportedRecords,
} from "@/lib/importSpreadsheet";

describe("lib/importSpreadsheet security helpers", () => {
  it("normalizes structured payloads before persistence", () => {
    const payload = sanitizeImportedRecord({
      nome: " Maria ",
      clientId: " abc-123 ",
      telefone: "(11) 91234-5678",
      _step: "2",
      _final: "sim",
      indicacao: " BIO-01 ",
      traffic_source: "",
      data_treinamento: "2026-03-01",
      areas_melhoria: [" Sono ", "", null],
      sintomas_fisicos: "[\"Dor de cabeca\", \"\"]",
    });

    expect(payload.nome).toBe("Maria");
    expect(payload.clientId).toBe("abc-123");
    expect(payload.telefone).toBe("11912345678");
    expect(payload._step).toBe(2);
    expect(payload._final).toBe(true);
    expect(payload.indicacao).toBe("BIO-01");
    expect(payload.from_bio).toBe("BIO-01");
    expect(payload.traffic_source).toBe("BIO-01");
    expect(payload.data_treinamento).toBe("01/03/2026");
    expect(payload.areas_melhoria).toEqual(["Sono"]);
    expect(payload.sintomas_fisicos).toEqual(["Dor de cabeca"]);
  });

  it("rejects invalid record collections", () => {
    expect(() => sanitizeImportedRecord(null)).toThrow("Registro de importacao invalido.");
    expect(() => sanitizeImportedRecords({})).toThrow("Lote de importacao invalido.");
  });

  it("sanitizes filenames before storing them", () => {
    expect(sanitizeImportFilename("  lote\x00-marco.csv  ")).toBe("lote-marco.csv");
    expect(sanitizeImportFilename("   ")).toBeNull();
  });
});
