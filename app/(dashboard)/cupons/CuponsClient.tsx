"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import type { Coupon, CouponStatus, CouponUse, UnregisteredCouponCode } from "@/lib/coupons";

interface CuponsClientProps {
  initialCoupons: Coupon[];
  initialUnregistered: UnregisteredCouponCode[];
  canManage: boolean;
}

interface CouponDraft {
  id: number | null;
  code: string;
  description: string;
  maxUses: string;
  validUntil: string;
  active: boolean;
}

function emptyDraft(code = ""): CouponDraft {
  return { id: null, code, description: "", maxUses: "", validUntil: "", active: true };
}

function draftFrom(coupon: Coupon): CouponDraft {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description ?? "",
    maxUses: coupon.maxUses === null ? "" : String(coupon.maxUses),
    validUntil: coupon.validUntil ?? "",
    active: coupon.active,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const STATUS_STYLE: Record<CouponStatus, { label: string; className: string }> = {
  ativo: { label: "Ativo", className: "bg-emerald-50 text-emerald-700" },
  inativo: { label: "Desativado", className: "bg-neutral-100 text-neutral-500" },
  expirado: { label: "Expirado", className: "bg-amber-50 text-amber-700" },
  esgotado: { label: "Esgotado", className: "bg-rose-50 text-rose-700" },
};

/**
 * Gestão dos cupons de cortesia do Encontro Online.
 *
 * A tela responde três perguntas de uma vez: quais códigos existem, até quando
 * cada um vale e quantas pessoas já entraram de graça por ele. O número de usos
 * não é um contador guardado à parte — é a contagem dos leads carimbados com o
 * código, a mesma que o formulário consulta para decidir se o cupom esgotou.
 * Por isso ele já nasce mostrando as cortesias concedidas antes desta tela
 * existir.
 */
export function CuponsClient({ initialCoupons, initialUnregistered, canManage }: CuponsClientProps) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [unregistered, setUnregistered] = useState(initialUnregistered);
  const [draft, setDraft] = useState<CouponDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [usesByCode, setUsesByCode] = useState<Record<string, CouponUse[]>>({});
  const [loadingUses, setLoadingUses] = useState<string | null>(null);

  const totals = useMemo(() => {
    const ativos = coupons.filter((coupon) => coupon.status === "ativo").length;
    const concedidas = coupons.reduce((sum, coupon) => sum + coupon.uses, 0);
    const foraDaTela = unregistered.reduce((sum, item) => sum + item.uses, 0);
    return { ativos, concedidas, foraDaTela };
  }, [coupons, unregistered]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/coupons");
    const data = (await response.json().catch(() => ({}))) as {
      coupons?: Coupon[];
      unregistered?: UnregisteredCouponCode[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Falha ao carregar os cupons.");
    if (data.coupons) setCoupons(data.coupons);
    if (data.unregistered) setUnregistered(data.unregistered);
  }, []);

  async function toggleUses(code: string) {
    if (expanded === code) {
      setExpanded(null);
      return;
    }
    setExpanded(code);
    if (usesByCode[code]) return;

    setLoadingUses(code);
    try {
      const response = await fetch(`/api/coupons/uses?code=${encodeURIComponent(code)}`);
      const data = (await response.json().catch(() => ({}))) as { uses?: CouponUse[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar quem usou.");
      setUsesByCode((current) => ({ ...current, [code]: data.uses ?? [] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar quem usou.");
      setExpanded(null);
    } finally {
      setLoadingUses(null);
    }
  }

  async function saveCoupon() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        code: draft.code,
        description: draft.description.trim() || null,
        maxUses: draft.maxUses.trim() === "" ? null : Number(draft.maxUses),
        validUntil: draft.validUntil || null,
        active: draft.active,
      };
      const response = await fetch(draft.id ? `/api/coupons/${draft.id}` : "/api/coupons", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar o cupom.");
      setDraft(null);
      // O código pode ter mudado, então a lista de "quem usou" já carregada não
      // vale mais para essa linha.
      setUsesByCode({});
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o cupom.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCoupon(coupon: Coupon) {
    const aviso =
      coupon.uses > 0
        ? `Excluir o cupom ${coupon.code}? As ${coupon.uses} cortesias já concedidas continuam valendo — o código é que deixa de ser aceito.`
        : `Excluir o cupom ${coupon.code}?`;
    if (!window.confirm(aviso)) return;

    setError(null);
    try {
      const response = await fetch(`/api/coupons/${coupon.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir o cupom.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir o cupom.");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
  const labelClass = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400";

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Cupons</h1>
          <p className="text-sm text-neutral-500">
            Cortesias do Encontro Online: cada cupom aceito zera o valor da inscrição.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="inline-flex h-10 items-center gap-2 self-start rounded-lg bg-neutral-900 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" /> Novo cupom
          </button>
        )}
      </header>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={Ticket}
          tone="teal"
          label="Cupons ativos"
          value={String(totals.ativos)}
          hint="Valendo agora, dentro do prazo e do limite"
        />
        <SummaryCard
          icon={Users}
          tone="brand"
          label="Cortesias concedidas"
          value={String(totals.concedidas)}
          hint="Inscrições que entraram sem pagar"
        />
        <SummaryCard
          icon={CalendarClock}
          tone="amber"
          label="Fora desta tela"
          value={String(totals.foraDaTela)}
          hint="Usos de códigos ainda não cadastrados aqui"
        />
      </div>

      {unregistered.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-amber-900">
                Códigos já usados que ainda não estão cadastrados aqui
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                Estes códigos deram cortesia a alguém, mas vieram da variável{" "}
                <code className="rounded bg-amber-100 px-1 font-mono">CUPONS_ENCONTRO_ONLINE</code> na Vercel.
                Enquanto essa variável existir, eles continuam sendo aceitos no formulário sem aparecer nesta
                gestão. Cadastre cada um aqui e depois esvazie a variável.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {unregistered.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => canManage && setDraft(emptyDraft(item.code))}
                    disabled={!canManage}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-default disabled:opacity-70"
                  >
                    <span className="font-mono">{item.code}</span>
                    <span className="text-amber-600">
                      {item.uses} uso{item.uses === 1 ? "" : "s"}
                    </span>
                    {canManage && <Plus className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-5 py-4">
          <h2 className="text-sm font-bold text-neutral-900">Cupons cadastrados</h2>
          <p className="text-xs text-neutral-500">
            Sem limite de usos e sem validade, o cupom vale para sempre. Clique no número de usos para ver quem
            entrou por ele.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Código</th>
                <th className="px-4 py-2 text-left font-semibold">Validade</th>
                <th className="px-4 py-2 text-left font-semibold">Usos</th>
                <th className="px-4 py-2 text-center font-semibold">Situação</th>
                <th className="px-4 py-2 text-left font-semibold">Último uso</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {coupons.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-sm text-neutral-400">
                    Nenhum cupom cadastrado ainda.
                  </td>
                </tr>
              ) : (
                coupons.map((coupon) => {
                  const status = STATUS_STYLE[coupon.status];
                  const isOpen = expanded === coupon.code;
                  return (
                    <Fragment key={coupon.id}>
                      <tr className={coupon.active ? "" : "bg-neutral-50/60"}>
                        <td className="px-4 py-3">
                          <p className="font-mono font-bold text-neutral-900">{coupon.code}</p>
                          {coupon.description && (
                            <p className="text-xs text-neutral-400">{coupon.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {coupon.validUntil ? (
                            <>
                              até {formatDate(coupon.validUntil)}
                              <span className="block text-[10px] text-neutral-400">inclusive</span>
                            </>
                          ) : (
                            <span className="text-neutral-400">sem prazo</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleUses(coupon.code)}
                            className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 font-semibold text-neutral-900 hover:bg-neutral-100"
                          >
                            {coupon.uses}
                            {coupon.maxUses !== null && (
                              <span className="font-normal text-neutral-400">de {coupon.maxUses}</span>
                            )}
                            {loadingUses === coupon.code ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                            ) : (
                              <ChevronDown
                                className={`h-3.5 w-3.5 text-neutral-400 transition ${isOpen ? "rotate-180" : ""}`}
                              />
                            )}
                          </button>
                          {coupon.maxUses !== null && (
                            <span className="mt-0.5 block text-[10px] text-neutral-400">
                              {coupon.remaining === 0
                                ? "nenhuma vaga restante"
                                : `${coupon.remaining} restante${coupon.remaining === 1 ? "" : "s"}`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-500">
                          {coupon.lastUsedAt ? formatDateTime(coupon.lastUsedAt) : "—"}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setDraft(draftFrom(coupon))}
                                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label={`Editar ${coupon.code}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeCoupon(coupon)}
                                className="rounded-lg p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                                aria-label={`Excluir ${coupon.code}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-neutral-50/80">
                          <td colSpan={canManage ? 6 : 5} className="px-4 py-3">
                            <UsesList uses={usesByCode[coupon.code] ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-neutral-900">
                  {draft.id ? "Editar cupom" : "Novo cupom"}
                </h2>
                <p className="text-xs text-neutral-500">
                  Todo cupom aceito é cortesia integral — não existe desconto parcial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={labelClass} htmlFor="cupom-codigo">
                  Código
                </label>
                <input
                  id="cupom-codigo"
                  value={draft.code}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
                  placeholder="CORTESIA2026"
                  className={`${inputClass} font-mono`}
                />
                <p className="mt-1 text-[10px] text-neutral-400">
                  Letras, números, ponto, hífen e underline. Código curto é adivinhável — prefira códigos longos
                  e use o limite de usos para conter um vazamento.
                </p>
              </div>

              <div>
                <label className={labelClass} htmlFor="cupom-descricao">
                  Descrição (opcional)
                </label>
                <input
                  id="cupom-descricao"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Parceria com a escola X"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="cupom-limite">
                    Limite de usos
                  </label>
                  <input
                    id="cupom-limite"
                    type="number"
                    min={1}
                    value={draft.maxUses}
                    onChange={(event) => setDraft({ ...draft, maxUses: event.target.value })}
                    placeholder="ilimitado"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="cupom-validade">
                    Válido até
                  </label>
                  <input
                    id="cupom-validade"
                    type="date"
                    value={draft.validUntil}
                    onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Cupom ativo
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCoupon}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function UsesList({ uses }: { uses: CouponUse[] }) {
  if (uses.length === 0) {
    return <p className="text-xs text-neutral-400">Ninguém usou este cupom ainda.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {uses.map((use) => (
        <li key={use.inscricaoId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{use.nome ?? "(sem nome)"}</p>
            <p className="truncate text-xs text-neutral-400">
              {[use.telefone, use.email].filter(Boolean).join(" · ") || "sem contato registrado"}
            </p>
          </div>
          <span className="text-xs text-neutral-500">{formatDateTime(use.usadoEm)}</span>
        </li>
      ))}
    </ul>
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
