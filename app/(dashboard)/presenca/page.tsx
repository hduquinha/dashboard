import type { Metadata } from "next";
import PresenceValidationForm from "./PresenceValidationForm";

export const metadata: Metadata = {
  title: "Validar Presença | Painel",
  description: "Valide a presença dos participantes nos encontros do Zoom e associe às inscrições.",
};

export default function PresencaPage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
              Validação
            </p>
            <h1 className="text-2xl font-semibold text-neutral-900">Presença nos encontros</h1>
            <p className="text-sm text-neutral-600">
              Importe o relatório de participantes do Zoom, configure os horários da dinâmica e 
              valide quem cumpriu os requisitos mínimos de presença.
            </p>
          </div>
        </header>

        <PresenceValidationForm />
      </div>
    </main>
  );
}
