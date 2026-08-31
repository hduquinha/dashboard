"use client";

import { useState } from "react";
import { CalendarPlus, Check, DoorOpen, Pencil, Trash2, X } from "lucide-react";
import { Field, formatDateBR, inputClass } from "./TurmasUI";
import type { AcademicCalendarDay, AcademicRoom } from "@/types/academic";

/**
 * Salas e calendário institucional — o cadastro de apoio da grade.
 *
 * Sala se DESATIVA por padrão em vez de se excluir: ela aparece em turmas antigas e
 * apagar levaria junto a evidência de onde a aula aconteceu. A exclusão só passa
 * quando ninguém referencia a sala, e o próprio servidor recusa o resto.
 */
export function AcademicSettingsPanel({
  rooms,
  calendarDays,
  canManage,
  onRoomsChanged,
  onCalendarChanged,
}: {
  rooms: AcademicRoom[];
  calendarDays: AcademicCalendarDay[];
  canManage: boolean;
  onRoomsChanged: (rooms: AcademicRoom[]) => void;
  onCalendarChanged: (days: AcademicCalendarDay[]) => void;
}) {
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [editingRoom, setEditingRoom] = useState<AcademicRoom | null>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [day, setDay] = useState("");
  const [dayKind, setDayKind] = useState<AcademicCalendarDay["kind"]>("feriado");
  const [dayScope, setDayScope] = useState<AcademicCalendarDay["scope"]>("ambos");
  const [dayLabel, setDayLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Quantos feriados a última importação acrescentou — some ao recarregar.
  const [imported, setImported] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function roomRequest(endpoint: string, init: RequestInit, fallback: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? fallback);
      if (Array.isArray(data.rooms)) {
        onRoomsChanged(data.rooms);
      } else {
        const refreshed = await fetch("/api/academic/rooms");
        const refreshedData = await refreshed.json().catch(() => ({}));
        if (refreshed.ok) onRoomsChanged(refreshedData.rooms ?? []);
      }
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fallback);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createNewRoom() {
    if (!roomName.trim()) return;
    const ok = await roomRequest(
      "/api/academic/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, capacity: roomCapacity || null }),
      },
      "Falha ao cadastrar sala."
    );
    if (ok) {
      setRoomName("");
      setRoomCapacity("");
    }
  }

  async function saveCalendarDay() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/academic/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, kind: dayKind, scope: dayScope, label: dayLabel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar calendário.");
      onCalendarChanged(data.days ?? []);
      setDay("");
      setDayLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar calendário.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Traz os feriados do ano corrente e do seguinte. As datas são calculadas no
   * servidor (`lib/holidays.ts`), sem consultar serviço nenhum — e o que já
   * estiver cadastrado à mão não é tocado.
   */
  async function importHolidays() {
    setSaving(true);
    setError(null);
    try {
      const atual = new Date().getFullYear();
      const response = await fetch("/api/academic/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ years: [atual, atual + 1] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao importar feriados.");
      onCalendarChanged(data.days ?? []);
      setImported(Number(data.imported ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao importar feriados.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCalendarDay(item: AcademicCalendarDay) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/academic/calendar?day=${encodeURIComponent(item.day)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao remover data.");
      onCalendarChanged(data.days ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover data.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-[rgb(var(--slate-12))]">
          <DoorOpen className="h-3.5 w-3.5 text-[rgb(var(--slate-9))]" /> Salas e espaços
        </p>
        <p className="mt-0.5 text-[11px] text-[rgb(var(--slate-9))]">
          A sala padrão da turma pode ser sobrescrita em cada horário da grade. Sala ocupada no mesmo
          horário por outra turma é recusada no salvamento.
        </p>

        {canManage && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Nome da sala">
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Capacidade">
              <input
                type="number"
                min={1}
                value={roomCapacity}
                onChange={(event) => setRoomCapacity(event.target.value)}
                className={`${inputClass} w-28`}
              />
            </Field>
            <button
              type="button"
              disabled={saving || !roomName.trim()}
              onClick={() => void createNewRoom()}
              className="h-9 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              Adicionar sala
            </button>
          </div>
        )}

        <ul className="mt-3 divide-y divide-[rgb(var(--border-weak))]">
          {rooms.length === 0 ? (
            <li className="py-2 text-xs text-[rgb(var(--slate-9))]">Nenhuma sala cadastrada.</li>
          ) : (
            rooms.map((room) =>
              editingRoom?.id === room.id ? (
                <li key={room.id} className="flex flex-wrap items-center gap-1.5 py-2">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className={`${inputClass} w-40`}
                  />
                  <input
                    type="number"
                    min={1}
                    value={editCapacity}
                    onChange={(event) => setEditCapacity(event.target.value)}
                    placeholder="cap."
                    className={`${inputClass} w-20`}
                  />
                  <button
                    type="button"
                    disabled={saving || !editName.trim()}
                    onClick={async () => {
                      const ok = await roomRequest(
                        `/api/academic/rooms/${room.id}`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: editName, capacity: editCapacity || null }),
                        },
                        "Falha ao atualizar a sala."
                      );
                      if (ok) setEditingRoom(null);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-md bg-neutral-900 text-white disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingRoom(null)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ) : (
                <li key={room.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-xs text-[rgb(var(--slate-11))]">
                    <strong className="text-[rgb(var(--slate-12))]">{room.name}</strong>
                    {room.capacity ? ` · ${room.capacity} pessoas` : " · sem capacidade definida"}
                    {room.active ? "" : " · inativa"}
                  </span>
                  {canManage && (
                    <span className="flex flex-none items-center gap-1">
                      <button
                        type="button"
                        title="Renomear ou mudar a capacidade"
                        onClick={() => {
                          setEditingRoom(room);
                          setEditName(room.name);
                          setEditCapacity(room.capacity ? String(room.capacity) : "");
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        title={room.active ? "Desativar (some das listas, histórico fica)" : "Reativar"}
                        onClick={() =>
                          void roomRequest(
                            `/api/academic/rooms/${room.id}`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                name: room.name,
                                capacity: room.capacity,
                                active: !room.active,
                              }),
                            },
                            "Falha ao atualizar a sala."
                          )
                        }
                        className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-[10px] font-semibold text-[rgb(var(--slate-11))] disabled:opacity-40"
                      >
                        {room.active ? "Desativar" : "Reativar"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        title="Excluir a sala (só quando nenhuma turma a usa)"
                        onClick={() => {
                          if (!window.confirm(`Excluir a sala ${room.name}?`)) return;
                          void roomRequest(
                            `/api/academic/rooms/${room.id}`,
                            { method: "DELETE" },
                            "Falha ao excluir a sala."
                          );
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md border border-rose-200 text-rose-600 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </li>
              )
            )
          )}
        </ul>
      </div>

      <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
        <p className="text-xs font-bold text-[rgb(var(--slate-12))]">Calendário institucional</p>
        <p className="mt-0.5 text-[11px] text-[rgb(var(--slate-9))]">
          O escopo didático tira o dia da projeção de aulas da turma; o financeiro empurra vencimentos.
        </p>
        {canManage && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void importHolidays()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-[11px] font-semibold text-[rgb(var(--slate-11))] disabled:opacity-50"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Importar feriados de {new Date().getFullYear()} e {new Date().getFullYear() + 1}
            </button>
            {imported !== null && (
              <span className="text-[11px] text-[rgb(var(--slate-9))]">
                {imported === 0
                  ? "Nada novo: os feriados já estavam no calendário."
                  : `${imported} feriado(s) adicionados.`}
              </span>
            )}
          </div>
        )}
        {canManage && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={inputClass} />
            <input
              value={dayLabel}
              onChange={(event) => setDayLabel(event.target.value)}
              placeholder="Ex.: Aniversário de São Paulo"
              className={inputClass}
            />
            <select
              value={dayKind}
              onChange={(event) => setDayKind(event.target.value as AcademicCalendarDay["kind"])}
              className={inputClass}
            >
              <option value="feriado">Feriado</option>
              <option value="recesso">Recesso</option>
              <option value="letivo_extra">Dia letivo extra</option>
            </select>
            <div className="flex gap-2">
              <select
                value={dayScope}
                onChange={(event) => setDayScope(event.target.value as AcademicCalendarDay["scope"])}
                className={inputClass}
              >
                <option value="ambos">Didático e financeiro</option>
                <option value="didatico">Só didático</option>
                <option value="financeiro">Só financeiro</option>
              </select>
              <button
                type="button"
                disabled={saving || !day}
                onClick={() => void saveCalendarDay()}
                className="h-9 flex-none rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        )}
        <ul className="mt-3 max-h-56 divide-y divide-[rgb(var(--border-weak))] overflow-y-auto">
          {calendarDays.length === 0 ? (
            <li className="py-2 text-xs text-[rgb(var(--slate-9))]">Nenhuma exceção cadastrada.</li>
          ) : (
            calendarDays.map((item) => (
              <li key={item.day} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="text-[rgb(var(--slate-11))]">
                  <strong className="text-[rgb(var(--slate-12))]">{formatDateBR(item.day)}</strong> ·{" "}
                  {item.label || item.kind.replace("_", " ")} · {item.scope}
                </span>
                {canManage && (
                  <button
                    type="button"
                    title="Remover do calendário"
                    disabled={saving}
                    onClick={() => void removeCalendarDay(item)}
                    className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
        {error && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}
      </div>
    </section>
  );
}
