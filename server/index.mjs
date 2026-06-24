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
const ZENDROP_MCP_ENDPOINT =
  process.env.ZENDROP_MCP_ENDPOINT || "https://app.zendrop.com/mcp/v1";
const DEFAULT_ZENDROP_SCOPES =
  process.env.ZENDROP_SCOPES || "orders:read,stores:read";

const dataDir = path.resolve(process.cwd(), ".data");
const storeFile = path.join(dataDir, "shopify-connections.json");
const settingsFile = path.join(dataDir, "app-settings.json");
const metaStoreFile = path.join(dataDir, "meta-connections.json");
const profilesFile = path.join(dataDir, "profiles.json");
const SHOPIFY_API_VERSION = "2026-04";
const DEFAULT_PROFILE_EMAIL = "hello@insidecats.com";

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

function ensureProfilesFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(profilesFile)) fs.writeFileSync(profilesFile, JSON.stringify({ profiles: {} }, null, 2));
}

function readProfilesFile() {
  ensureProfilesFile();
  const parsed = JSON.parse(fs.readFileSync(profilesFile, "utf-8"));
  return parsed && typeof parsed === "object" ? parsed : { profiles: {} };
}

function writeProfilesFile(next) {
  ensureProfilesFile();
  fs.writeFileSync(profilesFile, JSON.stringify(next, null, 2));
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function getRequestedProfileEmail(req) {
  return (
    normalizeEmail(
      req.headers["x-growthos-profile"] ||
      req.query?.profileEmail ||
      req.body?.profileEmail,
    ) ||
    DEFAULT_PROFILE_EMAIL
  );
}

function defaultProfileState() {
  return {
    mappings: [],
    adAnnotations: {},
    zendropOrderCosts: [],
    ruleSettings: null,
    dailyAdBudget: 100,
    displayCurrency: "USD",
    usdToAudRate: 1.55,
    usdToAudRateUpdatedAt: "",
    usdToAudRateSource: "cached",
    dateRange: {
      preset: "7d",
      startDate: "",
      endDate: "",
    },
  };
}

function createEmptyProfile(email) {
  return {
    email,
    shopifyApp: {},
    metaApp: {},
    zendropApp: {},
    ui: {},
    shopifyStore: {},
    metaStore: {},
    zendropStore: {},
    appState: defaultProfileState(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function migrateLegacyProfile(email, profile) {
  if (email !== DEFAULT_PROFILE_EMAIL) return profile;

  const legacySettings = readSettings();
  const legacyShopifyStore = readStore();
  const legacyMetaStore = readMetaStore();

  return {
    ...profile,
    shopifyApp:
      profile.shopifyApp && Object.keys(profile.shopifyApp).length
        ? profile.shopifyApp
        : legacySettings.shopifyApp || {},
    metaApp:
      profile.metaApp && Object.keys(profile.metaApp).length
        ? profile.metaApp
        : legacySettings.metaApp || {},
    ui:
      profile.ui && Object.keys(profile.ui).length
        ? profile.ui
        : legacySettings.ui || {},
    shopifyStore:
      profile.shopifyStore && Object.keys(profile.shopifyStore).length
        ? profile.shopifyStore
        : legacyShopifyStore || {},
    metaStore:
      profile.metaStore && Object.keys(profile.metaStore).length
        ? profile.metaStore
        : legacyMetaStore || {},
    appState: profile.appState || defaultProfileState(),
  };
}

function ensureProfile(email) {
  const normalized = normalizeEmail(email) || DEFAULT_PROFILE_EMAIL;
  const root = readProfilesFile();
  root.profiles = root.profiles || {};
  const existing = root.profiles[normalized];
  const nextProfile = migrateLegacyProfile(
    normalized,
    existing ? { ...createEmptyProfile(normalized), ...existing } : createEmptyProfile(normalized),
  );
  nextProfile.updatedAt = nextProfile.updatedAt || new Date().toISOString();
  if (!existing || JSON.stringify(existing) !== JSON.stringify(nextProfile)) {
    root.profiles[normalized] = nextProfile;
    writeProfilesFile(root);
  }
  return nextProfile;
}

function updateProfile(email, updater) {
  const normalized = normalizeEmail(email) || DEFAULT_PROFILE_EMAIL;
  const root = readProfilesFile();
  root.profiles = root.profiles || {};
  const current = migrateLegacyProfile(
    normalized,
    root.profiles[normalized]
      ? { ...createEmptyProfile(normalized), ...root.profiles[normalized] }
      : createEmptyProfile(normalized),
  );
  const next = updater(current) || current;
  next.email = normalized;
  next.updatedAt = new Date().toISOString();
  root.profiles[normalized] = next;
  writeProfilesFile(root);
  return next;
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

function getShopifyConfig(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  const saved = profile.shopifyApp || {};
  return {
    apiKey: saved.apiKey || process.env.SHOPIFY_API_KEY || "",
    apiSecret: saved.apiSecret || process.env.SHOPIFY_API_SECRET || "",
    scopes: normalizeScopes(saved.scopes || DEFAULT_SHOPIFY_SCOPES),
    redirectUri: saved.redirectUri || DEFAULT_SHOPIFY_REDIRECT_URI,
    defaultShopDomain: saved.defaultShopDomain || "",
    distributionLink: saved.distributionLink || DEFAULT_SHOPIFY_DISTRIBUTION_LINK,
  };
}

function getMetaConfig(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  const saved = profile.metaApp || {};
  return {
    appId: saved.appId || process.env.META_APP_ID || "",
    appSecret: saved.appSecret || process.env.META_APP_SECRET || "",
    scopes: saved.scopes || DEFAULT_META_SCOPES,
    redirectUri: saved.redirectUri || DEFAULT_META_REDIRECT_URI,
  };
}

function normalizeZendropScopes(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  )].join(",");
}

function getZendropConfig(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  const saved = profile.zendropApp || {};
  return {
    accessToken: saved.accessToken || process.env.ZENDROP_ACCESS_TOKEN || "",
    scopes: normalizeZendropScopes(saved.scopes || DEFAULT_ZENDROP_SCOPES),
    endpoint: saved.endpoint || ZENDROP_MCP_ENDPOINT,
  };
}

function normalizeShop(shop) {
  const normalized = String(shop || "").trim().toLowerCase();
  const isValid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized);
  return isValid ? normalized : "";
}

function getConnectedShop(profileEmail, shop) {
  const profile = ensureProfile(profileEmail);
  const connections = profile.shopifyStore || {};
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

async function zendropMcpFetch(accessToken, payload = {}, endpoint = ZENDROP_MCP_ENDPOINT) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Zendrop returned a non-JSON response (${response.status}).`);
  }

  if (!response.ok || data?.error) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Zendrop request failed (${response.status}).`;
    throw new Error(String(message));
  }

  return data;
}

function getZendropConnection(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  return profile.zendropStore?.connection || null;
}

function extractFirstArray(source, candidatePaths) {
  for (const path of candidatePaths) {
    const parts = path.split(".");
    let current = source;
    for (const part of parts) {
      current = current?.[part];
    }
    if (Array.isArray(current)) return current;
  }
  return [];
}

function extractFirstValue(source, candidatePaths) {
  for (const path of candidatePaths) {
    const parts = path.split(".");
    let current = source;
    for (const part of parts) {
      current = current?.[part];
    }
    if (current !== undefined && current !== null && `${current}`.trim() !== "") {
      return current;
    }
  }
  return "";
}

function toFiniteNumber(value) {
  const parsed = Number(
    String(value ?? "")
      .replace(/[^0-9.\-]/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeZendropCurrency(value) {
  return String(value || "").trim().toUpperCase() === "AUD" ? "AUD" : "USD";
}

function normalizeZendropStore(store) {
  if (!store || typeof store !== "object") return null;
  const storeId = String(
    store.id ||
    store.store_id ||
    store.storeId ||
    store.uuid ||
    "",
  ).trim();
  const storeName = String(
    store.name ||
    store.store_name ||
    store.storeName ||
    store.title ||
    "",
  ).trim();
  const storeUrl = String(
    store.url ||
    store.store_url ||
    store.domain ||
    store.shop_url ||
    "",
  ).trim();
  const connectionStatus = String(
    store.connection_status ||
    store.status ||
    "",
  ).trim();

  if (!storeId && !storeName && !storeUrl) return null;
  return {
    storeId,
    storeName,
    storeUrl,
    connectionStatus,
  };
}

function pickZendropStores(payload) {
  return extractFirstArray(payload, [
    "stores",
    "data.stores",
    "result.stores",
    "results.stores",
    "data",
  ])
    .map(normalizeZendropStore)
    .filter(Boolean);
}

function pickZendropOrders(payload) {
  return extractFirstArray(payload, [
    "orders",
    "data.orders",
    "result.orders",
    "results.orders",
    "items",
    "data.items",
    "data",
  ]).filter((item) => item && typeof item === "object");
}

function normalizeZendropOrderId(order) {
  return String(
    order?.id ||
    order?.order_id ||
    order?.orderId ||
    order?.zendrop_order_id ||
    "",
  ).trim();
}

function normalizeZendropOrderNumber(order) {
  return String(
    order?.order_number ||
    order?.orderNumber ||
    order?.number ||
    normalizeZendropOrderId(order) ||
    "",
  ).trim();
}

function extractLineItemCost(rawItem) {
  const quantity = Math.max(1, Number(rawItem?.quantity || rawItem?.qty || 1) || 1);
  const explicitTotal = [
    rawItem?.total_product_cost,
    rawItem?.total_item_cost,
    rawItem?.product_total_cost,
    rawItem?.cost_total,
  ].find((value) => value !== undefined && value !== null && `${value}`.trim() !== "");
  if (explicitTotal !== undefined) return toFiniteNumber(explicitTotal);

  const unitValue = [
    rawItem?.product_cost,
    rawItem?.unit_cost,
    rawItem?.cost,
    rawItem?.price,
    rawItem?.unit_price,
    rawItem?.fulfillment_cost,
  ].find((value) => value !== undefined && value !== null && `${value}`.trim() !== "");
  if (unitValue !== undefined) {
    const amount = toFiniteNumber(unitValue);
    const key = String(unitValue);
    return /total/i.test(key) ? amount : amount * quantity;
  }

  return 0;
}

function extractZendropLineItems(orderPayload, costPayload) {
  const detailSource =
    extractFirstValue(orderPayload, ["order", "data.order", "result.order", "results.order"]) ||
    orderPayload;
  const costSource =
    extractFirstValue(costPayload, ["order", "data.order", "result.order", "results.order"]) ||
    costPayload;

  const lineItems = extractFirstArray(detailSource, [
    "line_items",
    "items",
    "products",
    "order.line_items",
    "order.items",
  ]);
  const costItems = extractFirstArray(costSource, [
    "line_items",
    "items",
    "products",
    "costs",
    "order.line_items",
    "order.items",
  ]);

  const totalShipping = toFiniteNumber(
    extractFirstValue(costSource, [
      "shipping_cost",
      "total_shipping_cost",
      "shipping_total",
      "fulfillment.shipping_cost",
      "order.shipping_cost",
    ]),
  );

  const normalizedItems = lineItems.map((item, index) => {
    const quantity = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
    const costItem = costItems[index] || {};
    const productCost =
      extractLineItemCost(costItem) ||
      extractLineItemCost(item);
    const shippingCost =
      toFiniteNumber(
        costItem?.shipping_cost ||
        costItem?.shipping ||
        costItem?.shipping_price ||
        item?.shipping_cost ||
        item?.shipping ||
        item?.shipping_price ||
        0,
      );

    return {
      productName: String(
        item?.product_title ||
        item?.title ||
        item?.product_name ||
        item?.name ||
        "Untitled product",
      ).trim(),
      sku: String(item?.sku || item?.variant_sku || costItem?.sku || "").trim(),
      quantity,
      productCost,
      shippingCost,
    };
  });

  if (!normalizedItems.length) return [];

  const allocatedShipping = normalizedItems.reduce((sum, item) => sum + item.shippingCost, 0);
  const shippingGap = Math.max(0, totalShipping - allocatedShipping);
  if (shippingGap > 0) {
    const units = normalizedItems.reduce((sum, item) => sum + item.quantity, 0) || normalizedItems.length;
    normalizedItems.forEach((item) => {
      item.shippingCost += shippingGap * (item.quantity / units);
    });
  }

  return normalizedItems;
}

function buildZendropOrderRows(orderSummary, orderPayload, costPayload) {
  const detailSource =
    extractFirstValue(orderPayload, ["order", "data.order", "result.order", "results.order"]) ||
    orderPayload;
  const currency = normalizeZendropCurrency(
    extractFirstValue(costPayload, [
      "currency",
      "order.currency",
      "data.currency",
      "result.currency",
    ]) || extractFirstValue(detailSource, ["currency", "order.currency"]) || "USD",
  );
  const orderNumber = normalizeZendropOrderNumber(orderSummary) || normalizeZendropOrderNumber(detailSource);
  const orderDate = String(
    extractFirstValue(detailSource, [
      "order_date",
      "created_at",
      "date",
      "placed_at",
    ]) || "",
  ).trim();

  return extractZendropLineItems(detailSource, costPayload)
    .filter((item) => item.productName)
    .map((item, index) => ({
      id: `zendrop-${orderNumber || normalizeZendropOrderId(orderSummary) || "order"}-${index}`,
      orderNumber: orderNumber || normalizeZendropOrderId(orderSummary),
      orderDate,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      productCost: Number(item.productCost.toFixed(2)),
      shippingCost: Number(item.shippingCost.toFixed(2)),
      totalCost: Number((item.productCost + item.shippingCost).toFixed(2)),
      currency,
    }));
}

async function fetchZendropStores(accessToken, endpoint = ZENDROP_MCP_ENDPOINT) {
  const payload = await zendropMcpFetch(accessToken, { action: "get_stores" }, endpoint);
  return pickZendropStores(payload);
}

async function fetchZendropOrders(accessToken, endpoint = ZENDROP_MCP_ENDPOINT) {
  const rows = [];

  for (let page = 1; page <= 20; page += 1) {
    const payload = await zendropMcpFetch(
      accessToken,
      {
        action: "get_orders",
        page,
        per_page: 50,
        limit: 50,
        start_date: "2000-01-01",
        end_date: new Date().toISOString().slice(0, 10),
        date_from: "2000-01-01",
        date_to: new Date().toISOString().slice(0, 10),
      },
      endpoint,
    );
    const orders = pickZendropOrders(payload);
    if (!orders.length) break;
    rows.push(...orders);
    if (orders.length < 50) break;
  }

  return rows;
}

function pickMetaCreativeUrl(creative) {
  if (!creative || typeof creative !== "object") return "";

  const direct = [
    creative.image_url,
    creative.thumbnail_url,
    creative.object_story_spec?.video_data?.image_url,
    creative.object_story_spec?.link_data?.image_hash ? "" : creative.object_story_spec?.link_data?.picture,
    creative.object_story_spec?.photo_data?.image_url,
    creative.object_story_spec?.photo_data?.url,
    creative.object_story_spec?.template_data?.picture,
  ].find((value) => typeof value === "string" && value.trim());

  if (direct) return direct.trim();

  const attachments = creative.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(attachments)) {
    const firstAttachmentImage = attachments
      .map((attachment) => attachment?.picture || attachment?.image_url)
      .find((value) => typeof value === "string" && value.trim());
    if (firstAttachmentImage) return firstAttachmentImage.trim();
  }

  return "";
}

function pickMetaCreativeAssetThumbnail(creative) {
  const videos = creative?.asset_feed_spec?.videos;
  if (!Array.isArray(videos)) return "";
  const thumbnail = videos
    .map((item) => (typeof item?.thumbnail_url === "string" ? item.thumbnail_url.trim() : ""))
    .find(Boolean);
  return thumbnail || "";
}

function buildMetaCreativeEmbedUrl(creative) {
  const permalink = typeof creative?.instagram_permalink_url === "string"
    ? creative.instagram_permalink_url.trim()
    : "";
  if (permalink) {
    return permalink.endsWith("/")
      ? `${permalink}embed/captioned/`
      : `${permalink}/embed/captioned/`;
  }
  return "";
}

function normalizeMetaGoal(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replaceAll("_", " ") : "";
}

function buildObjectiveLabel(campaignObjective, optimizationGoal) {
  const goal = normalizeMetaGoal(optimizationGoal);
  if (goal) return goal;
  return normalizeMetaGoal(campaignObjective);
}

function pickMetaCreativeVideoIds(creative) {
  if (!creative || typeof creative !== "object") return [];

  const orderedIds = [
    creative.object_story_spec?.video_data?.video_id,
    creative.video_id,
  ].map((value) => (value === undefined || value === null ? "" : String(value).trim()));

  const attachments = creative.object_story_spec?.link_data?.child_attachments;
  const attachmentIds = Array.isArray(attachments)
    ? attachments
      .map((attachment) =>
        attachment?.video_id === undefined || attachment?.video_id === null
          ? ""
          : String(attachment.video_id).trim(),
      )
    : [];

  return [...new Set([...orderedIds, ...attachmentIds].filter(Boolean))];
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

function getMetaConnection(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  return profile.metaStore?.connection || null;
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

function getUiConfig(profileEmail = DEFAULT_PROFILE_EMAIL) {
  const profile = ensureProfile(profileEmail);
  const saved = profile.ui || {};
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
  const profileEmail = getRequestedProfileEmail(req);
  const config = getShopifyConfig(profileEmail);
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
  const profileEmail = getRequestedProfileEmail(req);
  const config = getMetaConfig(profileEmail);
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
  const profileEmail = getRequestedProfileEmail(req);
  const config = getUiConfig(profileEmail);
  res.json(config);
});

app.get("/api/settings/zendrop", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const config = getZendropConfig(profileEmail);
  const connection = getZendropConnection(profileEmail);
  res.json({
    configured: Boolean(config.accessToken),
    accessToken: config.accessToken,
    accessTokenMasked: masked(config.accessToken),
    scopes: config.scopes,
    endpoint: config.endpoint,
    status: connection?.storeId || connection?.storeName ? "connected" : (config.accessToken ? "configured" : "not_connected"),
    storeId: connection?.storeId || "",
    storeName: connection?.storeName || "",
    storeUrl: connection?.storeUrl || "",
    lastSyncAt: connection?.lastSyncAt || "",
  });
});

app.post("/api/auth/login", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }

  const profile = ensureProfile(email);
  const hasStoredAppState = Boolean(
    profile.appState &&
    (
      Array.isArray(profile.appState.mappings) && profile.appState.mappings.length > 0 ||
      profile.appState.adAnnotations && Object.keys(profile.appState.adAnnotations).length > 0 ||
      Array.isArray(profile.appState.zendropOrderCosts) && profile.appState.zendropOrderCosts.length > 0 ||
      profile.appState.ruleSettings ||
      profile.appState.dailyAdBudget !== defaultProfileState().dailyAdBudget ||
      profile.appState.displayCurrency !== defaultProfileState().displayCurrency ||
      profile.appState.dateRange?.startDate ||
      profile.appState.dateRange?.endDate
    ),
  );

  res.json({
    ok: true,
    email,
    needsClientMigration: !hasStoredAppState,
  });
});

app.get("/api/profile/state", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const profile = ensureProfile(profileEmail);
  res.json(profile.appState || defaultProfileState());
});

