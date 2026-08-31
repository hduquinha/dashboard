import {
  businessUnitLabel,
  normalizeBusinessUnit,
  parseBusinessUnitFilter,
} from "@/lib/financeBusinessUnits";

describe("normalizeBusinessUnit", () => {
  it("reconhece as duas unidades", () => {
    expect(normalizeBusinessUnit("instituto")).toBe("instituto");
    expect(normalizeBusinessUnit("vozup")).toBe("vozup");
  });

  it("cai em vozup para valor ausente ou desconhecido", () => {
    // Toda a base nasceu antes da separação existir: o histórico é VozUP.
    expect(normalizeBusinessUnit(null)).toBe("vozup");
    expect(normalizeBusinessUnit(undefined)).toBe("vozup");
    expect(normalizeBusinessUnit("")).toBe("vozup");
    expect(normalizeBusinessUnit("qualquer coisa")).toBe("vozup");
    expect(normalizeBusinessUnit(7)).toBe("vozup");
  });
});

describe("parseBusinessUnitFilter", () => {
  it("sem escolha significa somar as duas, não vozup", () => {
    // Confundir isto faria a visão "Tudo" esconder o Instituto UP.
    expect(parseBusinessUnitFilter("")).toBeUndefined();
    expect(parseBusinessUnitFilter("tudo")).toBeUndefined();
    expect(parseBusinessUnitFilter(null)).toBeUndefined();
    expect(parseBusinessUnitFilter(undefined)).toBeUndefined();
  });

  it("aceita as duas unidades, tolerando caixa e espaço", () => {
    expect(parseBusinessUnitFilter("instituto")).toBe("instituto");
    expect(parseBusinessUnitFilter(" INSTITUTO ")).toBe("instituto");
    expect(parseBusinessUnitFilter("VozUP")).toBe("vozup");
  });
});

describe("businessUnitLabel", () => {
  it("usa o nome que a tela mostra", () => {
    expect(businessUnitLabel("instituto")).toBe("Instituto UP");
    expect(businessUnitLabel("vozup")).toBe("Voz UP");
    expect(businessUnitLabel(null)).toBe("Voz UP");
  });
});
