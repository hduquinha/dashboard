#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/adwords";
const REDIRECT_URI = "http://127.0.0.1:8085/oauth2callback";

async function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const raw = await readFile(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const rl = createInterface({ input, output });
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || (await rl.question("GOOGLE_ADS_CLIENT_ID: "));
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || (await rl.question("GOOGLE_ADS_CLIENT_SECRET: "));

  if (!clientId || !clientSecret) {
    throw new Error("Informe GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET.");
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\nAbra esta URL e autorize com a conta que acessa o Google Ads:\n");
  console.log(authUrl.toString());
  console.log(
    "\nSe o navegador mostrar uma pagina indisponivel no final, copie a URL da barra de endereco mesmo assim."
  );
  const answer = (await rl.question("\nCole o codigo de autorizacao ou a URL final: ")).trim();
  rl.close();

  if (!answer) throw new Error("Codigo de autorizacao vazio.");

  let code = answer;
  if (answer.startsWith("http://") || answer.startsWith("https://")) {
    const parsedUrl = new URL(answer);
    code = parsedUrl.searchParams.get("code") || "";
  }
  if (!code) throw new Error("Nao encontrei o parametro code na resposta informada.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    throw new Error(`Falha ao trocar codigo por refresh token (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  if (!body.refresh_token) {
    console.log("\nResposta recebida, mas sem refresh_token:");
    console.log(JSON.stringify(body, null, 2));
    console.log("\nTente remover o acesso antigo em myaccount.google.com/permissions e rode novamente.");
    return;
  }

  console.log("\nAdicione esta linha ao .env.local do dashboard:");
  console.log(`GOOGLE_ADS_REFRESH_TOKEN=${body.refresh_token}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
