import type { Metadata } from "next";
import RankingClient from "./RankingClient";
import { listTrainingsWithStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ranking de Presença",
  description: "Ranking de participantes por presença na dinâmica do encontro.",
};

export default async function RankingPage() {
  const trainings = await listTrainingsWithStats();

  return <RankingClient trainings={trainings} />;
}
