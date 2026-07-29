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

// Web push de leads novos para os celulares dos vendedores (inscritos via
// /api/push/subscribe). Mesmo padrão de loopback do merge sweep acima.
if (cluster.isPrimary && process.env.PUSH_DISPATCH_ENABLED !== "false") {
  const pushIntervalMs = Number.parseInt(process.env.PUSH_DISPATCH_INTERVAL_MS || "30000", 10);
  const pushToken = process.env.DASHBOARD_TOKEN || "";
  const pushUrl = `http://127.0.0.1:${port}/api/internal/push-dispatch`;

  const triggerPushDispatch = () => {
    if (!pushToken) return;
    fetch(pushUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${pushToken}` },
    }).catch((err) => {
      console.error("[dashboard] push dispatch trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerPushDispatch, pushIntervalMs);
  setTimeout(triggerPushDispatch, 15_000);
}

// Alerta o master quando (a) um lead atribuido fica parado sem nenhuma
// atualizacao (etapa/nota/tentativa de contato), ou (b) um lead chega na
// Chegada de Leads e passa do prazo sem ser distribuido a ninguem. Mesmo
// padrão de loopback do merge sweep e do push dispatch acima.
if (cluster.isPrimary && process.env.STALE_LEAD_ALERT_ENABLED !== "false") {
  const staleIntervalMs = Number.parseInt(process.env.STALE_LEAD_ALERT_INTERVAL_MS || "300000", 10);
  const staleToken = process.env.DASHBOARD_TOKEN || "";
  const staleUrl = `http://127.0.0.1:${port}/api/internal/stale-lead-alert`;

  const triggerStaleLeadAlert = () => {
    if (!staleToken) return;
    fetch(staleUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${staleToken}` },
    }).catch((err) => {
      console.error("[dashboard] stale lead alert trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerStaleLeadAlert, staleIntervalMs);
  setTimeout(triggerStaleLeadAlert, 20_000);
}

// Fallback para Lead Ads da Meta: webhooks podem falhar ou ficar desinscritos
// sem derrubar o app. A sincronização puxa leads recentes e ignora IDs já salvos.
if (cluster.isPrimary && process.env.FACEBOOK_LEAD_SYNC_ENABLED !== "false") {
  const syncIntervalMs = Number.parseInt(process.env.FACEBOOK_LEAD_SYNC_INTERVAL_MS || "120000", 10);
  const syncToken = process.env.DASHBOARD_TOKEN || "";
  const syncUrl = `http://127.0.0.1:${port}/api/internal/facebook-lead-sync`;

  const triggerFacebookLeadSync = () => {
    if (!syncToken || !process.env.FACEBOOK_PAGE_ACCESS_TOKEN) return;
    fetch(syncUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${syncToken}` },
    }).catch((err) => {
      console.error("[dashboard] facebook lead sync trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerFacebookLeadSync, syncIntervalMs);
  setTimeout(triggerFacebookLeadSync, 20_000);
}

// Metricas de campanha (Meta Ads): estrutura (campanha/conjunto/anuncio/
// criativo) + insights diarios por anuncio. Mesmo padrao de loopback dos
// blocos acima; roda com intervalo maior porque a estrutura/insights nao
// mudam a cada poucos minutos como um lead novo.
if (cluster.isPrimary && process.env.META_ADS_SYNC_ENABLED !== "false") {
  const metaAdsSyncIntervalMs = Number.parseInt(process.env.META_ADS_SYNC_INTERVAL_MS || "900000", 10);
  const metaAdsSyncToken = process.env.DASHBOARD_TOKEN || "";
  const metaAdsSyncUrl = `http://127.0.0.1:${port}/api/internal/meta-ads-sync`;

  const triggerMetaAdsSync = () => {
    if (!metaAdsSyncToken || !process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.META_ADS_AD_ACCOUNT_ID) return;
    fetch(metaAdsSyncUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${metaAdsSyncToken}` },
    }).catch((err) => {
      console.error("[dashboard] meta ads sync trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerMetaAdsSync, metaAdsSyncIntervalMs);
  setTimeout(triggerMetaAdsSync, 30_000);
}

// Metricas de campanha (Google Ads): mesmo loopback do Meta, mas só dispara
// quando todas as credenciais mínimas estão presentes.
if (cluster.isPrimary && process.env.GOOGLE_ADS_SYNC_ENABLED !== "false") {
  const googleAdsSyncIntervalMs = Number.parseInt(process.env.GOOGLE_ADS_SYNC_INTERVAL_MS || "900000", 10);
  const googleAdsSyncToken = process.env.DASHBOARD_TOKEN || "";
  const googleAdsSyncUrl = `http://127.0.0.1:${port}/api/internal/google-ads-sync`;

  const triggerGoogleAdsSync = () => {
    if (
      !googleAdsSyncToken ||
      !process.env.GOOGLE_ADS_DEVELOPER_TOKEN ||
      !process.env.GOOGLE_ADS_CLIENT_ID ||
      !process.env.GOOGLE_ADS_CLIENT_SECRET ||
      !process.env.GOOGLE_ADS_REFRESH_TOKEN ||
      !process.env.GOOGLE_ADS_CUSTOMER_ID
    ) {
      return;
    }
    fetch(googleAdsSyncUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${googleAdsSyncToken}` },
    }).catch((err) => {
      console.error("[dashboard] google ads sync trigger failed:", err?.message || err);
    });
  };

  setInterval(triggerGoogleAdsSync, googleAdsSyncIntervalMs);
  setTimeout(triggerGoogleAdsSync, 45_000);
}
