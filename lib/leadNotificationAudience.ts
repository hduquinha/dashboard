import type { DashboardUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isProductivityManager } from "@/lib/productivity";

type DistributionNotificationUser = Pick<DashboardUser, "email" | "role"> & {
  permissions?: readonly string[] | null;
  institutoUpOnly?: boolean | null;
};

/**
 * O aviso de lead novo chama a pessoa para agir na Chegada de Leads. Por isso,
 * nao basta enxergar a tela: ela tambem precisa passar pelo mesmo gate de
 * gestor usado pelas rotinas que efetivamente distribuem os leads.
 */
export function canReceiveNewLeadNotifications(
  user: DistributionNotificationUser | null | undefined
): boolean {
  return Boolean(
    user &&
      hasPermission(user, "view.distribution") &&
      isProductivityManager(user)
  );
}
