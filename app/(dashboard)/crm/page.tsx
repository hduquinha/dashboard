import type { Metadata } from "next";
import { cookies } from "next/headers";
import CrmClient from "./CrmClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getCommercialWorkspace } from "@/lib/commercial";
import { listInscricoes, listTrainingFilterOptions, listRecruitersWithDbNames, listCampaignTermOptions } from "@/lib/db";
import type { CommercialStage, InscricaoItem, InscricaoStatus, OrderDirection, OrderableField } from "@/types/inscricao";
import { ttlCache } from "@/lib/serverCache";
import { maskInscricoesForUser } from "@/lib/leadPermissions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

interface LeadsPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseStatus(value: string): InscricaoStatus | undefined {
  const allowed: InscricaoStatus[] = ["aguardando", "aprovado", "rejeitado"];
  return allowed.includes(value as InscricaoStatus) ? (value as InscricaoStatus) : undefined;
}

function parseCommercialStage(value: string): CommercialStage | undefined {
  const allowed: CommercialStage[] = [
    "novo", "primeiro_contato", "em_atendimento", "agendado",
    "fechamento", "ganho", "perdido", "no_show",
  ];
  return allowed.includes(value as CommercialStage) ? (value as CommercialStage) : undefined;
}

function parsePresenca(value: string): "aprovada" | "reprovada" | "validada" | "nao-validada" | undefined {
  const allowed = ["aprovada", "reprovada", "validada", "nao-validada"] as const;
  return allowed.includes(value as typeof allowed[number]) ? (value as typeof allowed[number]) : undefined;
}

function parseTag(value: string): "recrutador" | "whatsapp" | "com-indicador" | "com-dinamica" | undefined {
  const allowed = ["recrutador", "whatsapp", "com-indicador", "com-dinamica"] as const;
  return allowed.includes(value as typeof allowed[number]) ? (value as typeof allowed[number]) : undefined;
}

function toCrmPreviewItem(item: InscricaoItem): InscricaoItem {
  const preview = { ...item } as Partial<InscricaoItem>;
  delete preview.payload;
  delete preview.parsedPayload;
  delete preview.upDay;
  delete preview.previousFormFields;
  delete preview.notes;
  delete preview.presencaDia1;
  delete preview.presencaDia2;
  delete preview.presencaValidada;
  delete preview.presencaAprovada;
  delete preview.presencaParticipanteNome;
  delete preview.presencaTempoTotalMinutos;
  delete preview.presencaTempoDinamicaMinutos;
  delete preview.presencaPercentualDinamica;
  delete preview.presencaValidadaEm;
  delete preview.presencaTotalDias;
  delete preview.presencaDiaProcessado;
  delete preview.presencaDinamicaDias;
  return preview as InscricaoItem;
}

export const metadata: Metadata = {
  title: "CRM • Instituto UP",
  description: "Gerencie e acompanhe seus leads de forma profissional.",
};

