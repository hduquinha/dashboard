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

function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function buildWhatsAppWebUrl(phone: string | null | undefined): string {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return "#";
  return `https://web.whatsapp.com/send?phone=${normalized}`;
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * onClick para os links de WhatsApp: no celular troca o web.whatsapp.com (que
 * abriria o navegador) por wa.me, que abre direto o app instalado — WhatsApp
 * Business inclusive. O href continua sendo a URL web (estável no SSR, sem
 * mismatch de hidratação) e segue valendo no desktop.
 */
export function openWhatsAppOnMobile(
  event: { preventDefault: () => void },
  phone: string | null | undefined
): void {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized || !isMobileUserAgent()) return;
  event.preventDefault();
  window.location.href = `https://wa.me/${normalized}`;
}
