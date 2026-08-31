/**
 * Envio de e-mail transacional pelo Resend.
 *
 * Sem SDK: o Resend é uma chamada HTTP e só, e uma dependência a menos é uma
 * dependência a menos para auditar num repositório público.
 *
 * Regra que vale para todo este módulo: **nada aqui lança exceção**. Quem chama
 * está no meio de assinar um contrato ou de registrar uma venda — falha de
 * e-mail não pode derrubar essas operações. Erro vira `{ ok: false }` e quem
 * chamou decide o que fazer, normalmente registrar o evento e seguir.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailAttachment {
  filename: string;
  /** Conteúdo binário; vai para o Resend em base64. */
  content: Buffer;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "nao_configurado" | "destinatario_invalido" | "falha"; message: string };

/**
 * Remetente. Tem que ser do domínio verificado no Resend
 * (`send.escolavozup.com`) — endereço de outro domínio é recusado no envio.
 */
function sender(): string {
  const address = process.env.CONTRACT_MAIL_FROM?.trim();
  return address || "VozUp <contratos@send.escolavozup.com>";
}

/** Para onde vai a resposta do aluno: o e-mail real da escola, não o do envio. */
function replyTo(): string | null {
  const address = process.env.CONTRACT_MAIL_REPLY_TO?.trim();
  return address || null;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Aceita só o que tem cara de endereço; o resto nem vira chamada de rede. */
export function isEmailAddress(value: string | null | undefined): boolean {
  const clean = (value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

/**
 * Esconde o miolo do endereço para poder aparecer em tela e em log sem expor o
 * e-mail inteiro: `henriqueduquis1@gmail.com` → `hen•••••@gmail.com`.
 */
export function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!user || !domain) return "•••";
  const visible = user.slice(0, Math.min(3, user.length));
  return `${visible}${"•".repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      reason: "nao_configurado",
      message: "RESEND_API_KEY não está configurada neste ambiente.",
    };
  }
  if (!isEmailAddress(input.to)) {
    return { ok: false, reason: "destinatario_invalido", message: "Endereço de e-mail inválido." };
  }

  const reply = replyTo();
  const payload: Record<string, unknown> = {
    from: sender(),
    to: [input.to.trim()],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (reply) payload.reply_to = reply;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((file) => ({
      filename: file.filename,
      content: file.content.toString("base64"),
    }));
  }

  try {
    // Timeout curto: o aluno está olhando para um botão girando. Melhor falhar
    // rápido e deixar ele pedir de novo do que segurar a página.
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !data.id) {
      return {
        ok: false,
        reason: "falha",
        message: data.message ?? `Resend respondeu ${response.status}.`,
      };
    }
    return { ok: true, id: data.id };
  } catch (cause) {
    return {
      ok: false,
      reason: "falha",
      message: cause instanceof Error ? cause.message : "Falha de rede ao enviar o e-mail.",
    };
  }
}
