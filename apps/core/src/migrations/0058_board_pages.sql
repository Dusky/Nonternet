-- Page numbers for boards (docs/10, 17 2026-10-18): 201, 202, … in the order boards were made, then 2100–2999. A board keeps
-- its number for good; the lowest free one goes to each new board, whichever path makes it (the boards route, ring boards).
ALTER TABLE boards ADD COLUMN page integer UNIQUE;

WITH n AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM boards)
UPDATE boards b SET page = CASE WHEN n.rn <= 99 THEN 200 + n.rn WHEN n.rn <= 999 THEN 2000 + n.rn END
FROM n WHERE n.id = b.id;

CREATE FUNCTION next_board_page() RETURNS integer LANGUAGE sql AS $$
  SELECT min(s.p) FROM (SELECT generate_series(201, 299) AS p UNION ALL SELECT generate_series(2100, 2999)) s
  WHERE NOT EXISTS (SELECT 1 FROM boards WHERE page = s.p)
$$;

CREATE FUNCTION boards_assign_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.page IS NULL THEN
    -- One board at a time takes a number, so two made at once never pick the same one.
    PERFORM pg_advisory_xact_lock(hashtext('boards.page'));
    NEW.page := next_board_page();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER boards_assign_page BEFORE INSERT ON boards FOR EACH ROW EXECUTE FUNCTION boards_assign_page();
