import type { Metadata } from "next";
import RelatoriosClient from "./RelatoriosClient";
import { listTrainingsWithStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relatórios",
  description: "Visualize rankings e estatísticas com gráficos exportáveis.",
};

export default async function RelatoriosPage() {
  const trainings = await listTrainingsWithStats();
  
  return <RelatoriosClient trainings={trainings} />;
}
