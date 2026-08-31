import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MatriculasClient from "./MatriculasClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getFinanceCatalog, listEnrollmentPaymentHealth, listEnrollments } from "@/lib/finance";
import { listEnrollmentClassTags } from "@/lib/academicClasses";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Matrículas | VozUP",
  description: "Contratos, parcelas e recebimentos de matrículas.",
};

export const dynamic = "force-dynamic";

export default async function MatriculasPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.finance")) redirect("/");

  const [catalog, enrollments, health, classTags] = await Promise.all([
    getFinanceCatalog(),
    listEnrollments(),
    // Fora do recorte de período de propósito: parcela vencida em março continua
    // vencida em agosto (ver listEnrollmentPaymentHealth).
    listEnrollmentPaymentHealth(),
    // A etiqueta de turma é um extra: se o módulo acadêmico falhar, a carteira de
    // matrículas continua abrindo sem ela em vez de a tela do dinheiro cair junto.
    listEnrollmentClassTags().catch(() => []),
  ]);
  return (
    <MatriculasClient
      initialCatalog={catalog}
      initialEnrollments={enrollments}
      initialHealth={health}
      initialClassTags={classTags}
      canManageInvoices={hasPermission(session?.user, "finance.invoices")}
      canViewClasses={hasPermission(session?.user, "view.classes")}
      canManageClasses={hasPermission(session?.user, "classes.manage")}
      canViewStudents={hasPermission(session?.user, "view.students")}
    />
  );
}
