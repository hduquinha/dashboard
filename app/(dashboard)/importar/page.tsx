import type { Metadata } from "next";
import ImportForm from "./ImportForm";
import { previewImportAction } from "./actions";

export const metadata: Metadata = {
  title: "Importar inscrições | Painel",
  description: "Faça upload das planilhas e valide os dados antes de importar para o CRM.",
};

export default function ImportarPage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Importar</p>
            <h1 className="text-2xl font-semibold text-neutral-900">Importar planilha</h1>
            <p className="text-sm text-neutral-600">
              Pré-visualize o lote e bloqueie duplicados antes de enviar as inscrições para o banco.
            </p>
          </div>
        </header>

        <ImportForm action={previewImportAction} />
      </div>
    </main>
  );
}
