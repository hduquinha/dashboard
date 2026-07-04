import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { listAbsentInscricoes, type AbsentInscricao } from "@/lib/db";
import { formatTrainingTagLabel } from "@/lib/participantTags";
import {
  listPresenceRecords,
  type PendingPresenceRecord,
  type PresenceRecord,
} from "@/lib/presenceRecords";
import { humanizeName } from "@/lib/utils";

interface IndicatorGroup {
  key: string;
  label: string;
  code: string | null;
  records: PresenceRecord[];
}

function escapeHtml(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function displayName(value: string | null | undefined): string {
  return escapeHtml(humanizeName(value) || value || "-");
}

function formatMinutes(minutes: number | null | undefined): string {
  const safeMinutes = minutes ?? 0;
  if (safeMinutes < 60) {
    return `${safeMinutes}min`;
  }

  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
}

function presenceBadge(aprovado: boolean): string {
  return aprovado
    ? '<span class="badge badge-approved">Aprovada</span>'
    : '<span class="badge badge-insufficient">Insuficiente</span>';
}

function formatWhatsAppUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) {
    return null;
  }

  const phoneWithCountryCode = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phoneWithCountryCode}`;
}

function contactCell(phone: string | null | undefined): string {
  if (!phone) {
    return "-";
  }

  const whatsappUrl = formatWhatsAppUrl(phone);
  const whatsappLink = whatsappUrl
    ? `<a class="whatsapp" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
    : "";

  return `<span class="phone">${escapeHtml(phone)}</span>${whatsappLink}`;
}

function indicatorKey(record: PresenceRecord): string {
  const code = record.recrutadorCodigo?.trim();
  const name = record.recrutadorNome?.trim();

  if (code) {
    return `code:${code.toLowerCase()}`;
  }

  if (name) {
    return `name:${name.toLowerCase()}`;
  }

  return "none";
}

function indicatorLabel(record: PresenceRecord): string {
  const name = humanizeName(record.recrutadorNome);
  if (name) {
    return name;
  }

  return record.recrutadorCodigo?.trim() ? `Indicador ${record.recrutadorCodigo.trim()}` : "Sem indicador";
}

