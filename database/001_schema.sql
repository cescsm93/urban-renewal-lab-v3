CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS renewal;

CREATE TABLE IF NOT EXISTS renewal.workspaces (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renewal.layers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES renewal.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  source_filename text,
  source_crs text,
  registration_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS layers_workspace_idx ON renewal.layers(workspace_id);

CREATE TABLE IF NOT EXISTS renewal.features (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  layer_id bigint NOT NULL REFERENCES renewal.layers(id) ON DELETE CASCADE,
  source_feature_id text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(Geometry, 4326) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT feature_geometry_valid CHECK (ST_IsValid(geom)),
  CONSTRAINT feature_lonlat_bounds CHECK (
    ST_XMin(geom) >= -180 AND ST_XMax(geom) <= 180 AND
    ST_YMin(geom) >= -90 AND ST_YMax(geom) <= 90
  )
);
CREATE INDEX IF NOT EXISTS features_layer_idx ON renewal.features(layer_id);
CREATE INDEX IF NOT EXISTS features_geom_gist ON renewal.features USING GIST(geom);
CREATE INDEX IF NOT EXISTS features_properties_gin ON renewal.features USING GIN(properties);

-- A project may contain parcels; a parcel may contain buildings. Preserve
-- original layers and fields rather than forcing imported archives into one form.
CREATE TABLE IF NOT EXISTS renewal.feature_links (
  parent_id bigint NOT NULL REFERENCES renewal.features(id) ON DELETE CASCADE,
  child_id bigint NOT NULL REFERENCES renewal.features(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  PRIMARY KEY (parent_id, child_id, relation_type),
  CONSTRAINT different_features CHECK (parent_id <> child_id)
);
CREATE INDEX IF NOT EXISTS feature_links_child_idx ON renewal.feature_links(child_id);

CREATE TABLE IF NOT EXISTS renewal.analysis_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES renewal.workspaces(id) ON DELETE CASCADE,
  subject_feature_id bigint REFERENCES renewal.features(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_runs_workspace_idx
  ON renewal.analysis_runs(workspace_id, created_at DESC);
