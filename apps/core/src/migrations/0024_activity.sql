-- Which days each person used the site (docs/11 stats: active users and retention cohorts). One row per
-- person per day, whichever way they came in; nothing about what they did. Kept 400 days.
CREATE TABLE activity_days (
  user_id text NOT NULL REFERENCES users (id),
  day date NOT NULL,
  services text[] NOT NULL DEFAULT '{}',              -- web, irc, mud
  PRIMARY KEY (user_id, day)
);
CREATE INDEX activity_days_day ON activity_days (day);
