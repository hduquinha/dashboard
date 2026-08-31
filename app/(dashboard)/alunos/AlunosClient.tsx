"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  GraduationCap,
  Link2Off,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
  Wallet,
  X,
} from "lucide-react";
import {
  ALLOCATION_LABELS,
  allocationState,
  formatCpf,
  requiresGuardian,
} from "@/lib/academicRules";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type {
  AcademicRosterSummary,
  AcademicStudentCandidate,
  AcademicRegistrationRules,
  AcademicStudent,
  AcademicStudentFilters,
  AcademicUnlinkedEnrollment,
  StudentStatus,
} from "@/types/academic";

/**
 * Gestão de Alunos.
 *
 * Duas coisas que esta tela mostra de propósito em vez de esconder:
 * 1. **"Matriculado, aguardando alocação"** — contrato fechado e turma ainda não
 *    definida é estado normal (a venda não espera vaga de agenda), e precisa ser
 *    filtrável para a logística saber quem falta encaixar.
 * 2. **"Sem lead de origem"** — aluno que nunca passou pelo funil é aceitável; o que
 *    não pode é o gap ficar invisível e virar conciliação por nome depois.
 */

interface ClassOption {
  id: number;
  name: string;
  seatsLeft: number | null;
}

interface AlunosClientProps {
  initialStudents: AcademicStudent[];
  classes: ClassOption[];
  roster: AcademicRosterSummary;
  initialRegistrationRules: AcademicRegistrationRules;
  initialUnlinkedEnrollments: AcademicUnlinkedEnrollment[];
  canManage: boolean;
  canDelete: boolean;
  canViewFinance: boolean;
}

const EMPTY_FORM = {
  fullName: "",
  cpf: "",
  birthDate: "",
  email: "",
  phone: "",
  city: "",
  notes: "",
  status: "ativo" as StudentStatus,
  guardianName: "",
  guardianCpf: "",
  guardianEmail: "",
  guardianPhone: "",
  guardianRelationship: "",
  guardianBirthDate: "",
};

type FormState = typeof EMPTY_FORM;

