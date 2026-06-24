import type {
  AdAnnotation,
  AdLifecycleState,
  AdRecommendedAction,
  AdStopReason,
  AdTestOutcome,
  AdTestValidity,
  EvaluatedAdTest,
  GrowthAd,
  Product,
  RuleSettings,
} from "../types";
import { defaultRuleSettings, normalizeRuleSettings } from "./rules/rule-settings";

export const AD_FORMAT_SUGGESTIONS = [
  "UGC",
  "Direct Demo",
  "Static",
  "Testimonial",
  "Voiceover",
  "Silent Caption Video",
  "Comparison",
  "Carousel",
  "Other",
] as const;

type AdTestEvaluation = Pick<
  EvaluatedAdTest,
  | "lifecycleState"
  | "testOutcome"
  | "testValidity"
  | "countsTowardProductTest"
  | "recommendedAction"
  | "reason"
>;

function normalizeText(value: string | undefined) {
  return String(value || "").trim();
}

function isPreLaunchState(value: AdLifecycleState | undefined) {
  return value === "Concept" || value === "Draft" || value === "Ready";
}

function inferFormat(ad: GrowthAd) {
  const text = `${ad.name} ${ad.campaignName} ${ad.adSetName} ${ad.hook}`.toLowerCase();
  if (/(ugc|creator|founder|selfie|reaction)/i.test(text)) return "UGC";
  if (/(demo|showing|how it works|product demo)/i.test(text)) return "Direct Demo";
  if (/(testimonial|review|customer)/i.test(text)) return "Testimonial";
  if (/(voiceover|vo)/i.test(text)) return "Voiceover";
  if (/(silent|caption)/i.test(text)) return "Silent Caption Video";
  if (/(compare|comparison|vs)/i.test(text)) return "Comparison";
  if (/(static|image|photo)/i.test(text)) return "Static";
  if (/(carousel|collection)/i.test(text)) return "Carousel";
  return "";
}

function hasMeaningfulSetup(product: Product | undefined, angle: string, format: string) {
  return Boolean(product?.id && angle && format);
}

function getManualOverrides(annotation: AdAnnotation | undefined) {
  if (!annotation) return [];
  return Object.entries(annotation)
    .filter(([key, value]) => key !== "metaAdId" && value !== undefined && value !== "")
    .map(([key]) => key);
}

function buildResult(
  lifecycleState: AdLifecycleState,
  testValidity: AdTestValidity,
  testOutcome: AdTestOutcome,
  countsTowardProductTest: boolean,
  recommendedAction: AdRecommendedAction,
  reason: string,
): AdTestEvaluation {
  return {
    lifecycleState,
    testValidity,
    testOutcome,
    countsTowardProductTest,
    recommendedAction,
    reason,
  };
}

function applyManualOverrides(
  base: AdTestEvaluation,
  annotation: AdAnnotation | undefined,
): AdTestEvaluation {
  if (!annotation) return base;

  const lifecycleState = annotation.lifecycleState || base.lifecycleState;
  const testValidity = annotation.testValidity || base.testValidity;
  const testOutcome = annotation.testOutcome || base.testOutcome;
  const countsTowardProductTest =
    typeof annotation.countsTowardProductTestOverride === "boolean"
      ? annotation.countsTowardProductTestOverride
      : base.countsTowardProductTest;

  return {
    ...base,
    lifecycleState,
    testValidity,
    testOutcome,
    countsTowardProductTest,
  };
}

