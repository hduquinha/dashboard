/**
 * Teto de parcelas do CRONOGRAMA da matrícula (a venda dividida em N vencimentos).
 *
 * Vive num módulo próprio, sem banco, porque o mesmo número precisa valer no
 * servidor (`createEnrollment`, `updateEnrollment`, a venda pelo lead) e na tela
 * (o `<select>` do fechamento e o editor de matrícula). Enquanto era um `24`
 * repetido em seis arquivos, mudar o limite significava caçar magic number — e
 * bastava esquecer um para o servidor cortar em silêncio o que a tela deixou
 * escolher.
 *
 * **48 é o teto do sistema**, herdado do boleto longo. Cada forma de pagamento
 * pode declarar o teto DELA em `dashboard.finance_payment_methods.max_installments`
 * (o carnê em 48x, o cartão em 12x…); quem não declara nada usa o teto do
 * sistema, que é o comportamento antigo. É por isso que as funções aqui recebem
 * o teto da forma escolhida: o número de parcelas oferecido na tela é sempre o
 * da forma, e o servidor recusa o que passa dele.
 *
 * Isto NÃO governa: parcelas de cartão num pagamento recebido (a maquininha, com
 * taxa por bandeira) nem parcelas de comissão. Esses continuam em 24 nos seus
 * próprios pontos de `lib/finance.ts`.
 */

export const MAX_ENROLLMENT_INSTALLMENTS = 48;

/** Teto que vale de fato: o da forma de pagamento, quando ela declara um; senão o do sistema. */
export function installmentCap(methodMax?: number | null): number {
  const parsed = Math.trunc(Number(methodMax));
  if (!Number.isFinite(parsed) || parsed < 1) return MAX_ENROLLMENT_INSTALLMENTS;
  return Math.min(parsed, MAX_ENROLLMENT_INSTALLMENTS);
}

/** Fora da faixa, texto ou vazio viram 1 — nunca `NaN` no cronograma. */
export function normalizeEnrollmentInstallments(value: unknown, methodMax?: number | null): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(installmentCap(methodMax), Math.trunc(parsed)));
}

/** As opções do seletor: 1x … até o teto da forma escolhida (48x quando ela não tem teto). */
export function enrollmentInstallmentOptions(methodMax?: number | null): number[] {
  const cap = installmentCap(methodMax);
  return Array.from({ length: cap }, (_, index) => index + 1);
}
