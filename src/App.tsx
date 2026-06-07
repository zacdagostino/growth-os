import {
  ChangeEvent,
  CSSProperties,
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  CurrencyCode,
  GrowthAd,
  IntegrationConnection,
  MetaAdImport,
  IntegrationProvider,
  ProductAdMapping,
  Product,
  RuleSettings,
  ShopifyProductImport,
} from "./types";
import {
  applyProductMetrics,
  buildGrowthAds,
  buildGrowthProducts,
  createAutoMapping,
  detectProductForAd,
  estimatedProfit,
  KNOWN_GROWTH_PRODUCTS,
  reconcileMappings,
} from "./lib/growth-data";
import {
  buildWeeklyActionPlan,
  collectDataIssues,
  getAdDecisionReason,
  getAnglesTestedCount,
  getBudgetCapacitySummary,
  getFailureStage,
  getProductAdRevenue,
  getProductDecisionReason,
  getProductNextAction,
  getProductRevenueReference,
  getProductSlot3State,
  summarizeBusiness,
} from "./lib/dashboard-insights";
import { getBudgetSettings } from "./lib/rules/budget";
import { getAdDecision, getProductDecision } from "./lib/rules/decisions";
import {
  defaultRuleSettings,
  normalizeRuleSettings,
  RULE_SETTINGS_STORAGE_KEY,
} from "./lib/rules/rule-settings";

type NavIconName = "dashboard" | "products" | "ads" | "budget" | "settings";

const routes: Array<{ href: string; label: string; icon: NavIconName }> = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/products", label: "Products", icon: "products" },
  { href: "/ads", label: "Ads", icon: "ads" },
  { href: "/budget", label: "Budget", icon: "budget" },
];

const settingsRoute = { href: "/settings", label: "Settings", icon: "settings" } as const;

const initialConnections: IntegrationConnection[] = [
  {
    id: "shopify",
    provider: "shopify",
    status: "not_connected",
  },
  {
    id: "meta-ads",
    provider: "meta-ads",
    status: "not_connected",
  },
];

const shopifyImportFields = [
  "products",
  "orders",
  "revenue",
  "refunds",
  "customers",
  "product costs if available later",
];

const metaImportFields = [
  "campaigns",
  "ad sets",
  "ads",
  "spend",
  "impressions",
  "clicks",
  "CTR",
  "CPC",
  "purchases",
  "CPA",
  "ROAS",
  "conversion values",
];

const shopifyScopeOptions = [
  { value: "read_products", label: "Products" },
  { value: "read_orders", label: "Orders" },
  { value: "read_customers", label: "Customers" },
  { value: "read_themes", label: "Themes" },
  { value: "read_inventory", label: "Inventory" },
  { value: "read_locations", label: "Locations" },
  { value: "read_files", label: "Files" },
  { value: "read_markets", label: "Markets" },
  { value: "read_price_rules", label: "Discounts" },
  { value: "read_content", label: "Content" },
  { value: "read_reports", label: "Reports" },
  { value: "read_all_orders", label: "All Orders" },
];

function parseScopes(value: string) {
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => Boolean(scope) && scope !== "read_images");
}

function readCachedJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeCachedJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures; live fetch still works.
  }
}

function loadRuleSettingsFromStorage() {
  return normalizeRuleSettings(readCachedJson<Partial<RuleSettings>>(RULE_SETTINGS_STORAGE_KEY));
}

function loadMappingsFromStorage() {
  const saved = readCachedJson<Array<Partial<ProductAdMapping> & {
    assignedGrowthOSProduct?: string;
  }>>("growthos-product-ad-mappings-v1");
  const rows = Array.isArray(saved) ? saved : [];
  return rows
    .filter((mapping) => mapping.metaAdId)
    .map((mapping) => {
      const legacyAssignedProduct =
        "assignedGrowthOSProduct" in mapping ? mapping.assignedGrowthOSProduct : undefined;
      const legacyProduct = KNOWN_GROWTH_PRODUCTS.find(
        (product) => product.name === legacyAssignedProduct,
      );
      return {
        id: mapping.id || `mapping-${mapping.metaAdId}`,
        metaAdId: String(mapping.metaAdId),
        productId: mapping.productId || legacyProduct?.id,
        confidence: mapping.confidence || (mapping.productId || legacyProduct ? "Manual" : "Low"),
        source: mapping.source || (mapping.productId || legacyProduct ? "Manual" : "Auto"),
        notes: mapping.notes,
      } satisfies ProductAdMapping;
    });
}

type ShopifyDisplayCurrency = CurrencyCode;
const SHOPIFY_SOURCE_CURRENCY: CurrencyCode = "USD";
const OPERATING_CURRENCY: CurrencyCode = "AUD";
type DateRangePreset = "7d" | "30d" | "all" | "month" | "custom";
type UniversalDateRange = {
  preset: DateRangePreset;
  startDate: string;
  endDate: string;
};

function formatMoney(value: number, currencyCode: ShopifyDisplayCurrency | "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(value);
}

function convertMoney(
  value: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  usdToAudRate: number,
) {
  if (!Number.isFinite(value)) return 0;
  if (fromCurrency === toCurrency) return value;
  if (fromCurrency === "USD" && toCurrency === "AUD") return value * usdToAudRate;
  if (fromCurrency === "AUD" && toCurrency === "USD") return value / usdToAudRate;
  return value;
}

function formatDisplayMoney(
  value: number,
  sourceCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  usdToAudRate: number,
) {
  return formatMoney(convertMoney(value, sourceCurrency, displayCurrency, usdToAudRate), displayCurrency);
}

function nowLabel() {
  return new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateString: string, days: number) {
  const next = new Date(`${dateString}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localDateString(next);
}

function createPresetRange(preset: Exclude<DateRangePreset, "custom">): UniversalDateRange {
  const today = localDateString();
  if (preset === "7d") {
    return { preset, startDate: shiftDate(today, -6), endDate: today };
  }
  if (preset === "all") {
    return { preset, startDate: "2000-01-01", endDate: today };
  }
  if (preset === "month") {
    const now = new Date();
    const start = localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    return { preset, startDate: start, endDate: today };
  }

  return { preset: "30d", startDate: shiftDate(today, -29), endDate: today };
}

function normalizeDateRange(value: Partial<UniversalDateRange> | null | undefined) {
  const preset = value?.preset || "7d";
  if (preset !== "custom" && preset !== "7d" && preset !== "30d" && preset !== "all" && preset !== "month") {
    return createPresetRange("7d");
  }

  if (preset !== "custom") return createPresetRange(preset);

  const startDate = String(value?.startDate || "");
  const endDate = String(value?.endDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    return createPresetRange("7d");
  }

  return { preset, startDate, endDate };
}

function buildRangeQuery(range: UniversalDateRange) {
  const params = new URLSearchParams();
  params.set("preset", range.preset);
  params.set("start", range.startDate);
  params.set("end", range.endDate);
  return params.toString();
}

function formatRangeLabel(range: UniversalDateRange) {
  if (range.preset === "all") return "All time";
  const start = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T00:00:00`);
  const formatter = new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatStatus(status: IntegrationConnection["status"]) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Not Connected";
}

function normalizeCurrencyCode(value: string | undefined | null, fallback: CurrencyCode): CurrencyCode {
  return value === "USD" || value === "AUD" ? value : fallback;
}

function NavIcon({ name }: { name: NavIconName }) {
  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" fill="currentColor" />
      </svg>
    );
  }
  if (name === "products") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Zm0 2.2 5.2 2.8L12 10.8 6.8 8 12 5.2Zm-5.5 4.3 4.8 2.6v6.1l-4.8-2.6V9.5Zm6.3 8.7v-6.1l4.8-2.6v6.1l-4.8 2.6Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (name === "ads") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 18V9.5c0-.6.4-1 1-1H9l6-3.5c.7-.4 1.5.1 1.5.9v12.2c0 .8-.8 1.3-1.5.9L9 15.5H6c-.6 0-1-.4-1-1V18Zm2-4.5h2.5l5 2.9V7.6l-5 2.9H7v3Zm1.6 2.3 1.9 4.1"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (name === "budget") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm0 2h16m-4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7.5h14M5 12h14M5 16.5h14M9 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm9.5 4.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM12 16.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

type ShopifyAppSettings = {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  apiKeyMasked: string;
  apiSecretMasked: string;
  scopes: string;
  redirectUri: string;
  defaultShopDomain: string;
  distributionLink: string;
};

type MetaAppSettings = {
  configured: boolean;
  appId: string;
  appSecret: string;
  appIdMasked: string;
  appSecretMasked: string;
  scopes: string;
  redirectUri: string;
};

type ShopifyBranding = {
  shopName: string;
  shopDomain: string;
  logoUrl: string;
  primaryColor: string;
};

type UiSettings = {
  appColor: string;
  logoUrl: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string) {
  return /^#([0-9a-f]{6})$/i.test(value) ? value : "";
}

function shiftHexColor(hexColor: string, amount: number) {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return "";

  const channels = normalized
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => parseInt(channel, 16));

  if (!channels || channels.length !== 3) return normalized;

  const shifted = channels
    .map((channel) => clamp(Math.round(channel + 255 * amount), 0, 255))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");

  return `#${shifted}`;
}

function hexToRgb(hexColor: string) {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return null;

  const channels = normalized
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => parseInt(channel, 16));

  if (!channels || channels.length !== 3) return null;
  return channels;
}

function rgbToHsl([r, g, b]: [number, number, number]) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case red:
        hue = 60 * (((green - blue) / delta) % 6);
        break;
      case green:
        hue = 60 * ((blue - red) / delta + 2);
        break;
      default:
        hue = 60 * ((red - green) / delta + 4);
        break;
    }
  }

  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = chroma;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = chroma;
  } else if (hue < 180) {
    g1 = chroma;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = chroma;
  } else if (hue < 300) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function derivePalette(hexColor: string) {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return null;
  const rgb = hexToRgb(normalized) as [number, number, number];
  const { h, s, l } = rgbToHsl(rgb);
  const baseSaturation = clamp(Math.max(s, 0.82), 0, 1);
  const richSaturation = clamp(Math.max(s, 0.9) + 0.08, 0, 1);
  const deepSaturation = 1;
  const brand = rgbToHex(hslToRgb(h, baseSaturation, clamp(l, 0.38, 0.56)));
  const brandStrong = rgbToHex(hslToRgb(h, richSaturation, clamp(l - 0.1, 0.24, 0.4)));
  const brandSoft = rgbToHex(hslToRgb(h, clamp(baseSaturation * 0.32, 0.18, 0.34), 0.96));
  const brandSoftStrong = rgbToHex(hslToRgb(h, clamp(baseSaturation * 0.44, 0.24, 0.42), 0.88));
  const surfaceTint = rgbToHex(hslToRgb(h, clamp(baseSaturation * 0.18, 0.12, 0.22), 0.975));
  const metricStart = rgbToHex(hslToRgb(h, richSaturation, clamp(l - 0.01, 0.32, 0.5)));
  const metricEnd = rgbToHex(hslToRgb(h, deepSaturation, clamp(l - 0.08, 0.24, 0.38)));
  const badgeBg = rgbToHex(hslToRgb(h, clamp(baseSaturation * 0.28, 0.16, 0.3), 0.94));
  const badgeInk = rgbToHex(hslToRgb(h, clamp(baseSaturation + 0.12, 0, 1), 0.28));
  const chipBg = rgbToHex(hslToRgb(h, clamp(baseSaturation * 0.22, 0.14, 0.26), 0.97));
  const chipInk = rgbToHex(hslToRgb(h, clamp(baseSaturation + 0.14, 0, 1), 0.26));

  return {
    brand,
    brandStrong,
    brandSoft,
    brandSoftStrong,
    surfaceTint,
    metricStart,
    metricEnd,
    badgeBg,
    badgeInk,
    chipBg,
    chipInk,
    rgb: hexToRgb(brand)?.join(", ") || "22, 75, 53",
  };
}

