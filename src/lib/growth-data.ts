import type {
  CurrencyCode,
  GrowthAd,
  MappingConfidence,
  Product,
  ProductAdMapping,
  ProductRole,
  ProductStatus,
  RuleSettings,
  ShopifyProductImport,
  MetaAdImport,
} from "../types";
import { getAdDecision, getProductDecision, nextActionForDecision } from "./rules/decisions";

function convertCurrency(value: number, from: CurrencyCode, to: CurrencyCode, usdToAudRate: number) {
  if (!Number.isFinite(value)) return 0;
  if (from === to) return value;
  if (from === "USD" && to === "AUD") return value * usdToAudRate;
  if (from === "AUD" && to === "USD") return value / usdToAudRate;
  return value;
}

export const KNOWN_GROWTH_PRODUCTS = [
  { id: "stay-in-spinner", name: "Stay-In Spinner" },
  { id: "flappy-bird", name: "Flappy Bird" },
] as const;

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function detectProductForAd(ad: Pick<MetaAdImport, "adName" | "campaignName" | "adSetName">): {
  productId?: string;
  confidence: MappingConfidence;
} {
  const text = `${ad.adName} ${ad.campaignName} ${ad.adSetName}`.toLowerCase();
  if (text.includes("spinner")) return { productId: "stay-in-spinner", confidence: "High" };
  if (/(flappy|flapper|bird|flapping)/i.test(text)) return { productId: "flappy-bird", confidence: "High" };
  return { productId: undefined, confidence: "Low" };
}

export function createAutoMapping(ad: MetaAdImport): ProductAdMapping {
  const detection = detectProductForAd(ad);
  return {
    id: `mapping-${ad.metaAdId}`,
    metaAdId: ad.metaAdId,
    productId: detection.productId,
    confidence: detection.confidence,
    source: "Auto",
  };
}

export function reconcileMappings(ads: MetaAdImport[], mappings: ProductAdMapping[]) {
  const byAdId = new Map(mappings.map((mapping) => [mapping.metaAdId, mapping]));
  return ads.map((ad) => byAdId.get(ad.metaAdId) || createAutoMapping(ad));
}

function roleForIndex(index: number): ProductRole {
  if (index === 0) return "Hero";
  if (index === 1) return "Challenger";
  if (index === 2) return "Test";
  return "Backlog";
}

function statusFromMetrics(spend: number, purchases: number, cpa: number, breakEvenCpa: number): ProductStatus {
  if (purchases >= 10 && cpa > 0 && cpa <= breakEvenCpa) return "Certified";
  if (purchases >= 3) return "Promising";
  if (spend > 0) return "Testing";
  return "Preparing";
}

export function buildGrowthProducts(
  shopifyProducts: ShopifyProductImport[],
  rules: RuleSettings,
  usdToAudRate: number,
): Product[] {
  const sourceProducts = [
    ...KNOWN_GROWTH_PRODUCTS.map((product) => ({ id: product.id, name: product.name })),
    ...shopifyProducts.map((product) => ({
      id: slugify(product.productTitle),
      name: product.productTitle,
      shopifyProductId: product.shopifyProductId,
    })),
  ];
  const byId = new Map<string, { id: string; name: string; shopifyProductId?: string }>();
  for (const product of sourceProducts) {
    if (!byId.has(product.id)) byId.set(product.id, product);
  }

  return [...byId.values()].map((product, index) => {
    const shopify = shopifyProducts.find(
      (item) => item.shopifyProductId === product.shopifyProductId || slugify(item.productTitle) === product.id,
    );
    const audPrice = shopify?.price ? convertCurrency(shopify.price, "USD", "AUD", usdToAudRate) : 0;
    const breakEvenCpa = audPrice ? Math.max(1, Math.round(audPrice * 0.6)) : 20;
    return {
      id: product.id,
      name: product.name,
      shopifyProductId: shopify?.shopifyProductId || product.shopifyProductId,
      shopifyProductTitle: shopify?.productTitle,
      role: roleForIndex(index),
      status: shopify?.orders ? "Testing" : "Preparing",
      dailyBudget: index < 2 ? 50 : 0,
      totalSpend: 0,
      revenue: convertCurrency(shopify?.netSales || shopify?.revenue || 0, "USD", "AUD", usdToAudRate),
      purchases: 0,
      breakEvenCpa,
      breakEvenCpaSource: audPrice ? "catalog" : "fallback",
      currentCpa: 0,
      adsTestedCount: 0,
      requiredAdsBeforeJudgment: rules.requiredAdsBeforeProductJudgment,
      testBudgetCap: rules.productTestBudgetCap,
      nextAction: "Assign ads to calculate recommendation.",
    };
  });
}

