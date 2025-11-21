const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  const { rows } = await client.query(
    "SELECT id, payload->>'nome' AS nome, payload->>'traffic_source' AS indicador, payload->>'treinamento' AS treinamento, criado_em FROM inscricoes.inscricoes ORDER BY criado_em DESC LIMIT 20"
  );
  console.table(rows);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
