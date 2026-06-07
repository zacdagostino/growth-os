import type { BudgetSettings, Product, RuleSettings } from "../../types";
import { defaultRuleSettings, normalizeRuleSettings } from "./rule-settings";

export function getBudgetSettings(
  dailyAdBudget: number,
  products: Product[],
  settings?: Partial<RuleSettings>,
): BudgetSettings {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const budget = Math.max(0, Number(dailyAdBudget) || 0);
  const hasCertifiedProduct = products.some((product) => product.status === "Certified" || product.status === "Scaling");
  const hasDeadProduct = products.some((product) => product.status === "Dead");

  let maxActiveProducts = 1;
  let recommendedAdsPerProduct = "2-3";
  let thirdProductUnlocked = false;
  let thirdProductUnlockReason = "Daily budget is below the configured third-product threshold.";

  if (budget <= rules.oneProductMaxBudget) {
    maxActiveProducts = 1;
    recommendedAdsPerProduct = "2-3";
    thirdProductUnlockReason = "At this budget, concentrate spend on one active product.";
  } else if (budget >= rules.twoProductMinBudget && budget <= rules.twoProductMaxBudget) {
    maxActiveProducts = 2;
    recommendedAdsPerProduct = "3-4";
    thirdProductUnlockReason =
      hasCertifiedProduct || hasDeadProduct
        ? "Operationally eligible, but budget is still configured for two active products."
        : "Third product locked until one product is Certified or one product is Dead/replaced.";
  } else if (budget >= rules.threeProductMinBudget && budget < 300) {
    maxActiveProducts = 3;
    recommendedAdsPerProduct = "3-4 on main products, 1-2 on the small test product";
    thirdProductUnlocked = hasCertifiedProduct || hasDeadProduct || budget >= rules.threeProductRecommendedBudget;
    thirdProductUnlockReason = thirdProductUnlocked
      ? "Budget can support a third product test under the configured rules."
      : "Budget is near the threshold, but no product is certified or replaced yet.";
  } else if (budget >= 300) {
    maxActiveProducts = 3;
    recommendedAdsPerProduct = "4+ per active product";
    thirdProductUnlocked = true;
    thirdProductUnlockReason = "$300/day+ supports three or more products if operations can handle it.";
  } else {
    maxActiveProducts = 1;
    recommendedAdsPerProduct = "2-3";
    thirdProductUnlockReason = "Budget is between configured one-product and two-product thresholds.";
  }

  return {
    dailyAdBudget: budget,
    maxActiveProducts,
    recommendedAdsPerProduct,
    thirdProductUnlocked,
    thirdProductUnlockReason,
  };
}

