import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import NotificacoesClient from "./NotificacoesClient";
import { getAppNotificationFeed } from "@/lib/appNotifications";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notificações • Dashboard",
  description: "Avisos de leads novos, atribuições e leads parados.",
};

export default async function NotificacoesPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  // Sem permissão específica: cada usuário vê apenas as próprias notificações.
  if (!session?.user?.email) {
    redirect("/login");
  }

  const feed = await getAppNotificationFeed(session.user.email, { limit: 60 });

  return <NotificacoesClient initialFeed={feed} />;
}
