ALTER TABLE renewal.layers
  ADD COLUMN IF NOT EXISTS field_order text[] NOT NULL DEFAULT '{}'::text[];

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_name_unique
  ON renewal.workspaces(name);
CREATE UNIQUE INDEX IF NOT EXISTS layers_workspace_name_unique
  ON renewal.layers(workspace_id, name);
