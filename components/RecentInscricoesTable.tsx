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
            <th className="px-4 py-3">Nome</th>
            <th className="px-4 py-3">Telefone</th>
            <th className="px-4 py-3">Cidade</th>
            <th className="px-4 py-3">Indicador</th>
            <th className="px-4 py-3">Criado em</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 bg-white">
          {inscricoes.map((inscricao) => (
            <tr key={inscricao.id} className="hover:bg-neutral-50">
              <td className="px-4 py-3 font-medium text-neutral-900">
                {inscricao.nome ?? 'Indisponível'}
                {inscricao.tipo === 'recrutador' && inscricao.codigoProprio ? (
                  <span className="ml-2 text-xs text-neutral-500">Código {inscricao.codigoProprio}</span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-neutral-700">{inscricao.telefone ?? '—'}</td>
              <td className="px-4 py-3 text-neutral-700">{inscricao.cidade ?? '—'}</td>
              <td className="px-4 py-3 text-neutral-700">
                {inscricao.recrutadorNome ?? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Sem indicador</span>
                )}
                {inscricao.recrutadorCodigo ? (
                  <span className="ml-2 rounded-full bg-neutral-900/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
                    {inscricao.recrutadorCodigo}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-neutral-700">{formatDateTime(inscricao.criadoEm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
