import type { GrowthAd, GrowthDecision, Product, RuleSettings } from "../../types";
import { defaultRuleSettings, normalizeRuleSettings } from "./rule-settings";

export function getAdDecision(
  ad: GrowthAd,
  product: Product | undefined,
  settings?: Partial<RuleSettings>,
): GrowthDecision {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  if (!product || !product.breakEvenCpa) return "Needs More Spend";

  const breakEvenCpa = product.breakEvenCpa;
  if (
    ad.spend >= rules.killAdNoPurchaseSpendMultiplier * breakEvenCpa &&
    ad.purchases === 0
  ) {
    return "Kill";
  }

  if (
    ad.purchases >= rules.scaleAdMinPurchases &&
    ad.cpa > 0 &&
    ad.cpa <= rules.winningAdCpaMultiplier * breakEvenCpa
  ) {
    return "Scale";
  }

  if (ad.ctr < rules.lowCtrThreshold && (ad.clicks > 0 || ad.purchases > 0)) {
    return "Recut";
  }

  if (ad.spend < rules.needsMoreSpendMultiplier * breakEvenCpa) {
    return "Needs More Spend";
  }

  if (ad.purchases > 0 && ad.cpa > breakEvenCpa && ad.spend < product.testBudgetCap) {
    return "Keep Running";
  }

  return ad.purchases > 0 ? "Keep Running" : "Needs More Spend";
}

export function getProductDecision(
  product: Product,
  assignedAds: GrowthAd[],
  settings?: Partial<RuleSettings>,
): GrowthDecision {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const winnerExists = assignedAds.some(
    (ad) =>
      ad.purchases >= rules.scaleAdMinPurchases &&
      ad.cpa > 0 &&
      ad.cpa <= rules.winningAdCpaMultiplier * product.breakEvenCpa,
  );
  const hasMappingIssue = assignedAds.length === 0 && product.totalSpend === 0 && product.revenue > 0;
  const hasBudgetIssue = product.dailyBudget <= 0 && product.status === "Testing";

  if (hasMappingIssue || hasBudgetIssue) return "Pause";

  if (
    product.purchases >= rules.certifyProductMinPurchases &&
    product.currentCpa > 0 &&
    product.currentCpa <= rules.certifyProductCpaMultiplier * product.breakEvenCpa &&
    winnerExists
  ) {
    return "Certify";
  }

  if (
    (product.status === "Certified" || product.status === "Scaling") &&
    product.currentCpa > 0 &&
    product.currentCpa <= product.breakEvenCpa
  ) {
    return "Scale";
  }

  if (
    product.adsTestedCount < rules.requiredAdsBeforeProductJudgment &&
    product.totalSpend < rules.productTestBudgetCap
  ) {
    return "Continue Testing";
  }

  if (
    product.adsTestedCount >= rules.requiredAdsBeforeProductJudgment &&
    product.totalSpend >= rules.productTestBudgetCap &&
    product.purchases <= 1 &&
    (product.currentCpa === 0 || product.currentCpa > rules.killProductCpaMultiplier * product.breakEvenCpa)
  ) {
    return product.status === "Dead" ? "Replace" : "Kill";
  }

  if (
    (assignedAds.some((ad) => ad.clicks > 0) || product.purchases > 0) &&
    (product.currentCpa === 0 || product.currentCpa > product.breakEvenCpa)
  ) {
    return "Rework";
  }

  if (product.status === "Dead") return "Replace";
  return "Continue Testing";
}

export function nextActionForDecision(decision: GrowthDecision): string {
  switch (decision) {
    case "Scale":
      return "Increase budget only after confirming mapping and inventory.";
    case "Keep Running":
      return "Keep live and monitor CPA against break-even.";
    case "Needs More Spend":
      return "Let the test spend reach the configured threshold.";
    case "Recut":
      return "Recut hook or angle before adding budget.";
    case "Kill":
      return "Stop spend and archive the test.";
    case "Continue Testing":
      return "Test more ads and angles before judging.";
    case "Rework":
      return "Keep product, rework offer, creative, or landing page.";
    case "Pause":
      return "Resolve mapping, budget, or data quality issue first.";
    case "Replace":
      return "Move another prepared product into testing.";
    case "Certify":
      return "Mark product certified and prepare scale plan.";
    default:
      return "Review manually.";
  }
}