function buildIndicatorGroups(records: PresenceRecord[]): IndicatorGroup[] {
  const groups = new Map<string, IndicatorGroup>();

  records.forEach((record) => {
    const key = indicatorKey(record);
    const current = groups.get(key);
    if (current) {
      current.records.push(record);
      return;
    }

    groups.set(key, {
      key,
      label: indicatorLabel(record),
      code: record.recrutadorCodigo?.trim() || null,
      records: [record],
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      records: group.records.sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR")),
    }))
    .sort((left, right) => right.records.length - left.records.length || left.label.localeCompare(right.label, "pt-BR"));
}

function codeBadge(code: string | null): string {
  return code ? `<span class="code">#${escapeHtml(code)}</span>` : "";
}

function percentage(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function buildTopIndicatorChart(groups: IndicatorGroup[]): string {
  const top = groups.slice(0, 5);
  if (top.length === 0) {
    return '<p class="empty chart-empty">Sem presencas aprovadas para montar o ranking.</p>';
  }

  const leaderTotal = top[0]?.records.length ?? 1;

  return top
    .map((group, index) => {
      const share = Math.max(percentage(group.records.length, leaderTotal), 8);

      return `
        <div class="rank-row">
          <span class="rank-position">${index + 1}</span>
          <div class="rank-label">
            <strong>${displayName(group.label)}</strong>
            ${codeBadge(group.code)}
            <div class="bar"><span style="width: ${share}%"></span></div>
          </div>
          <strong class="rank-total">${group.records.length}</strong>
        </div>`;
    })
    .join("");
}

function buildApprovedRows(records: PresenceRecord[]): string {
  return records
    .map(
      (record, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${displayName(record.nome)}</td>
          <td>${contactCell(record.telefone)}</td>
          <td>${displayName(record.participanteNomeZoom)}</td>
          <td class="text-center">${formatMinutes(record.tempoTotalMinutos)}</td>
        </tr>`
    )
    .join("");
}

function buildApprovedGroups(groups: IndicatorGroup[]): string {
  if (groups.length === 0) {
    return '<p class="empty">Nenhuma presenca aprovada associada.</p>';
  }

  return groups
    .map(
      (group) => `
        <section class="indicator-group">
          <header class="indicator-heading">
            <div>
              <p class="eyebrow">Indicador</p>
              <h3>${displayName(group.label)} ${codeBadge(group.code)}</h3>
            </div>
            <strong>${group.records.length} aprovado${group.records.length === 1 ? "" : "s"}</strong>
          </header>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Inscrito</th>
                <th>Contato</th>
                <th>Nome no Zoom</th>
                <th class="text-center">Tempo</th>
              </tr>
            </thead>
            <tbody>${buildApprovedRows(group.records)}</tbody>
          </table>
        </section>`
    )
    .join("");
}

function buildNotApprovedRows(records: PresenceRecord[]): string {
  return records
    .map(
      (record, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${displayName(record.nome)}</td>
          <td>${contactCell(record.telefone)}</td>
          <td>${displayName(record.participanteNomeZoom)}</td>
          <td class="text-center">${formatMinutes(record.tempoTotalMinutos)}</td>
          <td class="text-center">${record.percentualDinamica ? `${record.percentualDinamica}%` : "—"}</td>
        </tr>`
    )
    .join("");
}

function buildNotApprovedGroups(groups: IndicatorGroup[]): string {
  if (groups.length === 0) {
    return '<p class="empty">Nenhuma presenca nao aprovada registrada.</p>';
  }

  return groups
    .map(
      (group) => `
        <section class="indicator-group">
          <header class="indicator-heading not-approved-heading">
            <div>
              <p class="eyebrow eyebrow-amber">Indicador</p>
              <h3>${displayName(group.label)} ${codeBadge(group.code)}</h3>
            </div>
            <strong class="amber-count">${group.records.length} nao aprovado${group.records.length === 1 ? "" : "s"}</strong>
          </header>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Inscrito</th>
                <th>Contato</th>
                <th>Nome no Zoom</th>
                <th class="text-center">Tempo</th>
                <th class="text-center">% Dinamica</th>
              </tr>
            </thead>
            <tbody>${buildNotApprovedRows(group.records)}</tbody>
          </table>
        </section>`
    )
    .join("");
}

interface IndicatorComparison {
  label: string;
  code: string | null;
  approved: number;
  notApproved: number;
}

function buildApprovalComparisonChart(
  approvedGroups: IndicatorGroup[],
  notApprovedGroups: IndicatorGroup[]
): string {
  const allMap = new Map<string, IndicatorComparison>();

  for (const g of approvedGroups) {
    allMap.set(g.key, { label: g.label, code: g.code, approved: g.records.length, notApproved: 0 });
  }

  for (const g of notApprovedGroups) {
    const existing = allMap.get(g.key);
    if (existing) {
      existing.notApproved = g.records.length;
    } else {
      allMap.set(g.key, { label: g.label, code: g.code, approved: 0, notApproved: g.records.length });
    }
  }

  const sorted = Array.from(allMap.values())
    .sort((a, b) => b.approved + b.notApproved - (a.approved + a.notApproved))
    .slice(0, 8);

  if (sorted.length === 0) {
    return '<p class="empty chart-empty">Sem dados para comparativo.</p>';
  }

  const maxTotal = Math.max(...sorted.map((i) => i.approved + i.notApproved));

  return sorted
    .map((indicator) => {
      const approvedPct = maxTotal > 0 ? Math.max(percentage(indicator.approved, maxTotal), indicator.approved > 0 ? 2 : 0) : 0;
      const notApprovedPct = maxTotal > 0 ? Math.max(percentage(indicator.notApproved, maxTotal), indicator.notApproved > 0 ? 2 : 0) : 0;
      return `
        <div class="cmp-row">
          <span class="cmp-label">${escapeHtml(indicator.label)}${indicator.code ? ` ${codeBadge(indicator.code)}` : ""}</span>
          <div class="cmp-bar">
            ${indicator.approved > 0 ? `<span class="cmp-ok" style="width:${approvedPct}%"></span>` : ""}
            ${indicator.notApproved > 0 ? `<span class="cmp-fail" style="width:${notApprovedPct}%"></span>` : ""}
          </div>
          <span class="cmp-counts"><span class="cmp-ok-text">${indicator.approved}✓</span>&nbsp;<span class="cmp-fail-text">${indicator.notApproved}✗</span></span>
        </div>`;
    })
    .join("");
}

function candidateLabel(
  pending: PendingPresenceRecord,
  candidate: 1 | 2
): { id: number | null; name: string | null; phone: string | null } {
  return candidate === 1
    ? {
        id: pending.inscricaoId1,
        name: pending.inscricaoNome1,
        phone: pending.inscricaoTelefone1,
      }
    : {
        id: pending.inscricaoId2,
        name: pending.inscricaoNome2,
        phone: pending.inscricaoTelefone2,
      };
}

function buildDoubtRows(records: PendingPresenceRecord[]): string {
  if (records.length === 0) {
    return '<tr><td colspan="6" class="empty">Nenhuma presença em dúvida.</td></tr>';
  }

  return records
    .map((pending, index) => {
      const candidates = [candidateLabel(pending, 1), candidateLabel(pending, 2)].filter(
        (candidate) => candidate.name || candidate.id || candidate.phone
      );
      const visibleCandidates =
        candidates.length > 0
          ? candidates
          : [{ id: null, name: "Sem candidata sugerida", phone: null }];

      return visibleCandidates
        .map((candidate, candidateIndex) => {
          const rowNumber = candidateIndex === 0 ? `<td rowspan="${visibleCandidates.length}">${index + 1}</td>` : "";
          const zoomName =
            candidateIndex === 0
              ? `<td rowspan="${visibleCandidates.length}">${displayName(pending.participanteNome)}</td>`
              : "";
          const zoomTime =
            candidateIndex === 0
              ? `<td rowspan="${visibleCandidates.length}" class="text-center">${formatMinutes(pending.tempoTotalMinutos)}</td>`
              : "";
          const zoomStatus =
            candidateIndex === 0
              ? `<td rowspan="${visibleCandidates.length}" class="text-center">${presenceBadge(pending.aprovado)}</td>`
              : "";
          const idLabel = candidate.id ? ` <span class="muted">#${candidate.id}</span>` : "";

          return `
            <tr>
              ${rowNumber}
              ${zoomName}
              ${zoomTime}
              ${zoomStatus}
              <td>Candidata ${candidateIndex + 1}: ${displayName(candidate.name)}${idLabel}</td>
              <td>${contactCell(candidate.phone)}</td>
            </tr>`;
        })
        .join("");
    })
    .join("");
}

function buildNotFoundRows(records: PendingPresenceRecord[]): string {
  if (records.length === 0) {
    return '<tr><td colspan="4" class="empty">Nenhum participante sem inscrição encontrada.</td></tr>';
  }

  return records
    .map(
      (pending, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${displayName(pending.participanteNome)}</td>
          <td class="text-center">${formatMinutes(pending.tempoTotalMinutos)}</td>
          <td class="text-center">${presenceBadge(pending.aprovado)}</td>
        </tr>`
    )
    .join("");
}

interface AbsentGroup {
  key: string;
  label: string;
  code: string | null;
  records: AbsentInscricao[];
}

function buildAbsentIndicatorGroups(records: AbsentInscricao[]): AbsentGroup[] {
  const map = new Map<string, AbsentGroup>();
  for (const r of records) {
    const key = r.recrutadorCodigo ?? "__sem_indicador__";
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: r.recrutadorNome ?? r.recrutadorCodigo ?? "Sem indicador",
        code: r.recrutadorCodigo,
        records: [],
      });
    }
    map.get(key)!.records.push(r);
  }
  return Array.from(map.values()).sort((a, b) => b.records.length - a.records.length);
}

function buildAbsentGroups(groups: AbsentGroup[]): string {
  if (groups.length === 0) {
    return '<p class="empty">Nenhum inscrito ausente.</p>';
  }
  return groups
    .map(
      (group) => `
      <div class="indicator-group">
        <div class="indicator-heading not-approved-heading">
          ${group.code ? `<span class="code">${escapeHtml(group.code)}</span>` : ""}
          <strong style="color:#b45309">${escapeHtml(group.label)}</strong>
          <span class="amber-count">${group.records.length}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Inscrito</th>
              <th>Contato</th>
            </tr>
          </thead>
          <tbody>
            ${group.records
              .map(
                (r, i) => `<tr>
              <td>${i + 1}</td>
              <td>${displayName(r.nome)}</td>
              <td>${contactCell(r.telefone)}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    )
    .join("");
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });

    const treinamentoId = request.nextUrl.searchParams.get("treinamento")?.trim();
    if (!treinamentoId) {
      return NextResponse.json({ error: "Treinamento nao informado." }, { status: 400 });
    }

    const [data, absentInscricoes] = await Promise.all([
      listPresenceRecords({ treinamentoId, apenasAprovados: false }),
      listAbsentInscricoes(treinamentoId),
    ]);
    const absentGroups = buildAbsentIndicatorGroups(absentInscricoes);
    const approved = data.presences
      .filter((record) => record.aprovado)
      .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
    const indicatorGroups = buildIndicatorGroups(approved);
    const notApproved = data.presences
      .filter((record) => !record.aprovado)
      .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
    const notApprovedIndicatorGroups = buildIndicatorGroups(notApproved);
    const doubts = data.pending.filter((record) => record.status === "doubt");

    // Chart data
    const allIndicatorKeys: string[] = [];
    const seenIndicatorKeys = new Set<string>();
    for (const g of [...indicatorGroups, ...notApprovedIndicatorGroups]) {
      if (!seenIndicatorKeys.has(g.key)) {
        seenIndicatorKeys.add(g.key);
        allIndicatorKeys.push(g.key);
      }
    }
    const comparisonData = allIndicatorKeys
      .map((key) => {
        const ag = indicatorGroups.find((g) => g.key === key);
        const ng = notApprovedIndicatorGroups.find((g) => g.key === key);
        return {
          label: ag?.label ?? ng?.label ?? key,
          approved: ag?.records.length ?? 0,
          notApproved: ng?.records.length ?? 0,
        };
      })
      .sort((a, b) => b.approved + b.notApproved - (a.approved + a.notApproved))
      .slice(0, 12);

    const timeBuckets = [
      { label: "< 30min", count: data.presences.filter((p) => p.tempoTotalMinutos < 30).length },
      { label: "30–60min", count: data.presences.filter((p) => p.tempoTotalMinutos >= 30 && p.tempoTotalMinutos < 60).length },
      { label: "60–90min", count: data.presences.filter((p) => p.tempoTotalMinutos >= 60 && p.tempoTotalMinutos < 90).length },
      { label: "90–120min", count: data.presences.filter((p) => p.tempoTotalMinutos >= 90 && p.tempoTotalMinutos < 120).length },
      { label: "120–150min", count: data.presences.filter((p) => p.tempoTotalMinutos >= 120 && p.tempoTotalMinutos < 150).length },
      { label: "150+min", count: data.presences.filter((p) => p.tempoTotalMinutos >= 150).length },
    ];

    const totalLinked = approved.length + notApproved.length;
    const approvalRate = totalLinked > 0 ? Math.round((approved.length / totalLinked) * 100) : 0;

    const chartPayload = {
      donut: {
        labels: ["Aprovadas", "Nao aprovadas", "Em duvida", "Nao encontradas", "Ausentes"],
        values: [approved.length, notApproved.length, doubts.length, data.pending.filter((r) => r.status === "not-found").length, absentInscricoes.length],
        colors: ["#14b8a6", "#f59e0b", "#3b82f6", "#e11d48", "#94a3b8"],
      },
      comparison: {
        labels: comparisonData.map((d) => d.label),
        approved: comparisonData.map((d) => d.approved),
        notApproved: comparisonData.map((d) => d.notApproved),
      },
      time: {
        labels: timeBuckets.map((b) => b.label),
        values: timeBuckets.map((b) => b.count),
        colors: ["#e11d48", "#fb923c", "#f59e0b", "#14b8a6", "#0891b2", "#0f766e"],
      },
      dinamica: {
        labels: ["0–25%", "25–50%", "50–75%", "75–100%"],
        values: [
          data.presences.filter((p) => p.percentualDinamica < 25).length,
          data.presences.filter((p) => p.percentualDinamica >= 25 && p.percentualDinamica < 50).length,
          data.presences.filter((p) => p.percentualDinamica >= 50 && p.percentualDinamica < 75).length,
          data.presences.filter((p) => p.percentualDinamica >= 75).length,
        ],
      },
    };
    const notFound = data.pending.filter((record) => record.status === "not-found");
    const participantsTotal = data.total + data.pending.length;
    const approvedPending = data.pending.filter((record) => record.aprovado).length;
    const approvedPresenceTotal = approved.length + approvedPending;
    const associatedShare = percentage(data.total, participantsTotal);
    const doubtShare = percentage(doubts.length, participantsTotal);
    const notFoundShare = participantsTotal > 0 ? Math.max(100 - associatedShare - doubtShare, 0) : 0;
    const reportTitle = formatTrainingTagLabel(treinamentoId);
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatorio de presenca - ${escapeHtml(reportTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f8fafc;
      color: #172033;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 1.4;
    }
    .page { background: #fff; max-width: 1020px; margin: 0 auto; padding: 28px; }
    .hero {
      background: #0f172a;
      border-left: 9px solid #14b8a6;
      color: #fff;
      margin-bottom: 16px;
      padding: 22px 24px;
    }
    .hero-top { align-items: flex-start; display: flex; gap: 18px; justify-content: space-between; }
    .brand { align-items: center; display: flex; gap: 10px; }
    .logo { background: #fff; height: 42px; object-fit: contain; padding: 5px; width: 42px; }
    .brand strong { display: block; font-size: 12px; }
    .brand span { color: #99f6e4; display: block; font-size: 9px; text-transform: uppercase; }
    .hero-meta { color: #cbd5e1; margin-top: 13px; }
    h1 { font-size: 27px; line-height: 1.1; margin: 15px 0 5px; }
    h2 {
      border-bottom: 1px solid #cbd5e1;
      color: #0f172a;
      font-size: 16px;
      line-height: 1.2;
      margin: 23px 0 10px;
      padding-bottom: 6px;
    }
    h3 { color: #0f172a; font-size: 13px; line-height: 1.2; margin: 0; }
    p { margin: 0; }
    .muted { color: #64748b; }
    .eyebrow { color: #0f766e; font-size: 8px; font-weight: bold; text-transform: uppercase; }
    .summary {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      margin-bottom: 13px;
    }
    .metric { border: 1px solid #cbd5e1; min-height: 65px; padding: 8px 9px; }
    .metric span { color: #475569; display: block; font-size: 9px; font-weight: bold; text-transform: uppercase; }
    .metric strong { color: #0f172a; display: block; font-size: 23px; line-height: 1.1; margin-top: 3px; }
    .charts { display: grid; gap: 11px; grid-template-columns: 1.15fr .85fr; margin-bottom: 14px; }
    .chart-panel { border: 1px solid #cbd5e1; padding: 12px; }
    .chart-panel h3 { margin-bottom: 9px; }
    .rank-row { align-items: center; display: grid; gap: 8px; grid-template-columns: 22px minmax(0, 1fr) 30px; margin-top: 8px; }
    .rank-position {
      background: #0f766e;
      color: #fff;
      display: inline-flex;
      font-weight: bold;
      height: 22px;
      justify-content: center;
      line-height: 22px;
      width: 22px;
    }
    .rank-label strong { display: inline-block; margin-right: 4px; }
    .rank-total { color: #0f172a; font-size: 16px; text-align: right; }
    .bar { background: #e2e8f0; height: 8px; margin-top: 4px; width: 100%; }
    .bar span { background: linear-gradient(90deg, #14b8a6, #0891b2); display: block; height: 100%; }
    .status-rail { display: flex; height: 20px; margin: 10px 0 12px; overflow: hidden; }
    .status-associated { background: #14b8a6; width: ${associatedShare}%; }
    .status-doubt { background: #f59e0b; width: ${doubtShare}%; }
    .status-not-found { background: #e11d48; width: ${notFoundShare}%; }
    .legend { display: grid; gap: 7px; }
    .legend-row { align-items: center; display: grid; gap: 7px; grid-template-columns: 9px minmax(0, 1fr) auto; }
    .dot { display: block; height: 9px; width: 9px; }
    .dot-associated { background: #14b8a6; }
    .dot-doubt { background: #f59e0b; }
    .dot-not-found { background: #e11d48; }
    .code {
      background: #ecfeff;
      color: #155e75;
      display: inline-block;
      font-size: 9px;
      font-weight: bold;
      padding: 1px 5px;
      vertical-align: middle;
    }
    table { border-collapse: collapse; margin: 8px 0 14px; width: 100%; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #475569; font-size: 8px; text-transform: uppercase; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .indicator-group { margin-bottom: 14px; }
    .indicator-heading {
      align-items: end;
      border-left: 4px solid #0f766e;
      display: flex;
      justify-content: space-between;
      padding: 3px 0 3px 8px;
    }
    .indicator-heading > strong { color: #0f766e; font-size: 12px; }
    .text-center { text-align: center; }
    .badge { display: inline-block; font-size: 9px; font-weight: bold; padding: 2px 5px; }
    .badge-approved { background: #d1fae5; color: #065f46; }
    .badge-insufficient { background: #fee2e2; color: #991b1b; }
    .phone { display: inline-block; margin-right: 5px; }
    .whatsapp { color: #047857; font-size: 9px; font-weight: bold; white-space: nowrap; }
    .empty { color: #64748b; font-style: italic; padding: 12px; }
    .chart-empty { padding: 5px 0; }
    .cmp-row { align-items: center; display: grid; gap: 8px; grid-template-columns: 150px 1fr 64px; margin-top: 8px; }
    .cmp-label { font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmp-bar { background: #e2e8f0; display: flex; height: 12px; overflow: hidden; }
    .cmp-ok { background: #14b8a6; display: block; height: 100%; }
    .cmp-fail { background: #f59e0b; display: block; height: 100%; }
    .cmp-counts { font-size: 9px; font-weight: bold; text-align: right; white-space: nowrap; }
    .cmp-ok-text { color: #0f766e; }
    .cmp-fail-text { color: #b45309; }
    .not-approved-heading { border-left-color: #f59e0b; }
    .eyebrow-amber { color: #b45309; }
    .eyebrow-amber + h3 { color: #92400e; }
    .amber-count { color: #b45309; font-size: 12px; }
    .actions {
      display: flex;
      gap: 8px;
      position: fixed;
      right: 20px;
      top: 20px;
    }
    .action {
      background: #171717;
      border: 0;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: bold;
      text-decoration: none;
      padding: 10px 14px;
    }
    .action-download {
      background: #0f766e;
    }
    .charts-row3 { display: grid; gap: 11px; grid-template-columns: repeat(3, 1fr); margin-bottom: 14px; }
    .charts-row2 { display: grid; gap: 11px; grid-template-columns: 1fr 1fr; margin-bottom: 14px; }
    .charts-full { margin-bottom: 14px; }
    .canvas-wrap { height: 220px; position: relative; }
    .canvas-wrap-tall { height: 340px; position: relative; }
    .canvas-wrap-time { height: 180px; position: relative; }
    .rate-display { align-items: center; display: flex; flex-direction: column; height: 220px; justify-content: center; text-align: center; }
    .rate-big { color: #14b8a6; font-size: 52px; font-weight: bold; line-height: 1; }
    .rate-sub { color: #475569; font-size: 9px; margin-top: 6px; }
    .rate-bar-track { background: #e2e8f0; height: 10px; margin-top: 10px; width: 90%; }
    .rate-bar-fill { background: linear-gradient(90deg, #14b8a6, #0891b2); height: 100%; }
    .rate-detail { display: flex; gap: 12px; margin-top: 8px; }
    .rate-ok { color: #0f766e; font-size: 9px; font-weight: bold; }
    .rate-fail { color: #b45309; font-size: 9px; font-weight: bold; }
    @media print {
      @page { margin: 9mm; size: A4 portrait; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { max-width: none; padding: 0; }
      .hero { margin-top: 0; }
      .actions { display: none; }
      thead { display: table-header-group; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
  <div class="actions">
    <a class="action action-download" href="/api/presence/attendance-report/pdf?treinamento=${encodeURIComponent(treinamentoId)}">Baixar PDF</a>
    <button class="action" onclick="window.print()">Imprimir</button>
  </div>
  <main class="page">
    <header class="hero">
      <div class="hero-top">
        <div class="brand">
          <img class="logo" src="/logo-up.svg" alt="Instituto UP">
          <div>
            <strong>Instituto UP</strong>
            <span>Relatorio do encontro</span>
          </div>
        </div>
        <p class="hero-meta">Gerado em ${escapeHtml(generatedAt)}</p>
      </div>
      <h1>Relatorio de presenca</h1>
      <p>${escapeHtml(reportTitle)}</p>
    </header>

    <section class="summary" style="grid-template-columns:repeat(7,minmax(0,1fr))">
      <div class="metric"><span>Inscritos</span><strong>${participantsTotal + absentInscricoes.length}</strong></div>
      <div class="metric"><span>No Zoom</span><strong>${participantsTotal}</strong></div>
      <div class="metric"><span>Ausentes</span><strong style="color:#64748b">${absentInscricoes.length}</strong></div>
      <div class="metric"><span>Presenca OK</span><strong style="color:#0f766e">${approvedPresenceTotal}</strong></div>
      <div class="metric"><span>Nao aprovadas</span><strong style="color:#b45309">${notApproved.length}</strong></div>
      <div class="metric"><span>Em duvida</span><strong>${doubts.length}</strong></div>
      <div class="metric"><span>Nao encontradas</span><strong>${notFound.length}</strong></div>
    </section>

    <div class="charts-row3">
      <div class="chart-panel">
        <p class="eyebrow">Distribuicao geral</p>
        <h3>Presencas por status</h3>
        <div class="canvas-wrap"><canvas id="chartDonut"></canvas></div>
      </div>
      <div class="chart-panel">
        <p class="eyebrow">Taxa de aprovacao</p>
        <h3>Das presencas vinculadas</h3>
        <div class="rate-display">
          <span class="rate-big">${approvalRate}%</span>
          <span class="rate-sub">aprovadas das ${totalLinked} vinculadas ao CRM</span>
          <div class="rate-bar-track">
            <div class="rate-bar-fill" style="width:${approvalRate}%"></div>
          </div>
          <div class="rate-detail">
            <span class="rate-ok">✓ ${approved.length} aprovadas</span>
            <span class="rate-fail">✗ ${notApproved.length} nao aprovadas</span>
          </div>
        </div>
      </div>
      <div class="chart-panel">
        <p class="eyebrow">Quem mais indicou</p>
        <h3>Top indicadores por aprovadas</h3>
        ${buildTopIndicatorChart(indicatorGroups)}
      </div>
    </div>

    <div class="chart-panel charts-full">
      <p class="eyebrow">Comparativo por indicador — top ${comparisonData.length}</p>
      <h3>Aprovadas vs. Nao aprovadas por indicador</h3>
      <div class="canvas-wrap-tall"><canvas id="chartComparison"></canvas></div>
    </div>

    <div class="charts-row2">
      <div class="chart-panel">
        <p class="eyebrow">Distribuicao de permanencia</p>
        <h3>Quanto tempo os participantes ficaram</h3>
        <div class="canvas-wrap-time"><canvas id="chartTime"></canvas></div>
      </div>
      <div class="chart-panel">
        <p class="eyebrow">Participacao na dinamica</p>
        <h3>Percentual de tempo na dinamica</h3>
        <div class="canvas-wrap-time"><canvas id="chartDinamica"></canvas></div>
      </div>
    </div>

    <section>
      <h2>1. Presencas aprovadas por indicador</h2>
      ${buildApprovedGroups(indicatorGroups)}
    </section>

    <section>
      <h2>2. Presencas nao aprovadas por indicador</h2>
      ${buildNotApprovedGroups(notApprovedIndicatorGroups)}
    </section>

    <section>
      <h2>3. Em duvida</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nome no Zoom</th>
            <th class="text-center">Tempo</th>
            <th class="text-center">Presenca</th>
            <th>Candidata</th>
            <th>Contato</th>
          </tr>
        </thead>
        <tbody>${buildDoubtRows(doubts)}</tbody>
      </table>
    </section>

    <section>
      <h2>4. Nao encontradas</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nome no Zoom</th>
            <th class="text-center">Tempo</th>
            <th class="text-center">Presenca</th>
          </tr>
        </thead>
        <tbody>${buildNotFoundRows(notFound)}</tbody>
      </table>
    </section>

    <section>
      <h2>5. Inscritos que nao participaram</h2>
      ${buildAbsentGroups(absentGroups)}
    </section>
  </main>
  <script>
    var D = ${safeJson(chartPayload)};

    new Chart(document.getElementById("chartDonut"), {
      type: "doughnut",
      data: {
        labels: D.donut.labels,
        datasets: [{
          data: D.donut.values,
          backgroundColor: D.donut.colors,
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { size: 9 }, boxWidth: 12, padding: 8 }
          }
        }
      }
    });

    new Chart(document.getElementById("chartComparison"), {
      type: "bar",
      data: {
        labels: D.comparison.labels,
        datasets: [
          {
            label: "Aprovadas",
            data: D.comparison.approved,
            backgroundColor: "#14b8a6",
            borderRadius: 3,
          },
          {
            label: "Nao aprovadas",
            data: D.comparison.notApproved,
            backgroundColor: "#f59e0b",
            borderRadius: 3,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: {
            position: "top",
            labels: { font: { size: 9 }, boxWidth: 12, padding: 8 }
          }
        },
        scales: {
          x: { stacked: false, ticks: { font: { size: 9 } }, grid: { color: "#f1f5f9" } },
          y: { stacked: false, ticks: { font: { size: 9 } }, grid: { display: false } }
        }
      }
    });

    new Chart(document.getElementById("chartTime"), {
      type: "bar",
      data: {
        labels: D.time.labels,
        datasets: [{
          label: "Participantes",
          data: D.time.values,
          backgroundColor: D.time.colors,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { font: { size: 9 }, stepSize: 1 }, beginAtZero: true, grid: { color: "#f1f5f9" } }
        }
      }
    });

    new Chart(document.getElementById("chartDinamica"), {
      type: "bar",
      data: {
        labels: D.dinamica.labels,
        datasets: [{
          label: "Participantes",
          data: D.dinamica.values,
          backgroundColor: ["#e11d48", "#f59e0b", "#0891b2", "#14b8a6"],
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { font: { size: 9 }, stepSize: 1 }, beginAtZero: true, grid: { color: "#f1f5f9" } }
        }
      }
    });
  </script>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 1500);
    });
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Presence attendance report error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
