import type { Metadata } from "next";
import Link from "next/link";
import PresenceValidationForm from "./PresenceValidationForm";
import { CheckCircle, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Validar Presença | Painel",
  description: "Importe o CSV do Zoom, revise participantes, associe a inscrições e confirme.",
};

interface PresencaPageProps {
  searchParams: Promise<{ treinamento?: string }>;
}

export default async function PresencaPage({ searchParams }: PresencaPageProps) {
  const params = await searchParams;
  const treinamento = params.treinamento ?? "";
  const confirmadosHref = treinamento
    ? `/presenca/confirmados?treinamento=${encodeURIComponent(treinamento)}`
    : "/presenca/confirmados";

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
                Validação de Presença
              </p>
              <h1 className="text-2xl font-semibold text-neutral-900">Presença nos Encontros</h1>
              <p className="text-sm text-neutral-600">
                Importe o CSV do Zoom, remova participantes que não devem estar na lista (equipe, hosts), 
                associe cada participante a uma inscrição e confirme as presenças.
              </p>
            </div>
            <Link
              href={confirmadosHref}
              className="flex items-center gap-2 rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-200"
            >
              <CheckCircle className="h-4 w-4" />
              Ver Confirmados
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <PresenceValidationForm initialTrainingId={treinamento} />
      </div>
    </main>
  );
}