export function buildGrowthAds(
  metaAds: MetaAdImport[],
  mappings: ProductAdMapping[],
  products: Product[],
  rules: RuleSettings,
  metaCurrency: CurrencyCode,
  usdToAudRate: number,
): GrowthAd[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const mappingByAdId = new Map(mappings.map((mapping) => [mapping.metaAdId, mapping]));
  return metaAds.map((ad) => {
    const mapping = mappingByAdId.get(ad.metaAdId);
    const product = mapping?.productId ? productById.get(mapping.productId) : undefined;
    const audSpend = convertCurrency(ad.spend, metaCurrency, "AUD", usdToAudRate);
    const audCpc = convertCurrency(ad.cpc || (ad.clicks > 0 ? ad.spend / ad.clicks : 0), metaCurrency, "AUD", usdToAudRate);
    const audRevenue = convertCurrency(ad.revenue ?? ad.spend * ad.roas, metaCurrency, "AUD", usdToAudRate);
    const growthAd: GrowthAd = {
      id: ad.metaAdId,
      metaAdId: ad.metaAdId,
      name: ad.adName,
      productId: mapping?.productId,
      campaignName: ad.campaignName,
      adSetName: ad.adSetName,
      angle: inferAngle(ad),
      hook: inferHook(ad),
      status: ad.spend > 0 ? "Live Test" : "Produced",
      spend: audSpend,
      impressions: ad.impressions,
      clicks: ad.clicks,
      ctr: ad.ctr,
      cpc: audCpc,
      purchases: ad.purchases,
      cpa: convertCurrency(ad.cpa || (ad.purchases > 0 ? ad.spend / ad.purchases : 0), metaCurrency, "AUD", usdToAudRate),
      roas: ad.roas,
      revenue: audRevenue,
      nextAction: "",
    };
    const decision = getAdDecision(growthAd, product, rules);
    return {
      ...growthAd,
      status:
        decision === "Scale"
          ? "Winner"
          : decision === "Kill"
            ? "Killed"
            : decision === "Recut"
              ? "Recut Needed"
              : growthAd.status,
      nextAction: nextActionForDecision(decision),
    };
  });
}

export function applyProductMetrics(
  products: Product[],
  ads: GrowthAd[],
  rules: RuleSettings,
): Product[] {
  return products.map((product) => {
    const assignedAds = ads.filter((ad) => ad.productId === product.id);
    const totalSpend = assignedAds.reduce((sum, ad) => sum + ad.spend, 0);
    const purchases = assignedAds.reduce((sum, ad) => sum + ad.purchases, 0);
    const metaRevenue = assignedAds.reduce((sum, ad) => sum + ad.revenue, 0);
    const currentCpa = purchases > 0 ? totalSpend / purchases : 0;
    const revenue = product.revenue || metaRevenue;
    const decisionProduct = {
      ...product,
      totalSpend,
      purchases,
      currentCpa,
      adsTestedCount: assignedAds.length,
      status: statusFromMetrics(totalSpend, purchases, currentCpa, product.breakEvenCpa),
    };
    const decision = getProductDecision(decisionProduct, assignedAds, rules);
    return {
      ...decisionProduct,
      revenue,
      nextAction: nextActionForDecision(decision),
    };
  });
}

export function estimatedProfit(product: Product) {
  return product.revenue - product.totalSpend;
}

function inferAngle(ad: MetaAdImport) {
  const text = `${ad.adName} ${ad.adSetName}`.toLowerCase();
  if (text.includes("offer")) return "Offer";
  if (text.includes("demo") || text.includes("ugc")) return "Demo/UGC";
  if (text.includes("carousel")) return "Comparison";
  return "Unlabeled";
}

function inferHook(ad: MetaAdImport) {
  const [firstPart] = ad.adName.split("-");
  return firstPart.trim() || "Unlabeled";
}
