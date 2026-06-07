import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || "8787");
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5173";
const META_GRAPH_VERSION = "v23.0";
const DEFAULT_SHOPIFY_SCOPES =
  process.env.SHOPIFY_SCOPES || "read_products,read_orders,read_customers,read_themes";
const DEFAULT_SHOPIFY_REDIRECT_URI =
  process.env.SHOPIFY_REDIRECT_URI || `http://localhost:${PORT}/api/shopify/callback`;
const DEFAULT_SHOPIFY_DISTRIBUTION_LINK =
  process.env.SHOPIFY_DISTRIBUTION_LINK ||
  "https://admin.shopify.com/oauth/install_custom_app?client_id=c964186bafd19dbf0caf084efabc581d&no_redirect=true&signature=eyJleHBpcmVzX2F0IjoxNzgxMTU3MjY4LCJwZXJtYW5lbnRfZG9tYWluIjoieWE3ZmN0LXh2Lm15c2hvcGlmeS5jb20iLCJjbGllbnRfaWQiOiJjOTY0MTg2YmFmZDE5ZGJmMGNhZjA4NGVmYWJjNTgxZCIsInB1cnBvc2UiOiJjdXN0b21fYXBwIiwibWVyY2hhbnRfb3JnYW5pemF0aW9uX2lkIjoxODg0NDY4MzV9--29065aacfcce4e0afafe61b5a087019ddf76d918";
const DEFAULT_META_SCOPES =
  process.env.META_SCOPES || "ads_read,business_management";
const DEFAULT_META_REDIRECT_URI =
  process.env.META_REDIRECT_URI || `http://localhost:${PORT}/api/meta/callback`;

const dataDir = path.resolve(process.cwd(), ".data");
const storeFile = path.join(dataDir, "shopify-connections.json");
const settingsFile = path.join(dataDir, "app-settings.json");
const metaStoreFile = path.join(dataDir, "meta-connections.json");
const SHOPIFY_API_VERSION = "2026-04";

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

function ensureMetaStoreFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(metaStoreFile)) fs.writeFileSync(metaStoreFile, "{}");
}

function readSettings() {
  ensureSettingsFile();
  return JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
}

function writeSettings(next) {
  ensureSettingsFile();
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2));
}

function readMetaStore() {
  ensureMetaStoreFile();
  return JSON.parse(fs.readFileSync(metaStoreFile, "utf-8"));
}

function writeMetaStore(next) {
  ensureMetaStoreFile();
  fs.writeFileSync(metaStoreFile, JSON.stringify(next, null, 2));
}

function masked(value) {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function normalizeScopes(value) {
  return String(value || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope && scope !== "read_images")
    .join(",");
}

function getShopifyConfig() {
  const settings = readSettings();
  const saved = settings.shopifyApp || {};
  return {
    apiKey: saved.apiKey || process.env.SHOPIFY_API_KEY || "",
    apiSecret: saved.apiSecret || process.env.SHOPIFY_API_SECRET || "",
    scopes: normalizeScopes(saved.scopes || DEFAULT_SHOPIFY_SCOPES),
    redirectUri: saved.redirectUri || DEFAULT_SHOPIFY_REDIRECT_URI,
    defaultShopDomain: saved.defaultShopDomain || "",
    distributionLink: saved.distributionLink || DEFAULT_SHOPIFY_DISTRIBUTION_LINK,
  };
}

function getMetaConfig() {
  const settings = readSettings();
  const saved = settings.metaApp || {};
  return {
    appId: saved.appId || process.env.META_APP_ID || "",
    appSecret: saved.appSecret || process.env.META_APP_SECRET || "",
    scopes: saved.scopes || DEFAULT_META_SCOPES,
    redirectUri: saved.redirectUri || DEFAULT_META_REDIRECT_URI,
  };
}

function normalizeShop(shop) {
  const normalized = String(shop || "").trim().toLowerCase();
  const isValid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized);
  return isValid ? normalized : "";
}

