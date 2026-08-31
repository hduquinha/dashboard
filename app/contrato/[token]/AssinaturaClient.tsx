"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Download, FileText, Loader2, Mail, ShieldCheck } from "lucide-react";
import type { PublicContractView } from "@/lib/contracts";
import type { ContractBlock, ContractPlanRow, ContractSnapshot } from "@/lib/contractTemplate";
import { normalizePlan, planTotal } from "@/lib/contractTemplate";

interface AssinaturaClientProps {
  contract: PublicContractView;
  token: string;
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Máscara conforme digita — CPF é o campo que mais dá erro no celular. */
function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

function formatDateBr(value: string | null): string {
  if (!value) return "—";
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return value;
}

/**
 * Quadro de resumo — a primeira página do contrato de papel.
 *
 * Vem antes das cláusulas de propósito: é o que o aluno confere de verdade
 * (nome, curso, quanto e quando paga). As cláusulas ele lê depois, e são
 * iguais para todo mundo.
 */
function ResumoQuadro({ snapshot }: { snapshot: ContractSnapshot }) {
  const { student, course } = snapshot;
  // Mesmo tratamento do PDF (`buildContractPdf`): o quadro sai com as quatro
  // linhas do papel, mesmo as que o contrato foi salvo sem elas.
  const plan = normalizePlan(snapshot.plan);
  const rows: Array<[string, string]> = [
    ["Nome", student.name || "—"],
    ["RG", student.rg || "—"],
    ["CPF", student.cpf || "—"],
    ["Nascimento", formatDateBr(student.birthDate)],
    ["Profissão", student.profession || "—"],
    ["Empresa", student.company || "—"],
    ["Telefone", student.mobile || student.phone || "—"],
    ["E-mail", student.email || "—"],
    [
      "Endereço",
      [student.address, student.neighborhood, student.city, student.state]
        .filter((part) => part && part.trim())
        .join(", ") || "—",
    ],
    ["CEP", student.zip || "—"],
  ];

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Aluno(a)</h3>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</dt>
              <dd className="text-[13px] text-neutral-800">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Curso / treinamento</h3>
        <p className="mt-1 text-[13px] text-neutral-800">
          {course.name || "—"}
          {course.hours ? ` • ${course.hours}` : ""}
          {course.className ? ` • turma ${course.className}` : ""}
        </p>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Plano financeiro</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Valor</th>
                <th className="px-3 py-2 text-center font-semibold">Parcelas</th>
                <th className="px-3 py-2 text-left font-semibold">Forma</th>
                <th className="px-3 py-2 text-left font-semibold">1º vencimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {plan.map((row: ContractPlanRow) => (
                <tr key={row.key}>
                  <td className="px-3 py-2 text-neutral-700">{row.label}</td>
                  <td className="px-3 py-2 text-right font-semibold text-neutral-900">
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-3 py-2 text-center text-neutral-500">
                    {row.installments > 1 ? `${row.installments}x ${formatMoney(row.installmentAmount)}` : "à vista"}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{row.paymentMethod ?? "A combinar"}</td>
                  <td className="px-3 py-2 text-neutral-500">{formatDateBr(row.firstDueDate)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-neutral-200 bg-neutral-50">
              <tr>
                <td className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-bold text-neutral-900">
                  {formatMoney(planTotal(plan))}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function ContractBody({ blocks }: { blocks: ContractBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => (
        <section key={index}>
          <h3 className="text-sm font-bold text-neutral-900">{block.title}</h3>
          <div className="mt-1.5 space-y-1.5">
            {block.items.map((item) => (
              <p key={item.number} className="text-[13px] leading-relaxed text-neutral-600">
                <span className="font-semibold text-neutral-500">{item.number}</span> {item.text}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Página que o aluno abre pelo link do WhatsApp.
 *
 * Desenhada para celular e para leitura: o contrato inteiro fica na tela antes
 * do formulário, e o botão de assinar só liga depois do aceite marcado. Nada
 * de "aceite os termos" escondido em link — o texto que ele aceita é o texto
 * que está acima do botão.
 */
/**
 * Instante a partir do qual o tempo de leitura corre.
 *
 * É `openedAt`, gravado no servidor na primeira abertura do link — assim quem
 * abriu ontem e voltou hoje não espera de novo, e o contador da tela usa a
 * mesma base que a checagem do servidor.
 *
 * O fallback existe só para o caso de `openedAt` vir nulo ou ilegível, e é
 * calculado UMA vez. Recalcular `Date.now()` a cada tique deixava o contador
 * eternamente em 90 — o tempo decorrido dava zero toda vez, e a assinatura
 * nunca liberava.
 */
function readingStartOf(contract: PublicContractView): number {
  const opened = contract.openedAt ? new Date(contract.openedAt) : null;
  return opened && Number.isFinite(opened.getTime()) ? opened.getTime() : Date.now();
}

function remainingSeconds(startedAt: number, minimum: number): number {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, minimum - elapsed);
}

export function AssinaturaClient({ contract, token }: AssinaturaClientProps) {
  const [name, setName] = useState(contract.signerName);
  const [cpf, setCpf] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(contract.status === "assinado");
  // Leitura: o fim do texto precisa ter passado pela tela E o contrato precisa
  // ter ficado aberto pelo tempo mínimo. Enquanto faltar um dos dois, o aceite
  // nem aparece para ser marcado.
  const [reachedEnd, setReachedEnd] = useState(false);
  const readingStartRef = useRef<number>(readingStartOf(contract));
  const [secondsLeft, setSecondsLeft] = useState(() =>
    remainingSeconds(readingStartRef.current, contract.minReadingSeconds)
  );
  const endOfTextRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(
      () => setSecondsLeft(remainingSeconds(readingStartRef.current, contract.minReadingSeconds)),
      1000
    );
    return () => clearInterval(timer);
  }, [contract.minReadingSeconds, secondsLeft]);

  useEffect(() => {
    const sentinel = endOfTextRef.current;
    if (!sentinel || reachedEnd) return;
    // IntersectionObserver em vez de conta de scroll: funciona igual no celular
    // com barra de endereço que aparece e some, e não depende da altura da
    // janela. Uma vez visto, fica visto — voltar para o topo não desfaz.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReachedEnd(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [reachedEnd]);

  const readingDone = reachedEnd && secondsLeft <= 0;

  // Código por e-mail: só entra em cena depois da leitura cumprida, para a
  // pessoa não receber um código enquanto ainda está lendo e ele vencer.
  const [otpCode, setOtpCode] = useState("");
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);

  async function requestOtp() {
    setSendingOtp(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/contracts/${token}/otp`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; maskedEmail?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não consegui enviar o código.");
      setOtpSentTo(data.maskedEmail ?? "seu e-mail");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui enviar o código.");
    } finally {
      setSendingOtp(false);
    }
  }

  // O "em Nx" do cabeçalho é o maior parcelamento do plano: matrícula à vista
  // com o curso em 12x é 12x para quem lê, não 1x nem 13x.
  const totalInstallments = contract.snapshot.plan.reduce(
    (largest, row) => Math.max(largest, row.installments),
    1
  );

  const blocked = contract.status === "cancelado" || !contract.documentReady;

  async function sign() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/contracts/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cpf, accepted, reachedEnd, otpCode }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível assinar agora.");
      setSigned(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível assinar agora.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-600">
          {contract.companyName || "Contrato"}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-neutral-900">Contrato de matrícula</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {contract.courseName} • {formatMoney(contract.amount)}
          {totalInstallments > 1 ? ` em ${totalInstallments}x` : " à vista"}
        </p>
      </header>

      {signed ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h2 className="mt-2 text-lg font-bold text-emerald-900">Contrato assinado</h2>
          <p className="mt-1 text-sm text-emerald-800">
            {contract.signatureKind === "papel"
              ? `A via assinada no papel foi digitalizada e arquivada pela escola${contract.signedAt ? ` em ${formatDateTime(contract.signedAt)}` : ""}.`
              : `${contract.signedAt ? `Assinatura registrada em ${formatDateTime(contract.signedAt)}.` : "Sua assinatura foi registrada."} Guarde uma via: ela traz o termo de evidências com data, hora e código de verificação.`}
          </p>
          <a
            href={`/api/public/contracts/${token}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Download className="h-4 w-4" /> Baixar minha via em PDF
          </a>
        </section>
      ) : contract.status === "cancelado" ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
          <h2 className="text-lg font-bold text-neutral-900">Este contrato foi cancelado</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Fale com a escola para receber um contrato novo.
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-4 flex items-center gap-2 border-b border-neutral-100 pb-3">
          <FileText className="h-4 w-4 text-neutral-400" />
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            Contrato nº {contract.id} — leia antes de assinar
          </p>
        </div>
        <ResumoQuadro snapshot={contract.snapshot} />
        <div className="my-5 border-t border-neutral-100" />
        <ContractBody blocks={contract.clauses} />
        {contract.closing && (
          <p className="mt-5 text-[13px] leading-relaxed text-neutral-600">{contract.closing}</p>
        )}
        {/* Marco do fim do texto: chegar aqui é o que libera o aceite. */}
        <div ref={endOfTextRef} aria-hidden className="h-px w-full" />
      </section>

      {!signed && contract.status === "pendente" && (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-cyan-600" />
            <h2 className="text-base font-bold text-neutral-900">Assinar eletronicamente</h2>
          </div>

          {!contract.documentReady && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Este contrato ainda está sendo preparado pela escola e não pode ser assinado agora. Avise quem te
              enviou o link.
            </p>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-500">
                Nome completo, como está no documento
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={blocked}
                className="w-full rounded-xl border border-neutral-200 px-3 py-3 text-base text-neutral-900 focus:border-cyan-400 focus:outline-none"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-500">Seu CPF</label>
              <input
                value={cpf}
                onChange={(event) => setCpf(maskCpf(event.target.value))}
                disabled={blocked}
                inputMode="numeric"
                placeholder="000.000.000-00"
                className="w-full rounded-xl border border-neutral-200 px-3 py-3 text-base text-neutral-900 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            {readingDone && !blocked && (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
                <p className="text-[13px] font-semibold text-cyan-900">
                  Código de verificação
                </p>
                {otpSentTo ? (
                  <>
                    <p className="mt-1 text-[12px] leading-relaxed text-cyan-800">
                      Enviamos um código de 6 dígitos para <strong>{otpSentTo}</strong>. Ele vale por
                      15 minutos. Confira também a caixa de spam.
                    </p>
                    <input
                      value={otpCode}
                      onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      disabled={blocked}
                      className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-3 py-3 text-center text-2xl font-bold tracking-[0.5em] text-neutral-900 focus:border-cyan-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={requestOtp}
                      disabled={sendingOtp}
                      className="mt-2 text-[12px] font-semibold text-cyan-700 underline disabled:opacity-50"
                    >
                      {sendingOtp ? "Enviando..." : "Não chegou? Enviar outro código"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[12px] leading-relaxed text-cyan-800">
                      Para assinar, confirme que é você: vamos enviar um código para o e-mail do seu
                      cadastro.
                    </p>
                    <button
                      type="button"
                      onClick={requestOtp}
                      disabled={sendingOtp || blocked}
                      className="mt-2 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
                    >
                      {sendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {sendingOtp ? "Enviando..." : "Enviar código para meu e-mail"}
                    </button>
                  </>
                )}
              </div>
            )}

            {!readingDone && !blocked && (
              <p className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
                <BookOpen className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                  {!reachedEnd
                    ? "Role a página até o fim do contrato para liberar a assinatura."
                    : `Falta${secondsLeft === 1 ? "" : "m"} ${secondsLeft} segundo${secondsLeft === 1 ? "" : "s"} de leitura para liberar a assinatura.`}
                </span>
              </p>
            )}

            <label
              className={`flex items-start gap-3 rounded-xl bg-neutral-50 p-3 ${
                readingDone && !blocked ? "cursor-pointer" : "cursor-not-allowed opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                disabled={blocked || !readingDone}
                className="mt-0.5 h-5 w-5 flex-none accent-cyan-600"
              />
              <span className="text-[13px] leading-relaxed text-neutral-600">{contract.acceptanceText}</span>
            </label>
          </div>

          {error && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

          <button
            type="button"
            onClick={sign}
            disabled={saving || blocked || !accepted || !readingDone || otpCode.length !== 6}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-5 py-4 text-base font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {saving ? "Registrando assinatura..." : "Assinar contrato"}
          </button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-400">
            Ao assinar, ficam registrados data, hora, endereço IP, o dispositivo usado, o tempo de
            leitura, a conferência do código enviado ao seu e-mail e um código de verificação do
            documento, conforme a cláusula de assinatura eletrônica acima. A via assinada chega no
            seu e-mail em seguida.
          </p>
        </section>
      )}

      <footer className="mt-8 text-center text-[11px] text-neutral-400">
        {contract.companyName || "Escola"} • Contrato nº {contract.id}/{contract.version}
      </footer>
    </main>
  );
}
