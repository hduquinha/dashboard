/**
 * Tipos do feed de notificacoes do site. Ficam fora de `lib/appNotifications`
 * para que componentes client possam importar sem arrastar o driver do
 * Postgres para o bundle.
 */

export type AppNotificationKind =
  | "new_lead"
  | "lead_assigned"
  | "stale_lead"
  | "undistributed_lead";

export interface AppNotification {
  id: number;
  kind: AppNotificationKind;
  title: string;
  body: string;
  url: string | null;
  inscricaoId: number | null;
  createdAt: string;
  readAt: string | null;
}

export interface AppNotificationFeed {
  items: AppNotification[];
  unread: number;
}
