import type { Metadata } from "next";
import Link from "next/link";
import LeadsClient from "./LeadsClient";
import { listInscricoes, listTrainingFilterOptions, listRecruitersWithDbNames } from "@/lib/db";
import type { OrderDirection, OrderableField } from "@/types/inscricao";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

interface LeadsPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export const metadata: Metadata = {
  title: "Leads • CRM",
  description: "Gerencie e acompanhe seus leads de forma profissional.",
};

export default async function LeadsPage(props: LeadsPageProps) {
  const searchParams = await props.searchParams;
  const nome = pick(searchParams?.nome);
  const telefone = pick(searchParams?.telefone);
  const indicacao = pick(searchParams?.indicacao);
  const treinamento = pick(searchParams?.treinamento);
  const statusFilter = pick(searchParams?.status) || undefined;
  const starsFilter = pick(searchParams?.stars) || undefined;
  const orderBy = (pick(searchParams?.orderBy) || "criado_em") as OrderableField;
  const orderDirection = (pick(searchParams?.orderDirection) || "desc") as OrderDirection;
  const page = Math.max(1, parseInt(pick(searchParams?.page) || "1", 10) || 1);

  const [trainingOptions, recruiterOptions, result] = await Promise.all([
    listTrainingFilterOptions(),
    listRecruitersWithDbNames(),
    listInscricoes({
      page,
      pageSize: PAGE_SIZE,
      orderBy,
      orderDirection,
      filters: {
        nome: nome || undefined,
        telefone: telefone || undefined,
        indicacao: indicacao || undefined,
        treinamento: treinamento || undefined,
      },
    }),
  ]);

  return (
    <LeadsClient
      inscricoes={result.data}
      total={result.total}
      page={page}
      pageSize={PAGE_SIZE}
      orderBy={orderBy}
      orderDirection={orderDirection}
      trainingOptions={trainingOptions}
      recruiterOptions={recruiterOptions}
      filters={{ nome, telefone, indicacao, treinamento, status: statusFilter, stars: starsFilter }}
    />
  );
}
