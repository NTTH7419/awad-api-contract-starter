-- Successful /v1 order submissions are retained so retries can replay the
-- original response without creating another order.
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  response_body TEXT NOT NULL,
  location      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
