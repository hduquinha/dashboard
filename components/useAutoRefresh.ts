"use client";

import { useEffect, useRef } from "react";

interface AutoRefreshOptions {
  /** Intervalo em ms. 30s é o padrão do dashboard — ver comentário abaixo. */
  intervalMs?: number;
  /** Pausa a atualização (arrasto em andamento, modal aberto, formulário sujo). */
  paused?: boolean;
  /** Desliga de vez (ex.: tela sem dados vivos). */
  enabled?: boolean;
}

/**
 * Atualização automática das telas do dashboard.
 *
 * Duas fontes: um relógio de 30s e o retorno do foco à aba. Trinta segundos foi
 * escolhido junto com a operação — é rápido o bastante para o vendedor ver o
 * lead que o colega distribuiu e devagar o bastante para não repetir o problema
 * de carga da VPS (as consultas do Kanban e da agenda não são baratas).
 *
 * **Nunca atualiza com a aba escondida**: manter um refetch de 30s rodando em
 * dez abas abandonadas é o jeito mais fácil de derrubar o banco sem ninguém
 * estar usando o sistema. Ao voltar para a aba, atualiza na hora — que é o
 * momento em que a pessoa realmente olha para os dados.
 *
 * `paused` existe porque refazer os dados no meio de um arrasto ou com um modal
 * aberto joga fora o que o usuário está fazendo.
 */
export function useAutoRefresh(
  refresh: () => void,
  { intervalMs = 30_000, paused = false, enabled = true }: AutoRefreshOptions = {}
): void {
  // A callback muda a cada render (é recriada nos componentes); guardá-la numa
  // ref evita reprogramar o intervalo a cada render e perder o ciclo. A
  // atribuição vai num efeito, não no corpo do componente: escrever em ref
  // durante o render é o que a regra react-hooks/refs proíbe.
  const refreshRef = useRef(refresh);
  const pausedRef = useRef(paused);

  useEffect(() => {
    refreshRef.current = refresh;
    pausedRef.current = paused;
  });

  useEffect(() => {
    if (!enabled) return;

    function run() {
      if (pausedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      refreshRef.current();
    }

    const timer = window.setInterval(run, intervalMs);

    function onVisibility() {
      if (document.visibilityState === "visible") run();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [intervalMs, enabled]);
}