app.post("/api/profile/state", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const payload = req.body || {};

  const nextAppState = {
    mappings: Array.isArray(payload.mappings) ? payload.mappings : [],
    adAnnotations:
      payload.adAnnotations && typeof payload.adAnnotations === "object"
        ? payload.adAnnotations
        : {},
    zendropOrderCosts: Array.isArray(payload.zendropOrderCosts) ? payload.zendropOrderCosts : [],
    ruleSettings: payload.ruleSettings && typeof payload.ruleSettings === "object"
      ? payload.ruleSettings
      : null,
    dailyAdBudget: Math.max(0, Number(payload.dailyAdBudget) || 0),
    displayCurrency: payload.displayCurrency === "AUD" ? "AUD" : "USD",
    usdToAudRate: Number.isFinite(Number(payload.usdToAudRate)) && Number(payload.usdToAudRate) > 0
      ? Number(payload.usdToAudRate)
      : defaultProfileState().usdToAudRate,
    usdToAudRateUpdatedAt: String(payload.usdToAudRateUpdatedAt || ""),
    usdToAudRateSource: String(payload.usdToAudRateSource || "cached"),
    dateRange:
      payload.dateRange && typeof payload.dateRange === "object"
        ? {
            preset: String(payload.dateRange.preset || "7d"),
            startDate: String(payload.dateRange.startDate || ""),
            endDate: String(payload.dateRange.endDate || ""),
          }
        : defaultProfileState().dateRange,
  };

  const profile = updateProfile(profileEmail, (current) => ({
    ...current,
    appState: nextAppState,
  }));

  res.json({
    ok: true,
    email: profile.email,
    appState: profile.appState,
  });
});

