import {
  MAX_ENROLLMENT_INSTALLMENTS,
  enrollmentInstallmentOptions,
  installmentCap,
  normalizeEnrollmentInstallments,
} from "@/lib/enrollmentInstallments";

describe("normalizeEnrollmentInstallments", () => {
  it("aceita o boleto longo até 48x", () => {
    expect(normalizeEnrollmentInstallments(48)).toBe(48);
    expect(normalizeEnrollmentInstallments("36")).toBe(36);
  });

  it("corta acima do teto em vez de gravar um cronograma absurdo", () => {
    expect(normalizeEnrollmentInstallments(60)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
    expect(normalizeEnrollmentInstallments(1000)).toBe(48);
  });

  it("vazio, texto e zero viram 1 — cronograma nunca fica sem parcela", () => {
    expect(normalizeEnrollmentInstallments("")).toBe(1);
    expect(normalizeEnrollmentInstallments("abc")).toBe(1);
    expect(normalizeEnrollmentInstallments(0)).toBe(1);
    expect(normalizeEnrollmentInstallments(-5)).toBe(1);
    expect(normalizeEnrollmentInstallments(null)).toBe(1);
  });

  it("corta a parte decimal: não existe meia parcela", () => {
    expect(normalizeEnrollmentInstallments(12.8)).toBe(12);
  });
});

describe("enrollmentInstallmentOptions", () => {
  it("vai de 1 a 48, sem buraco", () => {
    const opcoes = enrollmentInstallmentOptions();
    expect(opcoes).toHaveLength(48);
    expect(opcoes[0]).toBe(1);
    expect(opcoes[opcoes.length - 1]).toBe(48);
  });

  it("o seletor e o servidor usam o mesmo teto", () => {
    expect(Math.max(...enrollmentInstallmentOptions())).toBe(MAX_ENROLLMENT_INSTALLMENTS);
    expect(normalizeEnrollmentInstallments(MAX_ENROLLMENT_INSTALLMENTS)).toBe(
      MAX_ENROLLMENT_INSTALLMENTS
    );
  });
});

describe("teto por forma de pagamento", () => {
  it("sem teto declarado, vale o teto do sistema", () => {
    expect(installmentCap(null)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
    expect(installmentCap(undefined)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
    expect(installmentCap(0)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
  });

  it("o carnê em 48x oferece as 48 opções", () => {
    expect(enrollmentInstallmentOptions(48)).toHaveLength(48);
  });

  it("forma de teto curto corta o seletor e o servidor no mesmo número", () => {
    expect(installmentCap(12)).toBe(12);
    expect(enrollmentInstallmentOptions(12)).toHaveLength(12);
    expect(normalizeEnrollmentInstallments(36, 12)).toBe(12);
    expect(normalizeEnrollmentInstallments(1, 12)).toBe(1);
  });

  it("teto acima do teto do sistema não escapa dele", () => {
    expect(installmentCap(120)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
    expect(normalizeEnrollmentInstallments(90, 120)).toBe(MAX_ENROLLMENT_INSTALLMENTS);
  });
});
