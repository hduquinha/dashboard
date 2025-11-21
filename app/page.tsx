import DashboardLayout from "./(dashboard)/layout";
import CrmPage from "./(dashboard)/crm/page";

export { metadata } from "./(dashboard)/crm/page";

export const dynamic = "force-dynamic";

type DashboardPageProps = Parameters<typeof CrmPage>[0];

export default function HomePage(props: DashboardPageProps) {
	return (
		<DashboardLayout>
			<CrmPage {...props} />
		</DashboardLayout>
	);
}
