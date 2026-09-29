# Enigma bridge (M0 spike)

Stub of the bridge described in `docs/04-bbs-enigma.md`. Not production code. Findings are in
`docs/spikes/m0-enigma.md`.

| File | Goes to (inside an Enigma checkout) | Purpose |
|---|---|---|
| `bridge.js` | `core/servers/content/web_handlers/bridge.js` | webHandlers module: `POST /bridge/users`, `/areas`, `/areas/:tag/messages`, `/tickets`; wraps `authenticateFactor1` for `authType: 'ticket'` |
| `ws_ticket.js` | `core/servers/login/websocket_ticket.js` | Copy of Enigma's WebSocket login server that logs in from `?handle=&ticket=` and starts at `sshConnected` |

Config (`config.hjson`): enable `contentServers.web.http`, add `contentServers.web.handlers.bridge`
`{ enabled: true, secret: … }`, and add `loginServers.webSocketTicket.ws` `{ enabled: true, port: 8812 }`.
Enigma's own `restApi` handler stays off.

`spike/` holds the scripts used for the runtime checks (set `ENIGMA_DIR` for the Node one).
