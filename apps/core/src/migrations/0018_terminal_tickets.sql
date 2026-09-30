-- One-use sign-in tickets now serve the MUD as well as IRC (docs/09): a ticket names its service, so
-- one made for chat cannot open the MUD.
ALTER TABLE irc_tickets RENAME TO terminal_tickets;
ALTER TABLE terminal_tickets ADD COLUMN service text NOT NULL DEFAULT 'irc' CHECK (service IN ('irc', 'mud'));
ALTER INDEX irc_tickets_expiry RENAME TO terminal_tickets_expiry;
