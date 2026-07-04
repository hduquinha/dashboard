const cluster = require("node:cluster");
const http = require("node:http");
const os = require("node:os");
const { parse } = require("node:url");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const requestedWorkers = Number.parseInt(process.env.DASHBOARD_WEB_CONCURRENCY || "2", 10);
const availableWorkers =
  typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const workerCount = Math.max(
  1,
  Math.min(Number.isFinite(requestedWorkers) ? requestedWorkers : 2, availableWorkers)
);

if (!dev && workerCount > 1 && cluster.isPrimary) {
  console.log(`[dashboard] starting ${workerCount} workers`);

  for (let index = 0; index < workerCount; index += 1) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.warn(
      `[dashboard] worker ${worker.process.pid} exited code=${code ?? "null"} signal=${signal ?? "null"}`
    );
    cluster.fork();
  });
} else {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    http
      .createServer((request, response) => {
        const parsedUrl = parse(request.url, true);
        handle(request, response, parsedUrl);
      })
      .listen(port, hostname, () => {
        console.log(
          `[dashboard] worker ${process.pid} ready on http://${hostname}:${port}`
        );
      });
  });
}

// Varredura da fila de merge por telefone (migracao 011). Roda fora do
// if/else de cluster acima porque precisa disparar exatamente uma vez,
// nao importa a topologia: cluster.isPrimary e true tanto no processo
// unico (dev, ou producao com 1 worker) quanto no processo pai que faz
// fork() em modo cluster -- nunca nos workers filhos. server.js e
// CommonJS puro (sem resolucao de path alias "@/lib/db"), entao ele so
// dispara um fetch loopback; a logica real mora em lib/mergeSweep.ts,
// dentro do grafo de modulos do Next (acessivel via rota de API).
if (cluster.isPrimary && process.env.MERGE_SWEEP_ENABLED !== "false") {
  const sweepIntervalMs = Number.parseInt(process.env.MERGE_SWEEP_INTERVAL_MS || "30000", 10);
  const sweepToken = process.env.DASHBOARD_TOKEN || "";
  const sweepUrl = `http://127.0.0.1:${port}/api/internal/merge-sweep`;

  const triggerSweep = () => {
    fetch(sweepUrl, {
      method: "POST",
      headers: sweepToken ? { Authorization: `Bearer ${sweepToken}` } : {},
    }).catch((err) => {
      console.error("[dashboard] merge sweep trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerSweep, sweepIntervalMs);
  setTimeout(triggerSweep, 10_000); // margem para o worker terminar app.prepare()
}
