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

export type ZendropOrderCost = {
  id: string;
  orderNumber: string;
  orderDate?: string;
  productName: string;
  sku?: string;
  quantity: number;
  productCost: number;
  shippingCost: number;
  totalCost: number;
  currency: CurrencyCode;
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
  campaignId?: string;
  campaignName: string;
  campaignObjective?: string;
  objectiveLabel?: string;
  adSetId?: string;
  adSetName: string;
  optimizationGoal?: string;
  adName: string;
  metaAdId: string;
  creativeImageUrl?: string;
  creativeThumbnailUrl?: string;
  creativeVideoUrl?: string;
  creativeEmbedUrl?: string;
  creativeType?: string;
  firstActiveDate?: string;
  lastActiveDate?: string;
  activeDays?: number;
  dailyActivity?: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
  }>;
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

export type AdLifecycleState =
  | "Concept"
  | "Draft"
  | "Ready"
  | "Live Testing"
  | "Active Winner"
  | "Paused"
  | "Tested Winner"
  | "Tested Loser"
  | "Tested Mixed"
  | "Insufficient Data"
  | "Abandoned"
  | "Invalid Test"
  | "Fatigued"
  | "Archived";

export type AdTestOutcome = "Winner" | "Loser" | "Mixed" | "None";

export type AdTestValidity = "Valid" | "Insufficient" | "Invalid" | "Needs Review";

export type AdStopReason =
  | "Hit Kill Threshold"
  | "Hit Success Threshold"
  | "Manually Stopped Too Early"
  | "Budget Reallocated"
  | "Tracking Problem"
  | "Product Unavailable"
  | "Creative Fatigue"
  | "Campaign Restructure"
  | "Policy Rejection"
  | "Landing Page Issue"
  | "Duplicate Creative"
  | "Unknown";

export type AdRecommendedAction =
  | "Launch Test"
  | "Keep Running"
  | "Needs More Spend"
  | "Kill"
  | "Recut"
  | "Fix Tracking"
  | "Fix Landing Page"
  | "Assign Product"
  | "Add Angle"
  | "Add Format"
  | "Record Stop Reason"
  | "Mark Duplicate"
  | "Review Test Outcome"
  | "Archive Duplicate"
  | "Watch";

export type AdAnnotation = {
  metaAdId: string;
  angle?: string;
  hook?: string;
  format?: string;
  creativeFamilyId?: string;
  launchedAt?: string;
  stoppedAt?: string;
  breakEvenCpaAtTest?: number;
  trackingValid?: boolean;
  landingPageValid?: boolean;
  productAvailable?: boolean;
  duplicateOfAdId?: string;
  stopReason?: AdStopReason;
  lifecycleState?: AdLifecycleState;
  testOutcome?: AdTestOutcome;
  testValidity?: AdTestValidity;
  countsTowardProductTestOverride?: boolean;
  notes?: string;
};

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
  productImageUrl?: string;
  role: ProductRole;
  status: ProductStatus;
  dailyBudget: number;
  totalSpend: number;
  revenue: number;
  purchases: number;
  zendropOrders: number;
  zendropUnits: number;
  zendropProductCost: number;
  zendropShippingCost: number;
  zendropLandedCost: number;
  averageUnitLandedCost: number;
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
  campaignId?: string;
  creativeImageUrl?: string;
  creativeThumbnailUrl?: string;
  creativeVideoUrl?: string;
  creativeEmbedUrl?: string;
  creativeType?: string;
  campaignName: string;
  campaignObjective?: string;
  objectiveLabel?: string;
  adSetId?: string;
  adSetName: string;
  optimizationGoal?: string;
  firstActiveDate?: string;
  lastActiveDate?: string;
  activeDays?: number;
  dailyActivity?: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
  }>;
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

export type EvaluatedAdTest = GrowthAd & {
  productName?: string;
  productImageUrl?: string;
  lifecycleState: AdLifecycleState;
  testOutcome: AdTestOutcome;
  testValidity: AdTestValidity;
  stopReason?: AdStopReason;
  countsTowardProductTest: boolean;
  recommendedAction: AdRecommendedAction;
  reason: string;
  angle: string;
  hook: string;
  format: string;
  creativeFamilyId?: string;
  launchedAt?: string;
  stoppedAt?: string;
  breakEvenCpaAtTest?: number;
  trackingValid: boolean;
  landingPageValid: boolean;
  duplicateOfAdId?: string;
  notes?: string;
  manualOverrides: string[];
  isLaunched: boolean;
  isStopped: boolean;
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
  requiredFormatsBeforeProductJudgment: number;
  minimumAdImpressionsForCtrJudgment: number;
  minimumAdClicksForFunnelJudgment: number;
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
