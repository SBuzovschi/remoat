# Security Policy

## Security Model

Remoat is designed to run on your local machine with no external attack surface.

### Network

- **No inbound connections.** The bot uses Telegram's long-polling API (outbound HTTPS only). No webhooks, no open ports, no port forwarding.
- **CDP is local-only.** The WebSocket connection to Antigravity binds to `127.0.0.1`. It never leaves your machine.

### Authentication

- **Whitelist-based access control.** Every incoming Telegram message and callback query is checked against `ALLOWED_USER_IDS` before any processing occurs. Unauthorized messages are silently dropped.
- **No multi-tenancy.** Remoat is a single-user tool. The whitelist is an additional safety layer, not a shared-access mechanism.

### Credential Storage

- Bot tokens and user IDs are stored in a local `.env` file (or `~/.remoat/config.json` when installed via npm).
- The `.env` file is excluded from version control via `.gitignore`.
- We recommend setting restrictive file permissions: `chmod 600 .env`.

### Filesystem Access

- All workspace path operations are resolved against `WORKSPACE_BASE_DIR` using `path.resolve()` to prevent directory traversal.
- The bot cannot access directories outside the configured workspace root.

### Data Handling

- **No telemetry.** Remoat does not collect, transmit, or store analytics data.
- **No cloud storage.** Session data, workspace bindings, and templates are stored in a local SQLite database (`antigravity.db`).
- **Voice transcription is local.** Voice messages are transcribed on-device via whisper.cpp. Audio is never sent to external services.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Best Practices for Users

1. Keep `ALLOWED_USER_IDS` limited to your own Telegram account
2. Set file permissions on `.env`: `chmod 600 .env`
3. Don't share your bot token — if compromised, revoke it via [@BotFather](https://t.me/BotFather) and run `remoat setup` again
4. Run `remoat doctor` periodically to verify your configuration
5. Keep Remoat and its dependencies up to date
