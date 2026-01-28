"use client";

import { useState } from "react";
import type { AnamneseResposta } from "@/lib/anamnese";
import type { Recruiter } from "@/lib/recruiters";
import { ChevronDown, ChevronUp, Link as LinkIcon } from "lucide-react";

interface AnamneseListProps {
  initialAnamneses: AnamneseResposta[];
  recruiters: Recruiter[];
}

export default function AnamneseList({ initialAnamneses, recruiters }: AnamneseListProps) {
  const [anamneses, setAnamneses] = useState<AnamneseResposta[]>(initialAnamneses);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedRecruiter, setSelectedRecruiter] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<number | null>(null);

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleRecruiterChange = (anamneseId: number, code: string) => {
    setSelectedRecruiter(prev => ({ ...prev, [anamneseId]: code }));
  };

  const handleLink = async (anamneseId: number) => {
    const code = selectedRecruiter[anamneseId];
    if (!code) return;

    setIsSubmitting(anamneseId);
    try {
      const response = await fetch('/api/anamnese/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anamneseId, recruiterCode: code }),
      });

      if (!response.ok) {
        throw new Error('Failed to link');
      }

      // Remove from list
      setAnamneses(prev => prev.filter(a => a.id !== anamneseId));
    } catch (error) {
      console.error(error);
      alert("Erro ao vincular anamnese.");
    } finally {
      setIsSubmitting(null);
    }
  };

  if (anamneses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white p-12 text-center">
        <div className="mb-4 rounded-full bg-neutral-100 p-4">
          <LinkIcon className="h-8 w-8 text-neutral-400" />
        </div>
        <h3 className="text-lg font-semibold text-neutral-900">Tudo limpo!</h3>
        <p className="text-neutral-500">Não há respostas de anamnese pendentes de vínculo.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {anamneses.map((item) => (
        <div key={item.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-all hover:shadow-md">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex-1 cursor-pointer" onClick={() => toggleExpand(item.id)}>
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-neutral-900">{item.nome || "Sem nome"}</h3>
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                  ID #{item.id}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-500">
                <span>{item.cidade || "Cidade não informada"}</span>
                <span>•</span>
                <span>{item.telefone || "Sem telefone"}</span>
                <span>•</span>
                <span>{item.data_envio ? new Date(item.data_envio).toLocaleDateString() : "Data desconhecida"}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-700 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                value={selectedRecruiter[item.id] || ""}
                onChange={(e) => handleRecruiterChange(item.id, e.target.value)}
                disabled={isSubmitting === item.id}
              >
                <option value="" disabled>Selecione um recrutador...</option>
                {recruiters.map(rec => (
                  <option key={rec.code} value={rec.code}>
                    {rec.code} - {rec.name}
                  </option>
                ))}
              </select>
              
              <button
                onClick={() => handleLink(item.id)}
                disabled={!selectedRecruiter[item.id] || isSubmitting === item.id}
                className="flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting === item.id ? "Vinculando..." : "Vincular"}
              </button>

              <button 
                onClick={() => toggleExpand(item.id)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
              >
                {expandedId === item.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          </div>

          {expandedId === item.id && (
            <div className="border-t border-neutral-100 bg-neutral-50/50 p-5">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <DetailItem label="Momento Atual" value={item.momento_atual} />
                <DetailItem label="Maior Dificuldade" value={item.dificuldade_barreira} />
                <DetailItem label="Maior Medo" value={item.maior_medo} />
                <DetailItem label="Tempo Disponível" value={item.tempo_disponivel} />
                <DetailItem label="Visão do Instituto" value={item.visao_instituto} />
                <DetailItem label="Visão de Futuro" value={item.visao_futuro} />
                <DetailItem label="Contribuição" value={item.contribuicao} />
                <DetailItem label="Sonhos e Objetivos" value={item.sonhos_objetivos} />
                <DetailItem label="O que falta" value={item.o_que_falta} />
                <DetailItem label="Como podemos ajudar" value={item.como_ajudar} />
                <DetailItem label="Renda Necessária" value={item.renda_necessaria} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DetailItem({ label, value }: { label: string, value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <p className="text-sm text-neutral-800">{value}</p>
    </div>
  );
}
