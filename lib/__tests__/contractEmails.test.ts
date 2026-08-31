import { isEmailAddress, maskEmail } from "@/lib/email";
import { otpEmailHtml, otpEmailText, signedCopyHtml, signedCopyText } from "@/lib/contractEmails";

describe("endereços de e-mail", () => {
  it("aceita endereço de verdade e recusa o resto", () => {
    expect(isEmailAddress("henriqueduquis1@gmail.com")).toBe(true);
    expect(isEmailAddress("vozup@escolavozup.com")).toBe(true);
    expect(isEmailAddress("sem-arroba.com")).toBe(false);
    expect(isEmailAddress("dois@@arrobas.com")).toBe(false);
    expect(isEmailAddress("sem@dominio")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
  });

  it("mascara o miolo mas mantém o domínio legível", () => {
    const masked = maskEmail("henriqueduquis1@gmail.com");
    expect(masked).toContain("@gmail.com");
    expect(masked.startsWith("hen")).toBe(true);
    // O que a máscara existe para esconder não pode sobrar nela.
    expect(masked).not.toContain("henriqueduquis1");
  });

  it("endereço curto não vira máscara curta demais", () => {
    expect(maskEmail("ab@x.com")).toMatch(/^ab•{3,}@x\.com$/);
  });
});

describe("e-mail do código de verificação", () => {
  const CODE = "480913";

  it("leva o código nas duas versões — HTML e texto puro", () => {
    // Cliente que bloqueia HTML e leitor de tela usam a versão texto. Código
    // que só existe no HTML é código que não chegou para parte das pessoas.
    expect(otpEmailHtml(CODE, "Miriam Costa Kawasaki", "VozUP")).toContain(CODE);
    expect(otpEmailText(CODE, "Miriam Costa Kawasaki", "VozUP")).toContain(CODE);
  });

  it("trata a pessoa pelo primeiro nome", () => {
    expect(otpEmailText(CODE, "Miriam Costa Kawasaki", "VozUP")).toContain("Oi, Miriam!");
  });

  it("avisa quem não pediu o código", () => {
    // É esse aviso que transforma o e-mail em prova: quem não assinou tem como
    // reclamar na hora.
    expect(otpEmailText(CODE, "Miriam", "VozUP")).toContain("Se não foi você");
  });

  it("nome de aluno com HTML entra como texto, não como marcação", () => {
    const html = otpEmailHtml(CODE, '<img src=x onerror="alert(1)">', "VozUP");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("e-mail da via assinada", () => {
  const BODY = {
    signerName: "Miriam Costa Kawasaki",
    courseName: "Curso oratória 6 meses",
    company: "VozUP",
    contractNumber: "12/1",
    signedAt: "21/08/2026, 14:44 (horário de Brasília)",
  };

  it("diz o curso, quando foi assinado e o número do contrato", () => {
    for (const body of [signedCopyText(BODY), signedCopyHtml(BODY)]) {
      expect(body).toContain("Curso oratória 6 meses");
      expect(body).toContain("21/08/2026");
      expect(body).toContain("12/1");
    }
  });

  it("pede para quem NÃO assinou responder na hora", () => {
    expect(signedCopyText(BODY)).toContain("Se você NÃO assinou");
    expect(signedCopyHtml(BODY)).toContain("Se você não assinou");
  });

  it("escapa o nome do curso vindo do catálogo", () => {
    const html = signedCopyHtml({ ...BODY, courseName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
  });
});
