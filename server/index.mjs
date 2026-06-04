import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || "8787");
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5173";
const DEFAULT_SHOPIFY_SCOPES =
  process.env.SHOPIFY_SCOPES || "read_products,read_orders,read_customers";
const DEFAULT_SHOPIFY_REDIRECT_URI =
  process.env.SHOPIFY_REDIRECT_URI || `http://localhost:${PORT}/api/shopify/callback`;

const dataDir = path.resolve(process.cwd(), ".data");
const storeFile = path.join(dataDir, "shopify-connections.json");
const settingsFile = path.join(dataDir, "app-settings.json");

function ensureStoreFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storeFile)) fs.writeFileSync(storeFile, "{}");
}

function readStore() {
  ensureStoreFile();
  return JSON.parse(fs.readFileSync(storeFile, "utf-8"));
}

function writeStore(next) {
  ensureStoreFile();
  fs.writeFileSync(storeFile, JSON.stringify(next, null, 2));
}

function ensureSettingsFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, "{}");
}

function readSettings() {
  ensureSettingsFile();
  return JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
}

function writeSettings(next) {
  ensureSettingsFile();
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2));
}

function masked(value) {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function getShopifyConfig() {
  const settings = readSettings();
  const saved = settings.shopifyApp || {};
  return {
    apiKey: saved.apiKey || process.env.SHOPIFY_API_KEY || "",
    apiSecret: saved.apiSecret || process.env.SHOPIFY_API_SECRET || "",
    scopes: saved.scopes || DEFAULT_SHOPIFY_SCOPES,
    redirectUri: saved.redirectUri || DEFAULT_SHOPIFY_REDIRECT_URI,
  };
}

function normalizeShop(shop) {
  const normalized = String(shop || "").trim().toLowerCase();
  const isValid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized);
  return isValid ? normalized : "";
}

function timingSafeEqual(a, b) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

app.get("/api/settings/shopify-app", (req, res) => {
  const config = getShopifyConfig();
  res.json({
    configured: Boolean(config.apiKey && config.apiSecret),
    apiKeyMasked: masked(config.apiKey),
    apiSecretMasked: masked(config.apiSecret),
    scopes: config.scopes,
    redirectUri: config.redirectUri,
  });
});

app.post("/api/settings/shopify-app", (req, res) => {
  const apiKey = String(req.body?.apiKey || "").trim();
  const apiSecret = String(req.body?.apiSecret || "").trim();
  const scopes = String(req.body?.scopes || "").trim() || DEFAULT_SHOPIFY_SCOPES;
  const redirectUri = String(req.body?.redirectUri || "").trim() || DEFAULT_SHOPIFY_REDIRECT_URI;

  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "API key and API secret are required." });
    return;
  }

  const settings = readSettings();
  settings.shopifyApp = { apiKey, apiSecret, scopes, redirectUri };
  writeSettings(settings);

  res.json({ ok: true });
});

app.get("/api/integrations/shopify/status", (req, res) => {
  const requestedShop = normalizeShop(req.query.shop);
  const connections = readStore();
  const values = Object.values(connections);

  const selected =
    (requestedShop && connections[requestedShop]) || values[0] || null;

  if (!selected) {
    res.json({ status: "not_connected" });
    return;
  }

  res.json({
    status: "connected",
    accountName: selected.shop,
    storeDomain: selected.shop,
    lastSyncAt: selected.connectedAt,
  });
});

app.get("/api/shopify/install", (req, res) => {
  const config = getShopifyConfig();
  if (!config.apiKey || !config.apiSecret) {
    res.status(500).json({
      error:
        "Shopify credentials are missing. Configure Shopify app credentials in Settings.",
    });
    return;
  }

  const shop = normalizeShop(req.query.shop);
  if (!shop) {
    res.status(400).json({ error: "Invalid shop domain." });
    return;
  }

  const state = crypto.randomBytes(18).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const store = readStore();
  store.__states = store.__states || {};
  store.__states[state] = { shop, expiresAt };
  writeStore(store);

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", config.apiKey);
  authUrl.searchParams.set("scope", config.scopes);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("state", state);

  res.redirect(authUrl.toString());
});

app.get("/api/shopify/callback", async (req, res) => {
  const config = getShopifyConfig();
  if (!config.apiKey || !config.apiSecret) {
    res.status(500).send("Missing Shopify app credentials.");
    return;
  }

  const shop = normalizeShop(req.query.shop);
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const hmac = String(req.query.hmac || "");

  if (!shop || !code || !state || !hmac) {
    res.status(400).send("Missing required OAuth callback parameters.");
    return;
  }

  const store = readStore();
  const expectedState = store.__states?.[state];
  if (!expectedState || expectedState.shop !== shop || expectedState.expiresAt < Date.now()) {
    res.status(400).send("Invalid or expired OAuth state.");
    return;
  }

  const params = new URLSearchParams(req.url.split("?")[1] || "");
  params.delete("hmac");
  const message = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", config.apiSecret)
    .update(message)
    .digest("hex");

  if (!timingSafeEqual(generatedHmac, hmac)) {
    res.status(400).send("HMAC validation failed.");
    return;
  }

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.apiKey,
      client_secret: config.apiSecret,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    res.status(502).send(`Failed to retrieve Shopify access token: ${body}`);
    return;
  }

  const tokenData = await tokenResponse.json();
  const refreshed = readStore();
  delete refreshed.__states?.[state];
  refreshed[shop] = {
    shop,
    accessToken: tokenData.access_token,
    scope: tokenData.scope,
    connectedAt: new Date().toISOString(),
  };
  writeStore(refreshed);

  res.redirect(`${APP_BASE_URL}/settings/integrations?shopify=connected&shop=${encodeURIComponent(shop)}`);
});

app.post("/api/integrations/shopify/disconnect", (req, res) => {
  const shop = normalizeShop(req.body?.shop);
  if (!shop) {
    res.status(400).json({ error: "Invalid shop domain." });
    return;
  }

  const store = readStore();
  if (store[shop]) delete store[shop];
  writeStore(store);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`GrowthOS integration server listening on http://localhost:${PORT}`);
});
