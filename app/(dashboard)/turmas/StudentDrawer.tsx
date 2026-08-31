"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Save, Trash2, X } from "lucide-react";
import { ageOn, formatCpf, requiresGuardian } from "@/lib/academicRules";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import { Field, LinkStatusPill, STUDENT_STATUS_LABELS, formatDateBR, inputClass } from "./TurmasUI";
import type { AcademicStudent, StudentStatus } from "@/types/academic";

/**
 * Ficha do aluno aberta de dentro da turma.
 *
 * Existe porque a pergunta "quem é esse aluno?" nasce olhando a lista de chamada, e
 * mandar a secretaria para `/alunos`, refazer a busca e perder a turma selecionada
 * era o atrito que fazia o telefone do aluno voltar para o caderno. Os dados vêm da
 * MESMA API de `/alunos` — a ficha é uma só, exibida em dois lugares.
 */
export function StudentDrawer({
  studentId,
  canManageStudents,
  canDeleteStudents,
  onClose,
  onChanged,
}: {
  studentId: number;
  canManageStudents: boolean;
  canDeleteStudents: boolean;
  onClose: () => void;
  /** Avisa a turma para recarregar a lista (nome/situação podem ter mudado). */
  onChanged: (message: string) => void;
}) {
  const [student, setStudent] = useState<AcademicStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    cpf: "",
    birthDate: "",
    email: "",
    phone: "",
    city: "",
    status: "ativo" as StudentStatus,
    notes: "",
  });

  const fill = useCallback((record: AcademicStudent) => {
    setStudent(record);
    setForm({
      fullName: record.fullName,
      cpf: record.cpf ?? "",
      birthDate: record.birthDate ?? "",
      email: record.email ?? "",
      phone: record.phone ?? "",
      city: record.city ?? "",
      status: record.status,
      notes: record.notes ?? "",
    });
  }, []);

  // setState dentro do callback da promise (padrão aceito pelo lint deste repo).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/academic/students/${studentId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { student?: AcademicStudent } | null) => {
        if (cancelled) return;
        if (data?.student) fill(data.student);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, fill]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/academic/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar a ficha.");
      if (data.student) fill(data.student);
      setEditing(false);
      onChanged(data.warning ?? "Ficha do aluno atualizada.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar a ficha.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!student) return;
    if (
      !window.confirm(
        `Excluir o cadastro de ${student.fullName}? Ele sai de todas as turmas. Alunos com contrato no Financeiro não podem ser excluídos.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/academic/students/${studentId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir o aluno.");
      onChanged("Aluno excluído.");
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir o aluno.");
      setSaving(false);
    }
  }

  const age = student ? ageOn(student.birthDate) : null;
  const menorSemResponsavel = student ? requiresGuardian(student.birthDate) && !student.guardianId : false;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end bg-black/40">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-2 border-b border-neutral-100 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-neutral-900">
              {student ? humanizeName(student.fullName) || student.fullName : "Ficha do aluno"}
            </p>
            {student ? (
              <p className="text-[11px] text-neutral-500">
                {STUDENT_STATUS_LABELS[student.status]}
                {age !== null ? ` · ${age} anos` : ""}
                {student.leadInscricaoId ? ` · lead #${student.leadInscricaoId}` : " · sem lead de origem"}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          {menorSemResponsavel ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Menor de idade sem responsável legal cadastrado — o contrato precisa do CPF do responsável.
            </p>
          ) : null}

          {loading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-neutral-300" />
          ) : !student ? (
            <p className="py-6 text-center text-xs text-neutral-400">Não foi possível carregar a ficha.</p>
          ) : editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome *" className="sm:col-span-2">
                <input
                  value={form.fullName}
                  onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="CPF">
                <input
                  value={form.cpf}
                  onChange={(event) => setForm((current) => ({ ...current, cpf: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Nascimento">
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Telefone">
                <input
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="E-mail">
                <input
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Cidade">
                <input
                  value={form.city}
                  onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Situação do aluno">
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as StudentStatus }))}
                  className={inputClass}
                >
                  {(Object.keys(STUDENT_STATUS_LABELS) as StudentStatus[]).map((value) => (
                    <option key={value} value={value}>{STUDENT_STATUS_LABELS[value]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Observações" className="sm:col-span-2">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <p className="sm:col-span-2 text-[11px] text-neutral-500">
                Responsável legal e vínculo com o lead continuam sendo editados na Gestão de Alunos — aqui ficam os
                dados que a secretaria corrige com o aluno na frente.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <Info label="CPF" value={student.cpf ? formatCpf(student.cpf) : "—"} />
                <Info label="Nascimento" value={formatDateBR(student.birthDate)} />
                <Info label="Telefone" value={student.phone ?? "—"} />
                <Info label="Cidade" value={student.city ?? "—"} />
                <Info label="E-mail" value={student.email ?? "—"} className="col-span-2" />
              </dl>

              {student.phone ? (
                <a
                  href={buildWhatsAppWebUrl(student.phone)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => openWhatsAppOnMobile(event, student.phone)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Falar no WhatsApp
                </a>
              ) : null}

              {student.guardian ? (
                <div className="rounded-xl border border-neutral-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Responsável legal</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-800">{student.guardian.fullName}</p>
                  <p className="text-[11px] text-neutral-500">
                    {student.guardian.relationship ?? "Responsável"}
                    {student.guardian.cpf ? ` · ${formatCpf(student.guardian.cpf)}` : ""}
                    {student.guardian.phone ? ` · ${student.guardian.phone}` : ""}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Turmas do aluno</p>
                {student.classes.length === 0 ? (
                  <p className="mt-1 text-xs text-neutral-400">Nenhuma turma registrada.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {student.classes.map((link) => (
                      <li key={link.linkId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-neutral-700">{link.className}</span>
                        <LinkStatusPill status={link.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {student.notes ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Observações</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{student.notes}</p>
                </div>
              ) : null}

              <p className="text-[11px] text-neutral-400">
                {student.contractsCount > 0
                  ? `${student.contractsCount} contrato(s) no Financeiro`
                  : "Sem contrato no Financeiro"}
                {student.createdByName ? ` · cadastrado por ${student.createdByName}` : ""}
              </p>
            </div>
          )}
        </div>

        {student && !loading ? (
          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-neutral-100 bg-white px-5 py-3">
            <div>
              {canDeleteStudents && !editing ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir aluno
                </button>
              ) : null}
            </div>
            {canManageStudents ? (
              editing ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      fill(student);
                    }}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || !form.fullName.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar ficha
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white"
                >
                  Editar ficha
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 break-words text-neutral-800">{value}</dd>
    </div>
  );
}
