import type {
  IntegrationConnection,
  MetaAdImport,
  MetaCampaignImport,
  ProductAdMapping,
  ShopifyProductImport,
} from "./types";

export const initialConnections: IntegrationConnection[] = [
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

export const shopifyImportFields = [
  "products",
  "orders",
  "revenue",
  "refunds",
  "customers",
  "product costs if available later",
];

export const metaImportFields = [
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

export const shopifyProductImports: ShopifyProductImport[] = [
  {
    productTitle: "Stay-In Spinner",
    shopifyProductId: "gid://shopify/Product/8459301001",
    price: 29,
    orders: 184,
    revenue: 5336,
    refunds: 145,
    grossSales: 5481,
    netSales: 5191,
  },
  {
    productTitle: "Flappy Bird Wand",
    shopifyProductId: "gid://shopify/Product/8459301002",
    price: 24,
    orders: 127,
    revenue: 3048,
    refunds: 72,
    grossSales: 3120,
    netSales: 2976,
  },
  {
    productTitle: "Window Watcher Perch",
    shopifyProductId: "gid://shopify/Product/8459301003",
    price: 42,
    orders: 63,
    revenue: 2646,
    refunds: 84,
    grossSales: 2730,
    netSales: 2562,
  },
];

export const metaCampaignImports: MetaCampaignImport[] = [
  {
    campaignId: "238612890001",
    campaignName: "Insidecats Prospecting - Toys",
    spend: 4120,
    impressions: 221480,
    clicks: 5840,
    purchases: 389,
    roas: 3.7,
  },
];

export const metaAdImports: MetaAdImport[] = [
  {
    campaignName: "Insidecats Prospecting - Toys",
    adSetName: "Broad Cat Parents",
    adName: "Stay-In Spinner Demo - UGC",
    metaAdId: "238612890101",
    spend: 1260,
    impressions: 72440,
    clicks: 2014,
    ctr: 2.78,
    purchases: 128,
    cpa: 9.84,
    roas: 4.4,
  },
  {
    campaignName: "Insidecats Retargeting - 14 Day",
    adSetName: "Viewed Product",
    adName: "Flappy Bird Wand Offer",
    metaAdId: "238612890102",
    spend: 880,
    impressions: 38900,
    clicks: 1067,
    ctr: 2.74,
    purchases: 76,
    cpa: 11.58,
    roas: 3.2,
  },
  {
    campaignName: "Insidecats Prospecting - Mixed Toys",
    adSetName: "Lookalike Buyers",
    adName: "Which Toy Wins? Carousel",
    metaAdId: "238612890103",
    spend: 1430,
    impressions: 92600,
    clicks: 1890,
    ctr: 2.04,
    purchases: 92,
    cpa: 15.54,
    roas: 2.5,
  },
];

export const growthOSProducts = [
  "Stay-In Spinner",
  "Flappy Bird Wand",
  "Window Watcher Perch",
];

export const initialMappings: ProductAdMapping[] = [
  {
    metaAdId: "238612890101",
    metaAdName: "Stay-In Spinner Demo - UGC",
    metaCampaign: "Insidecats Prospecting - Toys",
    detectedProduct: "Stay-In Spinner",
    assignedGrowthOSProduct: "Stay-In Spinner",
    confidence: "High",
  },
  {
    metaAdId: "238612890102",
    metaAdName: "Flappy Bird Wand Offer",
    metaCampaign: "Insidecats Retargeting - 14 Day",
    detectedProduct: "Flappy Bird Wand",
    assignedGrowthOSProduct: "Flappy Bird Wand",
    confidence: "High",
  },
  {
    metaAdId: "238612890103",
    metaAdName: "Which Toy Wins? Carousel",
    metaCampaign: "Insidecats Prospecting - Mixed Toys",
    detectedProduct: "Ambiguous",
    confidence: "Low",
  },
];
