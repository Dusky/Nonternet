// Forgiving matches for search (docs/14): a query that is part of a word, has a typo or lacks an accent still finds
// "postgres", "Café" and "Getting started". Full-text search keeps doing the body text; this covers short fields
// (titles, subjects, addresses, memos). Uses pg_trgm with the f_search() wrapper from migration 0063.

// Too short a query matches almost everything by trigrams, so below this only full-text search runs.
export const FUZZY_MIN = 3;

// How alike a query and a word must be: 0.5 forgives a missing, extra or changed letter in most words ("lumire",
// "potery"); swapped letters in a short word often score lower, and are left to full-text search.
export const FUZZY_THRESHOLD = 0.5;

// SQL that is true when `col` loosely matches the query parameter `p` (both are SQL expressions). Searches here run
// within one person's things, one wiki or the boards a person can read on a small site, so they read the rows directly
// rather than keeping trigram indexes.
export const fuzzy = (col: string, p: string) => `(strpos(f_search(${col}), f_search(${p})) > 0 OR ${closeness(col, p)} >= ${FUZZY_THRESHOLD})`;
// How close a loose match is, for ordering: 1 for an exact word, less for a near one.
export const closeness = (col: string, p: string) => `word_similarity(f_search(${p}), f_search(${col}))`;
export const isFuzzy = (q: string | undefined): q is string => typeof q === 'string' && [...q.trim()].length >= FUZZY_MIN;
