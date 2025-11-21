'use client';

import { useEffect } from 'react';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error('Dashboard page error', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">Algo deu errado</h1>
        <p className="text-sm text-neutral-600">
          Tivemos um problema ao carregar as inscrições. Tente novamente em instantes.
        </p>
        <button
          type="button"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
          onClick={reset}
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
