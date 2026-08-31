"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Download, History, Info, Instagram, Phone, Users } from "lucide-react";

/**
 * Painel de movimentação de leads de um vendedor, dentro do card.
 *
 * É SÓ LEITURA. Diferente da produção de rotina, aqui não se lança nada: o dado
 * vem do histórico do CRM (dashboard.commercial_events), que é a fonte da
 * verdade. Digitar número à mão aqui criaria uma segunda versão dos fatos.
 *
 * O filtro de data consulta de verdade — cada troca de dia refaz a consulta na
 * janela daquele dia, no fuso de São Paulo. Não é recorte de uma lista já
 * carregada.
 */

interface MovementRow {
  eventId: number;
  date: string;
  time: string;
  leadId: number;
  leadName: string | null;
  fromStage: string | null;
  toStage: string | null;
  ownerName: string | null;
  actorName: string | null;
  byOther: boolean;
}

interface Transition {
  fromStage: string;
  toStage: string;
  count: number;
}

interface ActionRow {
  eventId: number;
  date: string;
  time: string;
  leadId: number;
  leadName: string | null;
  kind: string;
  action: string;
  ownerName: string | null;
  actorName: string | null;
  byOther: boolean;
}

interface Actions {
  total: number;
  byAction: Array<{ kind: string; action: string; count: number }>;
  byKind: Array<{ kind: string; count: number }>;
  rows: ActionRow[];
}

const KIND_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  anotacao: "Anotação",
};

interface Report {
  sellerName: string | null;
  from: string;
  to: string;
  received: number;
  moved: number;
  movements: number;
  stalled: number;
  transitions: Transition[];
  rows: MovementRow[];
  actions: Actions;
}

interface OutreachDay {
  date: string;
  reached: number;
  replied: number;
  confirmed: number;
  note: string | null;
  createdByName: string | null;
}

interface Outreach {
  reached: number;
  replied: number;
  confirmed: number;
  days: OutreachDay[];
}

interface Props {
  taskId: number;
}

/**
 * Os três números da prospecção no Instagram. Rótulo curto no campo e a
 * explicação embaixo — nome longo em campo de formulário quebra o alinhamento e
 * ninguém lê duas vezes.
 */
const CAMPOS_INSTAGRAM = [
  { chave: "reached", label: "Abordados", ajuda: "Pessoas que você chamou no direct" },
  { chave: "replied", label: "Responderam", ajuda: "Quantas responderam" },
  { chave: "confirmed", label: "Confirmados", ajuda: "Confirmaram presença na Aula Exclusiva" },
] as const;

type ChaveInstagram = (typeof CAMPOS_INSTAGRAM)[number]["chave"];

