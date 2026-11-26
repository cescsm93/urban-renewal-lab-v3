CREATE TABLE IF NOT EXISTS renewal.app_files (
  id uuid PRIMARY KEY,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL,
  uploaded_by text NOT NULL REFERENCES renewal.app_users(username),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renewal.app_import_batches (
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES renewal.app_files(id),
  uploaded_by text NOT NULL REFERENCES renewal.app_users(username),
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','committed')),
  source_crs text NOT NULL,
  layer_summaries jsonb NOT NULL,
  target_layer_ids bigint[],
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_import_batches_by_user_idx
  ON renewal.app_import_batches(uploaded_by,created_at DESC);
