import type { Metadata } from "next";
import DashboardNav from "@/components/DashboardNav";
import { listDuplicateSuspects } from "@/lib/db";
import ImportForm from "./ImportForm";

export const metadata: Metadata = {
  title: "Importar inscrições | Painel",
  description: "Faça upload das planilhas e valide os dados antes de importar para o CRM.",
};

export default async function ImportarPage() {
  const duplicateSummary = await listDuplicateSuspects({ maxGroups: 1 });

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="space-y-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-neutral-900">Importar planilha</h1>
            <p className="text-sm text-neutral-600">
              Pré-visualize o lote e bloqueie duplicados antes de enviar as inscrições para o banco.
            </p>
          </div>
          <DashboardNav duplicateCount={duplicateSummary.totalGroups} />
        </header>

        <ImportForm />
      </div>
    </main>
  );
}
