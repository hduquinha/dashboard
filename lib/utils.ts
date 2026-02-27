import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Insert spaces into CamelCase / all-caps-no-space names and title-case them.
 * "RodrigoDamaceno" → "Rodrigo Damaceno"
 * "LUCASVINICIUSRIBEIRODOSSANTOSSOUZA" → "Lucasviniciusribeirodossantossouza"
 * "AndréaRufino deSouza" → "Andréa Rufino De Souza"
 * "Vanessa Vaz" → "Vanessa Vaz"
 */
export function humanizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (!s) return "";

  // Insert space before uppercase letters preceded by lowercase (CamelCase)
  s = s.replace(/([a-záàãâéèêíóôõúüç])([A-ZÁÀÃÂÉÈÊÍÓÔÕÚÜÇ])/g, "$1 $2");

  // Title-case each word
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
