/**
 * Textos dos e-mails do contrato digital.
 *
 * Separado de `contracts.ts` porque é conteúdo, não regra: quem for ajustar a
 * redação não precisa entrar no arquivo que decide se uma assinatura vale.
 *
 * Todo e-mail sai em HTML e em texto puro. O texto puro não é enfeite: cliente
 * que bloqueia HTML, leitor de tela e a prévia da notificação usam ele — e num
 * e-mail que carrega código de verificação, chegar ilegível é o mesmo que não
 * chegar.
 */

/** Escapa o que vem de cadastro antes de entrar no HTML. Nome de aluno é dado
 *  de terceiro: entra como texto, nunca como marcação. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "Olá";
}

const SHELL_OPEN = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:520px;margin:0 auto;padding:24px">`;
const SHELL_CLOSE = `</div>`;

function footer(company: string): string {
  return `<p style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
${escape(company)} — este é um e-mail automático do sistema de contratos.</p>`;
}

export function otpEmailText(code: string, signerName: string, company: string): string {
  return [
    `Oi, ${firstName(signerName)}!`,
    "",
    `Seu código para assinar o contrato de matrícula é: ${code}`,
    "",
    "Ele vale por 15 minutos e só pode ser usado uma vez.",
    "",
    "Se não foi você que pediu este código, ignore este e-mail e avise a escola —",
    "sem o código, ninguém consegue assinar o contrato em seu nome.",
    "",
    company,
  ].join("\n");
}

export function otpEmailHtml(code: string, signerName: string, company: string): string {
  return `${SHELL_OPEN}
<p>Oi, ${escape(firstName(signerName))}!</p>
<p>Seu código para assinar o contrato de matrícula é:</p>
<p style="font-size:34px;font-weight:700;letter-spacing:9px;text-align:center;background:#f3f4f6;border-radius:12px;padding:18px 0;margin:20px 0">${escape(code)}</p>
<p>Ele vale por <strong>15 minutos</strong> e só pode ser usado uma vez.</p>
<p style="color:#6b7280;font-size:13px">Se não foi você que pediu este código, ignore este e-mail e avise a escola — sem o código, ninguém consegue assinar o contrato em seu nome.</p>
${footer(company)}
${SHELL_CLOSE}`;
}

export function signedCopyText(input: {
  signerName: string;
  courseName: string;
  company: string;
  contractNumber: string;
  signedAt: string;
}): string {
  return [
    `Oi, ${firstName(input.signerName)}!`,
    "",
    `Seu contrato de matrícula do treinamento ${input.courseName} foi assinado em ${input.signedAt}.`,
    "",
    "A via assinada vai anexada a este e-mail, em PDF. Ela traz o termo de",
    "evidências com data, hora, endereço IP, dispositivo e o código de",
    "verificação do documento.",
    "",
    "Guarde este e-mail: ele é o seu comprovante.",
    "",
    "Se você NÃO assinou este contrato, responda esta mensagem imediatamente.",
    "",
    `${input.company} — contrato nº ${input.contractNumber}`,
  ].join("\n");
}

export function signedCopyHtml(input: {
  signerName: string;
  courseName: string;
  company: string;
  contractNumber: string;
  signedAt: string;
}): string {
  return `${SHELL_OPEN}
<p>Oi, ${escape(firstName(input.signerName))}!</p>
<p>Seu contrato de matrícula do treinamento <strong>${escape(input.courseName)}</strong> foi assinado em <strong>${escape(input.signedAt)}</strong>.</p>
<p>A via assinada vai <strong>anexada a este e-mail</strong>, em PDF. Ela traz o termo de evidências com data, hora, endereço IP, dispositivo e o código de verificação do documento.</p>
<p style="background:#ecfdf5;border-radius:10px;padding:14px 16px;color:#065f46">Guarde este e-mail: ele é o seu comprovante da assinatura.</p>
<p style="color:#9f1239;font-size:13px"><strong>Se você não assinou este contrato</strong>, responda esta mensagem imediatamente.</p>
${footer(`${input.company} — contrato nº ${input.contractNumber}`)}
${SHELL_CLOSE}`;
}