export default async function LeadsPage(props: LeadsPageProps) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  const commercial = await getCommercialWorkspace(session?.user ?? null);

  const q = pick(searchParams?.q);
  const nome = pick(searchParams?.nome);
  const telefone = pick(searchParams?.telefone);
  const cidade = pick(searchParams?.cidade);
  const profissao = pick(searchParams?.profissao);
  const indicacao = pick(searchParams?.indicacao);
  const produtoRaw = pick(searchParams?.produto);
  const produto = (produtoRaw === "vozup" || produtoRaw === "instituto") ? produtoRaw : undefined;
  // Multi-select: comma-separated training IDs
  const treinamentosRaw = pick(searchParams?.treinamentos);
  const treinamentos = treinamentosRaw ? treinamentosRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // Quick filter: all of a kind
  const kind = pick(searchParams?.kind);
  const statusFilter = parseStatus(pick(searchParams?.status));
  const campaignSource = pick(searchParams?.campaignSource);
  const campaignName = pick(searchParams?.campaignName);
  const campaignTerm = pick(searchParams?.campaignTerm);
  const commercialStage = parseCommercialStage(pick(searchParams?.commercialStage));
  const assignedSellerEmail = pick(searchParams?.assignedSellerEmail);
  const unassignedOnly = commercial.isSupervisor && pick(searchParams?.unassignedOnly) === "1";
  const starsFilter = pick(searchParams?.stars) || undefined;
  const presencaFilter = parsePresenca(pick(searchParams?.presenca));
  const tagFilter = parseTag(pick(searchParams?.tag));
  const orderBy = (pick(searchParams?.orderBy) || "criado_em") as OrderableField;
  const orderDirection = (pick(searchParams?.orderDirection) || "desc") as OrderDirection;
  const page = Math.max(1, parseInt(pick(searchParams?.page) || "1", 10) || 1);

  const queryKey = JSON.stringify({
    page, orderBy, orderDirection, q, nome, telefone, cidade, profissao, indicacao,
    treinamentos: treinamentosRaw, kind, presencaFilter, tagFilter, statusFilter,
    campaignSource, campaignName, campaignTerm, commercialStage, produto,
    assignedSellerEmail: commercial.isSupervisor ? assignedSellerEmail : session?.user.email ?? "",
    unassignedOnly, starsFilter,
    user: commercial.isSupervisor ? "supervisor" : session?.user.email ?? "",
  });

  const [trainingOptions, recruiterOptions, campaignTermOptions, result] = await Promise.all([
    ttlCache("dashboard:training-options", 60_000, () => listTrainingFilterOptions()),
    ttlCache("dashboard:recruiter-options", 60_000, () => listRecruitersWithDbNames()),
    ttlCache("dashboard:campaign-term-options", 60_000, () => listCampaignTermOptions()),
    ttlCache(`dashboard:crm:list:${queryKey}`, 5_000, async () => {
      const allTrainings = await ttlCache("dashboard:training-options", 60_000, () => listTrainingFilterOptions());

      // Resolve which training IDs to filter by
      let treinamentoIds: string[] | undefined;
      if (treinamentos.length > 0) {
        // Specific trainings selected (multi-select)
        treinamentoIds = treinamentos;
      } else if (kind) {
        // Quick filter: all trainings of a kind
        treinamentoIds = allTrainings.filter((t) => t.kind === kind).map((t) => t.id);
      }

      return listInscricoes({
        page,
        pageSize: PAGE_SIZE,
        orderBy,
        orderDirection,
        filters: {
          caracteristica: q || undefined,
          nome: nome || undefined,
          telefone: telefone || undefined,
          cidade: cidade || undefined,
          profissao: profissao || undefined,
          indicacao: indicacao || undefined,
          treinamentoIds: treinamentoIds && treinamentoIds.length > 0 ? treinamentoIds : undefined,
          status: statusFilter,
          campaignSource: campaignSource || undefined,
          campaignName: campaignName || undefined,
          campaignTerm: campaignTerm || undefined,
          commercialStage,
          assignedSellerEmail: commercial.isSupervisor
            ? assignedSellerEmail || undefined
            : session?.user.email ?? "__unauthorized__",
          unassignedOnly,
          stars: starsFilter,
          presenca: presencaFilter,
          tag: tagFilter,
          produto,
        },
      });
    }),
  ]);

  const previewItems = maskInscricoesForUser(result.data, session?.user ?? null).map(toCrmPreviewItem);

  return (
    <CrmClient
      inscricoes={previewItems}
      commercial={commercial}
      currentUser={
        session
          ? {
              email: session.user.email,
              isSupervisor: commercial.isSupervisor,
              role: session.user.role,
              permissions: session.user.permissions,
              institutoUpOnly: session.user.institutoUpOnly,
            }
          : null
      }
      total={result.total}
      page={page}
      pageSize={PAGE_SIZE}
      orderBy={orderBy}
      orderDirection={orderDirection}
      trainingOptions={trainingOptions}
      recruiterOptions={recruiterOptions}
      campaignTermOptions={campaignTermOptions}
      filters={{
        q, nome, telefone, cidade, profissao, indicacao,
        treinamentos: treinamentosRaw,
        kind,
        presenca: presencaFilter,
        tag: tagFilter,
        status: statusFilter,
        stars: starsFilter,
        campaignSource,
        campaignName,
        campaignTerm,
        commercialStage,
        assignedSellerEmail: commercial.isSupervisor ? assignedSellerEmail : session?.user.email ?? "",
        unassignedOnly,
        produto,
      }}
    />
  );
}