function brandingStyle(primaryColor: string): CSSProperties {
  const normalized = normalizeHexColor(primaryColor);
  if (!normalized) return {};
  const palette = derivePalette(normalized);
  if (!palette) return {};

  return {
    "--color-brand": palette.brand,
    "--color-brand-strong": palette.brandStrong,
    "--color-brand-soft": palette.brandSoft,
    "--color-brand-soft-strong": palette.brandSoftStrong,
    "--color-surface-tint": palette.surfaceTint,
    "--color-brand-rgb": palette.rgb,
    "--color-brand-metric-start": palette.metricStart,
    "--color-brand-metric-end": palette.metricEnd,
    "--color-brand-badge-bg": palette.badgeBg,
    "--color-brand-badge-ink": palette.badgeInk,
    "--color-brand-chip-bg": palette.chipBg,
    "--color-brand-chip-ink": palette.chipInk,
  } as CSSProperties;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [connections, setConnections] =
    useState<IntegrationConnection[]>(initialConnections);
  const [mappings, setMappings] =
    useState<ProductAdMapping[]>(loadMappingsFromStorage);
  const [ruleSettings, setRuleSettings] = useState<RuleSettings>(loadRuleSettingsFromStorage);
  const [growthShopifyProducts, setGrowthShopifyProducts] =
    useState<ShopifyProductImport[]>([]);
  const [growthMetaAds, setGrowthMetaAds] = useState<MetaAdImport[]>([]);
  const [dailyAdBudget, setDailyAdBudget] = useState(() => {
    const saved = Number(window.localStorage.getItem("growthos-daily-ad-budget"));
    return Number.isFinite(saved) && saved >= 0 ? saved : 100;
  });
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [shopifyNotice, setShopifyNotice] = useState("");
  const [backendOffline, setBackendOffline] = useState(false);
  const [shopifyAppSettings, setShopifyAppSettings] =
    useState<ShopifyAppSettings | null>(null);
  const [metaAppSettings, setMetaAppSettings] =
    useState<MetaAppSettings | null>(null);
  const [shopifyBranding, setShopifyBranding] = useState<ShopifyBranding | null>(null);
  const [uiSettings, setUiSettings] = useState<UiSettings>({ appColor: "", logoUrl: "" });
  const [shopifyDisplayCurrency, setShopifyDisplayCurrency] =
    useState<ShopifyDisplayCurrency>(() => {
      const saved = window.localStorage.getItem("shopify-display-currency");
      return saved === "AUD" ? "AUD" : "USD";
    });
  const [usdToAudRate, setUsdToAudRate] = useState(() => {
    const saved = Number(window.localStorage.getItem("shopify-usd-aud-rate"));
    return Number.isFinite(saved) && saved > 0 ? saved : 1.55;
  });
  const [usdToAudRateUpdatedAt, setUsdToAudRateUpdatedAt] = useState(
    () => window.localStorage.getItem("shopify-usd-aud-rate-updated-at") || "",
  );
  const [usdToAudRateSource, setUsdToAudRateSource] = useState(
    () => window.localStorage.getItem("shopify-usd-aud-rate-source") || "cached",
  );
  const [usdToAudRateError, setUsdToAudRateError] = useState("");
  const [isRangeOpen, setIsRangeOpen] = useState(true);
  const [dateRange, setDateRange] = useState<UniversalDateRange>(() => {
    const saved = readCachedJson<UniversalDateRange>("growthos-universal-date-range");
    return normalizeDateRange(saved);
  });

  function navigate(href: string) {
    window.history.pushState(null, "", href);
    setPath(href);
    setIsNavOpen(false);
  }

  function isRouteActive(href: string) {
    if (href === "/") return path === "/";
    if (href === "/settings") {
      return path.startsWith("/settings") || path.startsWith("/imports") || path.startsWith("/mappings");
    }
    return path === href;
  }

  window.onpopstate = () => setPath(window.location.pathname);

  function updateConnection(provider: IntegrationProvider, next: IntegrationConnection) {
    setConnections((current) =>
      current.map((connection) =>
        connection.provider === provider ? next : connection,
      ),
    );
  }

  async function refreshUsdToAudRate() {
    try {
      const response = await fetch("/api/market/fx/usd-aud", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load current USD/AUD rate.");
      const data = (await response.json()) as {
        rate?: number;
        fetchedAt?: string;
        source?: string;
      };
      if (!data.rate || !Number.isFinite(data.rate) || data.rate <= 0) {
        throw new Error("Received an invalid USD/AUD rate.");
      }
      setUsdToAudRate(data.rate);
      setUsdToAudRateUpdatedAt(data.fetchedAt || "");
      setUsdToAudRateSource(data.source || "live");
      setUsdToAudRateError("");
    } catch (error) {
      setUsdToAudRateError(
        error instanceof Error ? error.message : "Could not load current USD/AUD rate.",
      );
    }
  }

  const shopifyConnection = connections.find(
    (connection) => connection.provider === "shopify",
  )!;
  const metaConnection = connections.find(
    (connection) => connection.provider === "meta-ads",
  )!;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop") || "";
    const status = params.get("shopify");

    function isValidShopDomain(value: string) {
      return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
    }

    async function loadShopifyConnection() {
      try {
        const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";
        const response = await fetch(`/api/integrations/shopify/status${query}`);
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as {
          status: IntegrationConnection["status"];
          accountName?: string;
          storeDomain?: string;
          lastSyncAt?: string;
        };

        updateConnection("shopify", {
          id: "shopify",
          provider: "shopify",
          status: data.status,
          accountName: data.accountName,
          storeDomain: data.storeDomain,
          lastSyncAt: data.lastSyncAt
            ? new Date(data.lastSyncAt).toLocaleString()
            : undefined,
        });
        return data;
      } catch {
        setBackendOffline(true);
        updateConnection("shopify", {
          id: "shopify",
          provider: "shopify",
          status: "error",
          errorMessage: "Could not load Shopify connection status.",
        });
        return null;
      }
    }

    async function loadShopifyAppSettings() {
      try {
        const response = await fetch("/api/settings/shopify-app");
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as ShopifyAppSettings;
        setShopifyAppSettings(data);
        return data;
      } catch {
        setBackendOffline(true);
        setShopifyAppSettings(null);
        return null;
      }
    }

    async function loadMetaConnection() {
      try {
        const response = await fetch("/api/integrations/meta/status");
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as {
          status: IntegrationConnection["status"];
          accountName?: string;
          accountId?: string;
          lastSyncAt?: string;
          currency?: CurrencyCode;
        };

        updateConnection("meta-ads", {
          id: "meta-ads",
          provider: "meta-ads",
          status: data.status,
          accountName: data.accountName,
          accountId: data.accountId,
          currency: normalizeCurrencyCode(data.currency, OPERATING_CURRENCY),
          lastSyncAt: data.lastSyncAt
            ? new Date(data.lastSyncAt).toLocaleString()
            : undefined,
        });
        return data;
      } catch {
        setBackendOffline(true);
        updateConnection("meta-ads", {
          id: "meta-ads",
          provider: "meta-ads",
          status: "error",
          errorMessage: "Could not load Meta connection status.",
        });
        return null;
      }
    }

    async function loadMetaAppSettings() {
      try {
        const response = await fetch("/api/settings/meta-app");
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as MetaAppSettings;
        setMetaAppSettings(data);
        return data;
      } catch {
        setBackendOffline(true);
        setMetaAppSettings(null);
        return null;
      }
    }

    async function loadShopifyBranding() {
      try {
        const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";
        const response = await fetch(`/api/branding/shopify${query}`);
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as ShopifyBranding;
        setShopifyBranding(data);
        return data;
      } catch {
        setBackendOffline(true);
        setShopifyBranding(null);
        return null;
      }
    }

    async function loadUiSettings() {
      try {
        const response = await fetch("/api/settings/ui");
        setBackendOffline(false);
        if (!response.ok) return null;
        const data = (await response.json()) as UiSettings;
        setUiSettings({ appColor: data.appColor || "", logoUrl: data.logoUrl || "" });
        return data;
      } catch {
        setBackendOffline(true);
        return null;
      }
    }

    if (status === "connected") {
      setShopifyNotice("Shopify connected successfully.");
      window.history.replaceState(null, "", "/settings/integrations");
      setPath("/settings/integrations");
    }
    if (params.get("meta") === "connected") {
      setShopifyNotice("Meta Ads connected successfully.");
      window.history.replaceState(null, "", "/settings/integrations");
      setPath("/settings/integrations");
    }

    async function bootstrap() {
      const [connection, settings] = await Promise.all([
        loadShopifyConnection(),
        loadShopifyAppSettings(),
        loadMetaConnection(),
        loadMetaAppSettings(),
        loadShopifyBranding(),
        loadUiSettings(),
      ]);

      // When Shopify launches the app from Admin, it includes the shop in the URL.
      // If we have credentials but no saved token for that shop yet, start OAuth directly.
      if (
        shop &&
        isValidShopDomain(shop) &&
        settings?.configured &&
        connection?.status !== "connected" &&
        status !== "connected"
      ) {
        window.location.href = `/api/shopify/install?shop=${encodeURIComponent(shop)}`;
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("shopify-display-currency", shopifyDisplayCurrency);
  }, [shopifyDisplayCurrency]);

  useEffect(() => {
    window.localStorage.setItem("shopify-usd-aud-rate", String(usdToAudRate));
  }, [usdToAudRate]);

  useEffect(() => {
    window.localStorage.setItem("shopify-usd-aud-rate-updated-at", usdToAudRateUpdatedAt);
  }, [usdToAudRateUpdatedAt]);

  useEffect(() => {
    window.localStorage.setItem("shopify-usd-aud-rate-source", usdToAudRateSource);
  }, [usdToAudRateSource]);

  useEffect(() => {
    void refreshUsdToAudRate().catch(() => undefined);
  }, []);

  const dateRangeKey = buildRangeQuery(dateRange);

  useEffect(() => {
    writeCachedJson("growthos-universal-date-range", dateRange);
  }, [dateRange]);

  useEffect(() => {
    writeCachedJson("growthos-product-ad-mappings-v1", mappings);
  }, [mappings]);

  useEffect(() => {
    writeCachedJson(RULE_SETTINGS_STORAGE_KEY, ruleSettings);
  }, [ruleSettings]);

  useEffect(() => {
    window.localStorage.setItem("growthos-daily-ad-budget", String(dailyAdBudget));
  }, [dailyAdBudget]);

  useEffect(() => {
    let active = true;

    async function loadGrowthData() {
      try {
        const [shopifyResponse, metaResponse] = await Promise.all([
          fetch(`/api/imports/shopify/products?${dateRangeKey}`, { cache: "no-store" }),
          fetch(`/api/imports/meta-ads?${dateRangeKey}`, { cache: "no-store" }),
        ]);

        if (shopifyResponse.ok) {
          const shopifyData = (await shopifyResponse.json()) as { products?: ShopifyProductImport[] };
          if (active) setGrowthShopifyProducts(Array.isArray(shopifyData.products) ? shopifyData.products : []);
        }

        if (metaResponse.ok) {
          const metaData = (await metaResponse.json()) as { ads?: MetaAdImport[] };
          if (active) setGrowthMetaAds(Array.isArray(metaData.ads) ? metaData.ads : []);
        }
      } catch {
        // Business views can still operate on cached/mock import rows.
      }
    }

    void loadGrowthData();
    return () => {
      active = false;
    };
  }, [dateRangeKey]);

  const reconciledMappings = useMemo(
    () => reconcileMappings(growthMetaAds, mappings),
    [growthMetaAds, mappings],
  );
  const metaOperatingCurrency = normalizeCurrencyCode(metaConnection.currency, OPERATING_CURRENCY);
  const baseGrowthProducts = useMemo(
    () => buildGrowthProducts(growthShopifyProducts, ruleSettings, usdToAudRate),
    [growthShopifyProducts, ruleSettings, usdToAudRate],
  );
  const growthAds = useMemo(
    () =>
      buildGrowthAds(
        growthMetaAds,
        reconciledMappings,
        baseGrowthProducts,
        ruleSettings,
        metaOperatingCurrency,
        usdToAudRate,
      ),
    [baseGrowthProducts, growthMetaAds, metaOperatingCurrency, reconciledMappings, ruleSettings, usdToAudRate],
  );
  const growthProducts = useMemo(
    () => applyProductMetrics(baseGrowthProducts, growthAds, ruleSettings),
    [baseGrowthProducts, growthAds, ruleSettings],
  );

  const effectiveBrandColor = uiSettings.appColor || shopifyBranding?.primaryColor || "";
  const effectiveLogoUrl = uiSettings.logoUrl || shopifyBranding?.logoUrl || "";

  return (
    <div className="app-shell" style={brandingStyle(effectiveBrandColor)}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            {effectiveLogoUrl ? (
                <img
                  className="brand-mark-image"
                  src={effectiveLogoUrl}
                  alt={shopifyBranding?.shopName || "Store logo"}
                />
            ) : (
              "G"
            )}
          </span>
          <div>
            <strong>GrowthOS</strong>
            <span>{shopifyBranding?.shopName || "Insidecats"}</span>
          </div>
        </div>
        <button
          className="btn btn-secondary menu-toggle"
          aria-expanded={isNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setIsNavOpen((open) => !open)}
        >
          Menu
        </button>
        <nav
          id="primary-navigation"
          className={isNavOpen ? "nav-open" : ""}
        >
          {routes.map((route) => (
            <button
              className={`nav-link ${isRouteActive(route.href) ? "active" : ""}`}
              key={route.href}
              onClick={() => navigate(route.href)}
            >
              <span className="nav-link-icon">
                <NavIcon name={route.icon} />
              </span>
              <span className="nav-link-label">{route.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-bottom-nav">
            <button
              className={`nav-link ${isRouteActive(settingsRoute.href) ? "active" : ""}`}
              onClick={() => navigate(settingsRoute.href)}
              title={settingsRoute.label}
            >
              <span className="nav-link-icon">
                <NavIcon name={settingsRoute.icon} />
              </span>
              <span className="nav-link-label">{settingsRoute.label}</span>
            </button>
          </div>
          <section className="sidebar-settings">
            <div className="sidebar-panel">
            <button
              className="sidebar-panel-toggle"
              type="button"
              aria-expanded={isRangeOpen}
              aria-controls="reporting-range-panel"
              onClick={() => setIsRangeOpen((current) => !current)}
            >
              <span className="sidebar-panel-header">
                <strong>Reporting range</strong>
                <span>{formatRangeLabel(dateRange)}</span>
              </span>
              <span className={`sidebar-panel-chevron ${isRangeOpen ? "open" : ""}`} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path
                    d="m6 9 6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </span>
            </button>
            {isRangeOpen ? (
              <div id="reporting-range-panel" className="sidebar-panel-body">
                <div className="range-chip-grid">
                  {[
                    { value: "7d", label: "Last 7 days" },
                    { value: "30d", label: "Last 30 days" },
                    { value: "all", label: "All time" },
                    { value: "month", label: "This month" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      className={`scope-chip ${dateRange.preset === option.value ? "scope-chip-selected" : ""}`}
                      type="button"
                      onClick={() =>
                        setDateRange(createPresetRange(option.value as Exclude<DateRangePreset, "custom">))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="date-range-grid">
                  <div>
                    <label htmlFor="range-start-date">Start date</label>
                    <input
                      id="range-start-date"
                      type="date"
                      value={dateRange.startDate}
                      max={dateRange.endDate}
                      onChange={(event) =>
                        setDateRange((current) => {
                          const nextStart = event.target.value;
                          return normalizeDateRange({
                            preset: "custom",
                            startDate: nextStart,
                            endDate: nextStart > current.endDate ? nextStart : current.endDate,
                          });
                        })
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="range-end-date">End date</label>
                    <input
                      id="range-end-date"
                      type="date"
                      value={dateRange.endDate}
                      min={dateRange.startDate}
                      max={localDateString()}
                      onChange={(event) =>
                        setDateRange((current) =>
                          normalizeDateRange({
                            preset: "custom",
                            startDate: current.startDate,
                            endDate: event.target.value,
                          }),
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </section>
        </div>
      </aside>

      <main>
        {backendOffline ? (
          <p className="notice notice-warning">
            The local integration server is offline, so saved Shopify settings and
            connection data cannot be loaded. Start the backend with `npm run dev:full`
            and refresh.
          </p>
        ) : null}
        {path === "/" ? (
          <DashboardPage
            key={dateRangeKey}
            shopifyConnection={shopifyConnection}
            metaConnection={metaConnection}
            navigate={navigate}
            shopifyDisplayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
            dateRange={dateRange}
            growthProducts={growthProducts}
            growthAds={growthAds}
            mappings={reconciledMappings}
            ruleSettings={ruleSettings}
            dailyAdBudget={dailyAdBudget}
          />
        ) : null}
        {path === "/settings" ? (
          <SettingsHubPage
            navigate={navigate}
            shopifyConnection={shopifyConnection}
            metaConnection={metaConnection}
            shopifyAppConfigured={Boolean(shopifyAppSettings?.configured)}
            metaAppConfigured={Boolean(metaAppSettings?.configured)}
            appColor={uiSettings.appColor}
            logoUrl={uiSettings.logoUrl}
            currency={shopifyDisplayCurrency}
          />
        ) : null}
        {path === "/settings/branding" ? (
          <BrandingSettingsPage
            navigate={navigate}
            appColor={uiSettings.appColor}
            logoUrl={uiSettings.logoUrl}
            setUiSettings={setUiSettings}
            shopifyBrandColor={shopifyBranding?.primaryColor || ""}
            shopifyLogoUrl={shopifyBranding?.logoUrl || ""}
          />
        ) : null}
        {path === "/settings/currency" ? (
          <CurrencySettingsPage
            navigate={navigate}
            currency={shopifyDisplayCurrency}
            setCurrency={setShopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
            usdToAudRateUpdatedAt={usdToAudRateUpdatedAt}
            usdToAudRateSource={usdToAudRateSource}
            usdToAudRateError={usdToAudRateError}
            refreshUsdToAudRate={refreshUsdToAudRate}
          />
        ) : null}
        {path === "/settings/rules" ? (
          <RulesSettingsPage
            navigate={navigate}
            ruleSettings={ruleSettings}
            setRuleSettings={setRuleSettings}
          />
        ) : null}
        {path === "/settings/integrations" ? (
          <IntegrationsPage
            navigate={navigate}
            shopifyConnection={shopifyConnection}
            metaConnection={metaConnection}
            updateConnection={updateConnection}
            shopifyNotice={shopifyNotice}
            setShopifyNotice={setShopifyNotice}
            shopifyAppConfigured={Boolean(shopifyAppSettings?.configured)}
            defaultShopDomain={shopifyAppSettings?.defaultShopDomain || ""}
            distributionLink={shopifyAppSettings?.distributionLink || ""}
            metaAppConfigured={Boolean(metaAppSettings?.configured)}
          />
        ) : null}
        {path === "/settings/app-setup" ? (
          <ShopifyAppSetupPage
            navigate={navigate}
            initialSettings={shopifyAppSettings}
            setShopifyAppSettings={setShopifyAppSettings}
            initialMetaSettings={metaAppSettings}
            setMetaAppSettings={setMetaAppSettings}
          />
        ) : null}
        {path === "/imports/shopify" ? (
          <ShopifyImportsPage
            key={dateRangeKey}
            shopifyDisplayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
            dateRange={dateRange}
          />
        ) : null}
        {path === "/imports/meta-ads" ? (
          <MetaAdsImportsPage
            key={dateRangeKey}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
            dateRange={dateRange}
            metaCurrency={metaOperatingCurrency}
          />
        ) : null}
        {path === "/mappings" ? (
          <MappingsPage
            ads={growthMetaAds}
            products={growthProducts}
            mappings={reconciledMappings}
            setMappings={setMappings}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
            metaCurrency={metaOperatingCurrency}
          />
        ) : null}
        {path === "/products" ? (
          <ProductsPage
            products={growthProducts}
            ads={growthAds}
            ruleSettings={ruleSettings}
            navigate={navigate}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
          />
        ) : null}
        {path.startsWith("/products/") ? (
          <ProductDetailPage
            productId={decodeURIComponent(path.replace("/products/", ""))}
            products={growthProducts}
            ads={growthAds}
            shopifyProducts={growthShopifyProducts}
            mappings={reconciledMappings}
            ruleSettings={ruleSettings}
            navigate={navigate}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
          />
        ) : null}
        {path === "/ads" ? (
          <AdsPage
            ads={growthAds}
            products={growthProducts}
            ruleSettings={ruleSettings}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
          />
        ) : null}
        {path === "/budget" ? (
          <BudgetPage
            dailyAdBudget={dailyAdBudget}
            setDailyAdBudget={setDailyAdBudget}
            products={growthProducts}
            ruleSettings={ruleSettings}
            displayCurrency={shopifyDisplayCurrency}
            usdToAudRate={usdToAudRate}
          />
        ) : null}
      </main>
    </div>
  );
}

type DashboardPageProps = {
  shopifyConnection: IntegrationConnection;
  metaConnection: IntegrationConnection;
  navigate: (href: string) => void;
  shopifyDisplayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
  dateRange: UniversalDateRange;
  growthProducts: Product[];
  growthAds: GrowthAd[];
  mappings: ProductAdMapping[];
  ruleSettings: RuleSettings;
  dailyAdBudget: number;
};

function DashboardPage({
  shopifyConnection,
  metaConnection,
  navigate,
  shopifyDisplayCurrency,
  usdToAudRate,
  dateRange,
  growthProducts,
  growthAds,
  mappings,
  ruleSettings,
  dailyAdBudget,
}: DashboardPageProps) {
  const businessSummary = summarizeBusiness(growthProducts, growthAds, mappings);
  const productCards = growthProducts
    .filter(
      (product) =>
        product.totalSpend > 0 ||
        product.purchases > 0 ||
        product.revenue > 0 ||
        product.role !== "Backlog",
    )
    .sort((first, second) => {
      const roleOrder = { Hero: 0, Challenger: 1, Test: 2, Backlog: 3 } as const;
      return roleOrder[first.role] - roleOrder[second.role] || second.totalSpend - first.totalSpend;
    })
    .slice(0, 4);
  const slot3State = getProductSlot3State(dailyAdBudget, growthProducts, ruleSettings);
  const budgetCapacity = getBudgetCapacitySummary(dailyAdBudget, growthProducts, ruleSettings);
  const dataIssues = collectDataIssues(
    growthProducts,
    growthAds,
    mappings,
    shopifyConnection,
    metaConnection,
  );
  const weeklyActionPlan = buildWeeklyActionPlan(
    growthProducts,
    growthAds,
    mappings,
    dailyAdBudget,
    shopifyConnection,
    metaConnection,
    ruleSettings,
  );
  const adsNeedingAction = growthAds
    .map((ad) => {
      const product = growthProducts.find((item) => item.id === ad.productId);
      const decision = getAdDecision(ad, product, ruleSettings);
      return { ad, product, decision };
    })
    .filter(({ decision }) => ["Kill", "Recut", "Needs More Spend", "Scale"].includes(decision))
    .sort((first, second) => second.ad.spend - first.ad.spend)
    .slice(0, 8);
  const activeProductsCount = productCards.length;
  const summaryItems = [
    {
      label: "Total ad spend",
      value: formatDisplayMoney(
        businessSummary.totalSpend,
        OPERATING_CURRENCY,
        shopifyDisplayCurrency,
        usdToAudRate,
      ),
    },
    {
      label: "Revenue",
      value: formatDisplayMoney(
        businessSummary.totalRevenue,
        OPERATING_CURRENCY,
        shopifyDisplayCurrency,
        usdToAudRate,
      ),
    },
    {
      label: "Estimated profit/loss",
      value: formatDisplayMoney(
        businessSummary.estimatedProfitLoss,
        OPERATING_CURRENCY,
        shopifyDisplayCurrency,
        usdToAudRate,
      ),
    },
    { label: "Active products", value: String(businessSummary.activeProducts || activeProductsCount) },
    { label: "Active ads", value: String(businessSummary.activeAds) },
    { label: "Unmapped ads", value: String(businessSummary.unmappedAds) },
    {
      label: "Date range",
      value:
        dateRange.preset === "7d"
          ? "Last 7 Days"
          : dateRange.preset === "30d"
            ? "Last 30 Days"
            : dateRange.preset === "all"
              ? "All Time"
              : dateRange.preset === "month"
                ? "This Month"
                : formatRangeLabel(dateRange),
    },
  ];
  const issueRows = [
    {
      title: "Unmapped Meta ads",
      count: dataIssues.unmappedAds.length,
      detail: dataIssues.unmappedAds.length
        ? `${dataIssues.unmappedAds.length} ads still need a product mapping before decisions are trustworthy.`
        : "No unmapped Meta ads.",
      actionLabel: "Open mappings",
      actionHref: "/mappings",
    },
    {
      title: "Products missing break-even CPA",
      count: dataIssues.productsMissingBreakEven.length,
      detail: dataIssues.productsMissingBreakEven.length
        ? dataIssues.productsMissingBreakEven.map((product) => product.name).join(", ")
        : "All surfaced products have a real break-even CPA source.",
      actionLabel: "Open products",
      actionHref: "/products",
    },
    {
      title: "Products with no assigned ads",
      count: dataIssues.productsWithoutAssignedAds.length,
      detail: dataIssues.productsWithoutAssignedAds.length
        ? dataIssues.productsWithoutAssignedAds.map((product) => product.name).join(", ")
        : "Every surfaced product has at least one assigned ad.",
      actionLabel: "Open mappings",
      actionHref: "/mappings",
    },
    {
      title: "Unlinked Shopify products",
      count: dataIssues.productsWithoutShopifyLink.length,
      detail: dataIssues.productsWithoutShopifyLink.length
        ? dataIssues.productsWithoutShopifyLink.map((product) => product.name).join(", ")
        : "All surfaced products are linked to Shopify.",
      actionLabel: "Open products",
      actionHref: "/products",
    },
    {
      title: "Ads missing spend or purchase data",
      count: dataIssues.adsMissingCoreData.length,
      detail: dataIssues.adsMissingCoreData.length
        ? `${dataIssues.adsMissingCoreData.length} ads have incomplete core fields.`
        : "No ads are missing spend, purchase, or CTR data.",
      actionLabel: "Open ads",
      actionHref: "/ads",
    },
    {
      title: "Stale mappings",
      count: dataIssues.staleMappings.length,
      detail: dataIssues.staleMappings.length
        ? `${dataIssues.staleMappings.length} saved mappings no longer match a live imported ad.`
        : "No stale mappings detected.",
      actionLabel: "Open mappings",
      actionHref: "/mappings",
    },
  ];
  const integrationWarnings = dataIssues.integrationWarnings.map((connection) =>
    `${connection.provider === "shopify" ? "Shopify" : "Meta"} is ${formatStatus(connection.status).toLowerCase()}.`,
  );

  return (
    <section className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">Home</p>
          <h1>Insidecats growth dashboard</h1>
          <p>
            Product-decision-first operating view. See what state each product is in,
            what decision is recommended, why that decision is being made, and what
            needs action next.
          </p>
          <p className="hero-subtle">Reporting window: {formatRangeLabel(dateRange)}</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/settings")}>
          Open Settings
        </button>
      </header>

      <section className="dashboard-summary-bar">
        {summaryItems.map((item) => (
          <div className="summary-pill" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="decision-card-grid">
        {productCards.map((product) => {
          const assignedAds = growthAds.filter((ad) => ad.productId === product.id);
          const decision = getProductDecision(product, assignedAds, ruleSettings);
          const failureStage = getFailureStage(product, assignedAds, ruleSettings);
          const reason = getProductDecisionReason(product, assignedAds, ruleSettings);
          const nextAction = getProductNextAction(product, assignedAds, ruleSettings);
          const adRevenue = getProductAdRevenue(assignedAds);
          const shopifyRevenue = product.shopifyProductId ? product.revenue : 0;
          const revenueReference = getProductRevenueReference(product, assignedAds);
          const profitLoss = revenueReference - product.totalSpend;
          const anglesTested = getAnglesTestedCount(assignedAds);
          const spendProgress = Math.min(
            100,
            Math.round((product.totalSpend / Math.max(product.testBudgetCap, 1)) * 100),
          );
          const adsProgress = Math.min(
            100,
            Math.round((product.adsTestedCount / Math.max(ruleSettings.requiredAdsBeforeProductJudgment, 1)) * 100),
          );
          const anglesProgress = Math.min(
            100,
            Math.round((anglesTested / Math.max(ruleSettings.requiredAnglesBeforeProductJudgment, 1)) * 100),
          );

          return (
            <article className="card product-decision-card" key={product.id}>
              <div className="product-decision-header">
                <div>
                  <p className="product-decision-role">{product.role}</p>
                  <h2>{product.name}</h2>
                </div>
                <div className="product-decision-badges">
                  <span className="status connected">{product.status}</span>
                  <span className="status not_connected">{decision}</span>
                </div>
              </div>

              <div className="diagnostic-callout">
                <strong>{failureStage}</strong>
                <span>{reason}</span>
              </div>

              <div className="decision-metric-grid">
                <MetricStat
                  label="Assigned Meta spend"
                  value={formatDisplayMoney(product.totalSpend, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                />
                <MetricStat
                  label="Shopify revenue"
                  value={
                    product.shopifyProductId
                      ? formatDisplayMoney(shopifyRevenue, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)
                      : "No linked Shopify product"
                  }
                />
                <MetricStat
                  label="Ad revenue"
                  value={
                    adRevenue > 0
                      ? formatDisplayMoney(adRevenue, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)
                      : "Not enough data"
                  }
                />
                <MetricStat
                  label="Estimated profit/loss"
                  value={formatDisplayMoney(profitLoss, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                />
                <MetricStat label="Purchases" value={product.purchases ? String(product.purchases) : "Not enough data"} />
                <MetricStat
                  label="Current CPA"
                  value={
                    product.currentCpa > 0
                      ? formatDisplayMoney(product.currentCpa, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)
                      : "Not enough data"
                  }
                />
                <MetricStat
                  label="Break-even CPA"
                  value={
                    product.breakEvenCpaSource === "catalog"
                      ? formatDisplayMoney(product.breakEvenCpa, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)
                      : "Missing break-even CPA"
                  }
                />
                <MetricStat label="Mapped ads" value={assignedAds.length ? String(assignedAds.length) : "No mapped ads"} />
              </div>

              <div className="progress-stack">
                <ProgressRow
                  label="Spend progress"
                  value={`${formatDisplayMoney(product.totalSpend, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)} / ${formatDisplayMoney(product.testBudgetCap, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}`}
                  percent={spendProgress}
                />
                <ProgressRow
                  label="Ads tested"
                  value={`${product.adsTestedCount} / ${ruleSettings.requiredAdsBeforeProductJudgment}`}
                  percent={adsProgress}
                />
                <ProgressRow
                  label="Angles tested"
                  value={`${anglesTested} / ${ruleSettings.requiredAnglesBeforeProductJudgment}`}
                  percent={anglesProgress}
                />
              </div>

              <div className="decision-explainer">
                <div>
                  <strong>Why</strong>
                  <p>{reason}</p>
                </div>
                <div>
                  <strong>Next action</strong>
                  <p>{nextAction}</p>
                </div>
              </div>

              <div className="button-row">
                <button className="btn btn-secondary" onClick={() => navigate(`/products/${encodeURIComponent(product.id)}`)}>
                  View Product
                </button>
                <button className="btn btn-ghost" onClick={() => navigate("/ads")}>
                  View Ads
                </button>
                <button className="btn btn-primary" onClick={() => navigate(`/products/${encodeURIComponent(product.id)}`)}>
                  Update Status
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <div className="dashboard-support-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Product Slot 3</h2>
            <span className={`status ${slot3State.unlocked ? "connected" : "not_connected"}`}>
              {slot3State.unlocked ? "Unlocked" : "Locked"}
            </span>
          </div>
          <div className="summary-list">
            <div>
              <strong>{formatDisplayMoney(slot3State.dailyAdBudget, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}</strong>
              <span>Current daily budget</span>
            </div>
            <div>
              <strong>{formatDisplayMoney(slot3State.requiredBudgetThreshold, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}</strong>
              <span>Configured threshold</span>
            </div>
            <div>
              <strong>{slot3State.certifiedProduct || "No"}</strong>
              <span>Certified/scaling product</span>
            </div>
            <div>
              <strong>{slot3State.replaceableProduct || "No"}</strong>
              <span>Dead/replaceable product</span>
            </div>
          </div>
          <p className="muted">{slot3State.reason}</p>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Budget Capacity</h2>
            <span className={`status ${budgetCapacity.spreadTooThin ? "error" : "connected"}`}>
              {budgetCapacity.spreadTooThin ? "Too thin" : "On plan"}
            </span>
          </div>
          <div className="summary-list">
            <div>
              <strong>{formatDisplayMoney(budgetCapacity.dailyAdBudget, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}</strong>
              <span>Current daily budget</span>
            </div>
            <div>
              <strong>{budgetCapacity.maxActiveProducts}</strong>
              <span>Recommended active products</span>
            </div>
            <div>
              <strong>{budgetCapacity.recommendedAdsPerProduct}</strong>
              <span>Recommended active ads per product</span>
            </div>
            <div>
              <strong>{budgetCapacity.recommendedRetargetingBudgetPercent}%</strong>
              <span>Recommended retargeting budget</span>
            </div>
          </div>
          <p className="muted">{budgetCapacity.explanation}</p>
        </article>
      </div>

      <article className="card">
        <div className="card-title-row">
          <h2>Ads Needing Action</h2>
          <span className="status connected">{adsNeedingAction.length} ads</span>
        </div>
        {adsNeedingAction.length ? (
          <div className="action-list">
            {adsNeedingAction.map(({ ad, product, decision }) => (
              <div className="action-row" key={ad.id}>
                <div className="action-row-main">
                  <strong>{ad.name}</strong>
                  <span>{product?.name || "Unassigned"} · {ad.campaignName} · {ad.adSetName}</span>
                </div>
                <div className="action-row-metrics">
                  <span>{formatDisplayMoney(ad.spend, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate)} spend</span>
                  <span>{ad.purchases} purchases</span>
                  <span>{ad.cpa ? formatDisplayMoney(ad.cpa, OPERATING_CURRENCY, shopifyDisplayCurrency, usdToAudRate) : "No CPA"} CPA</span>
                  <span>{ad.ctr.toFixed(2)}% CTR</span>
                </div>
                <div className="action-row-decision">
                  <span className={`status ${decision === "Scale" ? "connected" : decision === "Kill" ? "error" : "not_connected"}`}>
                    {decision}
                  </span>
                  <p>{getAdDecisionReason(ad, product, ruleSettings)}</p>
                </div>
                <div className="action-cell">
                  <button className="btn btn-secondary" onClick={() => navigate("/ads")}>View Ad</button>
                  {product ? (
                    <button className="btn btn-ghost" onClick={() => navigate(`/products/${encodeURIComponent(product.id)}`)}>
                      View Product
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No ads currently need an explicit action decision.</p>
        )}
      </article>

      <div className="dashboard-support-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Data Issues</h2>
            <span className={`status ${issueRows.some((issue) => issue.count > 0) || integrationWarnings.length ? "error" : "connected"}`}>
              {(issueRows.reduce((sum, issue) => sum + issue.count, 0) + integrationWarnings.length) || "Clear"}
            </span>
          </div>
          <div className="issue-list">
            {issueRows.map((issue) => (
              <div className="issue-row" key={issue.title}>
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                </div>
                <div className="issue-row-side">
                  <span className={`status ${issue.count > 0 ? "error" : "connected"}`}>{issue.count}</span>
                  <button className="btn btn-ghost" onClick={() => navigate(issue.actionHref)}>
                    {issue.actionLabel}
                  </button>
                </div>
              </div>
            ))}
            {integrationWarnings.length ? (
              <div className="issue-row">
                <div>
                  <strong>Integration warnings</strong>
                  <p>{integrationWarnings.join(" ")}</p>
                </div>
                <div className="issue-row-side">
                  <span className="status error">{integrationWarnings.length}</span>
                  <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>
                    Open integrations
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Weekly Action Plan</h2>
            <span className="status connected">{weeklyActionPlan.length} items</span>
          </div>
          {weeklyActionPlan.length ? (
            <div className="checklist">
              {weeklyActionPlan.map((item) => (
                <label className="checklist-item" key={item}>
                  <input type="checkbox" />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No urgent actions generated from the current data window.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressRow({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="progress-row">
      <div className="progress-row-top">
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span className="progress-fill" style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
    </div>
  );
}

function SettingsSubpageHeader({
  navigate,
  title,
  description,
  currentLabel,
}: {
  navigate: (href: string) => void;
  title: string;
  description: string;
  currentLabel: string;
}) {
  return (
    <header className="page-header settings-subpage-header">
      <div className="page-header-top">
        <button className="page-back-button" type="button" onClick={() => navigate("/settings")}>
          Back to Settings
        </button>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => navigate("/settings")}>Settings</button>
          <span>/</span>
          <strong>{currentLabel}</strong>
        </nav>
      </div>
      <div>
        <p className="eyebrow">Settings</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

function SettingsHubPage({
  navigate,
  shopifyConnection,
  metaConnection,
  shopifyAppConfigured,
  metaAppConfigured,
  appColor,
  logoUrl,
  currency,
}: {
  navigate: (href: string) => void;
  shopifyConnection: IntegrationConnection;
  metaConnection: IntegrationConnection;
  shopifyAppConfigured: boolean;
  metaAppConfigured: boolean;
  appColor: string;
  logoUrl: string;
  currency: ShopifyDisplayCurrency;
}) {
  const settingsSections = [
    {
      title: "Branding",
      description: "Set the GrowthOS logo and choose the custom brand color used across cards, accents, and states.",
      href: "/settings/branding",
      badge: appColor || logoUrl ? "Custom" : "Auto",
      tone: appColor || logoUrl ? "connected" : "not_connected",
    },
    {
      title: "Currency",
      description: "Control the display currency and exchange rate used in Shopify and Meta reporting surfaces.",
      href: "/settings/currency",
      badge: currency,
      tone: "connected",
    },
    {
      title: "Rules",
      description: "Edit the thresholds used to recommend kill, recut, certify, scale, and budget actions.",
      href: "/settings/rules",
      badge: "Editable",
      tone: "connected",
    },
    {
      title: "App Setup",
      description: "Manage Shopify and Meta credentials, scopes, and callback URLs.",
      href: "/settings/app-setup",
      badge: shopifyAppConfigured && metaAppConfigured ? "Configured" : "Needs attention",
      tone: shopifyAppConfigured && metaAppConfigured ? "connected" : "not_connected",
    },
    {
      title: "Integrations",
      description: "Connect stores and ad accounts, sync them, and manage live OAuth status.",
      href: "/settings/integrations",
      badge:
        shopifyConnection.status === "connected" && metaConnection.status === "connected"
          ? "2 connected"
          : "Connection status",
      tone:
        shopifyConnection.status === "connected" && metaConnection.status === "connected"
          ? "connected"
          : "not_connected",
    },
    {
      title: "Shopify Imports",
      description: "Inspect imported product revenue rows and verify Shopify sync output.",
      href: "/imports/shopify",
      badge: "Data view",
      tone: "connected",
    },
    {
      title: "Meta Ads Imports",
      description: "Review imported ad-level performance, spend, CPA, and ROAS.",
      href: "/imports/meta-ads",
      badge: "Data view",
      tone: "connected",
    },
    {
      title: "Mappings",
      description: "Map imported Meta ads back to the GrowthOS product catalog.",
      href: "/mappings",
      badge: "Operations",
      tone: "connected",
    },
  ] as const;

  return (
    <section className="page settings-home">
      <header className="settings-hero">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Control room</h1>
          <p>
            Central place for integrations, imports, mappings, and the app theme. The
            sidebar stays clean; the operational pages live here.
          </p>
        </div>
        <div className="settings-hero-chip">
          <span>Live theme</span>
          <strong>{appColor || logoUrl ? "Custom branding" : "Following Shopify branding"}</strong>
        </div>
      </header>

      <div className="settings-home-grid">
        <article className="card settings-index-card">
          <div className="card-title-row">
            <h2>Workspace</h2>
            <span className="status connected">{settingsSections.length} cards</span>
          </div>
          <div className="settings-section-grid">
            {settingsSections.map((section) => (
              <button
                key={section.href}
                className="settings-section-tile"
                onClick={() => navigate(section.href)}
              >
                <span className={`status ${section.tone}`}>{section.badge}</span>
                <strong>{section.title}</strong>
                <p>{section.description}</p>
                <span className="settings-section-link">Open section</span>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function BrandingSettingsPage({
  navigate,
  appColor,
  logoUrl,
  setUiSettings,
  shopifyBrandColor,
  shopifyLogoUrl,
}: {
  navigate: (href: string) => void;
  appColor: string;
  logoUrl: string;
  setUiSettings: Dispatch<SetStateAction<UiSettings>>;
  shopifyBrandColor: string;
  shopifyLogoUrl: string;
}) {
  const [draftColor, setDraftColor] = useState(appColor || shopifyBrandColor || "#164b35");
  const [draftLogoUrl, setDraftLogoUrl] = useState(logoUrl || shopifyLogoUrl || "");
  const [notice, setNotice] = useState("");
  const effectiveColor =
    normalizeHexColor(draftColor) ||
    normalizeHexColor(appColor) ||
    normalizeHexColor(shopifyBrandColor) ||
    "#164b35";
  const effectiveLogoUrl = draftLogoUrl || logoUrl || shopifyLogoUrl || "";

  useEffect(() => {
    setDraftColor(appColor || shopifyBrandColor || "#164b35");
  }, [appColor, shopifyBrandColor]);

  useEffect(() => {
    setDraftLogoUrl(logoUrl || shopifyLogoUrl || "");
  }, [logoUrl, shopifyLogoUrl]);

  async function saveUiSettings(next: { appColor: string; logoUrl: string }) {
    try {
      const response = await fetch("/api/settings/ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await response.json()) as { appColor?: string; logoUrl?: string; error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not save branding.");
        return;
      }
      setUiSettings({ appColor: data.appColor || "", logoUrl: data.logoUrl || "" });
      setNotice(
        data.appColor || data.logoUrl
          ? "Branding saved."
          : "Branding reset to Shopify defaults.",
      );
    } catch {
      setNotice("Could not save branding.");
    }
  }

  function handleLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraftLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <section className="page settings-home">
      <SettingsSubpageHeader
        navigate={navigate}
        title="Branding"
        currentLabel="Branding"
        description="Control the logo and accent color family used across GrowthOS."
      />

      {notice ? <p className="notice">{notice}</p> : null}

      <article className="card settings-color-card">
        <div className="card-title-row">
          <h2>Brand styling</h2>
          <span className={`status ${appColor || logoUrl ? "connected" : "not_connected"}`}>
            {appColor || logoUrl ? "Custom" : "Auto"}
          </span>
        </div>
        <p className="muted">
          Override the app brand color and logo manually or fall back to the Shopify store branding.
        </p>
        <div className="theme-preview" style={brandingStyle(effectiveColor)}>
          <div className="theme-preview-bar" />
            <div className="theme-preview-card">
              <div className="theme-preview-brand">
                <span className="brand-mark theme-preview-mark">
                  {effectiveLogoUrl ? (
                    <img className="brand-mark-image" src={effectiveLogoUrl} alt="Brand logo preview" />
                  ) : (
                    "G"
                  )}
                </span>
                <div className="theme-preview-copy">
                  <strong>Preview</strong>
                  <span>Buttons, accents, cards, and badges inherit this selected brand family.</span>
                </div>
              </div>
            </div>
          </div>
        <div className="settings-brand-stack">
          <div className="settings-brand-card">
            <div className="settings-brand-label">Logo override</div>
            <label className="logo-upload-field">
              <input type="file" accept="image/*" onChange={handleLogoFile} />
              <span>Upload logo</span>
            </label>
            <input
              value={draftLogoUrl}
              onChange={(event) => setDraftLogoUrl(event.target.value)}
              placeholder="https://... or uploaded image data"
            />
          </div>
          <div className="settings-brand-card">
            <div className="settings-brand-label">Color override</div>
            <div className="color-input-row">
              <input
                className="color-picker"
                type="color"
                value={effectiveColor}
                onChange={(event) => setDraftColor(event.target.value)}
              />
              <input
                value={draftColor}
                onChange={(event) => setDraftColor(event.target.value)}
                placeholder="#164b35"
              />
            </div>
          </div>
        </div>
        <div className="button-row">
          <button
            className="btn btn-primary"
            onClick={() => void saveUiSettings({ appColor: effectiveColor, logoUrl: draftLogoUrl.trim() })}
          >
            Save Branding
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => setDraftLogoUrl("")}
          >
            Use Shopify Logo
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setDraftColor(shopifyBrandColor || "#164b35");
              setDraftLogoUrl(shopifyLogoUrl || "");
              void saveUiSettings({ appColor: "", logoUrl: "" });
            }}
          >
            Use Shopify Branding
          </button>
        </div>
      </article>
    </section>
  );
}

function CurrencySettingsPage({
  navigate,
  currency,
  setCurrency,
  usdToAudRate,
  usdToAudRateUpdatedAt,
  usdToAudRateSource,
  usdToAudRateError,
  refreshUsdToAudRate,
}: {
  navigate: (href: string) => void;
  currency: ShopifyDisplayCurrency;
  setCurrency: Dispatch<SetStateAction<ShopifyDisplayCurrency>>;
  usdToAudRate: number;
  usdToAudRateUpdatedAt: string;
  usdToAudRateSource: string;
  usdToAudRateError: string;
  refreshUsdToAudRate: () => Promise<void>;
}) {
  return (
    <section className="page settings-home">
      <SettingsSubpageHeader
        navigate={navigate}
        title="Currency"
        currentLabel="Currency"
        description="Control the money display currency and conversion rate used across reporting views."
      />

      <article className="card settings-color-card">
        <div className="card-title-row">
          <h2>Display currency</h2>
          <span className="status connected">{currency}</span>
        </div>
        <p className="muted">
          Controls how Shopify and Meta money values are displayed throughout the app.
        </p>
        <label htmlFor="settings-display-currency">Currency</label>
        <select
          id="settings-display-currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value as ShopifyDisplayCurrency)}
        >
          <option value="USD">USD</option>
          <option value="AUD">AUD</option>
        </select>
        <div className="settings-inline-meta">
          <div>
            <label htmlFor="settings-usd-aud-rate">Current USD to AUD rate</label>
            <input
              id="settings-usd-aud-rate"
              type="text"
              value={usdToAudRate.toFixed(4)}
              readOnly
            />
          </div>
          <button className="btn btn-secondary" onClick={() => void refreshUsdToAudRate()}>
            Refresh live rate
          </button>
        </div>
        <p className="muted">
          Source: {usdToAudRateSource}. {usdToAudRateUpdatedAt ? `Updated ${new Date(usdToAudRateUpdatedAt).toLocaleString()}.` : "Using cached fallback."}
        </p>
        {usdToAudRateError ? <p className="notice notice-warning">{usdToAudRateError}</p> : null}
      </article>
    </section>
  );
}

function RulesSettingsPage({
  navigate,
  ruleSettings,
  setRuleSettings,
}: {
  navigate: (href: string) => void;
  ruleSettings: RuleSettings;
  setRuleSettings: Dispatch<SetStateAction<RuleSettings>>;
}) {
  const [draft, setDraft] = useState<RuleSettings>(ruleSettings);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDraft(ruleSettings);
  }, [ruleSettings]);

  function setRule(key: keyof RuleSettings, value: number) {
    setDraft((current) => normalizeRuleSettings({ ...current, [key]: value }));
  }

  function saveRules() {
    const next = normalizeRuleSettings(draft);
    setRuleSettings(next);
    setDraft(next);
    setNotice("Rule settings saved.");
  }

  function resetRules() {
    setDraft(defaultRuleSettings);
    setRuleSettings(defaultRuleSettings);
    setNotice("Rule settings reset to defaults.");
  }

  return (
    <section className="page">
      <SettingsSubpageHeader
        navigate={navigate}
        title="Rules"
        currentLabel="Rules"
        description="Edit the thresholds used for ad, product, and budget recommendations."
      />
      {notice ? <p className="notice">{notice}</p> : null}
      <RuleSection
        title="Ad Rules"
        rules={[
          ["killAdNoPurchaseSpendMultiplier", "Kill no-purchase spend multiplier", "Kill ad if spend reaches this multiple of product break-even CPA with zero purchases."],
          ["scaleAdMinPurchases", "Scale minimum purchases", "Ad can scale after this many purchases."],
          ["winningAdCpaMultiplier", "Winning CPA multiplier", "Ad is winning when CPA is at or below this multiple of break-even CPA."],
          ["needsMoreSpendMultiplier", "Needs more spend multiplier", "Ad needs more spend below this multiple of break-even CPA."],
          ["lowCtrThreshold", "Low CTR threshold (%)", "CTR below this percentage is considered weak."],
        ]}
        values={draft}
        onChange={setRule}
      />
      <RuleSection
        title="Product Rules"
        rules={[
          ["requiredAdsBeforeProductJudgment", "Required ads before judgment", "Minimum tested ads before product judgment."],
          ["requiredAnglesBeforeProductJudgment", "Required angles before judgment", "Minimum tested angles before product judgment."],
          ["productTestBudgetCap", "Product test budget cap", "Maximum product test spend before a stronger decision."],
          ["certifyProductMinPurchases", "Certify minimum purchases", "Purchases needed before certification can be recommended."],
          ["certifyProductCpaMultiplier", "Certify CPA multiplier", "Product can certify at or below this multiple of break-even CPA."],
          ["killProductCpaMultiplier", "Kill CPA multiplier", "Product can be killed above this CPA multiple after test completion."],
        ]}
        values={draft}
        onChange={setRule}
      />
      <RuleSection
        title="Budget Rules"
        rules={[
          ["oneProductMaxBudget", "One product max budget", "Budget at or below this stays focused on one product."],
          ["twoProductMinBudget", "Two product min budget", "Minimum daily budget for two active products."],
          ["twoProductMaxBudget", "Two product max budget", "Upper daily range for two active products."],
          ["threeProductMinBudget", "Three product min budget", "Minimum daily budget for a third product test."],
          ["threeProductRecommendedBudget", "Three product recommended budget", "Recommended daily budget for a third product test."],
          ["retargetingBudgetPercent", "Retargeting budget percent", "Percent of daily budget reserved for retargeting."],
        ]}
        values={draft}
        onChange={setRule}
      />
      <div className="button-row">
        <button className="btn btn-primary" onClick={saveRules}>Save</button>
        <button className="btn btn-secondary" onClick={resetRules}>Reset to Defaults</button>
      </div>
    </section>
  );
}

function RuleSection({
  title,
  rules,
  values,
  onChange,
}: {
  title: string;
  rules: Array<[keyof RuleSettings, string, string]>;
  values: RuleSettings;
  onChange: (key: keyof RuleSettings, value: number) => void;
}) {
  return (
    <article className="card setup-card">
      <div className="card-title-row">
        <h2>{title}</h2>
      </div>
      <div className="settings-section-grid">
        {rules.map(([key, label, helper]) => (
          <label className="settings-brand-card" key={key}>
            <span className="settings-brand-label">{label}</span>
            <input
              type="number"
              min={key === "requiredAdsBeforeProductJudgment" || key === "requiredAnglesBeforeProductJudgment" ? 1 : 0}
              step={key.toLowerCase().includes("percent") || key.toLowerCase().includes("threshold") ? 0.1 : 1}
              value={values[key]}
              onChange={(event) => onChange(key, Number(event.target.value))}
            />
            <span className="muted">{helper}</span>
          </label>
        ))}
      </div>
    </article>
  );
}

function ShopifyAppSetupPage({
  navigate,
  initialSettings,
  setShopifyAppSettings,
  initialMetaSettings,
  setMetaAppSettings,
}: {
  navigate: (href: string) => void;
  initialSettings: ShopifyAppSettings | null;
  setShopifyAppSettings: Dispatch<SetStateAction<ShopifyAppSettings | null>>;
  initialMetaSettings: MetaAppSettings | null;
  setMetaAppSettings: Dispatch<SetStateAction<MetaAppSettings | null>>;
}) {
  const [apiKey, setApiKey] = useState(initialSettings?.clientId || "");
  const [apiSecret, setApiSecret] = useState(initialSettings?.clientSecret || "");
  const [showSecret, setShowSecret] = useState(false);
  const [scopes, setScopes] = useState<string[]>(
    parseScopes(
      initialSettings?.scopes || "read_products,read_orders,read_customers",
    ),
  );
  const [redirectUri, setRedirectUri] = useState(
    initialSettings?.redirectUri || "http://localhost:8787/api/shopify/callback",
  );
  const [defaultShopDomain, setDefaultShopDomain] = useState(
    initialSettings?.defaultShopDomain || "",
  );
  const [metaAppId, setMetaAppId] = useState(initialMetaSettings?.appId || "");
  const [metaAppSecret, setMetaAppSecret] = useState(initialMetaSettings?.appSecret || "");
  const [showMetaSecret, setShowMetaSecret] = useState(false);
  const [metaScopes, setMetaScopes] = useState<string[]>(
    parseScopes(initialMetaSettings?.scopes || "ads_read,business_management"),
  );
  const [metaRedirectUri, setMetaRedirectUri] = useState(
    initialMetaSettings?.redirectUri || "http://localhost:8787/api/meta/callback",
  );
  const [notice, setNotice] = useState("");

  const scopeOptions = Array.from(
    new Map(
      [...shopifyScopeOptions, ...scopes.map((scope) => ({ value: scope, label: scope }))]
        .map((scope) => [scope.value, scope]),
    ).values(),
  );
  const scopesValue = scopes.join(",");

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  function removeScope(scope: string) {
    setScopes((current) => current.filter((item) => item !== scope));
  }

  useEffect(() => {
    if (!initialSettings) return;
    setApiKey(initialSettings.clientId);
    setApiSecret(initialSettings.clientSecret);
    setScopes(parseScopes(initialSettings.scopes));
    setRedirectUri(initialSettings.redirectUri);
    setDefaultShopDomain(initialSettings.defaultShopDomain);
  }, [initialSettings]);

  useEffect(() => {
    if (!initialMetaSettings) return;
    setMetaAppId(initialMetaSettings.appId);
    setMetaAppSecret(initialMetaSettings.appSecret);
    setMetaScopes(parseScopes(initialMetaSettings.scopes));
    setMetaRedirectUri(initialMetaSettings.redirectUri);
  }, [initialMetaSettings]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const nextScopesValue = scopesValue;
    const shouldReinstall =
      Boolean(defaultShopDomain || initialSettings?.distributionLink) &&
      (
        apiKey !== (initialSettings?.clientId || "") ||
        apiSecret !== (initialSettings?.clientSecret || "") ||
        nextScopesValue !== (initialSettings?.scopes || "") ||
        redirectUri !== (initialSettings?.redirectUri || "") ||
        defaultShopDomain !== (initialSettings?.defaultShopDomain || "")
      );

    try {
      const response = await fetch("/api/settings/shopify-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: apiKey,
          clientSecret: apiSecret,
          scopes: nextScopesValue,
          redirectUri,
          defaultShopDomain,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setNotice(data.error || "Could not save Shopify app settings.");
        return;
      }

      const statusResponse = await fetch("/api/settings/shopify-app");
      if (!statusResponse.ok) return;
      const data = (await statusResponse.json()) as ShopifyAppSettings;
      setShopifyAppSettings(data);
      setApiKey(data.clientId);
      setApiSecret(data.clientSecret);
      if (shouldReinstall) {
        setNotice("Shopify app settings saved. Reinstalling Shopify app now...");
        window.setTimeout(() => {
          if (data.defaultShopDomain) {
            window.location.href = `/api/shopify/install?shop=${encodeURIComponent(
              data.defaultShopDomain,
            )}`;
            return;
          }

          if (data.distributionLink) {
            window.location.href = data.distributionLink;
          }
        }, 700);
        return;
      }

      setNotice("Shopify app credentials saved.");
    } catch {
      setNotice("Could not save Shopify app settings.");
    }
  }

  async function saveMetaSettings(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/settings/meta-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: metaAppId,
          appSecret: metaAppSecret,
          scopes: metaScopes.join(","),
          redirectUri: metaRedirectUri,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setNotice(data.error || "Could not save Meta app settings.");
        return;
      }

      const statusResponse = await fetch("/api/settings/meta-app");
      if (!statusResponse.ok) return;
      const data = (await statusResponse.json()) as MetaAppSettings;
      setMetaAppSettings(data);
      setMetaAppId(data.appId);
      setMetaAppSecret(data.appSecret);
      setNotice("Meta app credentials saved.");
    } catch {
      setNotice("Could not save Meta app settings.");
    }
  }

  return (
    <section className="page">
      <SettingsSubpageHeader
        navigate={navigate}
        title="App setup"
        currentLabel="App setup"
        description="Configure Shopify app credentials in-app. Credentials are stored on the server and never exposed in browser state after save. Leave client ID or secret blank to keep the currently saved value."
      />

      {notice ? <p className="notice">{notice}</p> : null}

      <article className="card setup-card">
        <div className="card-title-row">
          <h2>Shopify app credentials</h2>
          <span
            className={`status ${initialSettings?.configured ? "connected" : "not_connected"}`}
          >
            {initialSettings?.configured ? "Configured" : "Not Configured"}
          </span>
        </div>

        <p className="muted">
          Current client ID: {initialSettings?.apiKeyMasked || "Not set"} | Current secret:{" "}
          {initialSettings?.apiSecretMasked || "Not set"}
        </p>

        <form className="setup-form" onSubmit={saveSettings}>
          <label htmlFor="shopify-api-key">Shopify client ID</label>
          <input
            id="shopify-api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Enter Shopify client ID"
          />

          <label htmlFor="shopify-api-secret">Shopify client secret</label>
          <div className="secret-input">
            <input
              id="shopify-api-secret"
              type={showSecret ? "text" : "password"}
              value={apiSecret}
              onChange={(event) => setApiSecret(event.target.value)}
              placeholder="Enter Shopify client secret"
            />
            <button
              aria-label={showSecret ? "Hide client secret" : "Show client secret"}
              className="btn btn-secondary btn-icon icon-button"
              type="button"
              onClick={() => setShowSecret((current) => !current)}
            >
              {showSecret ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 4.5 19.5 21"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M10.7 6.1A9.8 9.8 0 0 1 12 6c5.3 0 9.3 4.3 10 6-.3.8-1.4 2.4-3.1 3.8M14.8 16.7A4 4 0 0 1 8 12.2M6.1 8.7C4.5 10 3.4 11.4 3 12c.7 1.7 4.7 6 10 6 .5 0 1 0 1.5-.1"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              )}
            </button>
          </div>

          <div className="scope-field">
            <div className="scope-label-row">
              <label>Scopes</label>
              <span className="muted">{scopes.length} selected</span>
            </div>

            <div className="selected-scopes">
              {scopes.length ? (
                scopes.map((scope) => (
                  <button
                    key={scope}
                    className="scope-chip scope-chip-selected"
                    type="button"
                    onClick={() => removeScope(scope)}
                  >
                    <span>{scope}</span>
                    <span aria-hidden="true">x</span>
                  </button>
                ))
              ) : (
                <p className="muted">No scopes selected yet.</p>
              )}
            </div>

            <div className="scope-options">
              {scopeOptions.map((scope) => (
                <button
                  key={scope.value}
                  className={`scope-chip ${scopes.includes(scope.value) ? "scope-chip-active" : ""}`}
                  type="button"
                  onClick={() => toggleScope(scope.value)}
                >
                  {scope.label}
                </button>
              ))}
            </div>

          </div>

          <label htmlFor="shopify-redirect-uri">Redirect URI</label>
          <input
            id="shopify-redirect-uri"
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
          />

          <label htmlFor="shopify-default-shop-domain">Default shop domain</label>
          <input
            id="shopify-default-shop-domain"
            value={defaultShopDomain}
            onChange={(event) => setDefaultShopDomain(event.target.value)}
            placeholder="insidecats.myshopify.com"
          />

          <button className="btn btn-primary" type="submit">Save Shopify App Settings</button>
        </form>
      </article>

      <article className="card setup-card">
        <div className="card-title-row">
          <h2>Meta app credentials</h2>
          <span
            className={`status ${initialMetaSettings?.configured ? "connected" : "not_connected"}`}
          >
            {initialMetaSettings?.configured ? "Configured" : "Not Configured"}
          </span>
        </div>

        <p className="muted">
          Current app ID: {initialMetaSettings?.appIdMasked || "Not set"} | Current secret:{" "}
          {initialMetaSettings?.appSecretMasked || "Not set"}
        </p>

        <form className="setup-form" onSubmit={saveMetaSettings}>
          <label htmlFor="meta-app-id">Meta app ID</label>
          <input
            id="meta-app-id"
            value={metaAppId}
            onChange={(event) => setMetaAppId(event.target.value)}
            placeholder="Enter Meta app ID"
          />

          <label htmlFor="meta-app-secret">Meta app secret</label>
          <div className="secret-input">
            <input
              id="meta-app-secret"
              type={showMetaSecret ? "text" : "password"}
              value={metaAppSecret}
              onChange={(event) => setMetaAppSecret(event.target.value)}
              placeholder="Enter Meta app secret"
            />
            <button
              aria-label={showMetaSecret ? "Hide Meta app secret" : "Show Meta app secret"}
              className="btn btn-secondary btn-icon icon-button"
              type="button"
              onClick={() => setShowMetaSecret((current) => !current)}
            >
              {showMetaSecret ? "Hide" : "Show"}
            </button>
          </div>

          <div className="scope-field">
            <div className="scope-label-row">
              <label>Meta scopes</label>
              <span className="muted">{metaScopes.length} selected</span>
            </div>
            <div className="selected-scopes">
              {metaScopes.map((scope) => (
                <button
                  key={scope}
                  className="scope-chip scope-chip-selected"
                  type="button"
                  onClick={() =>
                    setMetaScopes((current) => current.filter((item) => item !== scope))
                  }
                >
                  <span>{scope}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
            <div className="scope-options">
              {[
                { value: "ads_read", label: "Ads Read" },
                { value: "ads_management", label: "Ads Management" },
                { value: "business_management", label: "Business Management" },
              ].map((scope) => (
                <button
                  key={scope.value}
                  className={`scope-chip ${metaScopes.includes(scope.value) ? "scope-chip-active" : ""}`}
                  type="button"
                  onClick={() =>
                    setMetaScopes((current) =>
                      current.includes(scope.value)
                        ? current.filter((item) => item !== scope.value)
                        : [...current, scope.value],
                    )
                  }
                >
                  {scope.label}
                </button>
              ))}
            </div>
          </div>

          <label htmlFor="meta-redirect-uri">Meta redirect URI</label>
          <input
            id="meta-redirect-uri"
            value={metaRedirectUri}
            onChange={(event) => setMetaRedirectUri(event.target.value)}
          />

          <button className="btn btn-primary" type="submit">Save Meta App Settings</button>
        </form>
      </article>
    </section>
  );
}

type IntegrationsProps = {
  shopifyConnection: IntegrationConnection;
  metaConnection: IntegrationConnection;
  updateConnection: (
    provider: IntegrationProvider,
    next: IntegrationConnection,
  ) => void;
  navigate: (href: string) => void;
  shopifyNotice: string;
  setShopifyNotice: Dispatch<SetStateAction<string>>;
  shopifyAppConfigured: boolean;
  defaultShopDomain: string;
  distributionLink: string;
  metaAppConfigured: boolean;
};

function IntegrationsPage({
  shopifyConnection,
  metaConnection,
  updateConnection,
  navigate,
  shopifyNotice,
  setShopifyNotice,
  shopifyAppConfigured,
  defaultShopDomain,
  distributionLink,
  metaAppConfigured,
}: IntegrationsProps) {
  const [shopDomain, setShopDomain] = useState(
    shopifyConnection.storeDomain || defaultShopDomain || "",
  );

  useEffect(() => {
    setShopDomain(shopifyConnection.storeDomain || defaultShopDomain || "");
  }, [defaultShopDomain, shopifyConnection.storeDomain]);

  function connectShopify(event: FormEvent) {
    event.preventDefault();
    const normalized = shopDomain.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
      setShopifyNotice("Enter a valid .myshopify.com domain.");
      return;
    }
    if (!shopifyAppConfigured) {
      setShopifyNotice("Configure Shopify app credentials first in Settings > App Setup.");
      return;
    }

    if (distributionLink) {
      window.location.href = distributionLink;
      return;
    }

    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(normalized)}`;
  }

  function connectMeta() {
    if (!metaAppConfigured) {
      setShopifyNotice("Configure Meta app credentials first in Settings > App Setup.");
      return;
    }

    window.location.href = "/api/meta/connect";
  }

  async function disconnect(provider: IntegrationProvider) {
    if (provider === "shopify") {
      try {
        const response = await fetch("/api/integrations/shopify/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop: shopifyConnection.storeDomain }),
        });
        if (!response.ok) {
          setShopifyNotice("Shopify disconnect failed. Try again.");
          return;
        }
      } catch {
        setShopifyNotice("Shopify disconnect failed. Try again.");
        return;
      }
    }
    if (provider === "meta-ads") {
      try {
        const response = await fetch("/api/integrations/meta/disconnect", {
          method: "POST",
        });
        if (!response.ok) {
          setShopifyNotice("Meta disconnect failed. Try again.");
          return;
        }
      } catch {
        setShopifyNotice("Meta disconnect failed. Try again.");
        return;
      }
    }

    updateConnection(provider, {
      id: provider,
      provider,
      status: "not_connected",
    });
    if (provider === "shopify") setShopifyNotice("Shopify disconnected.");
  }

  function syncNow(connection: IntegrationConnection) {
    updateConnection(connection.provider, {
      ...connection,
      lastSyncAt: nowLabel(),
      status: "connected",
    });
  }

  return (
    <section className="page">
      <SettingsSubpageHeader
        navigate={navigate}
        title="Integrations"
        currentLabel="Integrations"
        description="Connect revenue and ad platforms through the app UI. These flows are configured through live OAuth integrations and server-side tokens."
      />
      {shopifyNotice ? <p className="notice">{shopifyNotice}</p> : null}

      <div className="integration-grid">
        <IntegrationCard
          title="Shopify"
          connection={shopifyConnection}
          onDisconnect={() => disconnect("shopify")}
          onSync={() => syncNow(shopifyConnection)}
          importPath="/imports/shopify"
          navigate={navigate}
        >
          <form className="connect-form" onSubmit={connectShopify}>
            <label htmlFor="shopify-domain">myshopify store domain</label>
            <div className="inline-form">
              <input
                id="shopify-domain"
                value={shopDomain}
                onChange={(event) => setShopDomain(event.target.value)}
                placeholder="insidecats.myshopify.com"
              />
              <button className="btn btn-primary" type="submit">Connect Shopify</button>
            </div>
          </form>
          <ImportList title="Will import" items={shopifyImportFields} />
        </IntegrationCard>

        <IntegrationCard
          title="Meta/Facebook Ads"
          connection={metaConnection}
          onConnect={connectMeta}
          onDisconnect={() => disconnect("meta-ads")}
          onSync={() => syncNow(metaConnection)}
          importPath="/imports/meta-ads"
          navigate={navigate}
        >
          {metaConnection.status === "connected" ? (
            <div className="account-callout">
              <strong>{metaConnection.accountName}</strong>
              <span>{metaConnection.accountId}</span>
            </div>
          ) : (
            <p className="muted">
              Start the Meta OAuth flow to connect a real ad account.
            </p>
          )}
          <ImportList title="Will import" items={metaImportFields} />
        </IntegrationCard>
      </div>
    </section>
  );
}

type IntegrationCardProps = {
  title: string;
  connection: IntegrationConnection;
  children: ReactNode;
  onConnect?: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  importPath: string;
  navigate: (href: string) => void;
};

function IntegrationCard({
  title,
  connection,
  children,
  onConnect,
  onDisconnect,
  onSync,
  importPath,
  navigate,
}: IntegrationCardProps) {
  const isConnected = connection.status === "connected";

  return (
    <article className="card integration-card">
      <div className="card-title-row">
        <h2>{title}</h2>
        <span className={`status ${connection.status}`}>
          {formatStatus(connection.status)}
        </span>
      </div>
      <dl className="connection-meta">
        <div>
          <dt>Account/store</dt>
          <dd>{connection.accountName ?? "None connected"}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{connection.lastSyncAt ?? "Never"}</dd>
        </div>
      </dl>
      {children}
      <div className="button-row">
        {onConnect ? (
          <button className="btn btn-primary" onClick={onConnect} disabled={isConnected}>
            Connect
          </button>
        ) : null}
        <button className="btn btn-secondary" onClick={onDisconnect} disabled={!isConnected}>
          Disconnect
        </button>
        <button className="btn btn-ghost" onClick={onSync} disabled={!isConnected}>
          Sync Now
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(importPath)}>
          View Imports
        </button>
      </div>
    </article>
  );
}

function ImportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="pill-list">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function ShopifyImportsPage({
  shopifyDisplayCurrency,
  usdToAudRate,
  dateRange,
}: {
  shopifyDisplayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
  dateRange: UniversalDateRange;
}) {
  const rangeQuery = buildRangeQuery(dateRange);
  const cacheKey = `growthos-shopify-imports-cache:${rangeQuery}`;
  const [products, setProducts] = useState<ShopifyProductImport[]>([]);
  const [shop, setShop] = useState("");
  const [importedAt, setImportedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let hasLoadedData = false;
    const cached = readCachedJson<{
      shop?: string;
      importedAt?: string;
      products?: ShopifyProductImport[];
    }>(cacheKey);

    if (cached) {
      setProducts(cached.products || []);
      setShop(cached.shop || "");
      setImportedAt(cached.importedAt || "");
      setLoading(false);
      hasLoadedData = true;
    }

    let active = true;

    async function loadImports(background = false) {
      if (!background && !hasLoadedData) setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/imports/shopify/products?${rangeQuery}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          error?: string;
          shop?: string;
          importedAt?: string;
          products?: ShopifyProductImport[];
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not load Shopify imports.");
        }

        if (!active) return;
        setProducts(data.products || []);
        setShop(data.shop || "");
        setImportedAt(data.importedAt || "");
        hasLoadedData = true;
        writeCachedJson(cacheKey, {
          shop: data.shop || "",
          importedAt: data.importedAt || "",
          products: data.products || [],
        });
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load Shopify imports.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadImports();
    const intervalId = window.setInterval(() => {
      void loadImports(true);
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [cacheKey, rangeQuery]);

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Imports</p>
        <h1>Shopify</h1>
        <p>
          Imported product and revenue rows from your connected Shopify store
          {shop ? ` (${shop})` : ""} for {formatRangeLabel(dateRange)}.
        </p>
      </header>
      <p className="muted">
        Display currency: {shopifyDisplayCurrency}. Shopify source values are converted from USD using the live USD/AUD rate {usdToAudRate.toFixed(4)}.
      </p>
      {importedAt ? (
        <p className="muted">Last import: {new Date(importedAt).toLocaleString()}</p>
      ) : null}
      {loading ? <p className="notice">Loading Shopify imports...</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      {!loading && !error && products.length === 0 ? (
        <p className="notice">No Shopify order line items were available to import yet.</p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Price</th>
              <th>Orders</th>
              <th>Revenue</th>
              <th>Refunds</th>
              <th>Gross sales</th>
              <th>Net sales</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.shopifyProductId}>
                <td>
                  <div className="product-cell">
                    {product.productImageUrl ? (
                      <img
                        className="product-thumb"
                        src={product.productImageUrl}
                        alt={product.productTitle}
                        loading="lazy"
                      />
                    ) : (
                      <div className="product-thumb product-thumb-fallback" aria-hidden="true">
                        {product.productTitle.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="product-meta">
                      <strong>{product.productTitle}</strong>
                    </div>
                  </div>
                </td>
                <td>
                  {formatDisplayMoney(product.price, SHOPIFY_SOURCE_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                </td>
                <td>{product.orders}</td>
                <td>
                  {formatDisplayMoney(product.revenue, SHOPIFY_SOURCE_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                </td>
                <td>
                  {formatDisplayMoney(product.refunds, SHOPIFY_SOURCE_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                </td>
                <td>
                  {formatDisplayMoney(product.grossSales, SHOPIFY_SOURCE_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                </td>
                <td>
                  {formatDisplayMoney(product.netSales, SHOPIFY_SOURCE_CURRENCY, shopifyDisplayCurrency, usdToAudRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetaAdsImportsPage({
  displayCurrency,
  usdToAudRate,
  dateRange,
  metaCurrency,
}: {
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
  dateRange: UniversalDateRange;
  metaCurrency: CurrencyCode;
}) {
  const rangeQuery = buildRangeQuery(dateRange);
  const cacheKey = `growthos-meta-imports-cache:${rangeQuery}`;
  const [ads, setAds] = useState<MetaAdImport[]>([]);
  const [accountName, setAccountName] = useState("");
  const [importedAt, setImportedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let hasLoadedData = false;
    const cached = readCachedJson<{
      accountName?: string;
      importedAt?: string;
      ads?: MetaAdImport[];
    }>(cacheKey);

    if (cached) {
      setAds(cached.ads || []);
      setAccountName(cached.accountName || "");
      setImportedAt(cached.importedAt || "");
      setLoading(false);
      hasLoadedData = true;
    }

    let active = true;

    async function loadImports(background = false) {
      if (!background && !hasLoadedData) setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/imports/meta-ads?${rangeQuery}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          error?: string;
          accountName?: string;
          importedAt?: string;
          ads?: MetaAdImport[];
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not load Meta ads imports.");
        }

        if (!active) return;
        setAds(data.ads || []);
        setAccountName(data.accountName || "");
        setImportedAt(data.importedAt || "");
        hasLoadedData = true;
        writeCachedJson(cacheKey, {
          accountName: data.accountName || "",
          importedAt: data.importedAt || "",
          ads: data.ads || [],
        });
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load Meta ads imports.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadImports();
    const intervalId = window.setInterval(() => {
      void loadImports(true);
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [cacheKey, rangeQuery]);

  const totals = useMemo(
    () =>
      ads.reduce(
        (sum, ad) => ({
          spend: sum.spend + ad.spend,
          purchases: sum.purchases + ad.purchases,
          impressions: sum.impressions + ad.impressions,
        }),
        { spend: 0, purchases: 0, impressions: 0 },
      ),
    [ads],
  );

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Imports</p>
        <h1>Meta Ads</h1>
        <p>
          Imported ad performance rows{accountName ? ` from ${accountName}` : ""} for {formatRangeLabel(dateRange)}. Campaign summary:{" "}
          {formatDisplayMoney(totals.spend, metaCurrency, displayCurrency, usdToAudRate)}{" "}
          spend, {totals.purchases} purchases,{" "}
          {totals.impressions.toLocaleString()} impressions.
        </p>
      </header>
      {importedAt ? (
        <p className="muted">Last import: {new Date(importedAt).toLocaleString()}</p>
      ) : null}
      {loading ? <p className="notice">Loading Meta ads imports...</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign name</th>
              <th>Ad set name</th>
              <th>Ad name</th>
              <th>Meta ad ID</th>
              <th>Spend</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>Purchases</th>
              <th>CPA</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => (
              <tr key={ad.metaAdId}>
                <td>{ad.campaignName}</td>
                <td>{ad.adSetName}</td>
                <td>{ad.adName}</td>
                <td>{ad.metaAdId}</td>
                <td>
                  {formatDisplayMoney(ad.spend, metaCurrency, displayCurrency, usdToAudRate)}
                </td>
                <td>{ad.impressions.toLocaleString()}</td>
                <td>{ad.clicks.toLocaleString()}</td>
                <td>{ad.ctr}%</td>
                <td>{ad.purchases}</td>
                <td>
                  {formatDisplayMoney(ad.cpa, metaCurrency, displayCurrency, usdToAudRate)}
                </td>
                <td>{ad.roas.toFixed(1)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type MappingsPageProps = {
  ads: MetaAdImport[];
  products: Product[];
  mappings: ProductAdMapping[];
  setMappings: Dispatch<SetStateAction<ProductAdMapping[]>>;
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
  metaCurrency: CurrencyCode;
};

function MappingsPage({
  ads,
  products,
  mappings,
  setMappings,
  displayCurrency,
  usdToAudRate,
  metaCurrency,
}: MappingsPageProps) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const mappingByAdId = new Map(mappings.map((mapping) => [mapping.metaAdId, mapping]));

  function assign(metaAdId: string, productId?: string) {
    setMappings((current) => {
      const existing = current.find((mapping) => mapping.metaAdId === metaAdId);
      const nextMapping: ProductAdMapping = {
        id: existing?.id || `mapping-${metaAdId}`,
        metaAdId,
        productId,
        confidence: productId ? "Manual" : existing?.confidence || "Low",
        source: productId ? "Manual" : "Manual",
        notes: existing?.notes,
      };
      const withoutCurrent = current.filter((mapping) => mapping.metaAdId !== metaAdId);
      return [...withoutCurrent, nextMapping];
    });
  }

  function resetAuto(ad: MetaAdImport) {
    const auto = createAutoMapping(ad);
    setMappings((current) => [
      ...current.filter((mapping) => mapping.metaAdId !== ad.metaAdId),
      auto,
    ]);
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Attribution</p>
        <h1>Product/ad mappings</h1>
        <p>
          Assign imported Meta ads to GrowthOS products so ad spend can roll up
          against product-level revenue and margin.
        </p>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Meta ad name</th>
              <th>Campaign</th>
              <th>Ad set</th>
              <th>Spend</th>
              <th>Purchases</th>
              <th>CPA</th>
              <th>Detected product</th>
              <th>Assigned product</th>
              <th>Confidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const mapping = mappingByAdId.get(ad.metaAdId) || createAutoMapping(ad);
              const detection = detectProductForAd(ad);
              const detectedProduct = detection.productId ? productById.get(detection.productId)?.name : "Manual required";
              return (
              <tr key={ad.metaAdId}>
                <td>{ad.adName}</td>
                <td>{ad.campaignName}</td>
                <td>{ad.adSetName}</td>
                <td>{formatDisplayMoney(ad.spend, metaCurrency, displayCurrency, usdToAudRate)}</td>
                <td>{ad.purchases}</td>
                <td>{ad.cpa ? formatDisplayMoney(ad.cpa, metaCurrency, displayCurrency, usdToAudRate) : "—"}</td>
                <td>{detectedProduct}</td>
                <td>
                  <select
                    value={mapping.productId ?? ""}
                    onChange={(event) =>
                      assign(mapping.metaAdId, event.target.value || undefined)
                    }
                    aria-label={`Assign ${ad.adName}`}
                  >
                    <option value="">Unassigned</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`confidence ${mapping.confidence.toLowerCase()}`}>
                    {mapping.confidence}
                  </span>
                </td>
                <td className="action-cell">
                  <button
                    className="btn btn-primary"
                    onClick={() => assign(mapping.metaAdId, detection.productId)}
                    disabled={!detection.productId}
                  >
                    {mapping.productId ? "Change" : "Assign"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => assign(mapping.metaAdId, undefined)}
                    disabled={!mapping.productId}
                  >
                    Unassign
                  </button>
                  <button className="btn btn-secondary" onClick={() => resetAuto(ad)}>
                    Auto
                  </button>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductsPage({
  products,
  ads,
  ruleSettings,
  navigate,
  displayCurrency,
  usdToAudRate,
}: {
  products: Product[];
  ads: GrowthAd[];
  ruleSettings: RuleSettings;
  navigate: (href: string) => void;
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
}) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">GrowthOS</p>
        <h1>Products</h1>
        <p>Product testing state, assigned Meta spend, Shopify revenue, and rule-based recommendations.</p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Role</th>
              <th>Status</th>
              <th>Shopify linked</th>
              <th>Assigned spend</th>
              <th>Revenue</th>
              <th>Purchases</th>
              <th>CPA</th>
              <th>Break-even CPA</th>
              <th>Ads tested</th>
              <th>Test progress</th>
              <th>Decision</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const assignedAds = ads.filter((ad) => ad.productId === product.id);
              const decision = getProductDecision(product, assignedAds, ruleSettings);
              return (
                <tr key={product.id}>
                  <td>
                    <button className="table-link" onClick={() => navigate(`/products/${encodeURIComponent(product.id)}`)}>
                      {product.name}
                    </button>
                  </td>
                  <td>{product.role}</td>
                  <td>{product.status}</td>
                  <td>{product.shopifyProductId ? "Yes" : "No"}</td>
                  <td>{formatDisplayMoney(product.totalSpend, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</td>
                  <td>{formatDisplayMoney(product.revenue, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</td>
                  <td>{product.purchases}</td>
                  <td>{product.currentCpa ? formatDisplayMoney(product.currentCpa, OPERATING_CURRENCY, displayCurrency, usdToAudRate) : "—"}</td>
                  <td>{formatDisplayMoney(product.breakEvenCpa, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</td>
                  <td>{product.adsTestedCount} / {product.requiredAdsBeforeJudgment}</td>
                  <td>{Math.min(100, Math.round((product.totalSpend / Math.max(1, product.testBudgetCap)) * 100))}% budget</td>
                  <td><span className="status connected">{decision}</span></td>
                  <td>{product.nextAction}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdsPage({
  ads,
  products,
  ruleSettings,
  displayCurrency,
  usdToAudRate,
}: {
  ads: GrowthAd[];
  products: Product[];
  ruleSettings: RuleSettings;
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">GrowthOS</p>
        <h1>Ads</h1>
        <p>Imported Meta ads with GrowthOS product mapping and rule-based ad decisions.</p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ad name</th>
              <th>Campaign</th>
              <th>Ad set</th>
              <th>Assigned product</th>
              <th>Angle</th>
              <th>Spend</th>
              <th>Purchases</th>
              <th>CPA</th>
              <th>CTR</th>
              <th>ROAS</th>
              <th>Decision</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const product = ad.productId ? productById.get(ad.productId) : undefined;
              const decision = getAdDecision(ad, product, ruleSettings);
              return (
                <tr key={ad.id}>
                  <td>{ad.name}</td>
                  <td>{ad.campaignName}</td>
                  <td>{ad.adSetName}</td>
                  <td>{product?.name || "Unassigned"}</td>
                  <td>{ad.angle}</td>
                  <td>{formatDisplayMoney(ad.spend, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</td>
                  <td>{ad.purchases}</td>
                  <td>{ad.cpa ? formatDisplayMoney(ad.cpa, OPERATING_CURRENCY, displayCurrency, usdToAudRate) : "—"}</td>
                  <td>{ad.ctr.toFixed(2)}%</td>
                  <td>{ad.roas.toFixed(1)}x</td>
                  <td><span className="status connected">{decision}</span></td>
                  <td>{ad.nextAction}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BudgetPage({
  dailyAdBudget,
  setDailyAdBudget,
  products,
  ruleSettings,
  displayCurrency,
  usdToAudRate,
}: {
  dailyAdBudget: number;
  setDailyAdBudget: Dispatch<SetStateAction<number>>;
  products: Product[];
  ruleSettings: RuleSettings;
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
}) {
  const budget = getBudgetSettings(dailyAdBudget, products, ruleSettings);
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">GrowthOS</p>
        <h1>Budget</h1>
        <p>Budget spread, active product limits, and third-product unlock rules.</p>
      </header>
      <div className="metric-grid">
        <MetricCard label="Daily ad budget" value={formatDisplayMoney(budget.dailyAdBudget, OPERATING_CURRENCY, displayCurrency, usdToAudRate)} />
        <MetricCard label="Active products" value={String(budget.maxActiveProducts)} />
        <MetricCard label="Ads per product" value={budget.recommendedAdsPerProduct} />
        <MetricCard label="Product 3" value={budget.thirdProductUnlocked ? "Unlocked" : "Locked"} />
      </div>
      <article className="card setup-card">
        <label htmlFor="daily-ad-budget">Current daily ad budget</label>
        <input
          id="daily-ad-budget"
          type="number"
          min="0"
          value={dailyAdBudget}
          onChange={(event) => setDailyAdBudget(Math.max(0, Number(event.target.value) || 0))}
        />
        <p className="muted">{budget.thirdProductUnlockReason}</p>
        <div className="summary-list">
          <div><strong>{ruleSettings.oneProductMaxBudget}</strong><span>One product max budget</span></div>
          <div><strong>{ruleSettings.twoProductMinBudget}-{ruleSettings.twoProductMaxBudget}</strong><span>Two product budget range</span></div>
          <div><strong>{ruleSettings.threeProductMinBudget}+</strong><span>Third product minimum budget</span></div>
          <div><strong>{ruleSettings.retargetingBudgetPercent}%</strong><span>Retargeting budget percent</span></div>
        </div>
      </article>
    </section>
  );
}

function ProductDetailPage({
  productId,
  products,
  ads,
  shopifyProducts,
  mappings,
  ruleSettings,
  navigate,
  displayCurrency,
  usdToAudRate,
}: {
  productId: string;
  products: Product[];
  ads: GrowthAd[];
  shopifyProducts: ShopifyProductImport[];
  mappings: ProductAdMapping[];
  ruleSettings: RuleSettings;
  navigate: (href: string) => void;
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
}) {
  const product = products.find((item) => item.id === productId);
  if (!product) {
    return (
      <section className="page">
        <button className="page-back-button" onClick={() => navigate("/products")}>Back to Products</button>
        <p className="notice">Product not found.</p>
      </section>
    );
  }
  const assignedAds = ads.filter((ad) => ad.productId === product.id);
  const unmappedAds = ads.filter((ad) => !ad.productId);
  const shopify = shopifyProducts.find((item) => item.shopifyProductId === product.shopifyProductId);
  const decision = getProductDecision(product, assignedAds, ruleSettings);
  return (
    <section className="page">
      <header className="page-header settings-subpage-header">
        <div className="page-header-top">
          <button className="page-back-button" onClick={() => navigate("/products")}>Back to Products</button>
          <nav className="breadcrumb"><button onClick={() => navigate("/products")}>Products</button><span>/</span><strong>{product.name}</strong></nav>
        </div>
        <p className="eyebrow">Product detail</p>
        <h1>{product.name}</h1>
        <p>{decision}: {product.nextAction}</p>
      </header>
      <div className="metric-grid">
        <MetricCard label="Spend" value={formatDisplayMoney(product.totalSpend, OPERATING_CURRENCY, displayCurrency, usdToAudRate)} />
        <MetricCard label="Revenue" value={formatDisplayMoney(product.revenue, OPERATING_CURRENCY, displayCurrency, usdToAudRate)} />
        <MetricCard label="Purchases" value={String(product.purchases)} />
        <MetricCard label="Profit/Loss" value={formatDisplayMoney(estimatedProfit(product), OPERATING_CURRENCY, displayCurrency, usdToAudRate)} />
      </div>
      <article className="card">
        <div className="summary-list">
          <div><strong>{product.status}</strong><span>Status</span></div>
          <div><strong>{product.role}</strong><span>Role</span></div>
          <div><strong>{product.currentCpa ? formatDisplayMoney(product.currentCpa, OPERATING_CURRENCY, displayCurrency, usdToAudRate) : "—"}</strong><span>Current CPA</span></div>
          <div><strong>{formatDisplayMoney(product.breakEvenCpa, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</strong><span>Break-even CPA</span></div>
          <div><strong>{Math.round((product.totalSpend / Math.max(1, product.testBudgetCap)) * 100)}%</strong><span>Test budget cap progress</span></div>
          <div><strong>{product.adsTestedCount} / {product.requiredAdsBeforeJudgment}</strong><span>Ads tested progress</span></div>
          <div><strong>{shopify ? shopify.productTitle : "Not linked"}</strong><span>Shopify product</span></div>
          <div><strong>{mappings.filter((mapping) => mapping.productId === product.id).length}</strong><span>Manual/auto mappings</span></div>
        </div>
      </article>
      <AdsBreakdown title="Assigned ads" ads={assignedAds} displayCurrency={displayCurrency} usdToAudRate={usdToAudRate} />
      <AdsBreakdown title="Winning ads" ads={assignedAds.filter((ad) => ad.status === "Winner")} displayCurrency={displayCurrency} usdToAudRate={usdToAudRate} />
      <AdsBreakdown title="Live ads" ads={assignedAds.filter((ad) => ad.status === "Live Test")} displayCurrency={displayCurrency} usdToAudRate={usdToAudRate} />
      <AdsBreakdown title="Killed ads" ads={assignedAds.filter((ad) => ad.status === "Killed")} displayCurrency={displayCurrency} usdToAudRate={usdToAudRate} />
      <AdsBreakdown title="Unmapped ads" ads={unmappedAds} displayCurrency={displayCurrency} usdToAudRate={usdToAudRate} />
    </section>
  );
}

function AdsBreakdown({
  title,
  ads,
  displayCurrency,
  usdToAudRate,
}: {
  title: string;
  ads: GrowthAd[];
  displayCurrency: ShopifyDisplayCurrency;
  usdToAudRate: number;
}) {
  return (
    <article className="card">
      <div className="card-title-row">
        <h2>{title}</h2>
        <span className="status connected">{ads.length}</span>
      </div>
      <div className="entity-list">
        {ads.length ? ads.map((ad) => (
          <div className="entity-row" key={ad.id}>
            <div className="entity-main">
              <div>
                <strong>{ad.name}</strong>
                <span>{ad.campaignName} / {ad.adSetName}</span>
              </div>
            </div>
            <div className="entity-metrics">
              <strong>{formatDisplayMoney(ad.spend, OPERATING_CURRENCY, displayCurrency, usdToAudRate)}</strong>
              <span>{ad.purchases} purchases / {ad.roas.toFixed(1)}x ROAS</span>
            </div>
          </div>
        )) : <p className="muted">No ads in this group.</p>}
      </div>
    </article>
  );
}
