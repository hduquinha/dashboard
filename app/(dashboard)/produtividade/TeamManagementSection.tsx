"use client";

import { useState } from "react";
import { Users } from "lucide-react";

export interface TeamMemberRow {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  active: boolean;
  institutoUpOnly: boolean;
}

function NewMemberForm({ onCreated }: { onCreated: (member: TeamMemberRow) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [institutoUpOnly, setInstitutoUpOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role, institutoUpOnly }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao criar integrante.");
        return;
      }
      onCreated(data.member);
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
      setInstitutoUpOnly(false);
    } catch {
      setError("Erro de conexao.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] p-3 sm:grid-cols-6 sm:items-end">
      <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} required
          className="h-9 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-sm text-[rgb(var(--slate-12))]" />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          className="h-9 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-sm text-[rgb(var(--slate-12))]" />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
        Senha
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
          className="h-9 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-sm text-[rgb(var(--slate-12))]" />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
        Papel
        <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}
          className="h-9 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-sm text-[rgb(var(--slate-12))]">
          <option value="member">Usuario comum</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      <label className="flex h-9 items-center gap-1.5 text-xs font-semibold text-[rgb(var(--slate-10))]">
        <input type="checkbox" checked={institutoUpOnly} onChange={(e) => setInstitutoUpOnly(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-[rgb(var(--border-strong))]" />
        Só Instituto UP
      </label>
      <button type="submit" disabled={saving}
        className="h-9 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
        {saving ? "Criando..." : "Adicionar"}
      </button>
      {error && <p className="sm:col-span-6 text-xs text-red-600">{error}</p>}
    </form>
  );
}

function MemberRow({ member, currentUserId, onUpdated }: {
  member: TeamMemberRow;
  currentUserId: number;
  onUpdated: (member: TeamMemberRow) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao atualizar.");
        return;
      }
      onUpdated(data.member);
    } catch {
      setError("Erro de conexao.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-[rgb(var(--border-weak))]">
      <td className="px-3 py-2">
        <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{member.name}</p>
        <p className="text-xs text-[rgb(var(--slate-10))]">{member.email}</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-3 py-2">
        <select
          value={member.role}
          disabled={saving || member.id === currentUserId}
          onChange={(e) => patch({ role: e.target.value })}
          className="h-8 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))] disabled:opacity-50"
        >
          <option value="member">Usuario comum</option>
          <option value="admin">Administrador</option>
        </select>
      </td>
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          disabled={saving || member.id === currentUserId}
          onClick={() => patch({ active: !member.active })}
          className={`h-7 rounded-full px-3 text-[11px] font-semibold disabled:opacity-50 ${
            member.active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500"
          }`}
        >
          {member.active ? "Ativo" : "Inativo"}
        </button>
      </td>
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          disabled={saving}
          onClick={() => patch({ institutoUpOnly: !member.institutoUpOnly })}
          className={`h-7 rounded-full px-3 text-[11px] font-semibold disabled:opacity-50 ${
            member.institutoUpOnly ? "bg-violet-100 text-violet-700" : "bg-neutral-100 text-neutral-500"
          }`}
        >
          {member.institutoUpOnly ? "Só Instituto UP" : "Instituto UP + VozUP"}
        </button>
      </td>
      <td className="px-3 py-2 text-right">
        {resetOpen ? (
          <div className="flex items-center justify-end gap-1">
            <input
              type="password"
              placeholder="Nova senha"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-8 w-32 rounded-lg border border-[rgb(var(--border-strong))] px-2 text-xs"
            />
            <button
              type="button"
              disabled={saving || newPassword.length < 8}
              onClick={async () => { await patch({ password: newPassword }); setNewPassword(""); setResetOpen(false); }}
              className="h-8 rounded-lg bg-neutral-900 px-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button type="button" onClick={() => setResetOpen(false)} className="h-8 rounded-lg px-2 text-xs text-neutral-500">
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setResetOpen(true)} className="text-xs text-blue-600 hover:underline">
            Redefinir senha
          </button>
        )}
      </td>
    </tr>
  );
}

export function TeamManagementSection({
  initialMembers,
  currentUserId,
}: {
  initialMembers: TeamMemberRow[];
  currentUserId: number;
}) {
  const [members, setMembers] = useState(initialMembers);

  return (
    <section className="space-y-3 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
        <Users className="h-4 w-4 text-[rgb(var(--blue-9))]" />
        Gerenciar equipe
      </h2>

      <NewMemberForm onCreated={(member) => setMembers((prev) => [...prev, member])} />

      <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))]">
        <table className="w-full">
          <thead className="bg-[rgb(var(--slate-2))]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Integrante</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Papel</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-[rgb(var(--slate-11))]">Status</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-[rgb(var(--slate-11))]">Acesso</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Senha</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                currentUserId={currentUserId}
                onUpdated={(updated) => setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
