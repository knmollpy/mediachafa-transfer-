# MediaChafa Discord Bot

This bot is implemented inside the `mediachafa-beta-ai` Worker and a SQLite-backed Durable Object.

## Behavior

- Listens only to the configured Discord guild and channel.
- Ignores bots, webhooks, empty messages, duplicate events, and rapid repeats from the same user.
- Answers catalog questions in Spanish; lists public games; returns a download URL only when explicitly requested.
- Reads only `public.ps4_games` through the public/anonymous Data API and relies on the existing RLS policy. It does not query `media_links`, private rows, user profiles, or private project context.
- Uses MediaChafa's already-connected, zero-cost-verified inference providers only to classify ambiguous game-title queries. The model can select exact titles from the supplied public list; the server validates every title and obtains the actual URL itself.
- Does not expose the owner's chat endpoint, saved memory, tools, integrations, or administrative actions.

## Required Cloudflare configuration

Set these as Worker secrets/variables in the `mediachafa-beta-ai` environment:

- Secret `DISCORD_BOT_TOKEN`: bot token from Discord Developer Portal. Never commit or paste it into chat.
- Secret `DISCORD_CONTROL_SECRET`: long random control secret (at least 32 random bytes, base64 or hex encoded).
- Variable `DISCORD_GUILD_ID`: numeric ID of the Discord server.
- Variable `DISCORD_CHANNEL_ID`: numeric ID of the dedicated game-requests channel.

The Wrangler Durable Object binding and SQLite migration are declared in `wrangler.toml`.

## Discord Developer Portal

Enable the privileged **Message Content Intent** for the bot. No presence or server-members intent is needed.

Invite with the `bot` scope and only these permissions:
- View Channels
- Send Messages
- Read Message History

The bot should be granted access only to the dedicated channel (and the minimum server-level permissions needed to see it).

## Control endpoints

All control endpoints require `Authorization: Bearer <DISCORD_CONTROL_SECRET>`:

- `GET /discord/status`
- `POST /discord/start`
- `POST /discord/stop`

Do not publish the control secret in a browser client or repository. Use a trusted administrative environment only.

## Cost and operations

An outbound Discord Gateway WebSocket cannot use Durable Object WebSocket hibernation. Cloudflare documents that outbound WebSockets keep a Durable Object active, and that active operations can incur duration charges. The Free plan currently includes 13,000 GB-seconds/day for Durable Objects; a continuously active connection can consume a substantial part of that allowance depending on actual memory use. Do not start the bot until account usage and spending controls have been reviewed.

## Deployment checklist

1. Review this branch and its tests.
2. Configure the two secrets and two IDs above.
3. Verify the account's Durable Objects Free allowance and set a spending limit if available.
4. Deploy the Worker and its Durable Object migration.
5. Start the bot through the authenticated control endpoint.
6. Verify status is `ready` and test a catalog lookup in the configured channel.
