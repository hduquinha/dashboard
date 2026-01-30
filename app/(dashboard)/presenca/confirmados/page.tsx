import type { Metadata } from "next";
import ConfirmedPresencesClient from "./ConfirmedPresencesClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Presenças Confirmadas",
  description: "Visualize todos os participantes com presença validada e aprovada.",
};

interface PageProps {
  searchParams: Promise<{ treinamento?: string }>;
}

export default async function PresencasConfirmadasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <ConfirmedPresencesClient initialTraining={params.treinamento} />;
}
