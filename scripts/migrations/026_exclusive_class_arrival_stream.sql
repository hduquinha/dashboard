-- Nova fila de Chegada de Leads: Aula Exclusiva / Experimental.
-- O primeiro INSERT registra um marco imutável: registros anteriores não
-- entram na fila exclusiva, mesmo se continuarem sem responsável.

CREATE TABLE IF NOT EXISTS dashboard.arrival_streams (
  stream_key TEXT PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dashboard.arrival_streams (stream_key, starts_at)
VALUES ('aula_exclusiva_experimental', NOW())
ON CONFLICT (stream_key) DO NOTHING;
