export interface Recruiter {
  code: string;
  name: string;
  url: string;
}

export const RECRUITERS_BASE_URL = "https://instituto-up-formulario.vercel.app/?source=";

const RAW_RECRUITERS: Array<[string, string]> = [
  ["01", "Rodrigo"],
  ["02", "Vanessa"],
  ["03", "Jane"],
  ["04", "Jhonatha"],
  ["05", "Agatha"],
  ["06", "Valda"],
  ["07", "Cely"],
  ["08", "Lourenço"],
  ["09", "Bárbara"],
  ["10", "Sandra"],
  ["11", "Karina"],
  ["12", "Paula Porto"],
  ["13", "Regina Gondim"],
  ["14", "Salete"],
  ["15", "Marcos"],
  ["16", "Ivaneide"],
  ["17", "Karen"],
  ["18", "Claudia Talib"],
  ["19", "Anselmo"],
  ["20", "Alessandra"],
  ["21", "Cleidiane"],
  ["22", "Renata Vergílio"],
  ["23", "Alice"],
  ["24", "Eliane/Márcio"],
  ["25", "Adriana Davies"],
  ["26", "Maria Léo"],
  ["27", "Marcelo"],
  ["28", "Adryelly"],
  ["29", "Aline Nobile"],
  ["30", "Kleidiane"],
  ["31", "Gilsemara"],
  ["32", "Josefa"],
  ["33", "Mara"],
  ["34", "Thais/Jorge"],
];

export const RECRUITERS: Recruiter[] = RAW_RECRUITERS.map(([code, name]) => ({
  code,
  name,
  url: `${RECRUITERS_BASE_URL}${code}`,
}));

export function listRecruiters(): Recruiter[] {
  return RECRUITERS.map((recruiter) => ({ ...recruiter }));
}

const recruiterMap = new Map<string, Recruiter>();

for (const recruiter of RECRUITERS) {
  recruiterMap.set(recruiter.code, recruiter);
  const numeric = String(Number.parseInt(recruiter.code, 10));
  recruiterMap.set(numeric, recruiter);
}

export function normalizeRecruiterCode(code?: string | null): string | null {
  if (!code) {
    return null;
  }
  const cleaned = code.trim();
  if (!cleaned) {
    return null;
  }
  const digits = cleaned.replace(/\D+/g, "");
  if (!digits) {
    return null;
  }
  const numeric = Number.parseInt(digits, 10);
  if (Number.isNaN(numeric)) {
    return null;
  }
  return String(numeric).padStart(2, "0");
}

export function getRecruiterByCode(code?: string | null): Recruiter | null {
  const normalized = normalizeRecruiterCode(code);
  if (!normalized) {
    return null;
  }
  return recruiterMap.get(normalized) ?? recruiterMap.get(String(Number.parseInt(normalized, 10))) ?? null;
}
