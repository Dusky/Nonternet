-- What a person allowed each app they added to do (docs/10, decided 2026-10-16): asked when adding, changeable later in
-- Settings. Installs made before this agreed to everything their app asked for at the time, so they keep that.
ALTER TABLE app_installs ADD COLUMN granted text[] NOT NULL DEFAULT '{}';
UPDATE app_installs i SET granted = ARRAY(SELECT jsonb_array_elements_text(c.manifest->'permissions'))
  FROM app_catalog c WHERE c.app_id = i.app_id;
