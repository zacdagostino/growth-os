export type IntegrationProvider = "shopify" | "meta-ads";

export type IntegrationStatus = "not_connected" | "connected" | "error";

export type IntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountName?: string;
  accountId?: string;
  storeDomain?: string;
  lastSyncAt?: string;
  errorMessage?: string;
};

export type ShopifyProductImport = {
  productTitle: string;
  shopifyProductId: string;
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
  purchases: number;
  cpa: number;
  roas: number;
};

export type MappingConfidence = "High" | "Medium" | "Low" | "Manual";

export type ProductAdMapping = {
  metaAdId: string;
  metaAdName: string;
  metaCampaign: string;
  detectedProduct?: string;
  assignedGrowthOSProduct?: string;
  confidence: MappingConfidence;
};
