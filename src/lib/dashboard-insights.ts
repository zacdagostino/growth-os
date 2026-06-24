import type {
  GrowthAd,
  IntegrationConnection,
  Product,
  ProductAdMapping,
  RuleSettings,
} from "../types";
import { getBudgetSettings } from "./rules/budget";
import { getAdDecision, getProductDecision } from "./rules/decisions";
import { defaultRuleSettings, normalizeRuleSettings } from "./rules/rule-settings";

export type FailureStage =
  | "Not Enough Data"
  | "Attention Problem"
  | "Click Problem"
  | "Product Page Problem"
  | "Checkout Problem"
  | "Profitability Problem"
  | "Fulfilment Problem"
  | "Mapping/Data Issue"
  | "No Major Issue";

export function getAnglesTestedCount(ads: GrowthAd[]) {
  return new Set(
    ads
      .map((ad) => ad.angle)
      .filter((angle) => angle && angle !== "Unlabeled"),
  ).size;
}

export function getAverageCtr(ads: GrowthAd[]) {
  const rows = ads.filter((ad) => ad.impressions > 0 || ad.clicks > 0);
  if (!rows.length) return 0;
  return rows.reduce((sum, ad) => sum + ad.ctr, 0) / rows.length;
}

export function getProductAdRevenue(ads: GrowthAd[]) {
  return ads.reduce((sum, ad) => sum + (Number.isFinite(ad.revenue) ? ad.revenue : 0), 0);
}

export function getProductRevenueReference(product: Product, ads: GrowthAd[]) {
  const adRevenue = getProductAdRevenue(ads);
  const shopifyRevenue = product.shopifyProductId ? product.revenue : 0;
  return shopifyRevenue > 0 ? shopifyRevenue : adRevenue;
}

export function getFailureStage(
  product: Product,
  assignedAds: GrowthAd[],
  settings?: Partial<RuleSettings>,
): FailureStage {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const spendThreshold = Math.max(
    product.breakEvenCpa,
    rules.needsMoreSpendMultiplier * Math.max(product.breakEvenCpa, 1),
  );
  const averageCtr = getAverageCtr(assignedAds);

  if (!assignedAds.length || product.breakEvenCpaSource === "fallback" || !product.shopifyProductId) {
    return "Mapping/Data Issue";
  }

  if (product.totalSpend < spendThreshold) {
    return "Not Enough Data";
  }

  if (assignedAds.length > 0 && averageCtr > 0 && averageCtr < rules.lowCtrThreshold) {
    return "Attention Problem";
  }

  if (product.purchases > 0 && product.currentCpa > product.breakEvenCpa) {
    return "Profitability Problem";
  }

  if (
    product.purchases >= rules.scaleAdMinPurchases &&
    product.currentCpa > 0 &&
    product.currentCpa <= product.breakEvenCpa
  ) {
    return "No Major Issue";
  }

  return "Not Enough Data";
}

export function getProductDecisionReason(
  product: Product,
  assignedAds: GrowthAd[],
  settings?: Partial<RuleSettings>,
): string {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const decision = getProductDecision(product, assignedAds, rules);
  const mapped = assignedAds.length;
  const anglesTested = getAnglesTestedCount(assignedAds);

  if (!mapped || product.breakEvenCpaSource === "fallback" || !product.shopifyProductId) {
    const reasons = [];
    if (!mapped) reasons.push("no mapped ads");
    if (!product.shopifyProductId) reasons.push("no linked Shopify product");
    if (product.breakEvenCpaSource === "fallback") reasons.push("missing break-even CPA");
    return `This recommendation is fragile because ${reasons.join(", ")}.`;
  }

  if (decision === "Continue Testing") {
    return `This product is still being tested. It has ${product.adsTestedCount} of ${rules.requiredAdsBeforeProductJudgment} required ads and ${anglesTested} of ${rules.requiredAnglesBeforeProductJudgment} required angles under the ${Math.round(product.testBudgetCap)} test budget cap.`;
  }

  if (decision === "Rework") {
    return "This product has purchase or click signal, but CPA is above break-even. Rework creative, offer, or economics before scaling.";
  }

  if (decision === "Kill" || decision === "Replace") {
    return "This product has enough spend and enough ads tested, but no meaningful purchase signal at an acceptable CPA.";
  }

  if (decision === "Certify") {
    return "This product has reached the certification threshold with CPA at or below break-even and at least one winning ad.";
  }

  if (decision === "Scale") {
    return "This product is already performing at or below break-even CPA and has the signal needed to scale carefully.";
  }

  if (decision === "Pause") {
    return "A mapping, budget, or status issue makes the current decision unreliable.";
  }

  return "This product needs more observed spend and cleaner signal before a stronger recommendation.";
}

