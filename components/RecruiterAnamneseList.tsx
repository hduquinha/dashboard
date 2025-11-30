import type { AnamneseResposta } from "@/lib/anamnese";

interface RecruiterAnamneseListProps {
  anamneses: AnamneseResposta[];
}

export default function RecruiterAnamneseList({ anamneses }: RecruiterAnamneseListProps) {
  if (anamneses.length === 0) {
    return null;
  }

  return (
    <section className="border-t border-neutral-200 bg-white px-6 py-8">
      <h2 className="mb-6 text-lg font-semibold text-neutral-900">Anamneses Vinculadas</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {anamneses.map((item) => (
          <div key={item.id} className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-sm">
            <header>
              <h3 className="font-bold text-neutral-900">{item.nome}</h3>
              <p className="text-sm text-neutral-500">{item.cidade} • {item.telefone}</p>
              <p className="mt-1 text-xs text-neutral-400">
                Enviado em: {item.data_envio ? new Date(item.data_envio).toLocaleDateString() : '-'}
              </p>
            </header>
            
            <div className="space-y-3 text-sm text-neutral-700">
              <div>
                <span className="font-semibold text-neutral-900">Momento Atual:</span>
                <p className="mt-0.5">{item.momento_atual}</p>
              </div>
              <div>
                <span className="font-semibold text-neutral-900">Maior Medo:</span>
                <p className="mt-0.5">{item.maior_medo}</p>
              </div>
              <div>
                <span className="font-semibold text-neutral-900">Sonhos/Objetivos:</span>
                <p className="mt-0.5">{item.sonhos_objetivos}</p>
              </div>
              <div>
                <span className="font-semibold text-neutral-900">Renda Necessária:</span>
                <p className="mt-0.5">{item.renda_necessaria}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
