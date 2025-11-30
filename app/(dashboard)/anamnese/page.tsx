import type { Metadata } from "next";
import { listUnlinkedAnamneses } from "@/lib/anamnese";
import { listRecruiters } from "@/lib/recruiters";
import AnamneseList from "@/components/AnamneseList";

export const metadata: Metadata = {
  title: "Anamnese | Painel de Inscrições",
  description: "Vincule as respostas da anamnese aos recrutadores responsáveis.",
};

export const dynamic = "force-dynamic";

export default async function AnamnesePage() {
  const [anamneses, recruiters] = await Promise.all([
    listUnlinkedAnamneses(),
    Promise.resolve(listRecruiters()),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Anamnese</h1>
          <p className="text-sm text-neutral-500">Gerencie e vincule as respostas do formulário de anamnese.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
          <span className="flex h-2 w-2 rounded-full bg-blue-500"></span>
          {anamneses.length} pendentes
        </div>
      </header>

      <AnamneseList initialAnamneses={anamneses} recruiters={recruiters} />
    </main>
  );
}
