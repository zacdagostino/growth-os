# growth-os

GrowthOS includes a real Shopify OAuth install flow for local development.

## Local Setup

1. Start frontend + integration server:

```bash
npm install
npm run dev:full
```

2. Open `http://localhost:5173/settings/app-setup` and configure:
   - Shopify API key
   - Shopify API secret
   - scopes
   - redirect URI

3. In Shopify Partner Dashboard, set your app redirect URL to:
   `http://localhost:8787/api/shopify/callback`

4. Open `http://localhost:5173/settings/integrations`
5. Enter your `*.myshopify.com` domain and click `Connect Shopify`

Optional fallback:
- You can still set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in `.env` if needed.

## Important security note

This local implementation stores access tokens in `.data/shopify-connections.json`
for development convenience. In production, tokens should be encrypted at rest and
stored in a server-side database or secret manager.
