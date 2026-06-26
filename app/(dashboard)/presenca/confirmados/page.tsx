import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  Printer,
  UserCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { formatTrainingTagLabel } from "@/lib/participantTags";
import { listPresenceRecords, type PresenceRecord } from "@/lib/presenceRecords";
import { humanizeName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Presenças Confirmadas",
  description: "Lista de participantes com presenca validada por treinamento.",
};

interface PageProps {
  searchParams: Promise<{ treinamento?: string }>;
}

function formatMinutes(minutes: number | null | undefined): string {
  const safeMinutes = minutes ?? 0;
  if (safeMinutes < 60) {
    return `${safeMinutes}min`;
  }
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatus(record: PresenceRecord): {
  label: string;
  icon: LucideIcon;
  className: string;
} {
  if (record.aprovado) {
    return { label: "Aprovado", icon: CheckCircle, className: "bg-emerald-100 text-emerald-800" };
  }
  if (record.totalDias >= 2 && record.diaProcessado < record.totalDias) {
    return { label: "Parcial", icon: Clock, className: "bg-amber-100 text-amber-800" };
  }
  return { label: "Insuficiente", icon: XCircle, className: "bg-rose-100 text-rose-800" };
}

export default async function PresencasConfirmadasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const treinamentoId = params.treinamento?.trim() || null;
  const data = await listPresenceRecords({ treinamentoId, apenasAprovados: false });
  const title = treinamentoId ? formatTrainingTagLabel(treinamentoId) : "Todos os treinamentos";

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            href="/presenca"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-neutral-500 transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para validação
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças</h1>
          <p className="text-sm text-neutral-500">{title}</p>
        </div>
        {treinamentoId ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/presence/attendance-report/pdf?treinamento=${encodeURIComponent(treinamentoId)}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115e59]"
            >
              <Download className="h-4 w-4" />
              Baixar PDF
            </a>
            <a
              href={`/api/presence/attendance-report?treinamento=${encodeURIComponent(treinamentoId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              <Printer className="h-4 w-4" />
              Imprimir relatório
            </a>
            <Link
              href="/presenca/confirmados"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
            >
              Ver todos
            </Link>
          </div>
        ) : null}
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={Users} label="Validadas" value={data.total} tone="bg-cyan-50 text-cyan-700" />
        <Metric icon={CheckCircle} label="Aprovadas" value={data.totalAprovados} tone="bg-emerald-50 text-emerald-700" />
        <Metric icon={Clock} label="Parciais" value={data.totalParciais} tone="bg-amber-50 text-amber-700" />
        <Metric icon={XCircle} label="Insuficientes" value={data.totalReprovados} tone="bg-rose-50 text-rose-700" />
        <Metric icon={AlertTriangle} label="Pendentes" value={data.totalPending} tone="bg-violet-50 text-violet-700" />
      </section>

      {data.pending.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Presenças pendentes de associação
          </h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.pending.slice(0, 12).map((pending) => (
              <div key={pending.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm">
                <p className="font-semibold text-neutral-900">{humanizeName(pending.participanteNome)}</p>
                <p className="text-xs text-neutral-500">
                  {pending.status === "doubt" ? "Dúvida entre inscrições" : "Não encontrada"} · {formatMinutes(pending.tempoTotalMinutos)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <UserCheck className="h-5 w-5 text-cyan-600" />
            Participantes com presença
          </h2>
          <span className="text-xs font-medium text-neutral-500">{data.total} registro{data.total === 1 ? "" : "s"}</span>
        </div>

        {data.presences.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-500">
            Nenhuma presença validada encontrada para este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Participante</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 md:table-cell">Treinamento</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Status</th>
                  <th className="hidden px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:table-cell">Tempo</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 xl:table-cell">Indicador</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Validado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.presences.map((record) => {
                  const status = getStatus(record);
                  const StatusIcon = status.icon;

                  return (
                    <tr key={record.inscricaoId} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-900">{humanizeName(record.nome)}</p>
                        <p className="text-xs text-neutral-500">
                          Zoom: {record.participanteNomeZoom ? humanizeName(record.participanteNomeZoom) : "-"}
                        </p>
                        {record.telefone ? <p className="text-xs text-neutral-400">{record.telefone}</p> : null}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-neutral-700 md:table-cell">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                          <Calendar className="h-3 w-3" />
                          {formatTrainingTagLabel(record.treinamentoId)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>
                          <StatusIcon className="h-3.5 w-3.5" />
                          {status.label}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-center text-sm text-neutral-700 lg:table-cell">
                        <div className="flex flex-col items-center">
                          <span className="font-semibold">{formatMinutes(record.tempoTotalMinutos)}</span>
                          {record.tempoDinamicaMinutos > 0 ? (
                            <span className="text-xs text-cyan-700">Dinâmica {formatMinutes(record.tempoDinamicaMinutos)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-neutral-700 xl:table-cell">
                        {record.recrutadorNome ? humanizeName(record.recrutadorNome) : "Sem indicador"}
                        {record.recrutadorCodigo ? (
                          <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                            {record.recrutadorCodigo}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-neutral-500">{formatDateTime(record.validadoEm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-medium text-neutral-500">{label}</p>
        <p className="text-2xl font-bold text-neutral-900">{value.toLocaleString("pt-BR")}</p>
      </div>
    </div>
  );
}