export function evaluateAdTest(
  ad: GrowthAd,
  product: Product | undefined,
  annotation: AdAnnotation | undefined,
  settings?: Partial<RuleSettings>,
): EvaluatedAdTest {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const angle = normalizeText(annotation?.angle) || (ad.angle === "Unlabeled" ? "" : ad.angle);
  const hook = normalizeText(annotation?.hook) || (ad.hook === "Unlabeled" ? "" : ad.hook);
  const format = normalizeText(annotation?.format) || inferFormat(ad);
  const stopReason = annotation?.stopReason;
  const trackingValid = annotation?.trackingValid ?? true;
  const landingPageValid = annotation?.landingPageValid ?? true;
  const productAvailable = annotation?.productAvailable ?? true;
  const duplicateOfAdId = normalizeText(annotation?.duplicateOfAdId) || undefined;
  const breakEvenCpaAtTest = Number(annotation?.breakEvenCpaAtTest || product?.breakEvenCpa || 0) || undefined;
  const launchedAt = normalizeText(annotation?.launchedAt) || undefined;
  const stoppedAt = normalizeText(annotation?.stoppedAt) || undefined;
  const isLaunched =
    Boolean(launchedAt) ||
    ad.impressions > 0 ||
    ad.clicks > 0 ||
    ad.spend > 0 ||
    ad.purchases > 0;
  const isStopped =
    Boolean(stoppedAt) ||
    Boolean(stopReason) ||
    annotation?.lifecycleState === "Paused" ||
    annotation?.lifecycleState === "Archived" ||
    annotation?.lifecycleState === "Fatigued" ||
    annotation?.lifecycleState === "Tested Winner" ||
    annotation?.lifecycleState === "Tested Loser" ||
    annotation?.lifecycleState === "Tested Mixed" ||
    annotation?.lifecycleState === "Abandoned" ||
    annotation?.lifecycleState === "Invalid Test";

  const spendThreshold = breakEvenCpaAtTest
    ? rules.needsMoreSpendMultiplier * breakEvenCpaAtTest
    : 0;
  const killThreshold = breakEvenCpaAtTest
    ? rules.killAdNoPurchaseSpendMultiplier * breakEvenCpaAtTest
    : 0;
  const winnerThreshold = breakEvenCpaAtTest
    ? rules.winningAdCpaMultiplier * breakEvenCpaAtTest
    : 0;
  const enoughForCtrJudgment = ad.impressions >= rules.minimumAdImpressionsForCtrJudgment;
  const enoughForFunnelJudgment = ad.clicks >= rules.minimumAdClicksForFunnelJudgment;

  let evaluation: AdTestEvaluation;

  if (!product) {
    evaluation = buildResult(
      isLaunched ? "Insufficient Data" : (annotation?.lifecycleState && isPreLaunchState(annotation.lifecycleState) ? annotation.lifecycleState : "Draft"),
      "Needs Review",
      "None",
      false,
      "Assign Product",
      "This ad is not assigned to a product, so it cannot count toward product testing.",
    );
  } else if (!trackingValid) {
    evaluation = buildResult(
      "Invalid Test",
      "Invalid",
      "None",
      false,
      "Fix Tracking",
      "Purchase tracking was unavailable during the test, so the result is invalid.",
    );
  } else if (!landingPageValid) {
    evaluation = buildResult(
      "Invalid Test",
      "Invalid",
      "None",
      false,
      "Fix Landing Page",
      "The landing page was unavailable or broken, so the test cannot be trusted.",
    );
  } else if (!productAvailable) {
    evaluation = buildResult(
      "Invalid Test",
      "Invalid",
      "None",
      false,
      "Review Test Outcome",
      "The product was unavailable during this test window, so the result should not count.",
    );
  } else if (duplicateOfAdId) {
    evaluation = buildResult(
      "Archived",
      "Invalid",
      "None",
      false,
      "Archive Duplicate",
      "This ad is marked as a duplicate creative and should not inflate tested-ad counts.",
    );
  } else if (!isLaunched) {
    const lifecycleState =
      annotation?.lifecycleState && isPreLaunchState(annotation.lifecycleState)
        ? annotation.lifecycleState
        : hasMeaningfulSetup(product, angle, format)
          ? "Ready"
          : "Draft";
    const recommendedAction = !angle ? "Add Angle" : !format ? "Add Format" : "Launch Test";
    const reason = !angle
      ? "This ad has not launched and still needs an angle."
      : !format
        ? "This ad has not launched and still needs a creative format."
        : "This ad is ready to launch but has not spent yet.";
    evaluation = buildResult(
      lifecycleState,
      "Insufficient",
      "None",
      false,
      recommendedAction,
      reason,
    );
  } else if (!angle) {
    evaluation = buildResult(
      isStopped ? "Insufficient Data" : "Live Testing",
      "Needs Review",
      "None",
      false,
      "Add Angle",
      "The ad has launched, but no angle is recorded yet, so it cannot count as a valid product test.",
    );
  } else if (!format) {
    evaluation = buildResult(
      isStopped ? "Insufficient Data" : "Live Testing",
      "Needs Review",
      "None",
      false,
      "Add Format",
      "The ad has launched, but no creative format is recorded yet, so it cannot count as a valid product test.",
    );
  } else if (
    ad.purchases >= rules.scaleAdMinPurchases &&
    ad.cpa > 0 &&
    winnerThreshold > 0 &&
    ad.cpa <= winnerThreshold
  ) {
    evaluation = buildResult(
      isStopped ? "Tested Winner" : "Active Winner",
      "Valid",
      "Winner",
      true,
      isStopped ? "Watch" : "Keep Running",
      `Generated ${ad.purchases} purchases at a CPA below the ${formatCurrencyHint(winnerThreshold)} winner threshold.`,
    );
  } else if (
    ad.purchases === 0 &&
    killThreshold > 0 &&
    ad.spend >= killThreshold
  ) {
    evaluation = buildResult(
      "Tested Loser",
      "Valid",
      "Loser",
      true,
      "Kill",
      `Spent ${formatCurrencyHint(ad.spend)}, which is at least ${rules.killAdNoPurchaseSpendMultiplier}x the break-even CPA, with zero purchases.`,
    );
  } else if (
    ad.spend >= spendThreshold &&
    (
      ad.purchases > 0 ||
      enoughForFunnelJudgment ||
      (enoughForCtrJudgment && ad.ctr > 0)
    )
  ) {
    if (isStopped) {
      evaluation = buildResult(
        "Tested Mixed",
        "Valid",
        "Mixed",
        true,
        ad.ctr < rules.lowCtrThreshold ? "Recut" : "Review Test Outcome",
        ad.ctr < rules.lowCtrThreshold
          ? `The ad reached a meaningful spend threshold, but CTR is below the ${rules.lowCtrThreshold}% threshold.`
          : "The ad reached a meaningful test threshold but produced mixed efficiency signals.",
      );
    } else {
      evaluation = buildResult(
        "Live Testing",
        "Insufficient",
        "None",
        false,
        ad.ctr < rules.lowCtrThreshold ? "Recut" : "Keep Running",
        ad.ctr < rules.lowCtrThreshold
          ? `The ad is live, but CTR is below the ${rules.lowCtrThreshold}% threshold and likely needs a recut.`
          : "The ad has some signal but has not reached a conclusive finished outcome yet.",
      );
    }
  } else if (isStopped) {
    if (!stopReason) {
      evaluation = buildResult(
        "Insufficient Data",
        "Needs Review",
        "None",
        false,
        "Record Stop Reason",
        "The ad stopped before reaching a valid conclusion and has no recorded stop reason.",
      );
    } else if (
      stopReason === "Tracking Problem" ||
      stopReason === "Landing Page Issue" ||
      stopReason === "Product Unavailable" ||
      stopReason === "Policy Rejection"
    ) {
      const action =
        stopReason === "Tracking Problem"
          ? "Fix Tracking"
          : stopReason === "Landing Page Issue"
            ? "Fix Landing Page"
            : "Review Test Outcome";
      evaluation = buildResult(
        "Invalid Test",
        "Invalid",
        "None",
        false,
        action,
        `This ad stopped because of ${stopReason.toLowerCase()}, so it should not count toward product testing.`,
      );
    } else if (stopReason === "Duplicate Creative") {
      evaluation = buildResult(
        "Archived",
        "Invalid",
        "None",
        false,
        "Archive Duplicate",
        "This ad is recorded as a duplicate creative and should be archived from testing counts.",
      );
    } else if (stopReason === "Creative Fatigue") {
      evaluation = buildResult(
        "Fatigued",
        "Valid",
        ad.purchases > 0 ? "Winner" : "Mixed",
        ad.purchases > 0,
        "Watch",
        "This ad is no longer a fresh test because it was stopped for creative fatigue.",
      );
    } else {
      evaluation = buildResult(
        "Abandoned",
        "Insufficient",
        "None",
        false,
        "Review Test Outcome",
        "The ad was stopped before reaching a conclusive valid test outcome.",
      );
    }
  } else {
    evaluation = buildResult(
      "Live Testing",
      "Insufficient",
      "None",
      false,
      "Needs More Spend",
      "Spend is still below the configured minimum test threshold for judgment.",
    );
  }

  evaluation = applyManualOverrides(evaluation, annotation);

  return {
    ...ad,
    productName: product?.name,
    productImageUrl: product?.productImageUrl,
    lifecycleState: evaluation.lifecycleState,
    testOutcome: evaluation.testOutcome,
    testValidity: evaluation.testValidity,
    stopReason,
    countsTowardProductTest: evaluation.countsTowardProductTest,
    recommendedAction: evaluation.recommendedAction,
    reason: evaluation.reason,
    angle: angle || "Unlabeled",
    hook: hook || "Unlabeled",
    format: format || "Data unavailable",
    creativeFamilyId: annotation?.creativeFamilyId,
    launchedAt,
    stoppedAt,
    breakEvenCpaAtTest,
    trackingValid,
    landingPageValid,
    duplicateOfAdId,
    notes: annotation?.notes,
    manualOverrides: getManualOverrides(annotation),
    isLaunched,
    isStopped,
  };
}