function getConnectedShop(shop) {
  const connections = readStore();
  if (shop && connections[shop]?.accessToken) return connections[shop];

  return Object.values(connections).find(
    (connection) =>
      connection &&
      typeof connection === "object" &&
      connection.shop &&
      connection.accessToken,
  );
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseDateInput(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function buildUtcRange(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start || !end || start > end) return null;

  return {
    start,
    end,
    startIso: `${start}T00:00:00.000Z`,
    endIso: `${end}T23:59:59.999Z`,
  };
}

async function shopifyAdminFetch(shop, accessToken, pathname, searchParams = {}) {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function shopifyAdminGraphql(shop, accessToken, query, variables = {}) {
  const response = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((error) => error.message).join("; ") ||
      `Shopify GraphQL request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload.data;
}

async function metaGraphFetch(pathname, searchParams = {}) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const message =
      payload.error?.message ||
      `Meta Graph request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

async function metaOAuthFetch(searchParams = {}) {
  const url = new URL("https://graph.facebook.com/oauth/access_token");
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error
      ? ` (${error.cause.message})`
      : "";
    throw new Error(`Meta OAuth network request failed${cause}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Meta OAuth returned a non-JSON response (${response.status}): ${text.slice(0, 240)}`);
  }

  if (!response.ok || payload.error) {
    const message =
      payload.error?.message ||
      `Meta OAuth request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

async function fetchUsdAudRate() {
  const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD", {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`FX rate request failed (${response.status}).`);
  }

  const payload = await response.json();
  const rate = Number(payload?.rates?.AUD);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("FX rate payload did not include a valid AUD quote.");
  }

  return {
    rate,
    effectiveDate: payload?.date || "",
  };
}

function getMetaConnection() {
  const store = readMetaStore();
  return store.connection || null;
}

function findThemeSettingValue(current, candidates) {
  for (const key of candidates) {
    const value = current?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickBrandColor(current) {
  const explicit = findThemeSettingValue(current, [
    "color_button",
    "color_primary",
    "primary_color",
    "brand_color",
    "accent_color",
    "color_accent",
    "colors_accent_1",
    "color_link",
  ]);

  if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(explicit)) return explicit;

  for (const [key, value] of Object.entries(current || {})) {
    if (
      /color|accent|primary|brand/i.test(key) &&
      typeof value === "string" &&
      /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value) &&
      !["#ffffff", "#fff", "#000000", "#000"].includes(value.toLowerCase())
    ) {
      return value;
    }
  }

  return "";
}

function normalizeLogoReference(current) {
  return findThemeSettingValue(current, [
    "logo",
    "logo_image",
    "header_logo",
    "brand_logo",
    "logo_desktop",
  ]);
}

async function resolveThemeLogoUrl(shop, accessToken, logoRef) {
  if (!logoRef) return "";
  if (/^https?:\/\//i.test(logoRef)) return logoRef;

  if (logoRef.startsWith("shopify://")) {
    const filename = logoRef.split("/").pop() || "";
    if (!filename) return "";
    const data = await shopifyAdminGraphql(
      shop,
      accessToken,
      `query ThemeLogo($query: String!) {
        files(first: 10, query: $query) {
          nodes {
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      }`,
      { query: `filename:${filename}` },
    );

    const match = data?.files?.nodes?.find((node) => node?.image?.url);
    return match?.image?.url || "";
  }

  return "";
}

function isHexColor(value) {
  return /^#([0-9a-f]{6})$/i.test(String(value || "").trim());
}

function isSafeLogoValue(value) {
  const input = String(value || "").trim();
  if (!input) return true;
  if (/^https?:\/\//i.test(input)) return true;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+$/.test(input);
}

function getUiConfig() {
  const settings = readSettings();
  const saved = settings.ui || {};
  const appColor = isHexColor(saved.appColor) ? saved.appColor : "";
  const logoUrl = isSafeLogoValue(saved.logoUrl) ? String(saved.logoUrl || "").trim() : "";
  return { appColor, logoUrl };
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
    clientId: config.apiKey,
    clientSecret: config.apiSecret,
    apiKeyMasked: masked(config.apiKey),
    apiSecretMasked: masked(config.apiSecret),
    scopes: config.scopes,
    redirectUri: config.redirectUri,
    defaultShopDomain: config.defaultShopDomain,
    distributionLink: config.distributionLink,
  });
});

app.get("/api/settings/meta-app", (req, res) => {
  const config = getMetaConfig();
  res.json({
    configured: Boolean(config.appId && config.appSecret),
    appId: config.appId,
    appSecret: config.appSecret,
    appIdMasked: masked(config.appId),
    appSecretMasked: masked(config.appSecret),
    scopes: config.scopes,
    redirectUri: config.redirectUri,
  });
});

app.get("/api/settings/ui", (req, res) => {
  const config = getUiConfig();
  res.json(config);
});

app.post("/api/settings/shopify-app", (req, res) => {
  const settings = readSettings();
  const saved = settings.shopifyApp || {};
  const apiKey = String(req.body?.clientId || req.body?.apiKey || "").trim();
  const apiSecret = String(
    req.body?.clientSecret || req.body?.apiSecret || "",
  ).trim();
  const scopes = normalizeScopes(req.body?.scopes || DEFAULT_SHOPIFY_SCOPES);
  const redirectUri =
    String(req.body?.redirectUri || "").trim() || DEFAULT_SHOPIFY_REDIRECT_URI;
  const defaultShopDomain = normalizeShop(req.body?.defaultShopDomain) || saved.defaultShopDomain || "";
  const distributionLink =
    String(req.body?.distributionLink || "").trim() ||
    saved.distributionLink ||
    DEFAULT_SHOPIFY_DISTRIBUTION_LINK;
  const nextApiKey = apiKey || saved.apiKey || "";
  const nextApiSecret = apiSecret || saved.apiSecret || "";

  if (!nextApiKey || !nextApiSecret) {
    res.status(400).json({ error: "Client ID and client secret are required." });
    return;
  }

  settings.shopifyApp = {
    apiKey: nextApiKey,
    apiSecret: nextApiSecret,
    scopes,
    redirectUri,
    defaultShopDomain,
    distributionLink,
  };
  writeSettings(settings);

  res.json({
    ok: true,
    configured: true,
    clientId: nextApiKey,
    clientSecret: nextApiSecret,
    apiKeyMasked: masked(nextApiKey),
    apiSecretMasked: masked(nextApiSecret),
    scopes,
    redirectUri,
    defaultShopDomain,
    distributionLink,
  });
});

app.post("/api/settings/meta-app", (req, res) => {
  const settings = readSettings();
  const saved = settings.metaApp || {};
  const appId = String(req.body?.appId || "").trim();
  const appSecret = String(req.body?.appSecret || "").trim();
  const scopes = String(req.body?.scopes || "").trim() || DEFAULT_META_SCOPES;
  const redirectUri =
    String(req.body?.redirectUri || "").trim() || DEFAULT_META_REDIRECT_URI;
  const nextAppId = appId || saved.appId || "";
  const nextAppSecret = appSecret || saved.appSecret || "";

  if (!nextAppId || !nextAppSecret) {
    res.status(400).json({ error: "Meta app ID and app secret are required." });
    return;
  }

  settings.metaApp = {
    appId: nextAppId,
    appSecret: nextAppSecret,
    scopes,
    redirectUri,
  };
  writeSettings(settings);

  res.json({
    ok: true,
    configured: true,
    appId: nextAppId,
    appSecret: nextAppSecret,
    appIdMasked: masked(nextAppId),
    appSecretMasked: masked(nextAppSecret),
    scopes,
    redirectUri,
  });
});

app.post("/api/settings/ui", (req, res) => {
  const settings = readSettings();
  const requestedColor = String(req.body?.appColor || "").trim();
  const requestedLogoUrl = String(req.body?.logoUrl || "").trim();
  const appColor = isHexColor(requestedColor) ? requestedColor : "";
  if (!isSafeLogoValue(requestedLogoUrl)) {
    res.status(400).json({ error: "Logo URL must be an https URL or uploaded image data." });
    return;
  }
  const logoUrl = requestedLogoUrl;

  settings.ui = {
    ...(settings.ui || {}),
    appColor,
    logoUrl,
  };
  writeSettings(settings);

  res.json({
    ok: true,
    appColor,
    logoUrl,
  });
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

app.get("/api/integrations/meta/status", (req, res) => {
  const connection = getMetaConnection();
  if (!connection?.accessToken || !connection?.accountId) {
    res.json({ status: "not_connected" });
    return;
  }

  res.json({
    status: "connected",
    accountName: connection.accountName,
    accountId: connection.accountId,
    currency: connection.currency || "AUD",
    lastSyncAt: connection.connectedAt,
  });
});

app.get("/api/market/fx/usd-aud", async (req, res) => {
  try {
    const quote = await fetchUsdAudRate();
    res.json({
      pair: "USD/AUD",
      rate: quote.rate,
      effectiveDate: quote.effectiveDate,
      fetchedAt: new Date().toISOString(),
      source: "Frankfurter (ECB reference data)",
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Could not load USD/AUD rate.",
    });
  }
});

app.get("/api/meta/connect", (req, res) => {
  const config = getMetaConfig();
  if (!config.appId || !config.appSecret) {
    res.status(500).json({
      error: "Meta app credentials are missing. Configure Meta app settings first.",
    });
    return;
  }

  const state = crypto.randomBytes(18).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const store = readMetaStore();
  store.__states = store.__states || {};
  store.__states[state] = { expiresAt };
  writeMetaStore(store);

  const authUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", config.appId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", config.scopes);

  res.redirect(authUrl.toString());
});

app.get("/api/meta/callback", async (req, res) => {
  try {
    const config = getMetaConfig();
    if (!config.appId || !config.appSecret) {
      res.status(500).send("Missing Meta app credentials.");
      return;
    }

    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const errorReason = String(req.query.error_reason || req.query.error || "");

    if (errorReason) {
      res.status(400).send(`Meta authorization failed: ${errorReason}`);
      return;
    }

    if (!code || !state) {
      res.status(400).send("Missing required Meta OAuth callback parameters.");
      return;
    }

    const store = readMetaStore();
    const expectedState = store.__states?.[state];
    if (!expectedState || expectedState.expiresAt < Date.now()) {
      res.status(400).send("Invalid or expired Meta OAuth state.");
      return;
    }

    const tokenPayload = await metaOAuthFetch({
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code,
    });

    const longLivedPayload = await metaOAuthFetch({
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: tokenPayload.access_token,
    });

    const accessToken = longLivedPayload.access_token || tokenPayload.access_token;
    const accountsPayload = await metaGraphFetch("me/adaccounts", {
      access_token: accessToken,
      fields: "id,name,account_status,currency",
      limit: 50,
    });

    const accounts = Array.isArray(accountsPayload.data) ? accountsPayload.data : [];
    const selectedAccount = accounts.find((account) => account.id && account.name) || null;
    if (!selectedAccount) {
      res.status(400).send("No accessible Meta ad accounts were found for this user.");
      return;
    }

    const refreshed = readMetaStore();
    delete refreshed.__states?.[state];
    refreshed.connection = {
      accountId: String(selectedAccount.id),
      accountName: selectedAccount.name,
      accessToken,
      scopes: config.scopes,
      currency: selectedAccount.currency || "USD",
      connectedAt: new Date().toISOString(),
    };
    writeMetaStore(refreshed);

    res.redirect(`${APP_BASE_URL}/settings/integrations?meta=connected`);
  } catch (error) {
    console.error("Meta callback failed:", error);
    res.status(502).send(
      error instanceof Error
        ? error.message
        : "Meta connection failed.",
    );
  }
});

app.post("/api/integrations/meta/disconnect", (req, res) => {
  const store = readMetaStore();
  delete store.connection;
  writeMetaStore(store);
  res.json({ ok: true });
});

app.get("/api/imports/shopify/products", async (req, res) => {
  try {
    const requestedShop = normalizeShop(req.query.shop);
    const connection = getConnectedShop(requestedShop);
    const dateRange = buildUtcRange(req.query.start, req.query.end);

    if (!connection?.shop || !connection?.accessToken) {
      res.status(404).json({ error: "No connected Shopify store found." });
      return;
    }

    const payload = await shopifyAdminFetch(
      connection.shop,
      connection.accessToken,
      "orders.json",
      {
        status: "any",
        limit: 250,
        fields:
          "id,line_items,refunds,financial_status,cancelled_at,created_at",
        created_at_min: dateRange?.startIso,
        created_at_max: dateRange?.endIso,
      },
    );

    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    const byProduct = new Map();

    for (const order of orders) {
      if (!Array.isArray(order.line_items)) continue;
      const refundQuantities = new Map();

      if (Array.isArray(order.refunds)) {
        for (const refund of order.refunds) {
          if (!Array.isArray(refund.refund_line_items)) continue;
          for (const refunded of refund.refund_line_items) {
            const lineItemId = String(refunded.line_item_id || "");
            const quantity = Number(refunded.quantity || 0);
            refundQuantities.set(
              lineItemId,
              (refundQuantities.get(lineItemId) || 0) + quantity,
            );
          }
        }
      }

      for (const item of order.line_items) {
        const productId = item.product_id
          ? `gid://shopify/Product/${item.product_id}`
          : `line-item-${item.id}`;
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.price || 0);
        const discount = Number(item.total_discount || 0);
        const grossSales = unitPrice * quantity;
        const refundedQuantity = Math.min(
          quantity,
          Number(refundQuantities.get(String(item.id || "")) || 0),
        );
        const refunds = refundedQuantity * unitPrice;
        const netSales = grossSales - discount - refunds;

        if (!byProduct.has(productId)) {
          byProduct.set(productId, {
            productTitle: item.title || "Untitled product",
            shopifyProductId: productId,
            productImageUrl: item.image?.src || "",
            productNumericId: item.product_id ? String(item.product_id) : "",
            price: unitPrice,
            orders: 0,
            revenue: 0,
            refunds: 0,
            grossSales: 0,
            netSales: 0,
            _orderIds: new Set(),
          });
        }

        const summary = byProduct.get(productId);
        summary.productTitle = item.title || summary.productTitle;
        summary.productImageUrl = summary.productImageUrl || item.image?.src || "";
        summary.productNumericId =
          summary.productNumericId || (item.product_id ? String(item.product_id) : "");
        summary.price = unitPrice || summary.price;
        summary._orderIds.add(order.id);
        summary.revenue += grossSales - discount;
        summary.refunds += refunds;
        summary.grossSales += grossSales;
        summary.netSales += netSales;
      }
    }

    const missingImageIds = [...byProduct.values()]
      .filter((summary) => !summary.productImageUrl && summary.productNumericId)
      .map((summary) => summary.productNumericId);

    for (const ids of chunkItems([...new Set(missingImageIds)], 100)) {
      const productsPayload = await shopifyAdminFetch(
        connection.shop,
        connection.accessToken,
        "products.json",
        {
          ids: ids.join(","),
          fields: "id,image,images",
          limit: ids.length,
        },
      );

      const products = Array.isArray(productsPayload.products)
        ? productsPayload.products
        : [];
      const imageById = new Map(
        products.map((product) => [
          String(product.id),
          product.image?.src || product.images?.[0]?.src || "",
        ]),
      );

      for (const summary of byProduct.values()) {
        if (summary.productImageUrl || !summary.productNumericId) continue;
        summary.productImageUrl = imageById.get(summary.productNumericId) || "";
      }
    }

    const products = [...byProduct.values()]
      .map((summary) => ({
        productTitle: summary.productTitle,
        shopifyProductId: summary.shopifyProductId,
        productImageUrl: summary.productImageUrl,
        price: summary.price,
        orders: summary._orderIds.size,
        revenue: summary.revenue,
        refunds: summary.refunds,
        grossSales: summary.grossSales,
        netSales: summary.netSales,
      }))
      .sort((first, second) => second.netSales - first.netSales);

    res.json({
      shop: connection.shop,
      importedAt: new Date().toISOString(),
      range: dateRange ? { start: dateRange.start, end: dateRange.end } : null,
      productCount: products.length,
      products,
    });
  } catch (error) {
    res.status(502).json({
      error:
        error instanceof Error ? error.message : "Could not load Shopify imports.",
    });
  }
});

