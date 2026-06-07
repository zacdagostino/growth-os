import type { RuleSettings } from "../../types";

export type { RuleSettings };

export const RULE_SETTINGS_STORAGE_KEY = "growthos-rule-settings-v1";

export const defaultRuleSettings: RuleSettings = {
  killAdNoPurchaseSpendMultiplier: 2,
  scaleAdMinPurchases: 3,
  winningAdCpaMultiplier: 1,
  needsMoreSpendMultiplier: 1,
  lowCtrThreshold: 1,
  requiredAdsBeforeProductJudgment: 8,
  requiredAnglesBeforeProductJudgment: 4,
  productTestBudgetCap: 500,
  certifyProductMinPurchases: 10,
  certifyProductCpaMultiplier: 1,
  killProductCpaMultiplier: 1.5,
  oneProductMaxBudget: 50,
  twoProductMinBudget: 80,
  twoProductMaxBudget: 120,
  threeProductMinBudget: 150,
  threeProductRecommendedBudget: 200,
  retargetingBudgetPercent: 10,
};

const numericKeys = Object.keys(defaultRuleSettings) as Array<keyof RuleSettings>;

export function normalizeRuleSettings(input: Partial<RuleSettings> | null | undefined): RuleSettings {
  const next = { ...defaultRuleSettings };
  for (const key of numericKeys) {
    const value = Number(input?.[key]);
    if (Number.isFinite(value)) next[key] = value;
  }

  next.killAdNoPurchaseSpendMultiplier = Math.max(0, next.killAdNoPurchaseSpendMultiplier);
  next.scaleAdMinPurchases = Math.max(0, next.scaleAdMinPurchases);
  next.winningAdCpaMultiplier = Math.max(0, next.winningAdCpaMultiplier);
  next.needsMoreSpendMultiplier = Math.max(0, next.needsMoreSpendMultiplier);
  next.lowCtrThreshold = Math.max(0, next.lowCtrThreshold);
  next.requiredAdsBeforeProductJudgment = Math.max(1, next.requiredAdsBeforeProductJudgment);
  next.requiredAnglesBeforeProductJudgment = Math.max(1, next.requiredAnglesBeforeProductJudgment);
  next.productTestBudgetCap = Math.max(0, next.productTestBudgetCap);
  next.certifyProductMinPurchases = Math.max(0, next.certifyProductMinPurchases);
  next.certifyProductCpaMultiplier = Math.max(0, next.certifyProductCpaMultiplier);
  next.killProductCpaMultiplier = Math.max(0, next.killProductCpaMultiplier);
  next.oneProductMaxBudget = Math.max(0, next.oneProductMaxBudget);
  next.twoProductMinBudget = Math.max(0, next.twoProductMinBudget);
  next.twoProductMaxBudget = Math.max(0, next.twoProductMaxBudget);
  next.threeProductMinBudget = Math.max(0, next.threeProductMinBudget);
  next.threeProductRecommendedBudget = Math.max(0, next.threeProductRecommendedBudget);
  next.retargetingBudgetPercent = Math.max(0, next.retargetingBudgetPercent);
  return next;
}

