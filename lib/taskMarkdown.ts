/**
 * Markdown mínimo para a descrição e os comentários dos cards.
 *
 * Escrito à mão de propósito: o projeto não tem dependência de markdown e a
 * descrição de tarefa não justifica arrastar um parser inteiro pro bundle. O
 * parser devolve TOKENS, nunca HTML — quem renderiza monta elementos React, o
 * que elimina por construção qualquer injeção de HTML vinda do que o usuário
 * digitou (nada de dangerouslySetInnerHTML).
 *
 * Suporta: títulos, negrito, itálico, código (inline e bloco), links, imagens,
 * listas (inclusive de tarefa), citação, tabela, linha horizontal e menções @.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; value: string; href: string }
  | { type: "image"; value: string; href: string }
  | { type: "mention"; value: string };

export type BlockToken =
  | { type: "heading"; level: number; content: InlineToken[] }
  | { type: "paragraph"; content: InlineToken[] }
  | { type: "code"; language: string | null; value: string }
  | { type: "list"; ordered: boolean; items: { content: InlineToken[]; checked: boolean | null }[] }
  | { type: "quote"; content: InlineToken[] }
  | { type: "table"; header: InlineToken[][]; rows: InlineToken[][][] }
  | { type: "hr" };

const INLINE_PATTERN =
  /(!?\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)|(@[\p{L}\p{N}._-]+)|(https?:\/\/[^\s<>()]+)/gu;

/** Quebra uma linha em pedaços formatados. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: "text", value: text.slice(lastIndex, index) });
    const raw = match[0];

    if (raw.startsWith("![") || raw.startsWith("[")) {
      const isImage = raw.startsWith("!");
      const body = isImage ? raw.slice(1) : raw;
      const close = body.indexOf("](");
      const label = body.slice(1, close);
      const href = body.slice(close + 2, -1);
      tokens.push(isImage ? { type: "image", value: label, href } : { type: "link", value: label || href, href });
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ type: "bold", value: raw.slice(2, -2) });
    } else if (raw.startsWith("~~")) {
      tokens.push({ type: "strike", value: raw.slice(2, -2) });
    } else if (raw.startsWith("`")) {
      tokens.push({ type: "code", value: raw.slice(1, -1) });
    } else if (raw.startsWith("@")) {
      tokens.push({ type: "mention", value: raw.slice(1) });
    } else if (raw.startsWith("http")) {
      tokens.push({ type: "link", value: raw, href: raw });
    } else {
      tokens.push({ type: "italic", value: raw.slice(1, -1) });
    }
    lastIndex = index + raw.length;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", value: text.slice(lastIndex) });
  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): BlockToken[] {
  const lines = (source ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockToken[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Bloco de código cercado por ```
    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim() || null;
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1; // fecha
      blocks.push({ type: "code", language, value: buffer.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, content: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const buffer: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith(">")) {
        buffer.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", content: parseInline(buffer.join(" ")) });
      continue;
    }

    // Tabela: cabeçalho + linha de separação com --- e as linhas de dados.
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?[\s:-]*-[\s:|-]*$/.test(lines[index + 1])) {
      const header = splitRow(line).map(parseInline);
      index += 2;
      const rows: InlineToken[][][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const listMatch = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: { content: InlineToken[]; checked: boolean | null }[] = [];
      while (index < lines.length) {
        const current = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (!current || /\d/.test(current[1]) !== ordered) break;
        let text = current[2];
        let checked: boolean | null = null;
        const task = /^\[([ xX])\]\s*(.*)$/.exec(text);
        if (task) {
          checked = task[1].toLowerCase() === "x";
          text = task[2];
        }
        items.push({ content: parseInline(text), checked });
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Parágrafo: junta linhas seguidas até uma linha em branco ou outro bloco.
    const buffer: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !lines[index].trimStart().startsWith(">") &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index])
    ) {
      buffer.push(lines[index]);
      index += 1;
    }
    if (buffer.length > 0) blocks.push({ type: "paragraph", content: parseInline(buffer.join(" ")) });
    else index += 1;
  }

  return blocks;
}

/** Texto puro (usado na busca e no CSV, onde markdown só atrapalha). */
export function markdownToPlainText(source: string): string {
  return (source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
