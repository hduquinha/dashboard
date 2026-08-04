import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DocumentosClient from "./DocumentosClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Documentos e PDFs",
  description: "Modelos VozUP prontos para configurar, imprimir e usar.",
};

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.vozup")) {
    redirect("/");
  }

  return <DocumentosClient />;
}
