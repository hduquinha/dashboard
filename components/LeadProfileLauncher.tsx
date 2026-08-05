"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import type { TrainingOption } from "@/types/training";

interface LeadProfileLauncherValue {
  openLead: (leadId: number) => void;
}

const LeadProfileContext = createContext<LeadProfileLauncherValue | null>(null);

/**
 * Abre a ficha completa do lead (a MESMA do /crm: etapa, vendedor, respostas
 * do formulário, notas e linha do tempo com as edições) a partir de qualquer
 * lugar que mostre uma pessoa.
 *
 * Existe como contexto porque essas listas estão fundas na árvore — dentro de
 * uma linha de hora, de um card de grupo, de um modal de anúncio — e passar
 * `onOpenLead` de mão em mão por cinco níveis só para chegar lá seria pior. Um
 * componente fora do provedor continua funcionando: `useOpenLeadProfile`
 * devolve null e a lista só não fica clicável.
 */
export function useOpenLeadProfile(): ((leadId: number) => void) | null {
  return useContext(LeadProfileContext)?.openLead ?? null;
}

interface LeadProfileLauncherProps {
  trainingOptions: TrainingOption[];
  recruiterOptions: Array<{ code: string; name: string }>;
  children: React.ReactNode;
}

export default function LeadProfileLauncher({
  trainingOptions,
  recruiterOptions,
  children,
}: LeadProfileLauncherProps) {
  const [leadId, setLeadId] = useState<number | null>(null);

  const openLead = useCallback((id: number) => setLeadId(id), []);
  const value = useMemo(() => ({ openLead }), [openLead]);

  return (
    <LeadProfileContext.Provider value={value}>
      {children}
      {leadId !== null ? (
        <LeadProfileModal
          leadId={leadId}
          onClose={() => setLeadId(null)}
          trainingOptions={trainingOptions}
          recruiterOptions={recruiterOptions}
        />
      ) : null}
    </LeadProfileContext.Provider>
  );
}
