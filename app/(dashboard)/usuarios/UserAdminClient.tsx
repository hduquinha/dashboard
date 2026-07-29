"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  KeyRound,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_PRIORITY_BY_ROLE,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  defaultPermissionsForRole,
  normalizePermissionList,
  normalizeTeamRole,
  type PermissionKey,
  type TeamRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface AdminTeamMember {
  id: number;
  email: string;
  name: string;
  role: TeamRole;
  active: boolean;
  priorityLevel: number;
  permissions: PermissionKey[];
  institutoUpOnly: boolean;
}

interface UserAdminClientProps {
  initialMembers: AdminTeamMember[];
  currentUserId: number;
}

type DialogMode = "create" | "edit";

interface DialogState {
  mode: DialogMode;
  member?: AdminTeamMember;
}

function DeleteUserDialog({
  member,
  onClose,
  onDeleted,
}: {
  member: AdminTeamMember;
  onClose: () => void;
  onDeleted: (memberId: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function removeMember() {
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Falha ao excluir usuario.");
      onDeleted(member.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <Trash2 size={20} />
        </div>
        <h2 id="delete-user-title" className="mt-4 text-lg font-black text-slate-950">
          Excluir usuario?
        </h2>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
          O acesso de <strong className="font-black text-slate-900">{member.name}</strong> sera removido
          permanentemente. Esta acao nao pode ser desfeita.
        </p>
        {error ? <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={removeMember}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            <Trash2 size={16} />
            {deleting ? "Excluindo..." : "Excluir usuario"}
          </button>
        </div>
      </section>
    </div>
  );
}

function roleTone(role: TeamRole): string {
  if (role === "super_master") return "bg-cyan-50 text-cyan-700 ring-cyan-200";
  if (role === "admin") return "bg-violet-50 text-violet-700 ring-violet-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function emptyCreateMember(): AdminTeamMember {
  return {
    id: 0,
    email: "",
    name: "",
    role: "member",
    active: true,
    priorityLevel: DEFAULT_PRIORITY_BY_ROLE.member,
    permissions: defaultPermissionsForRole("member"),
    institutoUpOnly: false,
  };
}

function PermissionDialog({
  state,
  currentUserId,
  onClose,
  onSaved,
}: {
  state: DialogState;
  currentUserId: number;
  onClose: () => void;
  onSaved: (member: AdminTeamMember) => void;
}) {
  const base = state.member ?? emptyCreateMember();
  const [name, setName] = useState(base.name);
  const [email, setEmail] = useState(base.email);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TeamRole>(base.role);
  const [active, setActive] = useState(base.active);
  const [priorityLevel, setPriorityLevel] = useState(base.priorityLevel);
  const [institutoUpOnly, setInstitutoUpOnly] = useState(base.institutoUpOnly);
  const [permissions, setPermissions] = useState<PermissionKey[]>(base.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCreate = state.mode === "create";
  const isSelf = !isCreate && base.id === currentUserId;
  const roleIsSuper = role === "super_master";
  const effectivePermissions = roleIsSuper ? ALL_PERMISSION_KEYS : permissions;
  const effectiveSet = useMemo(() => new Set(effectivePermissions), [effectivePermissions]);

  function replaceRole(nextRole: TeamRole) {
    setRole(nextRole);
    setPriorityLevel(DEFAULT_PRIORITY_BY_ROLE[nextRole]);
    setPermissions(defaultPermissionsForRole(nextRole, { institutoUpOnly }));
  }

  function replaceInstitutoOnly(nextValue: boolean) {
    setInstitutoUpOnly(nextValue);
    setPermissions((current) =>
      nextValue
        ? current.filter((permission) => permission !== "view.vozup")
        : current.includes("view.vozup")
          ? current
          : [...current, "view.vozup"]
    );
  }

  function togglePermission(permission: PermissionKey) {
    if (roleIsSuper) return;
    setPermissions((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return normalizePermissionList([...next]);
    });
  }

  function setGroupPermissions(groupKeys: readonly PermissionKey[], checked: boolean) {
    if (roleIsSuper) return;
    setPermissions((current) => {
      const next = new Set(current);
      for (const key of groupKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      if (institutoUpOnly) next.delete("view.vozup");
      return normalizePermissionList([...next]);
    });
  }

  function restoreRoleDefault() {
    setPermissions(defaultPermissionsForRole(role, { institutoUpOnly }));
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name,
        email,
        role,
        active,
        priorityLevel,
        permissions: effectivePermissions,
        institutoUpOnly,
      };
      if (password) body.password = password;

      const res = await fetch(isCreate ? "/api/team" : `/api/team/${base.id}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { member?: AdminTeamMember; error?: string };
      if (!res.ok || !data.member) {
        throw new Error(data.error ?? "Falha ao salvar usuario.");
      }
      onSaved(data.member);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <section className="flex h-[min(860px,calc(100vh-48px))] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-slate-200">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              Administrar usuarios
            </p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-950">
              {isCreate ? "Novo perfil" : base.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-content-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-slate-50/70 p-5 lg:border-b-0 lg:border-r">
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                Nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                E-mail
                <input
                  type="email"
                  value={email}
                  disabled={!isCreate}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none disabled:bg-slate-100 disabled:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                {isCreate ? "Senha" : "Nova senha"}
                <input
                  type="password"
                  value={password}
                  minLength={8}
                  placeholder={isCreate ? "Minimo 8 caracteres" : "Manter atual"}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </label>

              <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
                <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Perfil
                  <select
                    value={role}
                    disabled={isSelf}
                    onChange={(event) => replaceRole(normalizeTeamRole(event.target.value))}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none disabled:bg-slate-100 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="member">{ROLE_LABELS.member}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                    <option value="super_master">{ROLE_LABELS.super_master}</option>
                  </select>
                </label>

                <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Prioridade
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={priorityLevel}
                    onChange={(event) => setPriorityLevel(Number(event.target.value))}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  />
                </label>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">Usuario ativo</span>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={isSelf}
                  onChange={(event) => setActive(event.target.checked)}
                  className="size-4 rounded border-slate-300 text-cyan-600"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">Somente Instituto UP</span>
                <input
                  type="checkbox"
                  checked={institutoUpOnly}
                  onChange={(event) => replaceInstitutoOnly(event.target.checked)}
                  className="size-4 rounded border-slate-300 text-cyan-600"
                />
              </label>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving || roleIsSuper}
                  onClick={() => setPermissions(ALL_PERMISSION_KEYS)}
                  className="h-9 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  disabled={saving || roleIsSuper}
                  onClick={() => setPermissions([])}
                  className="h-9 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  disabled={saving || roleIsSuper}
                  onClick={restoreRoleDefault}
                  className="col-span-2 h-9 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Padrao do perfil
                </button>
              </div>
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            <div className="grid gap-4">
              {PERMISSION_GROUPS.map((group) => {
                const groupKeys = group.permissions.map((permission) => permission.key);
                const checkedCount = groupKeys.filter((key) => effectiveSet.has(key)).length;
                const allChecked = checkedCount === groupKeys.length;
                const noneChecked = checkedCount === 0;

                return (
                  <section key={group.key} className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-slate-950">{group.label}</h3>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">{group.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                          {checkedCount}/{groupKeys.length}
                        </span>
                        <button
                          type="button"
                          disabled={saving || roleIsSuper || allChecked}
                          onClick={() => setGroupPermissions(groupKeys, true)}
                          className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Grupo
                        </button>
                        <button
                          type="button"
                          disabled={saving || roleIsSuper || noneChecked}
                          onClick={() => setGroupPermissions(groupKeys, false)}
                          className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Limpar
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 p-3 md:grid-cols-2">
                      {group.permissions.map((permission) => {
                        const checked = effectiveSet.has(permission.key);
                        const Icon = checked ? CheckSquare : Square;
                        return (
                          <button
                            key={permission.key}
                            type="button"
                            disabled={saving || roleIsSuper}
                            onClick={() => togglePermission(permission.key)}
                            className={cn(
                              "grid min-h-16 grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2 text-left transition disabled:cursor-default",
                              checked
                                ? "border-cyan-200 bg-cyan-50/70 text-slate-950"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                              roleIsSuper ? "opacity-80" : ""
                            )}
                          >
                            <Icon className={checked ? "mt-0.5 text-cyan-600" : "mt-0.5 text-slate-400"} size={18} />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold">{permission.label}</span>
                              <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                {permission.description}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </main>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-sm font-semibold text-rose-600">{error}</div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || !name.trim() || !email.trim() || (isCreate && password.length < 8)}
              onClick={submit}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? "Salvando..." : "Salvar usuario"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function UserAdminClient({
  initialMembers,
  currentUserId,
}: UserAdminClientProps) {
  const [members, setMembers] = useState(initialMembers);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<AdminTeamMember | null>(null);

  const filteredMembers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return members;
    return members.filter((member) =>
      [member.name, member.email, ROLE_LABELS[member.role]]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [members, query]);

  function upsertMember(member: AdminTeamMember) {
    setMembers((current) => {
      const exists = current.some((item) => item.id === member.id);
      const next = exists
        ? current.map((item) => (item.id === member.id ? member : item))
        : [...current, member];
      return next.sort((a, b) => b.priorityLevel - a.priorityLevel || a.name.localeCompare(b.name));
    });
  }

  function removeMember(memberId: number) {
    setMembers((current) => current.filter((member) => member.id !== memberId));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-600">
              Administracao
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Usuarios e permissoes</h1>
          </div>
          <button
            type="button"
            onClick={() => setDialog({ mode: "create" })}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"
          >
            <Plus size={16} />
            Novo usuario
          </button>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar usuario"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <ShieldCheck size={16} className="text-cyan-600" />
              {members.length} perfis
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Usuario</th>
                  <th className="px-4 py-3 text-left">Perfil</th>
                  <th className="px-4 py-3 text-left">Prioridade</th>
                  <th className="px-4 py-3 text-left">Permissoes</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="grid size-10 place-content-center rounded-lg bg-cyan-50 text-sm font-black text-cyan-700 ring-1 ring-cyan-100">
                          {(member.name || member.email).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-950">{member.name}</p>
                          <p className="truncate text-xs font-medium text-slate-500">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-md px-2 py-1 text-xs font-black ring-1", roleTone(member.role))}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-black text-slate-800">{member.priorityLevel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                        {member.role === "super_master" ? "Todas" : member.permissions.length}
                      </span>
                      {member.institutoUpOnly ? (
                        <span className="ml-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">
                          Instituto UP
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-black",
                          member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {member.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDialog({ mode: "edit", member })}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-white"
                        >
                          <UserCog size={15} />
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={member.id === currentUserId}
                          onClick={() => setMemberToDelete(member)}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                          title={member.id === currentUserId ? "Voce nao pode excluir seu proprio usuario" : "Excluir usuario"}
                        >
                          <Trash2 size={15} />
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                      Nenhum usuario encontrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <ShieldCheck className="text-cyan-600" size={18} />
            <p className="mt-2 text-sm font-black text-slate-950">Super master</p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {members.filter((member) => member.role === "super_master").length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <KeyRound className="text-violet-600" size={18} />
            <p className="mt-2 text-sm font-black text-slate-950">Administradores</p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {members.filter((member) => member.role === "admin").length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <UserCog className="text-slate-600" size={18} />
            <p className="mt-2 text-sm font-black text-slate-950">Usuarios ativos</p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {members.filter((member) => member.active).length}
            </p>
          </div>
        </section>
      </div>

      {dialog ? (
        <PermissionDialog
          state={dialog}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
          onSaved={upsertMember}
        />
      ) : null}
      {memberToDelete ? (
        <DeleteUserDialog
          member={memberToDelete}
          onClose={() => setMemberToDelete(null)}
          onDeleted={removeMember}
        />
      ) : null}
    </main>
  );
}
