import CrmPage from "./crm/page";

export { metadata } from "./crm/page";

export const dynamic = "force-dynamic";

type DashboardPageProps = Parameters<typeof CrmPage>[0];

export default function DashboardPage(props: DashboardPageProps) {
	return CrmPage(props);
}
