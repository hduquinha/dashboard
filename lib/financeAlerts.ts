import { createHash } from "node:crypto";

import { createAppNotifications } from "@/lib/appNotifications";
import { listEnrollmentPaymentHealth, markOverdueRevenues, type OverdueSweepRow } from "@/lib/finance";
import { hasPermission } from "@/lib/permissions";
import { listTeamMembers } from "@/lib/teamAuth";

/**
 * Cobrança automática do que venceu.
 *
 * Antes disto, nada no sistema olhava o relógio do dinheiro: as rotinas
 * periódicas do server.js cuidavam de lead parado, push e prazo de tarefa, e
 * uma parcela podia vencer e ficar meses sem que ninguém fosse avisado. O
 * status no banco só era refeito quando alguém lançava um pagamento naquela
 * matrícula — ou seja, quem parou de pagar era exatamente quem nunca era
 * recalculado.
 */

export interface OverdueAlertResult {
  /** Parcelas que mudaram para atrasado nesta passada. */
  marked: number;
  /** Parcelas que ficaram de fora do aviso por já existir dinheiro no contrato. */
  skippedByCredit: number;
  recipients: number;
  notified: number;
}

/** Identidade do lote de parcelas que venceram juntas. */
function batchKey(rows: readonly OverdueSweepRow[]): string {
  const ids = rows.map((row) => row.revenueId).sort((a, b) => a - b).join(",");
  return createHash("sha1").update(ids).digest("hex").slice(0, 16);
}

function moneyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Um aviso por lote, não um por parcela: rajada de notificação é bug conhecido aqui. */
function buildSummary(rows: readonly OverdueSweepRow[]): { title: string; body: string } {
  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  const students = [...new Set(rows.map((row) => row.student?.trim()).filter(Boolean))] as string[];
  const nomes = students.slice(0, 3).join(", ");
  const resto = students.length > 3 ? ` e mais ${students.length - 3}` : "";
  return {
    title: rows.length === 1 ? "1 parcela venceu" : `${rows.length} parcelas venceram`,
    body: students.length
      ? `${moneyBRL(total)} em aberto — ${nomes}${resto}.`
      : `${moneyBRL(total)} em aberto.`,
  };
}

/**
 * Marca as parcelas vencidas e avisa quem cuida do financeiro.
 *
 * O destinatário é quem tem `view.finance`, não o vendedor da matrícula:
 * `finance_sellers` guarda só nome e percentual, sem e-mail, então não há como
 * chegar na caixa do vendedor a partir da venda. Quem cobra hoje é o
 * financeiro — e é ele que consegue dar a baixa.
 */
export async function dispatchOverdueInstallmentAlerts(): Promise<OverdueAlertResult> {
  const marked = await markOverdueRevenues();
  const result: OverdueAlertResult = { marked: marked.length, skippedByCredit: 0, recipients: 0, notified: 0 };
  if (marked.length === 0) return result;

  // A parcela continua marcada como vencida — ela está em aberto de fato. O que a
  // regra de crédito decide é se ISTO VIRA COBRANÇA: quando o contrato já recebeu
  // dinheiro que não está aplicado naquela parcela (pagamento lançado sem selecionar
  // parcela, rateio preso na primeira), o caso é de conciliação e avisar "fulano está
  // devendo" é falso. A carteira de matrículas usa a mesma classificação; sem isto,
  // tela e sino diriam coisas diferentes sobre a mesma pessoa.
  const health = await listEnrollmentPaymentHealth().catch(() => []);
  const cobravel = new Set(
    health.filter((item) => item.status === "atrasado").map((item) => item.enrollmentId)
  );
  const rows = health.length > 0 ? marked.filter((row) => cobravel.has(row.enrollmentId)) : marked;
  result.skippedByCredit = marked.length - rows.length;
  if (rows.length === 0) return result;

  const members = await listTeamMembers({ activeOnly: true });
  const recipients = [
    ...new Set(
      members
        .filter((member) => hasPermission(member, "view.finance"))
        .map((member) => member.email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  result.recipients = recipients.length;
  if (recipients.length === 0) return result;

  const { title, body } = buildSummary(rows);
  result.notified = await createAppNotifications(recipients, [
    {
      kind: "finance_overdue",
      title,
      body,
      url: "/financeiro?aba=cobranca",
      // Idempotência pelo conjunto de parcelas, não pelo dia: reprocessar o
      // mesmo lote não duplica o aviso, mas uma parcela que vence mais tarde
      // no mesmo dia (matrícula cadastrada com vencimento retroativo) ainda
      // gera o seu — foi por chavear só pela data que um aviso se perderia.
      dedupeKey: `finance_overdue:${batchKey(rows)}`,
    },
  ]);
  return result;
}