app.post("/api/settings/shopify-app", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const profile = ensureProfile(profileEmail);
  const saved = profile.shopifyApp || {};
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

  updateProfile(profileEmail, (current) => ({
    ...current,
    shopifyApp: {
      apiKey: nextApiKey,
      apiSecret: nextApiSecret,
      scopes,
      redirectUri,
      defaultShopDomain,
      distributionLink,
    },
  }));

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
  const profileEmail = getRequestedProfileEmail(req);
  const profile = ensureProfile(profileEmail);
  const saved = profile.metaApp || {};
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

  updateProfile(profileEmail, (current) => ({
    ...current,
    metaApp: {
      appId: nextAppId,
      appSecret: nextAppSecret,
      scopes,
      redirectUri,
    },
  }));

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
  const profileEmail = getRequestedProfileEmail(req);
  const requestedColor = String(req.body?.appColor || "").trim();
  const requestedLogoUrl = String(req.body?.logoUrl || "").trim();
  const appColor = isHexColor(requestedColor) ? requestedColor : "";
  if (!isSafeLogoValue(requestedLogoUrl)) {
    res.status(400).json({ error: "Logo URL must be an https URL or uploaded image data." });
    return;
  }
  const logoUrl = requestedLogoUrl;

  updateProfile(profileEmail, (current) => ({
    ...current,
    ui: {
      ...(current.ui || {}),
      appColor,
      logoUrl,
    },
  }));

  res.json({
    ok: true,
    appColor,
    logoUrl,
  });
});

