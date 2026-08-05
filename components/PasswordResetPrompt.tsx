"use client";

import { useState } from "react";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

export default function PasswordResetPrompt({ name }: { name: string }) {
  const [mode, setMode] = useState<"choice" | "reset">("choice");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  async function continueWithCurrentPassword() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/account/password-reset-prompt", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível registrar sua escolha.");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar sua escolha.");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível alterar a senha.");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Redefinir senha">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-950/30">
        <div className="bg-[linear-gradient(135deg,#061b34,#0b5470)] px-7 py-7 text-white">
          <div className="grid size-11 place-content-center rounded-2xl bg-white/10 ring-1 ring-white/20"><ShieldCheck size={23} className="text-cyan-200" /></div>
          <h2 className="mt-5 text-xl font-black tracking-tight">Proteja o seu acesso</h2>
          <p className="mt-1 text-sm leading-6 text-cyan-50/80">Olá, {name.split(" ")[0] || "pessoa"}. Esta é uma conferência única da sua senha.</p>
        </div>

        {mode === "choice" ? (
          <div className="p-7">
            <p className="text-base font-bold text-slate-900">Você gostaria de redefinir sua senha?</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">Se preferir, continue com a senha atual. Não mostraremos este aviso novamente.</p>
            {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setMode("reset")} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"><KeyRound size={16} />Redefinir agora</button>
              <button type="button" onClick={continueWithCurrentPassword} disabled={saving} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : "Manter senha atual"}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void resetPassword(); }} className="space-y-4 p-7">
            <div><p className="text-base font-bold text-slate-900">Defina uma nova senha</p><p className="mt-1 text-sm text-slate-500">Use ao menos 8 caracteres.</p></div>
            <label className="block text-sm font-bold text-slate-700">Nova senha<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>
            <label className="block text-sm font-bold text-slate-700">Confirmar nova senha<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>
            {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
            <div className="flex gap-3 pt-2"><button type="button" onClick={() => { setMode("choice"); setError(null); }} disabled={saving} className="h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Voltar</button><button disabled={saving} className="ml-auto inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}Salvar nova senha</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
