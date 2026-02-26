import type { Metadata } from "next";
import TrainingDetailsClient from "./TrainingDetailsClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Treinamento ${id}`,
    description: `Detalhes e ranking de recrutadores do treinamento ${id}.`,
  };
}

export default async function TrainingDetailsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = tab === "detalhes" || tab === "nao-associados" ? tab : undefined;
  return <TrainingDetailsClient treinamentoId={id} initialTab={initialTab} />;
}
