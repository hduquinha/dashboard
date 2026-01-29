import type { Metadata } from "next";
import ConfirmedPresencesClient from "./ConfirmedPresencesClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Presenças Confirmadas",
  description: "Visualize todos os participantes com presença validada e aprovada.",
};

export default function PresencasConfirmadasPage() {
  return <ConfirmedPresencesClient />;
}