function formatCurrencyHint(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${Math.round(value)}`;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function summarizeAdTesting(ads: EvaluatedAdTest[], settings?: Partial<RuleSettings>) {
  const rules = normalizeRuleSettings(settings || defaultRuleSettings);
  const validTestedAds = ads.filter((ad) => ad.countsTowardProductTest);
  const winners = validTestedAds.filter((ad) => ad.testOutcome === "Winner");
  const losers = validTestedAds.filter((ad) => ad.testOutcome === "Loser");
  const mixed = validTestedAds.filter((ad) => ad.testOutcome === "Mixed");
  const live = ads.filter((ad) => ad.lifecycleState === "Live Testing" || ad.lifecycleState === "Active Winner");
  const abandoned = ads.filter((ad) => ad.lifecycleState === "Abandoned");
  const invalid = ads.filter((ad) => ad.lifecycleState === "Invalid Test");
  const insufficient = ads.filter((ad) => ad.lifecycleState === "Insufficient Data");
  const needsStopReason = ads.filter((ad) => ad.isStopped && !ad.stopReason);
  const unmapped = ads.filter((ad) => !ad.productId);
  const testedAngles = uniqueValues(validTestedAds.map((ad) => ad.angle).filter((angle) => angle !== "Unlabeled"));
  const testedFormats = uniqueValues(validTestedAds.map((ad) => ad.format).filter((format) => format !== "Data unavailable"));

  return {
    adsCreated: ads.length,
    adsLaunched: ads.filter((ad) => ad.isLaunched).length,
    currentlyActive: live.length,
    validTestedAds: validTestedAds.length,
    requiredValidTestedAds: rules.requiredAdsBeforeProductJudgment,
    testedWinners: winners.length,
    testedLosers: losers.length,
    testedMixed: mixed.length,
    insufficientDataAds: insufficient.length,
    abandonedAds: abandoned.length,
    invalidTests: invalid.length,
    distinctAnglesTested: testedAngles.length,
    requiredAngles: rules.requiredAnglesBeforeProductJudgment,
    formatsTested: testedFormats.length,
    requiredFormats: rules.requiredFormatsBeforeProductJudgment,
    totalMetaSpend: ads.reduce((sum, ad) => sum + ad.spend, 0),
    productTestSpend: validTestedAds.reduce((sum, ad) => sum + ad.spend, 0),
    productTestBudgetCap: rules.productTestBudgetCap,
    angles: testedAngles,
    formats: testedFormats,
    needsStopReason: needsStopReason.length,
    unmappedAds: unmapped.length,
  };
}

export function buildStillNeeded(summary: ReturnType<typeof summarizeAdTesting>, product: Product | undefined) {
  const items: string[] = [];
  const missingAds = Math.max(0, summary.requiredValidTestedAds - summary.validTestedAds);
  const missingAngles = Math.max(0, summary.requiredAngles - summary.distinctAnglesTested);
  const missingFormats = Math.max(0, summary.requiredFormats - summary.formatsTested);
  const remainingBudget = Math.max(0, summary.productTestBudgetCap - summary.productTestSpend);

  if (missingAds > 0) items.push(`${missingAds} more valid tested ads required`);
  if (missingAngles > 0) items.push(`${missingAngles} more distinct angles required`);
  if (missingFormats > 0) items.push(`${missingFormats} more creative formats recommended`);
  if (remainingBudget > 0) items.push(`$${Math.round(remainingBudget)} remaining test allowance`);
  if (summary.needsStopReason > 0) items.push(`${summary.needsStopReason} ads need a stop reason`);
  if (summary.invalidTests > 0) items.push(`${summary.invalidTests} invalid tests must be resolved`);
  if (summary.unmappedAds > 0) items.push(`${summary.unmappedAds} unmapped ads need review`);
  if (product && product.breakEvenCpaSource === "fallback") items.push("Break-even CPA is missing");

  return items;
}

export function getAngleCoverage(ads: EvaluatedAdTest[]) {
  const byAngle = new Map<string, EvaluatedAdTest[]>();
  for (const ad of ads) {
    const angle = ad.angle || "Unlabeled";
    byAngle.set(angle, [...(byAngle.get(angle) || []), ad]);
  }

  return [...byAngle.entries()].map(([angle, rows]) => {
    const valid = rows.filter((ad) => ad.countsTowardProductTest);
    const winners = valid.filter((ad) => ad.testOutcome === "Winner");
    const losers = valid.filter((ad) => ad.testOutcome === "Loser");
    const mixed = valid.filter((ad) => ad.testOutcome === "Mixed");
    const bestCpa = valid
      .filter((ad) => ad.cpa > 0)
      .reduce((best, ad) => Math.min(best, ad.cpa), Number.POSITIVE_INFINITY);
    const currentStatus =
      !rows.some((ad) => ad.isLaunched)
        ? "Untested"
        : winners.length
          ? "Proven"
          : rows.some((ad) => ad.lifecycleState === "Live Testing" || ad.lifecycleState === "Active Winner")
            ? "Testing"
            : mixed.length
              ? "Promising"
              : valid.length
                ? "Weak"
                : "Untested";
    return {
      angle,
      adsCreated: rows.length,
      adsLaunched: rows.filter((ad) => ad.isLaunched).length,
      validTestedAds: valid.length,
      winners: winners.length,
      losers: losers.length,
      mixed: mixed.length,
      bestCpa: Number.isFinite(bestCpa) ? bestCpa : 0,
      currentStatus,
    };
  });
}

export function getFormatCoverage(ads: EvaluatedAdTest[]) {
  const byFormat = new Map<string, EvaluatedAdTest[]>();
  for (const ad of ads) {
    const format = ad.format || "Data unavailable";
    byFormat.set(format, [...(byFormat.get(format) || []), ad]);
  }

  return [...byFormat.entries()].map(([format, rows]) => {
    const valid = rows.filter((ad) => ad.countsTowardProductTest);
    const bestCpa = valid
      .filter((ad) => ad.cpa > 0)
      .reduce((best, ad) => Math.min(best, ad.cpa), Number.POSITIVE_INFINITY);
    return {
      format,
      adsCreated: rows.length,
      validTestedAds: valid.length,
      bestResult: Number.isFinite(bestCpa) ? bestCpa : 0,
    };
  });
}

export function getProductTestConclusion(
  product: Product | undefined,
  summary: ReturnType<typeof summarizeAdTesting>,
  stillNeeded: string[],
) {
  if (!product) {
    return {
      fullyTested: false,
      conclusion: "Select a product",
      why: "Choose a product to evaluate product-level testing readiness.",
      recommendedAction: "Review live product tests.",
    };
  }

  if (product.breakEvenCpaSource === "fallback") {
    return {
      fullyTested: false,
      conclusion: "Test Invalid / Needs Repair",
      why: "Break-even CPA is missing, so product-level ad conclusions are unreliable.",
      recommendedAction: "Add a real break-even CPA before judging the product.",
    };
  }

  const fullyTested =
    summary.validTestedAds >= summary.requiredValidTestedAds &&
    summary.distinctAnglesTested >= summary.requiredAngles &&
    summary.formatsTested >= summary.requiredFormats &&
    summary.invalidTests === 0;

  if (!fullyTested) {
    return {
      fullyTested: false,
      conclusion: "Not Fully Tested",
      why: stillNeeded[0] || "This product has not reached the configured testing requirements yet.",
      recommendedAction: stillNeeded.length
        ? `Still needed: ${stillNeeded.slice(0, 3).join(", ")}.`
        : "Continue generating valid tested ads.",
    };
  }

  if (summary.testedWinners > 0 && product.currentCpa > 0 && product.currentCpa <= product.breakEvenCpa) {
    return {
      fullyTested: true,
      conclusion: "Fully Tested — Successful",
      why: "The product has enough valid tested ads, enough angles, enough formats, and profitable signal.",
      recommendedAction: "Scale cautiously and keep monitoring winner fatigue.",
    };
  }

  if (summary.testedWinners > 0 || summary.testedMixed > 0) {
    return {
      fullyTested: true,
      conclusion: "Fully Tested — Promising but Not Yet Profitable",
      why: "The product completed the configured test requirements but results are mixed on efficiency.",
      recommendedAction: "Rework the winning angle, format, or landing page before further scale.",
    };
  }

  return {
    fullyTested: true,
    conclusion: "Fully Tested — Failed",
    why: "The product met the configured test requirements without producing enough winning evidence.",
    recommendedAction: "Archive this product test and move budget to the next prepared product.",
  };
}