export function getProductNextAction(
  product: Product,
  assignedAds: GrowthAd[],
  settings?: Partial<RuleSettings>,
): string {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const decision = getProductDecision(product, assignedAds, rules);
  const anglesTested = getAnglesTestedCount(assignedAds);

  if (!assignedAds.length) return "Fix unmapped ads before judging this product.";
  if (!product.shopifyProductId) return "Link the Shopify product so revenue and break-even math are trustworthy.";
  if (product.breakEvenCpaSource === "fallback") return "Add or update break-even CPA before trusting the recommendation.";

  if (decision === "Continue Testing") {
    const missingAds = Math.max(0, rules.requiredAdsBeforeProductJudgment - product.adsTestedCount);
    const missingAngles = Math.max(0, rules.requiredAnglesBeforeProductJudgment - anglesTested);
    if (missingAds > 0 || missingAngles > 0) {
      return `Keep testing until this product reaches ${missingAds || 0} more ads and ${missingAngles || 0} more angles, or the budget cap.`;
    }
    return "Keep testing until the product reaches the configured spend threshold.";
  }

  if (decision === "Rework") return "Rework the landing page, offer, or creative before spending more.";
  if (decision === "Kill") return "Stop spend and replace this test with a stronger product or angle.";
  if (decision === "Replace") return "Replace this product with the next prepared product without adding more budget pressure.";
  if (decision === "Certify") return "Mark this product certified and prepare a cautious scale plan.";
  if (decision === "Scale") return "Scale budget cautiously by 20–30% if performance holds.";
  if (decision === "Pause") return "Resolve the mapping or budget issue before making another decision.";
  return "Review the product manually and tighten the test setup.";
}

export function getAdDecisionReason(
  ad: GrowthAd,
  product: Product | undefined,
  settings?: Partial<RuleSettings>,
): string {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const decision = getAdDecision(ad, product, rules);

  if (!product) return "This ad is not mapped to a product yet, so the decision is incomplete.";
  if (decision === "Kill") return "Spend has passed the no-purchase threshold with no conversion signal.";
  if (decision === "Recut") return `CTR is below the ${rules.lowCtrThreshold}% threshold, so the hook likely needs work.`;
  if (decision === "Scale") return "This ad has enough purchases and CPA is at or below break-even.";
  if (decision === "Needs More Spend") return "This ad has not spent enough against the product break-even CPA to judge yet.";
  return "This ad is still within the normal test window.";
}

export function getProductSlot3State(
  dailyAdBudget: number,
  products: Product[],
  settings?: Partial<RuleSettings>,
) {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const budget = getBudgetSettings(dailyAdBudget, products, rules);
  const certifiedProduct = products.find(
    (product) => product.status === "Certified" || product.status === "Scaling",
  );
  const replaceableProduct = products.find(
    (product) => product.status === "Dead" || getProductDecision(product, [], rules) === "Replace",
  );
  const unlocked =
    dailyAdBudget >= rules.threeProductMinBudget ||
    (Boolean(certifiedProduct) && dailyAdBudget >= rules.twoProductMinBudget) ||
    (Boolean(replaceableProduct) && dailyAdBudget >= rules.twoProductMinBudget);

  let reason = `Product Slot 3 is locked because the current budget supports ${budget.maxActiveProducts} active products. Unlock at $${rules.threeProductMinBudget}/day or when one product is Certified, Dead, or Replaced.`;
  if (dailyAdBudget >= rules.threeProductMinBudget) {
    reason = `Product Slot 3 is unlocked because the daily budget meets the configured ${rules.threeProductMinBudget}/day threshold.`;
  } else if (certifiedProduct && dailyAdBudget >= rules.twoProductMinBudget) {
    reason = `Product Slot 3 is unlocked because ${certifiedProduct.name} is Certified/Scaling and the current budget can support a controlled third test.`;
  } else if (replaceableProduct && dailyAdBudget >= rules.twoProductMinBudget) {
    reason = `Product Slot 3 is unlocked because ${replaceableProduct.name} is Dead/Replaceable, so Product 3 can replace it without adding extra budget pressure.`;
  }

  return {
    unlocked,
    reason,
    dailyAdBudget,
    requiredBudgetThreshold: rules.threeProductMinBudget,
    certifiedProduct: certifiedProduct?.name,
    replaceableProduct: replaceableProduct?.name,
  };
}

export function getBudgetCapacitySummary(
  dailyAdBudget: number,
  products: Product[],
  settings?: Partial<RuleSettings>,
) {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const budget = getBudgetSettings(dailyAdBudget, products, rules);
  const activeProducts = products.filter(
    (product) => product.totalSpend > 0 || product.purchases > 0 || product.status !== "Preparing",
  );
  const spreadTooThin = activeProducts.length > budget.maxActiveProducts;
  const explanation = spreadTooThin
    ? `Budget is spread too thin for ${activeProducts.length} active products. The current budget supports ${budget.maxActiveProducts} active products with ${budget.recommendedAdsPerProduct} active ads per product.`
    : `Current budget supports ${budget.maxActiveProducts} active products with ${budget.recommendedAdsPerProduct} active ads per product and ${rules.retargetingBudgetPercent}% for retargeting.`;

  return {
    ...budget,
    recommendedRetargetingBudgetPercent: rules.retargetingBudgetPercent,
    spreadTooThin,
    explanation,
  };
}

