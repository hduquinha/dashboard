"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/encontroChat";
import { isLeadMatch } from "@/lib/encontroChatUtils";

interface EncontroChatViewProps {
  dataEncontro: string;
  leadNome: string | null;
}

export function EncontroChatView({ dataEncontro, leadNome }: EncontroChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setMessages(null);
    setError(null);
    setShowAll(false);

    fetch(`/api/encontro-online/chat?data=${encodeURIComponent(dataEncontro)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setMessages(json.messages);
        else setError(json.error ?? "Erro ao carregar chat");
      })
      .catch(() => setError("Erro ao carregar chat"));
  }, [dataEncontro]);

  if (error) {
    return <p className="py-2 text-xs text-red-500">{error}</p>;
  }

  if (messages === null) {
    return (
      <div className="flex justify-center py-4">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-500" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="py-2 text-xs text-neutral-400">
        Nenhum chat importado para {dataEncontro}.
      </p>
    );
  }

  const leadMessages = leadNome
    ? messages.filter((m) => isLeadMatch(leadNome, m.nome))
    : [];

  const displayed = showAll ? messages : (leadMessages.length > 0 ? messages : messages);

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-neutral-400">
          {messages.length} mensagens
          {leadMessages.length > 0 && ` · ${leadMessages.length} deste participante`}
        </p>
        {leadMessages.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] font-semibold text-blue-600 hover:underline"
          >
            {showAll ? "Ver só deste participante" : "Ver chat completo"}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-100 bg-neutral-50">
        {(showAll || leadMessages.length === 0 ? messages : leadMessages).map((m, i) => {
          const isLead = leadNome ? isLeadMatch(leadNome, m.nome) : false;
          return (
            <div
              key={i}
              className={`flex gap-2 border-b border-neutral-100 px-3 py-1.5 last:border-0 ${
                isLead ? "bg-blue-50" : ""
              }`}
            >
              <span className="w-10 shrink-0 text-[10px] text-neutral-400">{m.horario}</span>
              <span
                className={`w-28 shrink-0 truncate text-[10px] font-semibold ${
                  isLead ? "text-blue-700" : "text-neutral-600"
                }`}
                title={m.nome}
              >
                {m.nome}
              </span>
              <span className="min-w-0 break-words text-[10px] text-neutral-800">{m.mensagem}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
