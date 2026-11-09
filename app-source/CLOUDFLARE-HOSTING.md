# Cloudflare Pages hosting

The public MediaChafa web app is published from this repository's `main` branch to Cloudflare Pages.

Project: `mediachafa-transfer`
Production URL: https://mediachafa-transfer.pages.dev

Cloudflare Pages build output is generated from the root site shell and the `app-source`, `icons`, and `downloads` directories. Authentication, database, storage, Beta AI, task workflows, and existing Cloudflare Workers remain external services and are not replaced by static hosting.

Production changes are published by merging to `main`; pull request previews are isolated from production.
