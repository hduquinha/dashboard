import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listCoupons, listUnregisteredCouponCodes } from "@/lib/coupons";
import { CuponsClient } from "./CuponsClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cupons • Dashboard",
  description: "Cupons de cortesia do Encontro Online, validade e quem ja usou.",
};

export default async function CuponsPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "view.coupons")) {
    redirect("/");
  }

  const [coupons, unregistered] = await Promise.all([listCoupons(), listUnregisteredCouponCodes()]);

  return (
    <CuponsClient
      initialCoupons={coupons}
      initialUnregistered={unregistered}
      canManage={hasPermission(session.user, "coupons.manage")}
    />
  );
}