app.post("/api/settings/zendrop", async (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const profile = ensureProfile(profileEmail);
  const saved = profile.zendropApp || {};
  const accessToken = String(req.body?.accessToken || "").trim() || saved.accessToken || "";
  const scopes = normalizeZendropScopes(req.body?.scopes || saved.scopes || DEFAULT_ZENDROP_SCOPES);
  const endpoint = String(req.body?.endpoint || "").trim() || saved.endpoint || ZENDROP_MCP_ENDPOINT;

  if (!accessToken) {
    res.status(400).json({ error: "Zendrop access token is required." });
    return;
  }

  try {
    const stores = await fetchZendropStores(accessToken, endpoint);
    const primaryStore = stores.find((store) => /connected|active/i.test(store.connectionStatus || "")) || stores[0] || null;

    const profile = updateProfile(profileEmail, (current) => ({
      ...current,
      zendropApp: {
        accessToken,
        scopes,
        endpoint,
      },
      zendropStore: {
        ...(current.zendropStore || {}),
        connection: primaryStore
          ? {
              ...primaryStore,
              connectedAt: new Date().toISOString(),
              lastSyncAt: current.zendropStore?.connection?.lastSyncAt || "",
            }
          : current.zendropStore?.connection || {},
      },
    }));

    const connection = profile.zendropStore?.connection || {};
    res.json({
      ok: true,
      configured: true,
      accessToken,
      accessTokenMasked: masked(accessToken),
      scopes,
      endpoint,
      status: connection?.storeId || connection?.storeName ? "connected" : "configured",
      storeId: connection?.storeId || "",
      storeName: connection?.storeName || "",
      storeUrl: connection?.storeUrl || "",
      lastSyncAt: connection?.lastSyncAt || "",
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Could not verify Zendrop access token.",
    });
  }
});

