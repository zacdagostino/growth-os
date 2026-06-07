export type CurrencyCode = "USD" | "AUD";

export type IntegrationProvider = "shopify" | "meta-ads";

export type IntegrationStatus = "not_connected" | "connected" | "error";

export type IntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  currency?: CurrencyCode;
  accountName?: string;
  accountId?: string;
  storeDomain?: string;
  lastSyncAt?: string;
  errorMessage?: string;
};

export type ShopifyProductImport = {
  productTitle: string;
  shopifyProductId: string;
  productImageUrl?: string;
  price: number;
  orders: number;
  revenue: number;
  refunds: number;
  grossSales: number;
  netSales: number;
};

export type ShopifyOrderSummary = {
  shopifyProductId: string;
  orders: number;
  revenue: number;
  refunds: number;
  grossSales: number;
  netSales: number;
};

export type MetaCampaignImport = {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  roas: number;
};

export type MetaAdImport = {
  campaignName: string;
  adSetName: string;
  adName: string;
  metaAdId: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc?: number;
  purchases: number;
  cpa: number;
  roas: number;
  revenue?: number;
};

export type MappingConfidence = "High" | "Medium" | "Low" | "Manual";

export type ProductRole = "Hero" | "Challenger" | "Test" | "Backlog";

export type ProductStatus =
  | "Researching"
  | "Preparing"
  | "Testing"
  | "Promising"
  | "Certified"
  | "Scaling"
  | "Paused"
  | "Dead";

export type GrowthAdStatus =
  | "Concept"
  | "Produced"
  | "Live Test"
  | "Winner"
  | "Fatigued"
  | "Killed"
  | "Recut Needed";

export type GrowthDecision =
  | "Scale"
  | "Keep Running"
  | "Needs More Spend"
  | "Recut"
  | "Kill"
  | "Continue Testing"
  | "Rework"
  | "Pause"
  | "Replace"
  | "Certify";

export type Product = {
  id: string;
  name: string;
  shopifyProductId?: string;
  shopifyProductTitle?: string;
  role: ProductRole;
  status: ProductStatus;
  dailyBudget: number;
  totalSpend: number;
  revenue: number;
  purchases: number;
  breakEvenCpa: number;
  breakEvenCpaSource: "catalog" | "fallback";
  currentCpa: number;
  adsTestedCount: number;
  requiredAdsBeforeJudgment: number;
  testBudgetCap: number;
  nextAction: string;
};

export type GrowthAd = {
  id: string;
  metaAdId?: string;
  name: string;
  productId?: string;
  campaignName: string;
  adSetName: string;
  angle: string;
  hook: string;
  status: GrowthAdStatus;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  purchases: number;
  cpa: number;
  roas: number;
  revenue: number;
  nextAction: string;
};

export type ProductAdMapping = {
  id: string;
  metaAdId: string;
  productId?: string;
  confidence: MappingConfidence;
  source: "Auto" | "Manual";
  notes?: string;
};

export type BudgetSettings = {
  dailyAdBudget: number;
  maxActiveProducts: number;
  recommendedAdsPerProduct: string;
  thirdProductUnlocked: boolean;
  thirdProductUnlockReason: string;
};

export type RuleSettings = {
  killAdNoPurchaseSpendMultiplier: number;
  scaleAdMinPurchases: number;
  winningAdCpaMultiplier: number;
  needsMoreSpendMultiplier: number;
  lowCtrThreshold: number;
  requiredAdsBeforeProductJudgment: number;
  requiredAnglesBeforeProductJudgment: number;
  productTestBudgetCap: number;
  certifyProductMinPurchases: number;
  certifyProductCpaMultiplier: number;
  killProductCpaMultiplier: number;
  oneProductMaxBudget: number;
  twoProductMinBudget: number;
  twoProductMaxBudget: number;
  threeProductMinBudget: number;
  threeProductRecommendedBudget: number;
  retargetingBudgetPercent: number;
};
