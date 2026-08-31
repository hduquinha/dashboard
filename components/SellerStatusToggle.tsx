"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Botão de disponibilidade do vendedor, no topo do Kanban dele.
 *
 * É declaração explícita, não presença automática: nada marca alguém como
 * online só por ter a aba aberta. Quem sabe se pode receber lead agora é a
 * pessoa — e é essa informação que aparece para quem distribui, na Chegada
 * de Leads.
 */
export function SellerStatusToggle() {
  const [status, setStatus] = useState<"online" | "offline" | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/commercial/seller-status");
      const data = (await response.json().catch(() => ({}))) as {
        mine?: { status: string };
      };
      setStatus(data.mine?.status === "online" ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    const next = status === "online" ? "offline" : "online";
    setSaving(true);
    // Otimista: o botão responde na hora e volta atrás se o servidor recusar.
    setStatus(next);
    try {
      const response = await fetch("/api/commercial/seller-status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error("falhou");
    } catch {
      setStatus(next === "online" ? "offline" : "online");
    } finally {
      setSaving(false);
    }
  }

  if (status === null) return null;

  const online = status === "online";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      title={
        online
          ? "Você aparece como disponível para receber leads. Clique para ficar indisponível."
          : "Você aparece como indisponível na Chegada de Leads. Clique para ficar disponível."
      }
      aria-pressed={online}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition ${
        online
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-[rgb(var(--border-strong))] bg-white text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
      }`}
    >
      {saving ? (
        <RefreshCw className="h-3 w-3 animate-spin" />
      ) : (
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-[rgb(var(--slate-8))]"}`}
        />
      )}
      {online ? "Disponível" : "Indisponível"}
    </button>
  );
}