export function collectDataIssues(
  products: Product[],
  ads: GrowthAd[],
  mappings: ProductAdMapping[],
  shopifyConnection: IntegrationConnection,
  metaConnection: IntegrationConnection,
) {
  const unmappedAds = ads.filter((ad) => !ad.productId);
  const productsMissingBreakEven = products.filter((product) => product.breakEvenCpaSource === "fallback");
  const productsWithoutShopifyLink = products.filter(
    (product) => !product.shopifyProductId && (product.totalSpend > 0 || product.purchases > 0 || product.role !== "Backlog"),
  );
  const productsWithoutAssignedAds = products.filter(
    (product) => !ads.some((ad) => ad.productId === product.id) && product.role !== "Backlog",
  );
  const adsMissingCoreData = ads.filter(
    (ad) => !Number.isFinite(ad.spend) || !Number.isFinite(ad.purchases) || !Number.isFinite(ad.ctr),
  );
  const integrationWarnings = [shopifyConnection, metaConnection].filter(
    (connection) => connection.status !== "connected",
  );

  return {
    unmappedAds,
    productsMissingBreakEven,
    productsWithoutShopifyLink,
    productsWithoutAssignedAds,
    adsMissingCoreData,
    staleMappings: mappings.filter((mapping) => !ads.some((ad) => ad.metaAdId === mapping.metaAdId)),
    integrationWarnings,
  };
}

export function buildWeeklyActionPlan(
  products: Product[],
  ads: GrowthAd[],
  mappings: ProductAdMapping[],
  dailyAdBudget: number,
  shopifyConnection: IntegrationConnection,
  metaConnection: IntegrationConnection,
  settings?: Partial<RuleSettings>,
) {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const issues = collectDataIssues(products, ads, mappings, shopifyConnection, metaConnection);
  const slot3 = getProductSlot3State(dailyAdBudget, products, rules);
  const items: string[] = [];

  if (issues.unmappedAds.length) {
    items.push(`Map ${issues.unmappedAds.length} unmapped Meta ads.`);
  }
  if (issues.productsMissingBreakEven.length) {
    items.push(`Add break-even CPA for ${issues.productsMissingBreakEven[0].name}${issues.productsMissingBreakEven.length > 1 ? ` and ${issues.productsMissingBreakEven.length - 1} more product${issues.productsMissingBreakEven.length > 2 ? "s" : ""}` : ""}.`);
  }

  const testingProduct = products.find((product) => getProductDecision(product, ads.filter((ad) => ad.productId === product.id), rules) === "Continue Testing");
  if (testingProduct) {
    items.push(`Continue testing ${testingProduct.name} until it reaches the required spend/ad threshold.`);
  }

  const reworkProduct = products.find((product) => getProductDecision(product, ads.filter((ad) => ad.productId === product.id), rules) === "Rework");
  if (reworkProduct) {
    items.push(`Rework creative, offer, or landing page for ${reworkProduct.name} before spending more.`);
  }

  const killAds = ads.filter((ad) => getAdDecision(ad, products.find((product) => product.id === ad.productId), rules) === "Kill");
  if (killAds.length) {
    items.push(`Kill ${killAds.length} ad${killAds.length === 1 ? "" : "s"} that cleared the no-purchase spend threshold.`);
  }

  if (!slot3.unlocked) {
    items.push("Keep Product Slot 3 locked until budget or product status changes.");
  }

  const scaleProduct = products.find((product) => getProductDecision(product, ads.filter((ad) => ad.productId === product.id), rules) === "Scale");
  if (scaleProduct) {
    items.push(`Scale ${scaleProduct.name} cautiously by 20–30% if CPA holds.`);
  }

  return items.slice(0, 7);
}

export function summarizeBusiness(products: Product[], ads: GrowthAd[], mappings: ProductAdMapping[]) {
  const totalSpend = ads.reduce((sum, ad) => sum + ad.spend, 0);
  const totalRevenue = products.reduce((sum, product) => sum + getProductRevenueReference(product, ads.filter((ad) => ad.productId === product.id)), 0);
  const totalZendropLandedCost = products.reduce((sum, product) => sum + product.zendropLandedCost, 0);
  const activeProducts = products.filter(
    (product) => product.totalSpend > 0 || product.purchases > 0 || product.status !== "Preparing",
  );
  const activeAds = ads.filter((ad) => ad.spend > 0 || ad.purchases > 0 || ad.clicks > 0);
  const unmappedAds = ads.filter((ad) => !ad.productId);

  return {
    totalSpend,
    totalRevenue,
    totalZendropLandedCost,
    estimatedProfitLoss: totalRevenue - totalSpend - totalZendropLandedCost,
    activeProducts: activeProducts.length,
    activeAds: activeAds.length,
    unmappedAds: unmappedAds.length,
    staleMappings: mappings.filter((mapping) => !ads.some((ad) => ad.metaAdId === mapping.metaAdId)).length,
  };
}
