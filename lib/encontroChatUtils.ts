export function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

export function isLeadMatch(leadNome: string, chatNome: string): boolean {
  const leadNorm = normalizeForMatch(leadNome);
  const chatNorm = normalizeForMatch(chatNome);

  if (leadNorm === chatNorm) return true;
  if (leadNorm.includes(chatNorm) || chatNorm.includes(leadNorm)) return true;

  const chatWords = chatNorm.split(/\s+/).filter((w) => w.length >= 2);
  const leadWords = leadNorm.split(/\s+/).filter((w) => w.length >= 2);
  const matches = chatWords.filter((w) => leadWords.includes(w));

  return matches.length >= Math.min(2, chatWords.length);
}

export function parseChatHistory(raw: string): { horario: string; nome: string; mensagem: string }[] {
  const messages: { horario: string; nome: string; mensagem: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(.+?)\s*-\s*(.+)$/);
    if (!match) continue;
    const [, horario, nome, mensagem] = match;
    if (nome.trim() && mensagem.trim()) {
      messages.push({ horario: horario.trim(), nome: nome.trim(), mensagem: mensagem.trim() });
    }
  }
  return messages;
}
