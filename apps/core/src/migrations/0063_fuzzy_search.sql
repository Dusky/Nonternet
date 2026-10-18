-- Search that forgives (docs/14, 17 2026-10-18): prefix, typo and accent-insensitive matching on short fields, beside
-- the existing full-text search on bodies. Both extensions ship with Postgres and are "trusted", so the database
-- owner can add them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- One folding for every search: lower case, no accents. unaccent() is only STABLE, so this IMMUTABLE wrapper names its dictionary so
-- the result cannot change with search_path (and could be indexed later if a site grows).
CREATE FUNCTION f_search(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, t)) $$;
