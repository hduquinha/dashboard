import type { InscricaoItem } from '@/types/inscricao';

interface RecentInscricoesTableProps {
  inscricoes: InscricaoItem[];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RecentInscricoesTable({ inscricoes }: RecentInscricoesTableProps) {
  if (inscricoes.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        Nenhuma inscrição foi registrada para este treinamento ainda.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-neutral-200 text-sm">
        <thead className="bg-neutral-100 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-3 w-10">#</th>
            <th className="px-3 py-3">Nome</th>
            <th className="hidden px-3 py-3 lg:table-cell">Telefone</th>
            <th className="hidden px-3 py-3 md:table-cell">Cidade</th>
            <th className="px-3 py-3">Indicador</th>
            <th className="hidden px-3 py-3 sm:table-cell">Criado em</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {inscricoes.map((inscricao, index) => (
            <tr 
              key={inscricao.id} 
              className={`transition-colors hover:bg-[#2DBDC2]/10 ${index % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'}`}
            >
              <td className="px-3 py-3 text-neutral-500 font-medium">
                {index + 1}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-col">
                  <span className="font-medium text-neutral-900">
                    {inscricao.nome ?? 'Indisponível'}
                  </span>
                  {inscricao.tipo === 'recrutador' && inscricao.codigoProprio ? (
                    <span className="text-xs text-neutral-500">Código {inscricao.codigoProprio}</span>
                  ) : null}
                  {/* Telefone inline em mobile */}
                  <span className="text-xs text-neutral-500 lg:hidden">
                    {inscricao.telefone ?? ''}
                  </span>
                  {/* Data inline em mobile */}
                  <span className="text-xs text-neutral-400 sm:hidden">
                    {formatDateTime(inscricao.criadoEm)}
                  </span>
                </div>
              </td>
              <td className="hidden px-3 py-3 text-neutral-700 lg:table-cell">{inscricao.telefone ?? '—'}</td>
              <td className="hidden px-3 py-3 text-neutral-700 md:table-cell">{inscricao.cidade ?? '—'}</td>
              <td className="px-3 py-3 text-neutral-700">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium sm:text-sm">
                    {inscricao.recrutadorNome ?? (
                      <span className="text-neutral-400">Sem indicador</span>
                    )}
                  </span>
                  {inscricao.recrutadorCodigo ? (
                    <span className="inline-flex w-max rounded-full bg-neutral-900/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                      {inscricao.recrutadorCodigo}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="hidden px-3 py-3 text-neutral-700 sm:table-cell">{formatDateTime(inscricao.criadoEm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
