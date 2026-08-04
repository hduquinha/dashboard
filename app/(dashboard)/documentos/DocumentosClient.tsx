"use client";

import { useState } from "react";
import Image from "next/image";
import {
  CalendarClock,
  Check,
  Download,
  FileText,
  Gift,
  MapPin,
  Printer,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { CONSULTING_PERIODS } from "@/lib/exclusiveClassDocumentConfig";

const MAX_COPIES = 50;
const DOCUMENT_FEATURES = [
  { icon: Check, label: "Identificação somente com nome" },
  { icon: CalendarClock, label: "Período: manhã, tarde ou noite" },
  { icon: UsersRound, label: "Cinco linhas para indicações" },
  { icon: ShieldCheck, label: "Aviso de privacidade incluído" },
] as const;

function PreviewLine({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[5px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <div className="mt-1 h-px bg-slate-300" />
    </div>
  );
}

export default function DocumentosClient() {
  const [copies, setCopies] = useState(1);
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");

  const params = new URLSearchParams({ copias: String(copies) });
  if (eventDate) params.set("data", eventDate);
  if (location.trim()) params.set("local", location.trim());
  const downloadHref = `/api/documentos/aula-exclusiva?${params.toString()}`;

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <header className="overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#041a30_0%,#073657_68%,#075a78_100%)] px-5 py-6 text-white shadow-[0_22px_55px_rgba(2,19,37,0.18)] sm:px-7 lg:px-9 lg:py-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100">
              <FileText size={14} />
              Central de documentos
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              Documentos prontos para usar
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              Configure, visualize e baixe fichas profissionais da VozUP em PDF para impressão.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm sm:flex">
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
              <p className="text-xs font-semibold text-cyan-100/75">Modelo disponível</p>
              <p className="mt-1 font-black text-white">Aula Exclusiva</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
              <p className="text-xs font-semibold text-cyan-100/75">Formato</p>
              <p className="mt-1 font-black text-white">A4 · PDF</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,0.88fr)_minmax(520px,1.12fr)]">
        <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-[var(--dashboard-card-shadow)] sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-[#0086b8]">
              <Printer size={23} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0086b8]">
                Modelo 01
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                Lista da Aula Exclusiva
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Uma ficha por participante, reunindo presença, consultoria e indicações.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {DOCUMENT_FEATURES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700"
              >
                <Icon size={17} className="shrink-0 text-[#0086b8]" />
                {label}
              </div>
            ))}
          </div>

          <div className="my-6 h-px bg-slate-200" />

          <div className="grid gap-5">
            <div>
              <label htmlFor="document-date" className="text-sm font-bold text-slate-800">
                Data da aula <span className="font-medium text-slate-400">(opcional)</span>
              </label>
              <div className="relative mt-2">
                <CalendarClock
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="document-date"
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#08a9d8] focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="document-location" className="text-sm font-bold text-slate-800">
                Unidade ou local <span className="font-medium text-slate-400">(opcional)</span>
              </label>
              <div className="relative mt-2">
                <MapPin
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="document-location"
                  type="text"
                  maxLength={70}
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Ex.: Unidade Centro"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#08a9d8] focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="document-copies" className="text-sm font-bold text-slate-800">
                Quantidade de fichas
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Cada participante recebe uma página para preencher.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="document-copies"
                  type="number"
                  min={1}
                  max={MAX_COPIES}
                  value={copies}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setCopies(Number.isFinite(parsed) ? Math.min(MAX_COPIES, Math.max(1, parsed)) : 1);
                  }}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-[#08a9d8] focus:ring-4 focus:ring-cyan-100"
                />
                <span className="rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold text-slate-600">
                  {copies} {copies === 1 ? "página" : "páginas"}
                </span>
              </div>
            </div>
          </div>

          <a
            href={downloadHref}
            download
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0086b8] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,134,184,0.22)] transition hover:bg-[#006f99] focus:outline-none focus:ring-4 focus:ring-cyan-200"
          >
            <Download size={18} />
            Gerar e baixar PDF
          </a>
          <p className="mt-3 text-center text-xs leading-5 text-slate-400">
            O arquivo é gerado na hora e não salva os dados dos participantes.
          </p>
        </section>

        <section
          aria-label="Pré-visualização do documento"
          className="rounded-[22px] border border-slate-200 bg-[#e9eff5] p-3 shadow-[var(--dashboard-card-shadow)] sm:p-5 lg:p-7"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Pré-visualização
              </p>
              <p className="mt-1 text-sm font-bold text-slate-800">Frente da ficha A4</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm">
              1 pessoa por página
            </span>
          </div>

          <div className="mx-auto aspect-[210/297] w-full max-w-[620px] overflow-hidden rounded-sm bg-white p-[5.5%] text-slate-800 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
            <div className="rounded-lg bg-[#061d33] p-[4%] text-white">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Image
                    src="/vozup-logo-dark.svg"
                    alt="VozUP"
                    width={96}
                    height={32}
                    className="mt-1 h-auto w-[74px] shrink-0"
                  />
                  <div>
                    <p className="text-[5px] font-bold tracking-[0.15em] text-cyan-100">
                      AULA EXCLUSIVA
                    </p>
                    <p className="mt-1 text-[9px] font-black leading-tight">
                      Presença, consultoria e indicações
                    </p>
                  </div>
                </div>
                <div className="text-right text-[5px] leading-3 text-slate-300">
                  <p className="font-bold">DATA DA AULA</p>
                  <p className="text-[7px] font-bold text-white">
                    {eventDate ? eventDate.split("-").reverse().join("/") : "____/____/________"}
                  </p>
                  <p className="mt-1 font-bold">UNIDADE / LOCAL</p>
                  <p className="max-w-[110px] truncate text-[6px] text-white">
                    {location || "________________"}
                  </p>
                </div>
              </div>
            </div>

            <p className="my-[2.5%] text-center text-[5px] text-slate-500">
              Preencha uma ficha por participante e marque o período.
            </p>

            <div className="grid gap-[2.4%]">
              <div>
                <div className="rounded bg-cyan-50 px-2 py-1 text-[6px] font-black uppercase text-[#075a78]">
                  1 · Identificação e presença
                </div>
                <div className="mt-1 rounded border border-slate-200 p-2">
                  <PreviewLine label="Nome completo" />
                </div>
              </div>

              <div>
                <div className="rounded bg-cyan-50 px-2 py-1 text-[6px] font-black uppercase text-[#075a78]">
                  2 · Agendamento da consultoria
                </div>
                <div className="mt-1 grid grid-cols-[42%_1fr] gap-2 rounded border border-slate-200 p-2">
                  <div>
                    <p className="text-[5px] font-bold uppercase tracking-[0.08em] text-slate-400">
                      Data da consultoria
                    </p>
                    <div className="mt-1 flex items-end gap-[3px] text-[5px] text-slate-400">
                      <span className="h-px w-[22%] bg-slate-300" />/
                      <span className="h-px w-[22%] bg-slate-300" />/
                      <span className="h-px w-[32%] bg-slate-300" />
                    </div>
                  </div>
                  <div>
                    <p className="text-[5px] font-bold uppercase text-slate-500">
                      Marque o período de preferência
                    </p>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {CONSULTING_PERIODS.map((period) => (
                        <span
                          key={period}
                          className="flex items-center justify-center gap-[3px] rounded-sm border border-slate-200 bg-slate-50 py-[3px] text-[5px] font-bold text-slate-700"
                        >
                          <span className="inline-block h-[4px] w-[4px] rounded-[1px] border border-slate-400 bg-white" />
                          {period}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between rounded bg-cyan-50 px-2 py-1 text-[6px] font-black uppercase text-[#075a78]">
                  <span>3 · Indicações para o presente</span>
                  <Gift size={8} />
                </div>
                <div className="mt-1 overflow-hidden rounded border border-slate-300">
                  <div className="grid grid-cols-[1fr_0.75fr_1.1fr] bg-[#061d33] px-2 py-1 text-[5px] font-bold text-white">
                    <span>Nome</span>
                    <span>Telefone</span>
                    <span>Vínculo</span>
                  </div>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div
                      key={index}
                      className="grid h-[18px] grid-cols-[1fr_0.75fr_1.1fr] border-t border-slate-200 px-2 py-1 text-[4px] text-slate-400"
                    >
                      <span />
                      <span />
                      <span>□ Amigo □ Parente □ Colega □ Outro</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-[2.4%] rounded border border-slate-200 bg-slate-50 p-2 text-[4.5px] leading-tight text-slate-500">
              □ Confirmo que avisei ou tenho autorização para compartilhar os contatos indicados.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