export function AlunosClient({
  initialStudents,
  classes,
  roster,
  initialRegistrationRules,
  initialUnlinkedEnrollments,
  canManage,
  canDelete,
  canViewFinance,
}: AlunosClientProps) {
  const [students, setStudents] = useState(initialStudents);
  const [rosterSummary, setRosterSummary] = useState(roster);
  const [registrationRules, setRegistrationRules] = useState(initialRegistrationRules);
  const [unlinkedEnrollments, setUnlinkedEnrollments] = useState(initialUnlinkedEnrollments);
  const [search, setSearch] = useState("");
  const [flag, setFlag] = useState<AcademicStudentFilters["flag"] | "">("");
  const [status, setStatus] = useState<StudentStatus | "">("");
  const [classId, setClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<AcademicStudent | null>(null);
  const [pendingEnrollment, setPendingEnrollment] = useState<AcademicUnlinkedEnrollment | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function reload(overrides: {
    search?: string;
    flag?: AcademicStudentFilters["flag"] | "";
    status?: StudentStatus | "";
    classId?: string;
  } = {}) {
    const nextSearch = overrides.search ?? search;
    const nextFlag = overrides.flag ?? flag;
    const nextStatus = overrides.status ?? status;
    const nextClassId = overrides.classId ?? classId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      if (nextFlag) params.set("flag", nextFlag);
      if (nextStatus) params.set("status", nextStatus);
      if (nextClassId) params.set("classId", nextClassId);
      const response = await fetch(`/api/academic/students?${params}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os alunos.");
      setStudents(data.students ?? []);
      if (data.roster) setRosterSummary(data.roster);
      if (Array.isArray(data.unlinkedEnrollments)) setUnlinkedEnrollments(data.unlinkedEnrollments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os alunos.");
    } finally {
      setLoading(false);
    }
  }

  const counters = useMemo(() => {
    let aguardando = 0;
    let semLead = 0;
    let menorSemResponsavel = 0;
    for (const student of students) {
      const active = student.classes.filter((link) => link.status === "ativa").length;
      if (allocationState({ activeClasses: active, contractsCount: student.contractsCount }) === "aguardando_alocacao") {
        aguardando += 1;
      }
      if (!student.leadInscricaoId) semLead += 1;
      if (requiresGuardian(student.birthDate) && !student.guardianId) menorSemResponsavel += 1;
    }
    return { aguardando, semLead, menorSemResponsavel };
  }, [students]);

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[rgb(var(--slate-12))]">
            <GraduationCap className="h-5 w-5 text-[rgb(var(--blue-9))]" />
            Alunos
          </h1>
          <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">
            Cadastro de aluno matriculado e responsável legal. A alocação em turma é feita na tela de Turmas.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPendingEnrollment(null);
              setShowForm(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            Novo aluno
          </button>
        )}
      </header>

      {/* Contadores: cada um é também um filtro, porque o número sem o "quem" não
          resolve nada para a secretaria. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Alunos" value={students.length} onClick={() => { setFlag(""); void reload({ flag: "" }); }} />
        <SummaryCard
          label="Aguardando alocação"
          value={counters.aguardando}
          tone="amber"
          hint="Contrato fechado, turma ainda não definida"
          onClick={() => { setFlag("sem_turma"); void reload({ flag: "sem_turma" }); }}
        />
        <SummaryCard
          label="Sem lead de origem"
          value={counters.semLead}
          tone="slate"
          hint="Nunca passou pelo funil comercial"
          onClick={() => { setFlag("sem_lead"); void reload({ flag: "sem_lead" }); }}
        />
        <SummaryCard
          label="Menor sem responsável"
          value={counters.menorSemResponsavel}
          tone="rose"
          hint="O contrato precisa do CPF do responsável"
          onClick={() => { setFlag("menor_sem_responsavel"); void reload({ flag: "menor_sem_responsavel" }); }}
        />
      </div>

      {unlinkedEnrollments.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-amber-950">
                Contratos aguardando cadastro de aluno: {unlinkedEnrollments.length}
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                A venda já existe no Financeiro, mas ainda não aparece na fila de alocação. Confirme o lead ou
                complete o cadastro para criar o vínculo sem editar o banco.
              </p>
            </div>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {unlinkedEnrollments.map((enrollment) => (
              <div
                key={enrollment.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-neutral-900">{enrollment.studentName}</p>
                  <p className="truncate text-[11px] text-neutral-500">
                    Contrato #{enrollment.id}
                    {enrollment.courseName ? ` · ${enrollment.courseName}` : ""}
                    {enrollment.saleDate
                      ? ` · ${new Date(`${enrollment.saleDate}T12:00:00`).toLocaleDateString("pt-BR")}`
                      : ""}
                  </p>
                  <p className={`text-[10px] font-semibold ${enrollment.leadInscricaoId ? "text-emerald-700" : "text-amber-700"}`}>
                    {enrollment.leadInscricaoId
                      ? `Lead #${enrollment.leadInscricaoId}${enrollment.leadName ? ` — ${enrollment.leadName}` : ""}`
                      : "Lead ainda não confirmado"}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setPendingEnrollment(enrollment);
                      setShowForm(true);
                    }}
                    className="shrink-0 rounded-lg bg-amber-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-800"
                  >
                    Cadastrar e vincular
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {canManage && (
        <RegistrationRulesPanel rules={registrationRules} onChanged={setRegistrationRules} />
      )}

      {/* Alunos por turma: a linha "aguardando alocação" é própria, para a contagem
          não perder nem duplicar quem ainda não tem horário. */}
      {rosterSummary.classes.length > 0 ||
      rosterSummary.awaitingAllocation > 0 ||
      rosterSummary.withoutContractOrClass > 0 ? (
        <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--slate-10))]">
            Alunos por turma
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {rosterSummary.classes.map((line) => (
              <span key={line.classId} className="rounded-md bg-[rgb(var(--slate-3))] px-2 py-1 text-[rgb(var(--slate-12))]">
                {line.className}: <strong>{line.students}</strong>
              </span>
            ))}
            {rosterSummary.awaitingAllocation > 0 && (
              <span className="rounded-md bg-amber-100 px-2 py-1 font-semibold text-amber-900">
                Aguardando alocação: {rosterSummary.awaitingAllocation}
              </span>
            )}
            {rosterSummary.withoutContractOrClass > 0 && (
              <span className="rounded-md bg-[rgb(var(--slate-3))] px-2 py-1 text-[rgb(var(--slate-11))]">
                Sem turma e sem contrato: {rosterSummary.withoutContractOrClass}
              </span>
            )}
            <span className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-[rgb(var(--slate-10))]">
              Total: {rosterSummary.total}
            </span>
          </div>
        </section>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void reload({ search });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5">
          <Search className="h-3.5 w-3.5 text-[rgb(var(--slate-9))]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, CPF, telefone ou e-mail…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={flag}
          onChange={(event) => {
            const next = event.target.value as AcademicStudentFilters["flag"] | "";
            setFlag(next);
            void reload({ flag: next });
          }}
          className="h-9 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 text-sm"
        >
          <option value="">Todos os alunos</option>
          <option value="sem_turma">Aguardando alocação</option>
          <option value="sem_lead">Sem lead de origem</option>
          <option value="menor_sem_responsavel">Menor sem responsável</option>
        </select>
        <select
          value={status}
          onChange={(event) => {
            const next = event.target.value as StudentStatus | "";
            setStatus(next);
            void reload({ status: next });
          }}
          className="h-9 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="trancado">Trancado</option>
          <option value="concluido">Concluído</option>
          <option value="inativo">Inativo</option>
        </select>
        <select
          value={classId}
          onChange={(event) => {
            const next = event.target.value;
            setClassId(next);
            void reload({ classId: next });
          }}
          className="h-9 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 text-sm"
        >
          <option value="">Todas as turmas</option>
          {classes.map((turma) => (
            <option key={turma.id} value={turma.id}>{turma.name}</option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-sm font-semibold">
          Buscar
        </button>
      </form>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}

      <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="text-xs text-[rgb(var(--slate-10))]">
            <tr className="border-b border-[rgb(var(--border-weak))]">
              <th className="px-3 py-2 font-medium">Aluno</th>
              <th className="px-3 py-2 font-medium">CPF</th>
              <th className="px-3 py-2 font-medium">Contato</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Turma</th>
              <th className="px-3 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-[rgb(var(--slate-9))]" />
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[rgb(var(--slate-9))]">
                  Nenhum aluno neste recorte.
                </td>
              </tr>
            ) : (
              students.map((student) => {
                const active = student.classes.filter((link) => link.status === "ativa");
                const state = allocationState({
                  activeClasses: active.length,
                  contractsCount: student.contractsCount,
                });
                const menorSemResponsavel = requiresGuardian(student.birthDate) && !student.guardianId;
                return (
                  <tr key={student.id} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(student);
                          setPendingEnrollment(null);
                          setShowForm(true);
                        }}
                        className="text-left font-semibold text-[rgb(var(--slate-12))] hover:underline"
                      >
                        {humanizeName(student.fullName) ?? student.fullName}
                      </button>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {!student.leadInscricaoId && (
                          <span className="inline-flex items-center gap-1 rounded bg-[rgb(var(--slate-3))] px-1.5 text-[10px] font-semibold text-[rgb(var(--slate-11))]">
                            <Link2Off className="h-2.5 w-2.5" /> sem lead
                          </span>
                        )}
                        {menorSemResponsavel && (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700">
                            <AlertTriangle className="h-2.5 w-2.5" /> menor sem responsável
                          </span>
                        )}
                        {student.guardian && (
                          <span className="rounded bg-[rgb(var(--slate-3))] px-1.5 text-[10px] text-[rgb(var(--slate-11))]">
                            resp.: {student.guardian.fullName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[rgb(var(--slate-11))]">
                      {student.cpf ? formatCpf(student.cpf) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[rgb(var(--slate-11))]">
                      {student.phone ? (
                        <a
                          href={buildWhatsAppWebUrl(student.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => openWhatsAppOnMobile(event, student.phone)}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          <MessageCircle className="h-3 w-3 text-emerald-600" />
                          {student.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                          state === "alocado"
                            ? "bg-emerald-100 text-emerald-800"
                            : state === "aguardando_alocacao"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                        }`}
                      >
                        {ALLOCATION_LABELS[state]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[rgb(var(--slate-11))]">
                      {active.length > 0 ? active.map((link) => link.className).join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {student.contractsCount > 0 && (
                          <span
                            title={`${student.contractsCount} contrato(s) no Financeiro`}
                            className="inline-flex items-center gap-1 rounded bg-[rgb(var(--slate-3))] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--slate-11))]"
                          >
                            <Wallet className="h-3 w-3" /> {student.contractsCount}
                          </span>
                        )}
                        {canViewFinance && (
                          <Link
                            href="/financeiro"
                            title="Abrir Gestão Financeira"
                            className="rounded p-1 text-cyan-700 hover:bg-cyan-50"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            title="Excluir aluno"
                            onClick={async () => {
                              if (!confirm(`Excluir ${student.fullName}?`)) return;
                              const response = await fetch(`/api/academic/students/${student.id}`, { method: "DELETE" });
                              const data = await response.json().catch(() => ({}));
                              if (!response.ok) {
                                setError(data.error ?? "Falha ao excluir.");
                                return;
                              }
                              void reload();
                            }}
                            className="rounded p-1 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showForm && canManage && (
        <StudentForm
          student={selected}
          pendingEnrollment={pendingEnrollment}
          rules={registrationRules}
          canViewFinance={canViewFinance}
          onClose={() => {
            setShowForm(false);
            setPendingEnrollment(null);
          }}
          onSaved={(warning) => {
            setShowForm(false);
            setPendingEnrollment(null);
            setNotice(warning);
            void reload();
          }}
        />
      )}

      <p className="text-[11px] text-[rgb(var(--slate-9))]">
        Turmas disponíveis: {classes.length === 0 ? "nenhuma cadastrada ainda" : classes.map((turma) => turma.name).join(" · ")}
      </p>
    </div>
  );
}

const REGISTRATION_RULE_LABELS: Array<{ key: keyof AcademicRegistrationRules; label: string }> = [
  { key: "studentCpfRequired", label: "CPF do aluno" },
  { key: "studentEmailRequired", label: "E-mail do aluno" },
  { key: "studentBirthDateRequired", label: "Nascimento do aluno" },
  { key: "studentPhoneRequired", label: "Telefone do aluno" },
  { key: "guardianRequiredForMinor", label: "Responsável para menor" },
  { key: "guardianCpfRequired", label: "CPF do responsável" },
  { key: "guardianEmailRequired", label: "E-mail do responsável" },
  { key: "guardianBirthDateRequired", label: "Nascimento do responsável" },
  { key: "guardianPhoneRequired", label: "Telefone do responsável" },
];

function RegistrationRulesPanel({
  rules,
  onChanged,
}: {
  rules: AcademicRegistrationRules;
  onChanged: (rules: AcademicRegistrationRules) => void;
}) {
  const [saving, setSaving] = useState<keyof AcademicRegistrationRules | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof AcademicRegistrationRules) {
    setSaving(key);
    setError(null);
    try {
      const response = await fetch("/api/academic/settings/registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: !rules[key] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar regra.");
      onChanged(data.rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar regra.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <details className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
      <summary className="cursor-pointer text-xs font-bold text-[rgb(var(--slate-12))]">
        Regras de campos obrigatórios
      </summary>
      <p className="mt-1 text-[11px] text-[rgb(var(--slate-9))]">
        Estas regras são operacionais e valem no servidor; alterar aqui não exige novo deploy.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REGISTRATION_RULE_LABELS.map((item) => (
          <label key={item.key} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs">
            <input
              type="checkbox"
              checked={rules[item.key]}
              disabled={saving !== null}
              onChange={() => void toggle(item.key)}
            />
            {item.label}
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}
    </details>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "blue",
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "blue" | "amber" | "rose" | "slate";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-900"
      : tone === "rose"
        ? "text-rose-700"
        : tone === "slate"
          ? "text-[rgb(var(--slate-11))]"
          : "text-[rgb(var(--slate-12))]";
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3 text-left transition hover:border-[rgb(var(--blue-9))]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value.toLocaleString("pt-BR")}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[rgb(var(--slate-9))]">{hint}</p>}
    </button>
  );
}

function StudentForm({
  student,
  pendingEnrollment,
  rules,
  canViewFinance,
  onClose,
  onSaved,
}: {
  student: AcademicStudent | null;
  pendingEnrollment: AcademicUnlinkedEnrollment | null;
  rules: AcademicRegistrationRules;
  canViewFinance: boolean;
  onClose: () => void;
  onSaved: (warning: string | null) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    student
      ? {
          fullName: student.fullName,
          cpf: student.cpf ?? "",
          birthDate: student.birthDate ?? "",
          email: student.email ?? "",
          phone: student.phone ?? "",
          city: student.city ?? "",
          notes: student.notes ?? "",
          status: student.status,
          guardianName: student.guardian?.fullName ?? "",
          guardianCpf: student.guardian?.cpf ?? "",
          guardianEmail: student.guardian?.email ?? "",
          guardianPhone: student.guardian?.phone ?? "",
          guardianRelationship: student.guardian?.relationship ?? "",
          guardianBirthDate: student.guardian?.birthDate ?? "",
        }
      : pendingEnrollment
        ? {
            ...EMPTY_FORM,
            fullName: pendingEnrollment.studentName,
            phone: pendingEnrollment.leadPhone ?? "",
          }
        : EMPTY_FORM
  );
  const [leadQuery, setLeadQuery] = useState(pendingEnrollment?.leadName ?? "");
  const [leadResults, setLeadResults] = useState<AcademicStudentCandidate[]>([]);
  const [leadId, setLeadId] = useState<number | null>(
    student?.leadInscricaoId ?? pendingEnrollment?.leadInscricaoId ?? null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const menor = requiresGuardian(form.birthDate || null);

  useEffect(() => {
    if (student || pendingEnrollment?.leadInscricaoId || leadQuery.trim().length < 3) {
      setLeadResults([]);
      return;
    }
    const timer = setTimeout(() => {
      // Só leads que já fecharam: a ficha de aluno nasce depois da venda, e
      // buscar no funil inteiro fazia a secretaria digitar tudo para o "Salvar"
      // recusar no fim.
      fetch(`/api/academic/students/candidates?search=${encodeURIComponent(leadQuery.trim())}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { candidates?: AcademicStudentCandidate[] } | null) => {
          setLeadResults((data?.candidates ?? []).slice(0, 8));
        })
        .catch(() => setLeadResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [leadQuery, pendingEnrollment?.leadInscricaoId, student]);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        fullName: form.fullName,
        cpf: form.cpf,
        birthDate: form.birthDate || null,
        email: form.email,
        phone: form.phone,
        city: form.city,
        notes: form.notes,
        status: form.status,
        guardian: form.guardianName.trim()
          ? {
              fullName: form.guardianName,
              cpf: form.guardianCpf,
              email: form.guardianEmail,
              phone: form.guardianPhone,
              relationship: form.guardianRelationship,
              birthDate: form.guardianBirthDate || null,
            }
          : null,
        ...(student ? {} : { fromLeadId: leadId ?? undefined }),
        ...(pendingEnrollment ? { financeEnrollmentId: pendingEnrollment.id } : {}),
      };
      const response = await fetch(
        student ? `/api/academic/students/${student.id}` : "/api/academic/students",
        {
          method: student ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar o aluno.");
      onSaved(data.warning ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o aluno.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">{student ? "Editar aluno" : "Novo aluno"}</p>
            <p className="text-xs text-neutral-400">
              {student
                ? student.leadInscricaoId
                  ? `Lead de origem #${student.leadInscricaoId}`
                  : "Sem lead de origem — cadastro direto"
                : pendingEnrollment
                  ? `Vincular ao contrato #${pendingEnrollment.id}`
                  : "Converta um lead do CRM ou cadastre direto"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {student?.phone && (
              <a
                href={buildWhatsAppWebUrl(student.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50"
                title="Abrir WhatsApp"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            )}
            {student && canViewFinance && (
              <Link href="/financeiro" className="rounded-lg p-1.5 text-cyan-700 hover:bg-cyan-50" title="Abrir Financeiro">
                <Wallet className="h-4 w-4" />
              </Link>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          {!student && pendingEnrollment?.leadInscricaoId ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-900">
                Lead #{pendingEnrollment.leadInscricaoId} já confirmado no contrato
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-700">
                {pendingEnrollment.leadName ?? pendingEnrollment.studentName}
                {pendingEnrollment.leadPhone ? ` · ${pendingEnrollment.leadPhone}` : ""}
              </p>
            </div>
          ) : !student ? (
            <div className="rounded-xl border border-neutral-200 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-neutral-700">
                <UserRoundPlus className="h-3.5 w-3.5" />
                Converter um lead que já fechou
              </p>
              <p className="mb-2 text-[11px] text-neutral-500">
                Só aparecem leads que chegaram em &quot;Fechado&quot; ou já têm venda registrada — a ficha de aluno
                nasce depois do fechamento. Herda nome, contato e a origem de campanha, e é o que liga a jornada
                lead → aluno → mensalidade.
              </p>
              <input
                value={leadQuery}
                onChange={(event) => setLeadQuery(event.target.value)}
                placeholder="Buscar entre os leads fechados…"
                className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
              />
              {leadResults.length > 0 && (
                <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-neutral-100">
                  {leadResults.map((lead) => (
                    <li key={lead.inscricaoId}>
                      <button
                        type="button"
                        onClick={() => {
                          setLeadId(lead.inscricaoId);
                          // CPF e e-mail vêm junto quando o lead os tem: são
                          // obrigatórios aqui e redigitar é onde nasce erro.
                          setForm((current) => ({
                            ...current,
                            fullName: current.fullName || lead.name || "",
                            phone: current.phone || lead.phone || "",
                            email: current.email || lead.email || "",
                            cpf: current.cpf || lead.cpf || "",
                          }));
                          setLeadQuery(lead.name ?? String(lead.inscricaoId));
                          setLeadResults([]);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-neutral-50"
                      >
                        <span className="min-w-0 truncate">
                          {lead.name ?? "Sem nome"}
                          {lead.stageLabel ? <span className="text-neutral-400"> · {lead.stageLabel}</span> : null}
                          {lead.enrollmentId ? <span className="text-emerald-700"> · contrato #{lead.enrollmentId}</span> : null}
                        </span>
                        <span className="flex-none text-neutral-400">{lead.phone ?? `#${lead.inscricaoId}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {leadId && (
                <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">
                  Lead #{leadId} selecionado — o vínculo será gravado.
                </p>
              )}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome completo *">
              <input value={form.fullName} onChange={(event) => set("fullName", event.target.value)} className={inputClass} />
            </Field>
            <Field label={`CPF${rules.studentCpfRequired ? " *" : ""}`}>
              <input required={rules.studentCpfRequired} value={form.cpf} onChange={(event) => set("cpf", event.target.value)} className={inputClass} placeholder="000.000.000-00" />
            </Field>
            <Field label={`Data de nascimento${rules.studentBirthDateRequired ? " *" : ""}`}>
              <input required={rules.studentBirthDateRequired} type="date" value={form.birthDate} onChange={(event) => set("birthDate", event.target.value)} className={inputClass} />
            </Field>
            <Field label={`Telefone${rules.studentPhoneRequired ? " *" : ""}`}>
              <input required={rules.studentPhoneRequired} value={form.phone} onChange={(event) => set("phone", event.target.value)} className={inputClass} />
            </Field>
            <Field label={`E-mail${rules.studentEmailRequired ? " *" : ""}`}>
              <input required={rules.studentEmailRequired} type="email" value={form.email} onChange={(event) => set("email", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Cidade">
              <input value={form.city} onChange={(event) => set("city", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Status do aluno">
              <select value={form.status} onChange={(event) => set("status", event.target.value as StudentStatus)} className={inputClass}>
                <option value="ativo">Ativo</option>
                <option value="trancado">Trancado</option>
                <option value="concluido">Concluído</option>
                <option value="inativo">Inativo</option>
              </select>
            </Field>
          </div>

          <div className={`rounded-xl border p-3 ${menor ? "border-amber-300 bg-amber-50" : "border-neutral-200"}`}>
            <p className="text-xs font-bold text-neutral-800">
              Responsável legal {menor && rules.guardianRequiredForMinor ? "— obrigatório para menor de idade" : "(opcional)"}
            </p>
            <p className="mb-2 text-[11px] text-neutral-500">
              É o CPF do responsável que vai no contrato, nunca o do aluno menor nem o CNPJ da escola.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Nome do responsável${menor && rules.guardianRequiredForMinor ? " *" : ""}`}>
                <input required={menor && rules.guardianRequiredForMinor} value={form.guardianName} onChange={(event) => set("guardianName", event.target.value)} className={inputClass} />
              </Field>
              <Field label={`CPF do responsável${menor && rules.guardianCpfRequired ? " *" : ""}`}>
                <input required={menor && rules.guardianCpfRequired} value={form.guardianCpf} onChange={(event) => set("guardianCpf", event.target.value)} className={inputClass} />
              </Field>
              <Field label={`E-mail${menor && rules.guardianEmailRequired ? " *" : ""}`}>
                <input required={menor && rules.guardianEmailRequired} type="email" value={form.guardianEmail} onChange={(event) => set("guardianEmail", event.target.value)} className={inputClass} />
              </Field>
              <Field label={`Telefone${menor && rules.guardianPhoneRequired ? " *" : ""}`}>
                <input required={menor && rules.guardianPhoneRequired} value={form.guardianPhone} onChange={(event) => set("guardianPhone", event.target.value)} className={inputClass} />
              </Field>
              <Field label={`Data de nascimento${menor && rules.guardianBirthDateRequired ? " *" : ""}`}>
                <input required={menor && rules.guardianBirthDateRequired} type="date" value={form.guardianBirthDate} onChange={(event) => set("guardianBirthDate", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Parentesco">
                <input value={form.guardianRelationship} onChange={(event) => set("guardianRelationship", event.target.value)} className={inputClass} placeholder="mãe, pai, avó…" />
              </Field>
            </div>
          </div>

          <Field label="Observações">
            <textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} rows={2} className={inputClass} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !form.fullName.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar aluno
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