app.get("/api/integrations/shopify/status", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const requestedShop = normalizeShop(req.query.shop);
  const profile = ensureProfile(profileEmail);
  const connections = profile.shopifyStore || {};
  const values = Object.values(connections).filter(
    (connection) =>
      connection &&
      typeof connection === "object" &&
      connection.shop &&
      connection.accessToken,
  );

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
  const profileEmail = getRequestedProfileEmail(req);
  const connection = getMetaConnection(profileEmail);
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
  const profileEmail = getRequestedProfileEmail(req);
  const config = getMetaConfig(profileEmail);
  if (!config.appId || !config.appSecret) {
    res.status(500).json({
      error: "Meta app credentials are missing. Configure Meta app settings first.",
    });
    return;
  }

  const state = crypto.randomBytes(18).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  updateProfile(profileEmail, (current) => ({
    ...current,
    metaStore: {
      ...(current.metaStore || {}),
      __states: {
        ...((current.metaStore || {}).__states || {}),
        [state]: { expiresAt, profileEmail },
      },
    },
  }));

  const authUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", config.appId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", config.scopes);

  res.redirect(authUrl.toString());
});

app.get("/api/meta/callback", async (req, res) => {
  try {
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

    const profilesRoot = readProfilesFile();
    const profileEntry = Object.values(profilesRoot.profiles || {}).find(
      (profile) => profile?.metaStore?.__states?.[state],
    );
    const expectedState = profileEntry?.metaStore?.__states?.[state];
    if (!expectedState || expectedState.expiresAt < Date.now()) {
      res.status(400).send("Invalid or expired Meta OAuth state.");
      return;
    }
    const profileEmail = expectedState.profileEmail || DEFAULT_PROFILE_EMAIL;
    const config = getMetaConfig(profileEmail);
    if (!config.appId || !config.appSecret) {
      res.status(500).send("Missing Meta app credentials.");
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

    updateProfile(profileEmail, (current) => {
      const nextMetaStore = { ...(current.metaStore || {}) };
      if (nextMetaStore.__states) delete nextMetaStore.__states[state];
      nextMetaStore.connection = {
        accountId: String(selectedAccount.id),
        accountName: selectedAccount.name,
        accessToken,
        scopes: config.scopes,
        currency: selectedAccount.currency || "USD",
        connectedAt: new Date().toISOString(),
      };
      return {
        ...current,
        metaStore: nextMetaStore,
      };
    });

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
  const profileEmail = getRequestedProfileEmail(req);
  updateProfile(profileEmail, (current) => {
    const nextMetaStore = { ...(current.metaStore || {}) };
    delete nextMetaStore.connection;
    return {
      ...current,
      metaStore: nextMetaStore,
    };
  });
  res.json({ ok: true });
});

app.post("/api/imports/zendrop/sync", async (req, res) => {
  try {
    const profileEmail = getRequestedProfileEmail(req);
    const config = getZendropConfig(profileEmail);

    if (!config.accessToken) {
      res.status(400).json({ error: "Zendrop access token is missing. Save it in Settings first." });
      return;
    }

    const stores = await fetchZendropStores(config.accessToken, config.endpoint);
    const primaryStore = stores.find((store) => /connected|active/i.test(store.connectionStatus || "")) || stores[0] || null;
    const orders = await fetchZendropOrders(config.accessToken, config.endpoint);
    const importedRows = [];

    for (const order of orders) {
      const orderId = normalizeZendropOrderId(order);
      if (!orderId) continue;

      try {
        const [detailPayload, costPayload] = await Promise.all([
          zendropMcpFetch(config.accessToken, { action: "get_order", order_id: orderId, id: orderId }, config.endpoint),
          zendropMcpFetch(config.accessToken, { action: "get_order_fulfillment_cost", order_id: orderId, id: orderId }, config.endpoint),
        ]);
        importedRows.push(...buildZendropOrderRows(order, detailPayload, costPayload));
      } catch (error) {
        console.warn(`Skipping Zendrop order ${orderId}:`, error instanceof Error ? error.message : error);
      }
    }

    const dedupedRows = importedRows.filter((row, index, array) =>
      array.findIndex((candidate) => candidate.id === row.id) === index,
    );

    updateProfile(profileEmail, (current) => ({
      ...current,
      zendropStore: {
        ...(current.zendropStore || {}),
        connection: {
          ...(current.zendropStore?.connection || {}),
          ...(primaryStore || {}),
          lastSyncAt: new Date().toISOString(),
        },
      },
      appState: {
        ...(current.appState || defaultProfileState()),
        zendropOrderCosts: dedupedRows,
      },
    }));

    res.json({
      ok: true,
      importedRows: dedupedRows.length,
      orderCount: orders.length,
      storeName: primaryStore?.storeName || "",
      storeUrl: primaryStore?.storeUrl || "",
      lastSyncAt: new Date().toISOString(),
      orders: dedupedRows,
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Could not sync Zendrop orders.",
    });
  }
});

app.get("/api/imports/shopify/products", async (req, res) => {
  try {
    const profileEmail = getRequestedProfileEmail(req);
    const requestedShop = normalizeShop(req.query.shop);
    const connection = getConnectedShop(profileEmail, requestedShop);
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
    const profileEmail = getRequestedProfileEmail(req);
    const requestedShop = normalizeShop(req.query.shop);
    const connection = getConnectedShop(profileEmail, requestedShop);

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
    const profileEmail = getRequestedProfileEmail(req);
    const connection = getMetaConnection(profileEmail);
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
        "campaign_id,campaign_name,adset_id,adset_name,ad_name,ad_id,spend,impressions,clicks,ctr,cpc,actions,purchase_roas",
      time_range: dateRange && !isAllTimeRange
        ? JSON.stringify({ since: dateRange.start, until: dateRange.end })
        : undefined,
      date_preset: isAllTimeRange ? "maximum" : dateRange ? undefined : "last_30d",
      limit: 200,
    });

    const rows = Array.isArray(payload.data) ? payload.data : [];
    const activityPayload = await metaGraphFetch(`${accountId}/insights`, {
      access_token: connection.accessToken,
      level: "ad",
      fields: "ad_id,date_start,date_stop,spend,impressions,clicks,actions",
      time_increment: 1,
      time_range: dateRange && !isAllTimeRange
        ? JSON.stringify({ since: dateRange.start, until: dateRange.end })
        : undefined,
      date_preset: isAllTimeRange ? "maximum" : dateRange ? undefined : "last_30d",
      limit: 5000,
    });
    const activityRows = Array.isArray(activityPayload.data) ? activityPayload.data : [];
    const adIds = rows
      .map((row) => String(row.ad_id || "").trim())
      .filter(Boolean);
    const campaignIds = [...new Set(rows.map((row) => String(row.campaign_id || "").trim()).filter(Boolean))];
    const adSetIds = [...new Set(rows.map((row) => String(row.adset_id || "").trim()).filter(Boolean))];
    const creativeByAdId = new Map();
    const videoIds = new Set();
    const campaignById = new Map();
    const adSetById = new Map();
    const activityByAdId = new Map();

    for (const row of activityRows) {
      const adId = String(row.ad_id || "").trim();
      if (!adId) continue;
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const clicks = Number(row.clicks || 0);
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const purchaseAction = actions.find(
        (action) => action.action_type === "purchase" || action.action_type === "offsite_conversion.fb_pixel_purchase",
      );
      const purchases = Number(purchaseAction?.value || 0);
      if (spend <= 0 && impressions <= 0 && clicks <= 0) continue;
      const date = String(row.date_start || row.date_stop || "").trim();
      if (!date) continue;
      const current = activityByAdId.get(adId) || [];
      current.push({
        date,
        spend,
        impressions,
        clicks,
        purchases,
      });
      activityByAdId.set(adId, current);
    }

    for (const batch of chunkItems(campaignIds, 50)) {
      let campaignPayload = {};
      try {
        campaignPayload = await metaGraphFetch("", {
          access_token: connection.accessToken,
          ids: batch.join(","),
          fields: "id,objective",
        });
      } catch {
        campaignPayload = {};
      }

      for (const campaignId of batch) {
        campaignById.set(campaignId, campaignPayload?.[campaignId] || {});
      }
    }

    for (const batch of chunkItems(adSetIds, 50)) {
      let adSetPayload = {};
      try {
        adSetPayload = await metaGraphFetch("", {
          access_token: connection.accessToken,
          ids: batch.join(","),
          fields: "id,optimization_goal",
        });
      } catch {
        adSetPayload = {};
      }

      for (const adSetId of batch) {
        adSetById.set(adSetId, adSetPayload?.[adSetId] || {});
      }
    }

    for (const batch of chunkItems(adIds, 50)) {
      let creativePayload = {};
      try {
        creativePayload = await metaGraphFetch("", {
          access_token: connection.accessToken,
          ids: batch.join(","),
          fields:
            "id,name,creative{id,name,object_type,image_url,thumbnail_url,video_id,instagram_permalink_url,asset_feed_spec{videos{video_id,thumbnail_url}},object_story_spec{video_data{video_id,image_url},link_data{picture,child_attachments{picture,image_url,video_id}},photo_data{image_url,url},template_data{picture}}}",
        });
      } catch {
        creativePayload = {};
      }

      for (const adId of batch) {
        const adNode = creativePayload?.[adId];
        const creative = adNode?.creative || {};
        const creativeVideoIds = pickMetaCreativeVideoIds(creative);
        for (const videoId of creativeVideoIds) videoIds.add(videoId);
        creativeByAdId.set(adId, {
          creativeImageUrl: pickMetaCreativeUrl(creative),
          creativeThumbnailUrl:
            pickMetaCreativeAssetThumbnail(creative) ||
            (typeof creative.thumbnail_url === "string" ? creative.thumbnail_url : "") ||
            pickMetaCreativeUrl(creative),
          creativeVideoIds,
          creativeEmbedUrl: buildMetaCreativeEmbedUrl(creative),
          creativeType: String(creative.object_type || "").trim() || "",
        });
      }
    }

    const videoById = new Map();
    for (const batch of chunkItems([...videoIds], 50)) {
      let videoPayload = {};
      try {
        videoPayload = await metaGraphFetch("", {
          access_token: connection.accessToken,
          ids: batch.join(","),
          fields: "id,source,picture",
        });
      } catch {
        videoPayload = {};
      }

      for (const videoId of batch) {
        const videoNode = videoPayload?.[videoId];
        videoById.set(videoId, {
          source: typeof videoNode?.source === "string" ? videoNode.source : "",
          picture: typeof videoNode?.picture === "string" ? videoNode.picture : "",
        });
      }
    }

    const ads = rows.map((row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const purchaseAction = actions.find(
        (action) => action.action_type === "purchase" || action.action_type === "offsite_conversion.fb_pixel_purchase",
      );
      const purchases = Number(purchaseAction?.value || 0);
      const spend = Number(row.spend || 0);
      const roasValue = Array.isArray(row.purchase_roas) ? Number(row.purchase_roas[0]?.value || 0) : 0;
      const adId = String(row.ad_id || "").trim();
      const campaignId = String(row.campaign_id || "").trim();
      const adSetId = String(row.adset_id || "").trim();
      const creative = creativeByAdId.get(adId) || {};
      const video =
        Array.isArray(creative.creativeVideoIds)
          ? creative.creativeVideoIds
              .map((videoId) => videoById.get(videoId) || {})
              .find((candidate) => candidate.source || candidate.picture) || {}
          : {};
      const activityPoints = activityByAdId.get(adId) || [];
      const activeDates = [...new Set(activityPoints.map((point) => point.date))].sort();
      const campaign = campaignById.get(campaignId) || {};
      const adSet = adSetById.get(adSetId) || {};
      const campaignObjective = String(campaign.objective || "").trim();
      const optimizationGoal = String(adSet.optimization_goal || "").trim();

      return {
        campaignId,
        campaignName: row.campaign_name || "Untitled campaign",
        campaignObjective,
        objectiveLabel: buildObjectiveLabel(campaignObjective, optimizationGoal),
        adSetId,
        adSetName: row.adset_name || "Untitled ad set",
        optimizationGoal,
        adName: row.ad_name || "Untitled ad",
        metaAdId: adId,
        creativeImageUrl: creative.creativeImageUrl || video.picture || "",
        creativeThumbnailUrl: creative.creativeThumbnailUrl || video.picture || creative.creativeImageUrl || "",
        creativeVideoUrl: video.source || "",
        creativeEmbedUrl: creative.creativeEmbedUrl || "",
        creativeType: creative.creativeType || "",
        firstActiveDate: activeDates[0] || "",
        lastActiveDate: activeDates[activeDates.length - 1] || "",
        activeDays: activeDates.length,
        dailyActivity: activityPoints.sort((first, second) => first.date.localeCompare(second.date)),
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
  const profileEmail = getRequestedProfileEmail(req);
  const config = getShopifyConfig(profileEmail);
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

  updateProfile(profileEmail, (current) => ({
    ...current,
    shopifyStore: {
      ...(current.shopifyStore || {}),
      __states: {
        ...((current.shopifyStore || {}).__states || {}),
        [state]: { shop, expiresAt, profileEmail },
      },
    },
  }));

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", config.apiKey);
  authUrl.searchParams.set("scope", config.scopes);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("state", state);

  res.redirect(authUrl.toString());
});

app.get("/api/shopify/callback", async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const hmac = String(req.query.hmac || "");

  if (!shop || !code || !state || !hmac) {
    res.status(400).send("Missing required OAuth callback parameters.");
    return;
  }

  const profilesRoot = readProfilesFile();
  const profileEntry = Object.values(profilesRoot.profiles || {}).find(
    (profile) => profile?.shopifyStore?.__states?.[state],
  );
  const expectedState = profileEntry?.shopifyStore?.__states?.[state];
  if (!expectedState || expectedState.shop !== shop || expectedState.expiresAt < Date.now()) {
    res.status(400).send("Invalid or expired OAuth state.");
    return;
  }
  const profileEmail = expectedState.profileEmail || DEFAULT_PROFILE_EMAIL;
  const config = getShopifyConfig(profileEmail);
  if (!config.apiKey || !config.apiSecret) {
    res.status(500).send("Missing Shopify app credentials.");
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
  updateProfile(profileEmail, (current) => {
    const nextShopifyStore = { ...(current.shopifyStore || {}) };
    if (nextShopifyStore.__states) delete nextShopifyStore.__states[state];
    nextShopifyStore[shop] = {
      shop,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      connectedAt: new Date().toISOString(),
    };
    return {
      ...current,
      shopifyStore: nextShopifyStore,
    };
  });

  res.redirect(`${APP_BASE_URL}/settings/integrations?shopify=connected&shop=${encodeURIComponent(shop)}`);
});

app.post("/api/integrations/shopify/disconnect", (req, res) => {
  const profileEmail = getRequestedProfileEmail(req);
  const shop = normalizeShop(req.body?.shop);
  if (!shop) {
    res.status(400).json({ error: "Invalid shop domain." });
    return;
  }

  updateProfile(profileEmail, (current) => {
    const nextShopifyStore = { ...(current.shopifyStore || {}) };
    if (nextShopifyStore[shop]) delete nextShopifyStore[shop];
    return {
      ...current,
      shopifyStore: nextShopifyStore,
    };
  });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`GrowthOS integration server listening on http://localhost:${PORT}`);
});
