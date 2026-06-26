import type { Metadata } from "next";
import RankingClient from "./RankingClient";
import { listTrainingsWithStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ranking de Presença",
  description: "Ranking de participantes por presença no encontro.",
};

interface RankingPageProps {
  searchParams: Promise<{ treinamento?: string }>;
}

export default async function RankingPage({ searchParams }: RankingPageProps) {
  const params = await searchParams;
  const trainings = await listTrainingsWithStats();

  return <RankingClient trainings={trainings} initialTraining={params.treinamento} />;
}
