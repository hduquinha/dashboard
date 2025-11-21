const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  const { rows } = await client.query(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'inscricoes' AND table_name = 'inscricoes' ORDER BY ordinal_position"
  );
  console.table(rows);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
