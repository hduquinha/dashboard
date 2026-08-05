import { redirect } from "next/navigation";

interface FinanceAccessPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function safeReturnTo(value: string): string {
  return value.startsWith("/financeiro") && !value.startsWith("//") ? value : "/financeiro";
}

export default async function FinanceAccessPage({ searchParams }: FinanceAccessPageProps) {
  const params = await searchParams;
  redirect(safeReturnTo(first(params.returnTo)));
}
