CREATE TABLE IF NOT EXISTS renewal.workspace_catalog (
  workspace_id bigint PRIMARY KEY REFERENCES renewal.workspaces(id) ON DELETE CASCADE,
  catalog_kind text NOT NULL CHECK (catalog_kind IN ('province','company'))
);

CREATE TABLE IF NOT EXISTS renewal.project_layer_sources (
  layer_id bigint PRIMARY KEY REFERENCES renewal.layers(id) ON DELETE CASCADE,
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[a-f0-9]{64}$'),
  gdb_layer text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