app.get("/api/branding/shopify", async (req, res) => {
  try {
    const requestedShop = normalizeShop(req.query.shop);
    const connection = getConnectedShop(requestedShop);

    if (!connection?.shop || !connection?.accessToken) {
      res.status(404).json({ error: "No connected Shopify store found." });
      return;
    }

    let shop = {};
    let logoUrl = "";
    let primaryColor = "";

    try {
      const brandData = await shopifyAdminGraphql(
        connection.shop,
        connection.accessToken,
        `
          query GrowthOsShopBranding {
            shop {
              name
              myshopifyDomain
              brand {
                logo {
                  image {
                    url
                  }
                }
                squareLogo {
                  image {
                    url
                  }
                }
                colors {
                  primary {
                    background
                  }
                }
              }
            }
          }
        `,
      );

      shop = brandData?.shop || {};
      logoUrl =
        shop.brand?.squareLogo?.image?.url ||
        shop.brand?.logo?.image?.url ||
        "";
      primaryColor = isHexColor(shop.brand?.colors?.primary?.background)
        ? shop.brand.colors.primary.background
        : "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/Field 'brand' doesn't exist on type 'Shop'/i.test(message)) {
        throw error;
      }
    }

    if (!shop?.name || !shop?.myshopifyDomain) {
      const shopData = await shopifyAdminFetch(
        connection.shop,
        connection.accessToken,
        "shop.json",
      );
      shop = shopData?.shop || {};
    }

    if (!logoUrl || !primaryColor) {
      const themesData = await shopifyAdminFetch(
        connection.shop,
        connection.accessToken,
        "themes.json",
        { role: "main" },
      );

      const theme = Array.isArray(themesData.themes) ? themesData.themes[0] : null;
      if (theme?.id) {
        const assetData = await shopifyAdminFetch(
          connection.shop,
          connection.accessToken,
          `themes/${theme.id}/assets.json`,
          { "asset[key]": "config/settings_data.json" },
        );

        const rawSettings = assetData?.asset?.value || "{}";
        const parsedSettings = JSON.parse(rawSettings);
        const current = parsedSettings?.current || {};

        if (!primaryColor) primaryColor = pickBrandColor(current);
        if (!logoUrl) {
          const logoRef = normalizeLogoReference(current);
          logoUrl = await resolveThemeLogoUrl(
            connection.shop,
            connection.accessToken,
            logoRef,
          );
        }
      }
    }

    res.json({
      shop: connection.shop,
      shopName: shop.name || connection.shop,
      shopDomain: shop.myshopifyDomain || shop.domain || connection.shop,
      logoUrl,
      primaryColor,
      requiresThemesScope: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load Shopify branding.";
    const requiresThemesScope = /read_themes|scope|forbidden|access denied/i.test(message);

    res.status(requiresThemesScope ? 403 : 502).json({
      error: message,
      requiresThemesScope,
    });
  }
});

app.get("/api/imports/meta-ads", async (req, res) => {
  try {
    const connection = getMetaConnection();
    const rangePreset = String(req.query.preset || "").trim().toLowerCase();
    const isAllTimeRange = rangePreset === "all";
    const dateRange = buildUtcRange(req.query.start, req.query.end);
    if (!connection?.accessToken || !connection?.accountId) {
      res.status(404).json({ error: "No connected Meta ad account found." });
      return;
    }

    const accountId = String(connection.accountId).startsWith("act_")
      ? String(connection.accountId)
      : `act_${connection.accountId}`;
    const payload = await metaGraphFetch(`${accountId}/insights`, {
      access_token: connection.accessToken,
      level: "ad",
      fields:
        "campaign_name,adset_name,ad_name,ad_id,spend,impressions,clicks,ctr,cpc,actions,purchase_roas",
      time_range: dateRange && !isAllTimeRange
        ? JSON.stringify({ since: dateRange.start, until: dateRange.end })
        : undefined,
      date_preset: isAllTimeRange ? "maximum" : dateRange ? undefined : "last_30d",
      limit: 200,
    });

    const rows = Array.isArray(payload.data) ? payload.data : [];
    const ads = rows.map((row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const purchaseAction = actions.find(
        (action) => action.action_type === "purchase" || action.action_type === "offsite_conversion.fb_pixel_purchase",
      );
      const purchases = Number(purchaseAction?.value || 0);
      const spend = Number(row.spend || 0);
      const roasValue = Array.isArray(row.purchase_roas) ? Number(row.purchase_roas[0]?.value || 0) : 0;

      return {
        campaignName: row.campaign_name || "Untitled campaign",
        adSetName: row.adset_name || "Untitled ad set",
        adName: row.ad_name || "Untitled ad",
        metaAdId: String(row.ad_id || ""),
        spend,
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        ctr: Number(row.ctr || 0),
        cpc: Number(row.cpc || 0),
        purchases,
        cpa: purchases > 0 ? spend / purchases : 0,
        roas: roasValue,
        revenue: spend * roasValue,
      };
    });

    res.json({
      accountId: connection.accountId,
      accountName: connection.accountName,
      importedAt: new Date().toISOString(),
      range: isAllTimeRange
        ? { preset: "all", start: null, end: null }
        : dateRange
          ? { start: dateRange.start, end: dateRange.end }
          : null,
      ads,
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Could not load Meta ads imports.",
    });
  }
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
