"use client";

import { useMemo, useState } from "react";
import { Flame, MessageSquareHeart, Star, Users, type LucideIcon } from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import { useOpenLeadProfile } from "@/components/LeadProfileLauncher";
import {
  querProximoPasso,
  summarizeWorkshopReviews,
  type WorkshopReview,
  type WorkshopReviewCount,
} from "@/lib/workshopReviews";

interface AvaliacoesClientProps {
  reviews: WorkshopReview[];
}

const TODOS = "__todos__";

/** Fuso declarado de propósito: o container roda em UTC, então sem isto a
 *  primeira renderização (no servidor) mostra a hora 3h adiantada até o
 *  navegador reidratar — e para quem abrir de fora do Brasil, sempre. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

/** Faixa da nota. A régua é a da pesquisa, não NPS: a pergunta é sobre o quanto
 *  o workshop fez a pessoa perceber algo, não sobre recomendar a escola. */
function notaTone(nota: number): string {
  if (nota >= 9) return "bg-[rgb(var(--teal-9))]";
  if (nota >= 7) return "bg-[rgb(var(--amber-9))]";
  return "bg-[rgb(var(--ruby-9))]";
}

function notaBadge(nota: number | null): string {
  if (nota === null) return "bg-neutral-100 text-neutral-500";
  if (nota >= 9) return "bg-emerald-50 text-emerald-700";
  if (nota >= 7) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

export function AvaliacoesClient({ reviews }: AvaliacoesClientProps) {
  const openLead = useOpenLeadProfile();
  const [workshop, setWorkshop] = useState<string>(TODOS);
  const [soQuentes, setSoQuentes] = useState(false);

  // Ordem de aparição: as linhas já vêm da mais recente para a mais antiga, o
  // que dispensa interpretar a data dentro do rótulo "Workshop DD/MM/AAAA".
  const workshops = useMemo(() => {
    const vistos: string[] = [];
    for (const review of reviews) {
      if (!vistos.includes(review.workshop)) vistos.push(review.workshop);
    }
    return vistos;
  }, [reviews]);

  const doWorkshop = useMemo(
    () => (workshop === TODOS ? reviews : reviews.filter((review) => review.workshop === workshop)),
    [reviews, workshop]
  );

  // O resumo segue o filtro de workshop, mas NÃO o de interesse: um KPI que
  // muda quando você liga "só quem quer próximos passos" mostraria 100% de
  // interessados e mentiria sobre o evento.
  const resumo = useMemo(() => summarizeWorkshopReviews(doWorkshop), [doWorkshop]);

  const listadas = useMemo(
    () => (soQuentes ? doWorkshop.filter(querProximoPasso) : doWorkshop),
    [doWorkshop, soQuentes]
  );

  const maiorNota = Math.max(1, ...resumo.distribuicaoNotas.map((faixa) => faixa.total));

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Avaliação do Workshop</h1>
          <p className="text-sm text-neutral-500">
            O que os participantes responderam no fim do evento. Não são leads novos — é a mesma pessoa que já
            está no CRM, ligada pelo telefone.
          </p>
        </div>
        <label className="flex items-center gap-2 self-start text-sm">
          <span className="text-neutral-500">Workshop</span>
          <select
            value={workshop}
            onChange={(event) => setWorkshop(event.target.value)}
            className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-900"
          >
            <option value={TODOS}>Todos ({reviews.length})</option>
            {workshops.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Users}
          tone="brand"
          label="Respostas"
          value={String(resumo.respostas)}
          hint={`${resumo.comLead} já têm ficha no CRM`}
        />
        <SummaryCard
          icon={Star}
          tone="teal"
          label="Nota média"
          value={resumo.notaMedia === null ? "—" : resumo.notaMedia.toFixed(1).replace(".", ",")}
          hint="De 0 a 10, o quanto o workshop fez a pessoa perceber algo"
        />
        <SummaryCard
          icon={MessageSquareHeart}
          tone="amber"
          label="Notas 9 e 10"
          value={String(resumo.notasAltas)}
          hint={`${resumo.notasBaixas} deram de 0 a 6`}
        />
        <SummaryCard
          icon={Flame}
          tone="ruby"
          label="Querem próximos passos"
          value={String(resumo.querProximosPassos)}
          hint="Para procurar ainda hoje"
        />
      </div>

      {resumo.respostas === 0 ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-semibold text-neutral-900">Nenhuma avaliação respondida ainda.</p>
          <p className="mt-1 text-xs text-neutral-500">
            As respostas caem aqui assim que alguém preencher o formulário em avaliacao-workshop.vercel.app.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-neutral-900">Distribuição das notas</h2>
            <p className="text-xs text-neutral-500">
              Quantas pessoas deram cada nota. Nota 0 é resposta, não falta de resposta.
            </p>
            <div className="mt-4 flex items-end gap-1.5 sm:gap-2">
              {resumo.distribuicaoNotas.map((faixa) => (
                <div key={faixa.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold tabular-nums text-neutral-500">
                    {faixa.total || ""}
                  </span>
                  <div className="flex h-24 w-full items-end">
                    <div
                      className={`w-full rounded-t ${notaTone(Number(faixa.label))} ${faixa.total ? "" : "opacity-20"}`}
                      style={{ height: `${Math.max((faixa.total / maiorNota) * 100, faixa.total ? 6 : 3)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums text-neutral-700">{faixa.label}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList
              title="O que mais contribuiu"
              hint="Momento escolhido por quem respondeu"
              accent="bg-[rgb(var(--blue-9))]"
              total={resumo.respostas}
              items={resumo.porMomento}
            />
            <BarList
              title="Interesse em continuar"
              hint="Depois da experiência, o que a pessoa quer fazer"
              accent="bg-[rgb(var(--teal-9))]"
              total={resumo.respostas}
              items={resumo.porInteresse}
            />
          </div>

          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-neutral-900">Respostas</h2>
                <p className="text-xs text-neutral-500">
                  Clique no nome para abrir a ficha completa no CRM.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                <input
                  type="checkbox"
                  checked={soQuentes}
                  onChange={(event) => setSoQuentes(event.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--blue-9))]"
                />
                Só quem quer próximos passos
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Quando</th>
                    <th className="px-4 py-2 text-left font-semibold">Quem respondeu</th>
                    <th className="px-4 py-2 text-center font-semibold">Nota</th>
                    <th className="px-4 py-2 text-left font-semibold">Momento</th>
                    <th className="px-4 py-2 text-left font-semibold">Interesse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {listadas.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-400">
                        Ninguém pediu próximo passo neste recorte.
                      </td>
                    </tr>
                  ) : (
                    listadas.map((review) => (
                      <tr key={review.id} className={querProximoPasso(review) ? "bg-emerald-50/40" : ""}>
                        <td className="px-4 py-3 align-top">
                          <p className="whitespace-nowrap text-xs text-neutral-500">
                            {formatDateTime(review.respondidoEm)}
                          </p>
                          <p className="whitespace-nowrap text-[11px] text-neutral-400">{review.workshop}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {review.inscricaoId !== null && openLead ? (
                            <button
                              type="button"
                              onClick={() => openLead(review.inscricaoId as number)}
                              className="text-left font-semibold text-[rgb(var(--blue-11))] hover:underline"
                            >
                              {review.nome}
                            </button>
                          ) : (
                            <p className="font-semibold text-neutral-900">{review.nome}</p>
                          )}
                          <p className="text-xs text-neutral-500">{review.telefone}</p>
                          {review.inscricaoId === null && (
                            <p className="text-[11px] text-neutral-400">Sem ficha com este telefone</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <span
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold tabular-nums ${notaBadge(review.nota)}`}
                          >
                            {review.nota ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-neutral-700">{review.momento || "—"}</td>
                        <td className="px-4 py-3 align-top text-neutral-700">{review.interesse || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function BarList({
  title,
  hint,
  accent,
  items,
  total,
}: {
  title: string;
  hint: string;
  accent: string;
  items: WorkshopReviewCount[];
  total: number;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
      <p className="text-xs text-neutral-500">{hint}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm text-neutral-700">{item.label}</p>
              <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-neutral-900">
                {item.total}
                <span className="ml-1 text-xs font-normal text-neutral-400">
                  {total > 0 ? `${Math.round((item.total / total) * 100)}%` : ""}
                </span>
              </p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${accent}`}
                style={{ width: `${total > 0 ? Math.max((item.total / total) * 100, 2) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <IconTile icon={icon} tone={tone} size="lg" solid />
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-500">{label}</p>
        <p className="truncate text-xl font-bold text-neutral-900">{value}</p>
        {hint && <p className="text-[10px] text-neutral-400">{hint}</p>}
      </div>
    </div>
  );
}
