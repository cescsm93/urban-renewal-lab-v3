CREATE TABLE IF NOT EXISTS renewal.archive_editors (
  username text PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS features_layer_source_idx
  ON renewal.features(layer_id, source_feature_id);
