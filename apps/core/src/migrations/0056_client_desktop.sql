-- The desktop layout (docs/10, 2026-10-13): where icons sit, which apps are hidden from the desktop, the phone order. One more
-- client document next to chat and mud, so it follows the person, is exported and is erased with them.
ALTER TABLE client_settings DROP CONSTRAINT client_settings_client_check;
ALTER TABLE client_settings ADD CONSTRAINT client_settings_client_check CHECK (client IN ('chat', 'mud', 'desktop'));
