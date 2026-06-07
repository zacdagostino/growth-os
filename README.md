# growth-os

GrowthOS includes a real Shopify OAuth install flow for local development.

## Local Setup

1. Start frontend + integration server:

```bash
npm install
npm run dev:full
```

2. Open `http://localhost:5173/settings/app-setup` and configure:
   - Shopify client ID
   - Shopify client secret
   - Shopify scopes
   - Shopify redirect URI
   - Meta app ID
   - Meta app secret
   - Meta scopes
   - Meta redirect URI

3. In Shopify Partner Dashboard, set your app redirect URL to:
   `http://localhost:8787/api/shopify/callback`
4. Set your app URL to:
   `http://localhost:5173`
5. Launch the app from Shopify Admin. Shopify will include the `shop`
   query parameter, and GrowthOS will start the OAuth install flow automatically
   when needed.

Fallback manual flow:
- Open `http://localhost:5173/settings/integrations`
- Enter your `*.myshopify.com` domain and click `Connect Shopify`

Optional fallback:
- You can still set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in `.env` if needed.
- You can still set `META_APP_ID` and `META_APP_SECRET` in `.env` if needed.

## Meta Local Setup

1. In Meta for Developers, create a Meta app with Facebook Login enabled.
2. Add your OAuth redirect URI:
   `http://localhost:8787/api/meta/callback`
3. Configure Meta app credentials in `Settings > App Setup`.
4. Open `http://localhost:5173/settings/integrations`
5. Click `Connect` under Meta/Facebook Ads and complete OAuth.

## Important security note

This local implementation stores access tokens in `.data/shopify-connections.json`
for development convenience. In production, tokens should be encrypted at rest and
stored in a server-side database or secret manager.