/** Hoje no fuso da operação — o mesmo critério do resto da agenda. */
function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Soma dias a uma data ISO sem passar por Date local (que mudaria o fuso). */
function somarDias(iso: string, dias: number): string {
  const base = new Date(`${iso}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

export function LeadMovementSection({ taskId }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [instagram, setInstagram] = useState<Outreach | null>(null);
  /** A opção existe neste card? Quem decide é o master. */
  const [instagramAtivo, setInstagramAtivo] = useState(false);
  const [podeGerenciarInstagram, setPodeGerenciarInstagram] = useState(false);
  const [valores, setValores] = useState<Record<ChaveInstagram, string>>({
    reached: "",
    replied: "",
    confirmed: "",
  });
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [diasComMovimento, setDiasComMovimento] = useState<string[]>([]);
  /** Vem da API junto com os dados, para não propagar permissão por props. */
  const [canExportAll, setCanExportAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<"vendedor" | "todos" | null>(null);

  const [de, setDe] = useState(hojeSaoPaulo);
  /** Intervalo: por padrão um dia só, que é como o card é lido no dia a dia. */
  const [ate, setAte] = useState(hojeSaoPaulo);

  const hoje = useMemo(hojeSaoPaulo, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/commercial/movimentacao?taskId=${taskId}&from=${de}&to=${ate}`
      );
      const payload = (await response.json().catch(() => ({}))) as {
        report?: Report;
        instagram?: Outreach | null;
        instagramEnabled?: boolean;
        canManageInstagram?: boolean;
        canExportAll?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar a movimentação.");
      setReport(payload.report ?? null);
      setInstagram(payload.instagram ?? null);
      setInstagramAtivo(Boolean(payload.instagramEnabled));
      setPodeGerenciarInstagram(Boolean(payload.canManageInstagram));
      setCanExportAll(Boolean(payload.canExportAll));
      // O formulário nasce com o que já foi lançado naquele dia: relançar é
      // corrigir o dia, não somar um segundo registro.
      const doDia = payload.instagram?.days.find((dia) => dia.date === de) ?? null;
      setValores({
        reached: doDia ? String(doDia.reached) : "",
        replied: doDia ? String(doDia.replied) : "",
        confirmed: doDia ? String(doDia.confirmed) : "",
      });
      setNota(doDia?.note ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a movimentação.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, de, ate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Dias com movimentação no mês do início, para o seletor não navegar às cegas.
  useEffect(() => {
    const mes = de.slice(0, 7);
    let cancelado = false;
    void (async () => {
      try {
        const response = await fetch(`/api/commercial/movimentacao?taskId=${taskId}&month=${mes}`);
        const payload = (await response.json().catch(() => ({}))) as { days?: string[] };
        if (!cancelado) setDiasComMovimento(payload.days ?? []);
      } catch {
        if (!cancelado) setDiasComMovimento([]);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [taskId, de]);

  const irPara = useCallback((dia: string) => {
    setDe(dia);
    setAte(dia);
  }, []);

  const exportar = useCallback(
    async (modo: "vendedor" | "todos") => {
      setBaixando(modo);
      try {
        const url =
          `/api/commercial/movimentacao/export?taskId=${taskId}&from=${de}&to=${ate}` +
          (modo === "todos" ? "&todos=1" : "");
        const response = await fetch(url);
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Falha ao gerar o PDF.");
        }
        // O nome do arquivo vem do Content-Disposition do servidor, que já sabe
        // de quem é o relatório e de que período.
        const blob = await response.blob();
        const nome =
          response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
          "movimentacao.pdf";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = nome;
        link.click();
        URL.revokeObjectURL(link.href);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao gerar o PDF.");
      } finally {
        setBaixando(null);
      }
    },
    [taskId, de, ate]
  );

  const salvarInstagram = useCallback(
    async (remover = false) => {
      setSalvando(true);
      try {
        const response = await fetch("/api/commercial/movimentacao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            date: de,
            remover,
            reached: Number(valores.reached || 0),
            replied: Number(valores.replied || 0),
            confirmed: Number(valores.confirmed || 0),
            note: nota,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao salvar o lançamento.");
        setError(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao salvar o lançamento.");
      } finally {
        setSalvando(false);
      }
    },
    [taskId, de, valores, nota, load]
  );

  // Quem responde hoje pode ter sido chamado ontem, então isto é aviso, não
  // impedimento — barrar transformaria um dia legítimo em erro.
  useEffect(() => {
    const abordados = Number(valores.reached || 0);
    const responderam = Number(valores.replied || 0);
    const confirmados = Number(valores.confirmed || 0);
    if (responderam > abordados && abordados > 0) {
      setAviso("Responderam é maior que abordados — normal se a resposta veio de uma abordagem de outro dia.");
    } else if (confirmados > responderam && responderam > 0) {
      setAviso("Confirmados é maior que responderam. Confira antes de salvar.");
    } else {
      setAviso(null);
    }
  }, [valores]);

  const alternarInstagram = useCallback(
    async (ligar: boolean) => {
      if (
        !ligar &&
        !window.confirm(
          "Remover a opção Leads Instagram deste card? Os lançamentos já feitos são preservados e voltam se você religar."
        )
      ) {
        return;
      }
      setSalvando(true);
      try {
        const response = await fetch("/api/commercial/movimentacao", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, instagram: ligar }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao alterar a opção.");
        setError(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao alterar a opção.");
      } finally {
        setSalvando(false);
      }
    },
    [taskId, load]
  );

  const umDiaSo = de === ate;
  const temMovimento = diasComMovimento.includes(de);
  const baseDoGrafico = report?.received ?? 0;
  const percentualParados =
    report && baseDoGrafico > 0 ? Math.round((report.stalled / baseDoGrafico) * 100) : 0;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-bold text-neutral-900">Movimentação de leads</h3>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
          Histórico
        </span>
        {report?.sellerName && (
          <span className="text-[11px] text-neutral-500">{report.sellerName}</span>
        )}
      </header>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="grid gap-3 rounded-xl border border-neutral-200 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
            Data
            <input
              type="date"
              value={de}
              max={hoje}
              onChange={(event) => irPara(event.target.value)}
              className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
            Até
            <input
              type="date"
              value={ate}
              min={de}
              max={hoje}
              onChange={(event) => setAte(event.target.value)}
              className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-emerald-400 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => irPara(somarDias(de, -1))}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            ‹ Dia anterior
          </button>
          <button
            type="button"
            onClick={() => irPara(hoje)}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => irPara(somarDias(hoje, -1))}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Ontem
          </button>
          <button
            type="button"
            onClick={() => irPara(somarDias(de, 1))}
            disabled={de >= hoje}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          >
            Dia seguinte ›
          </button>
          <button
            type="button"
            onClick={() => {
              setDe(somarDias(hoje, -6));
              setAte(hoje);
            }}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            7 dias
          </button>
        </div>

        {umDiaSo && !temMovimento && diasComMovimento.length > 0 && (
          <p className="text-[11px] text-neutral-500">
            Dias com movimentação em {de.slice(5, 7)}/{de.slice(0, 4)}:{" "}
            {diasComMovimento.map((dia) => (
              <button
                key={dia}
                type="button"
                onClick={() => irPara(dia)}
                className="mr-1 font-semibold text-emerald-700 underline-offset-2 hover:underline"
              >
                {dia.slice(8, 10)}
              </button>
            ))}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-2">
          <button
            type="button"
            onClick={() => void exportar("vendedor")}
            disabled={baixando !== null || loading}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {baixando === "vendedor" ? "Gerando…" : "Exportar PDF deste vendedor"}
          </button>
          {canExportAll && (
            <button
              type="button"
              onClick={() => void exportar("todos")}
              disabled={baixando !== null || loading}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              <Users className="h-3.5 w-3.5" />
              {baixando === "todos" ? "Gerando…" : "Exportar PDF geral"}
            </button>
          )}
        </div>
      </div>

      {report && report.actions.total > 0 && (
        <div className="grid gap-2 rounded-xl border border-neutral-200 p-3">
          <header className="flex flex-wrap items-center gap-2">
            <Phone className="h-4 w-4 text-sky-600" />
            <h4 className="text-xs font-bold text-neutral-900">Ações no lead</h4>
            <span className="text-[10px] text-neutral-500">
              {report.actions.total} registro(s) · não alteram as mudanças de etapa
            </span>
          </header>

          {/* Agrupado pelo que foi REGISTRADO: "Ligação feita" e "Ligação não
              atendida" são o mesmo tipo e só a descrição as separa. */}
          <div className="grid gap-1">
            {report.actions.byAction.map((item) => (
              <p
                key={`${item.kind}-${item.action}`}
                className="flex items-center gap-1.5 text-xs text-neutral-700"
              >
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-600">
                  {KIND_LABELS[item.kind] ?? "Outro"}
                </span>
                <span className="min-w-0 truncate">{item.action}</span>
                <span className="ml-auto font-bold tabular-nums">{item.count}</span>
              </p>
            ))}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-[11px] font-semibold text-neutral-600">
              Ver os {report.actions.rows.length} registro(s) em detalhe
            </summary>
            <ul className="mt-1 grid gap-1">
              {report.actions.rows.map((row) => (
                <li
                  key={row.eventId}
                  className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-neutral-100 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                    {umDiaSo ? row.time : `${formatarData(row.date)} ${row.time}`}
                  </span>
                  <span className="font-semibold text-neutral-800">
                    {row.leadName ?? `Lead #${row.leadId}`}
                  </span>
                  <span className="text-neutral-600">{row.action}</span>
                  <span className="ml-auto text-[10px] text-neutral-500">
                    por {row.actorName ?? "—"}
                  </span>
                  {row.byOther && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      outra pessoa
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Só o master vê este convite — é ele quem define quem trabalha o direct. */}
      {!instagramAtivo && podeGerenciarInstagram && (
        <button
          type="button"
          onClick={() => void alternarInstagram(true)}
          disabled={salvando}
          className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-fuchsia-300 px-3 py-1.5 text-[11px] font-semibold text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-50"
        >
          <Instagram className="h-3.5 w-3.5" />
          Adicionar Leads Instagram a este vendedor
        </button>
      )}

      {/* Prospecção no Instagram: o único bloco em que o painel ESCREVE. Fica
          aqui, ao lado dos números do CRM, porque enquanto morava numa rotina
          solta em /tarefas ninguém preenchia — dia em branco tem que ser
          visível junto com o resto do dia. */}
      {instagramAtivo && (
      <section className="grid gap-2.5 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3">
        <header className="flex flex-wrap items-center gap-2">
          <Instagram className="h-4 w-4 text-fuchsia-600" />
          <h4 className="text-xs font-bold text-neutral-900">Leads Instagram</h4>
          <span className="text-[10px] text-neutral-500">
            {umDiaSo ? formatarData(de) : `${formatarData(de)} a ${formatarData(ate)}`}
          </span>
          {podeGerenciarInstagram && (
            <button
              type="button"
              onClick={() => void alternarInstagram(false)}
              disabled={salvando}
              className="ml-auto rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              Remover opção
            </button>
          )}
        </header>

        <div className="grid grid-cols-3 gap-2">
          {CAMPOS_INSTAGRAM.map((campo) => (
            <div key={campo.chave} className="rounded-lg border border-fuchsia-200 bg-white px-2.5 py-1.5">
              <p className="text-lg font-black tabular-nums text-neutral-900">
                {instagram ? instagram[campo.chave] : 0}
              </p>
              <p className="text-[10px] font-semibold uppercase text-neutral-500">{campo.label}</p>
            </div>
          ))}
        </div>

        {umDiaSo ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {CAMPOS_INSTAGRAM.map((campo) => (
                <label key={campo.chave} className="grid gap-0.5 text-[10px] text-neutral-500">
                  <span className="font-semibold text-neutral-700">{campo.label}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={valores[campo.chave]}
                    onChange={(event) =>
                      setValores((atual) => ({ ...atual, [campo.chave]: event.target.value }))
                    }
                    className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-fuchsia-400 focus:outline-none"
                  />
                  <span className="leading-tight">{campo.ajuda}</span>
                </label>
              ))}
            </div>

            <input
              type="text"
              value={nota}
              maxLength={500}
              placeholder="Observação do dia (opcional)"
              onChange={(event) => setNota(event.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-fuchsia-400 focus:outline-none"
            />

            {aviso && <p className="text-[10px] font-semibold text-amber-700">{aviso}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void salvarInstagram(false)}
                disabled={salvando || loading}
                className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-fuchsia-700 disabled:opacity-50"
              >
                {salvando ? "Salvando…" : "Salvar o dia"}
              </button>
              {instagram?.days.some((dia) => dia.date === de) && (
                <button
                  type="button"
                  onClick={() => void salvarInstagram(true)}
                  disabled={salvando || loading}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Apagar lançamento
                </button>
              )}
              {/* Relançar edita o dia em vez de criar um segundo registro — quem
                  lança de novo precisa saber disso antes de somar na cabeça. */}
              <span className="text-[10px] text-neutral-500">
                Salvar de novo substitui o lançamento deste dia.
              </span>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-neutral-500">
            Os totais acima somam o período. Para lançar, escolha um dia só.
          </p>
        )}
      </section>
      )}

      <p className="text-[10px] text-neutral-400">
        Não inclui o funil de Triagem (lista fria) — ela tem ritmo próprio e é
        acompanhada na aba Triagem do Kanban.
      </p>

      {loading ? (
        <p className="text-xs text-neutral-500">Carregando…</p>
      ) : report ? (
        <>
          <div className="grid gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-950">
            <div className="flex items-center gap-1.5 font-bold">
              <Info className="h-4 w-4 text-sky-700" />
              Como interpretar este relatório
            </div>
            <div className="grid gap-1.5 text-[11px] leading-relaxed text-sky-900 sm:grid-cols-2">
              <p>
                <strong>Parados no período:</strong> leads atribuídos ao vendedor dentro da janela,
                sem nenhum evento depois da atribuição até o fim do período.
              </p>
              <p>
                <strong>Movimentados:</strong> quantidade de leads diferentes que o vendedor moveu de etapa.
                <strong> Movimentações:</strong> total de mudanças de etapa; o mesmo lead pode contar várias vezes.
              </p>
              <p>
                <strong>Recebidos</strong> é a base deste indicador: leads atribuídos ao vendedor durante o período.
                Leads antigos não entram em “Parados no período”.
              </p>
              <p>
                <strong>{percentualParados}% parados</strong> = {report.stalled} de {baseDoGrafico} recebidos:
                {" "}parados ÷ recebidos. A Triagem não entra nessa análise.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Recebidos", helper: "atribuídos no período", value: report.received },
              { label: "Movimentados", helper: "leads diferentes", value: report.moved },
              { label: "Parados", helper: "recebidos sem atividade", value: report.stalled },
              { label: "Movimentações", helper: "mudanças de etapa", value: report.movements },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-neutral-200 px-3 py-2">
                <p className="text-lg font-black tabular-nums text-neutral-900">{item.value}</p>
                <p className="text-[10px] font-semibold uppercase text-neutral-500">{item.label}</p>
                <p className="mt-0.5 text-[10px] text-neutral-400">{item.helper}</p>
              </div>
            ))}
          </div>

          {report.transitions.length > 0 && (
            <div className="grid gap-1 rounded-xl border border-neutral-200 p-3">
              <p className="text-[11px] font-bold uppercase text-neutral-500">
                Mudanças de etapa por transição
              </p>
              {report.transitions.map((item) => (
                <p
                  key={`${item.fromStage}-${item.toStage}`}
                  className="flex items-center gap-1.5 text-xs text-neutral-700"
                >
                  <span>{item.fromStage}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-neutral-400" />
                  <span>{item.toStage}</span>
                  <span className="ml-auto font-bold tabular-nums">{item.count}</span>
                </p>
              ))}
            </div>
          )}

          <div className="grid gap-1">
            <p className="text-[11px] font-bold uppercase text-neutral-500">Mudanças de etapa registradas</p>
            {report.rows.length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                Nenhuma movimentação registrada
                {umDiaSo ? ` em ${formatarData(de)}` : ` de ${formatarData(de)} a ${formatarData(ate)}`}.
              </p>
            ) : (
              <ul className="grid gap-1">
                {report.rows.map((row) => (
                  <li
                    key={row.eventId}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-neutral-100 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                      {umDiaSo ? row.time : `${formatarData(row.date)} ${row.time}`}
                    </span>
                    <span className="font-semibold text-neutral-800">
                      {row.leadName ?? `Lead #${row.leadId}`}
                    </span>
                    <span className="text-neutral-600">
                      {row.fromStage ?? "—"} → {row.toStage ?? "—"}
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-500">
                      resp. {row.ownerName ?? "sem responsável"} · por {row.actorName ?? "—"}
                    </span>
                    {/* Supervisor mexendo em lead alheio não some no meio dos
                        números — some do relatório é como nasce "eu não fiz isso". */}
                    {row.byOther && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        movido por outra pessoa
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
