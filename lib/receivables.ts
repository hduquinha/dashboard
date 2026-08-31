import type { FinanceRevenue, RevenuePaymentMethod, RevenueStatus } from "@/types/finance";

/**
 * Regras de leitura das parcelas de matrícula — a base da aba Cobrança.
 *
 * Tudo aqui é puro de propósito: o mesmo cálculo roda no servidor (rotina que
 * marca atraso) e na tela (lista do mês), e duas implementações diferentes do
 * que é "atrasado" foi exatamente o que produziu a Glória aparecendo
 * inadimplente enquanto o boleto do casal estava pago.
 */

/** Data que manda na cobrança: o vencimento acordado, com a competência de reserva. */
export function receivableDueDate(item: Pick<FinanceRevenue, "dueDate" | "date">): string {
  return item.dueDate ?? item.date;
}

/**
 * Status real da parcela, calculado na hora.
 *
 * O `status` gravado em `finance_revenues` é um retrato do último recálculo, e
 * o recálculo só acontece quando alguém mexe num pagamento daquela matrícula —
 * uma parcela que venceu ontem continua gravada como "previsto" até lá. Quem
 * manda é o recebido contra o vencimento; o campo do banco só serve para
 * `cancelado`, que é decisão humana e não se deduz de valor nenhum.
 */
export function receivableStatus(
  item: Pick<FinanceRevenue, "amount" | "paidAmount" | "dueDate" | "date" | "status" | "enrollmentId">,
  today: string
): RevenueStatus {
  // Receita avulsa não tem cronograma: o status dela é declarado, não derivado.
  if (item.enrollmentId === null) return item.status;
  if (item.status === "cancelado") return "cancelado";
  if (item.paidAmount >= item.amount) return "recebido";
  if (item.paidAmount > 0) return "parcial";
  return receivableDueDate(item) < today ? "atrasado" : "previsto";
}

/** Dias corridos desde o vencimento; zero enquanto a parcela não venceu. */
export function daysOverdue(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now) || now <= due) return 0;
  return Math.round((now - due) / 86_400_000);
}

const METHOD_KEY_BY_TERM: ReadonlyArray<readonly [string, RevenuePaymentMethod]> = [
  ["pix", "pix"],
  ["boleto", "boleto"],
  ["dinheiro", "dinheiro"],
  ["especie", "dinheiro"],
  ["transfer", "transferencia"],
  ["ted", "transferencia"],
  ["doc", "transferencia"],
  ["debito", "debito"],
  ["credito", "credito"],
  ["cartao", "credito"],
];

/**
 * Traduz o nome da forma de pagamento do catálogo (`finance_payment_methods`,
 * livre e editável pelo usuário: "Boleto Parcelado", "Crédito à Vista") para a
 * chave fechada que o lançamento de pagamento aceita.
 *
 * É palpite assumido, para que a baixa da parcela já venha preenchida com a
 * forma combinada no contrato em vez de obrigar a escolher de novo toda vez.
 * Quem dá a baixa continua podendo trocar antes de confirmar.
 */
export function guessPaymentMethodKey(name: string | null | undefined): RevenuePaymentMethod {
  const normalized = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized.trim()) return "outros";
  for (const [term, key] of METHOD_KEY_BY_TERM) {
    if (normalized.includes(term)) return key;
  }
  return "outros";
}

/** Hoje em ISO (UTC), no mesmo formato das datas de vencimento. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Classifica a situação de pagamento de uma matrícula inteira.
 *
 * Puro pelo mesmo motivo do resto deste arquivo: a regra decide o que a tela pinta de
 * vermelho, e "vermelho" aqui significa alguém sendo cobrado. A distinção que ela
 * carrega é a que faltava — **vencido não é o mesmo que devido**. Quando o contrato já
 * recebeu dinheiro que não está aplicado em parcela nenhuma (pagamento lançado sem
 * selecionar a parcela, ou rateio antigo preso na primeira), a parcela vencida é
 * problema de conciliação, não de inadimplência. Foi assim que a Glória apareceu
 * inadimplente com o boleto do casal pago.
 */
export function classifyPaymentHealth(input: {
  scheduleCount: number;
  /** Saldo em aberto de todas as parcelas, vencidas ou não. */
  openAmount: number;
  overdueCount: number;
  /** Saldo em aberto só das parcelas já vencidas. */
  overdueAmount: number;
  /** Recebido no contrato que não está quitando parcela nenhuma. */
  creditAmount: number;
}): { status: "quitado" | "em_dia" | "atrasado" | "a_conciliar" | "sem_cronograma"; uncoveredAmount: number } {
  const uncoveredAmount = Math.max(0, Math.round((input.overdueAmount - input.creditAmount) * 100) / 100);
  if (input.scheduleCount === 0) return { status: "sem_cronograma", uncoveredAmount: 0 };
  if (input.openAmount <= 0.005) return { status: "quitado", uncoveredAmount: 0 };
  if (input.overdueCount === 0) return { status: "em_dia", uncoveredAmount: 0 };
  return { status: uncoveredAmount > 0.005 ? "atrasado" : "a_conciliar", uncoveredAmount };
}
