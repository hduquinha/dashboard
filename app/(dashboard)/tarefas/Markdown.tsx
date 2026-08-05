"use client";

import { Fragment } from "react";
import { parseMarkdown, type BlockToken, type InlineToken } from "@/lib/taskMarkdown";

/**
 * Renderiza o markdown da descrição/comentário como elementos React.
 *
 * Não existe HTML cru em lugar nenhum aqui: o parser devolve tokens e este
 * componente monta as tags. É o que garante que uma descrição com `<script>`
 * apareça como texto, e não execute.
 */

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "bold":
            return <strong key={index} className="font-bold text-slate-900">{token.value}</strong>;
          case "italic":
            return <em key={index}>{token.value}</em>;
          case "strike":
            return <s key={index} className="text-slate-400">{token.value}</s>;
          case "code":
            return (
              <code key={index} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-rose-600">
                {token.value}
              </code>
            );
          case "mention":
            return (
              <span key={index} className="rounded bg-cyan-50 px-1 font-bold text-cyan-700">
                @{token.value}
              </span>
            );
          case "image":
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={index} src={token.href} alt={token.value} className="my-2 max-h-80 rounded-lg border border-slate-200" />;
          case "link":
            return (
              <a
                key={index}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-cyan-700 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-900"
              >
                {token.value}
              </a>
            );
          default:
            return <Fragment key={index}>{token.value}</Fragment>;
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-3 text-xl font-black text-slate-900",
  2: "mt-3 text-lg font-black text-slate-900",
  3: "mt-2 text-base font-extrabold text-slate-800",
  4: "mt-2 text-sm font-extrabold text-slate-800",
  5: "mt-2 text-sm font-bold text-slate-700",
  6: "mt-2 text-xs font-bold uppercase tracking-wide text-slate-500",
};

function Block({ block }: { block: BlockToken }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(block.level, 6)}` as "h1";
      return (
        <Tag className={HEADING_CLASS[block.level] ?? HEADING_CLASS[6]}>
          <Inline tokens={block.content} />
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100">
          <code>{block.value}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="my-2 border-l-4 border-cyan-300 bg-cyan-50/50 px-3 py-1.5 text-slate-600">
          <Inline tokens={block.content} />
        </blockquote>
      );
    case "hr":
      return <hr className="my-3 border-slate-200" />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`my-1.5 space-y-0.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, index) => (
            <li key={index} className={item.checked === null ? "" : "list-none -ml-5"}>
              {item.checked !== null && (
                <input type="checkbox" checked={item.checked} readOnly className="mr-1.5 align-middle accent-cyan-600" />
              )}
              <span className={item.checked ? "text-slate-400 line-through" : ""}>
                <Inline tokens={item.content} />
              </span>
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        // Tabela larga rola dentro do próprio quadro — sem isto o modal inteiro
        // ganha barra horizontal.
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {block.header.map((cell, index) => (
                  <th key={index} className="px-2 py-1.5 font-black text-slate-700">
                    <Inline tokens={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-100">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5 text-slate-600">
                      <Inline tokens={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p className="my-1.5 leading-6 text-slate-700">
          <Inline tokens={block.content} />
        </p>
      );
  }
}

export default function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;
  return (
    <div className={`text-sm ${className}`}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
