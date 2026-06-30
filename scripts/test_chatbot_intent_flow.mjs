import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
  }
}

function assertApprox(actual, expected, label, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

runScript("public/chatbot_data.js", sandbox);
runScript("public/sheet_report_data.js", sandbox);
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");

assertEqual(hooks.categoryForPrompt("Shokz"), null, "plain merchant name should not become a category");
assertEqual(hooks.detectQueryIntent("Shokz"), "merchant", "plain merchant name should route to merchant lookup");
assertEqual(hooks.cleanedMerchantLookupPhrase("Shokz offers"), "Shokz", "offer wording should be stripped before merchant matching");
assertEqual(hooks.categoryForPrompt("Shokz offers"), null, "merchant plus offers should not become a category");
assertEqual(hooks.detectQueryIntent("Shokz offers"), "merchant", "merchant plus offers should route to merchant lookup");
assertEqual(hooks.hasStrongMerchantLookup("Shokz offers", null), true, "merchant plus offers should be a strong merchant lookup");

assertEqual(hooks.categoryForPrompt("Electronics"), "Electronics", "main category should be recognized");
assertEqual(hooks.detectQueryIntent("Electronics"), "category", "main category should route to category lookup");
assertEqual(hooks.categoryForPrompt("Beauty offers"), "Beauty & Personal Care", "category-related offer prompt should resolve to the main category");
assertEqual(hooks.detectQueryIntent("recommend 5 beauty offers"), "recommendation", "category recommendation prompt should stay recommendation intent");
assertTruthy(hooks.categoryForPrompt("open-ear headphones"), "subcategory phrase should resolve to a category search value");
assertEqual(hooks.detectQueryIntent("open-ear headphones"), "category", "subcategory phrase should route to category lookup");
assertEqual(hooks.categoryForPrompt("Shokz Electronics"), "Electronics", "brand plus main category should resolve to the mentioned category");
assertEqual(hooks.detectQueryIntent("Shokz Electronics"), "category", "brand plus category wording should route to category lookup");
assertEqual(hooks.categoryForPrompt("Roborock robot vacuum"), "Robotic Vacuums", "brand plus subcategory wording should resolve to the subcategory");
assertEqual(hooks.detectQueryIntent("Roborock robot vacuum"), "category", "brand plus subcategory wording should route to category lookup");

assertEqual(hooks.categoryForPrompt("top 5 offers"), null, "generic recommendation should not invent a category");
assertEqual(hooks.detectQueryIntent("top 5 offers"), "recommendation", "generic recommendation should stay recommendation intent");

const tierBundlePlan = hooks.parseTierOfferRequest("I want 2 offers from tier 1, 3 offers from tier 3, and 1 offer from tier 4");
assertEqual(tierBundlePlan.length, 3, "multi-tier offer request should produce a three-tier plan");
assertEqual(tierBundlePlan[0].tier, "Tier 1", "first bundle tier should be Tier 1");
assertEqual(tierBundlePlan[0].count, 2, "first bundle tier should request 2 offers");
assertEqual(tierBundlePlan[1].tier, "Tier 3", "second bundle tier should be Tier 3");
assertEqual(tierBundlePlan[1].count, 3, "second bundle tier should request 3 offers");
assertEqual(tierBundlePlan[2].tier, "Tier 4", "third bundle tier should be Tier 4");
assertEqual(tierBundlePlan[2].count, 1, "third bundle tier should request 1 offer");

hooks.answerPrompt("I want 2 offers from tier 1, 3 offers from tier 3, and 1 offer from tier 4");
let bundle = hooks.currentRecommendationBundle();
assertTruthy(bundle, "multi-tier recommendation should create an active recommendation bundle");
assertEqual(bundle.rows.length, 6, "multi-tier recommendation bundle should contain the requested total when available");
const bundleCounts = bundle.rows.reduce((counts, offer) => {
  counts[offer.tier] = (counts[offer.tier] || 0) + 1;
  return counts;
}, {});
assertEqual(bundleCounts["Tier 1"], 2, "bundle should contain requested Tier 1 count");
assertEqual(bundleCounts["Tier 3"], 3, "bundle should contain requested Tier 3 count");
assertEqual(bundleCounts["Tier 4"], 1, "bundle should contain requested Tier 4 count");

const excludedOffer = bundle.rows.find((offer) => offer.tier === "Tier 3");
const excludedOfferShortName = excludedOffer.brand.split(/\s+/)[0];
hooks.answerPrompt(`do not try ${excludedOfferShortName}`);
bundle = hooks.currentRecommendationBundle();
assertEqual(bundle.rows.some((offer) => offer.brand === excludedOffer.brand), false, "excluded offer should leave the active recommendation bundle");
assertEqual(bundle.rows.length, 6, "excluding one offer should refill from the same tier when a replacement exists");
assertEqual(bundle.rows.filter((offer) => offer.tier === "Tier 3").length, 3, "Tier 3 quota should stay constant after exclusion");

const beforeReplaceTier3 = bundle.rows.filter((offer) => offer.tier === "Tier 3").map((offer) => offer.brand);
hooks.answerPrompt("change the tier 3 offers recommendation with other one");
bundle = hooks.currentRecommendationBundle();
const afterReplaceTier3 = bundle.rows.filter((offer) => offer.tier === "Tier 3").map((offer) => offer.brand);
const retainedTier3 = beforeReplaceTier3.filter((brand) => afterReplaceTier3.includes(brand)).length;
assertEqual(afterReplaceTier3.length, 3, "Tier 3 quota should stay constant after a change request");
assertEqual(retainedTier3, 2, "change tier 3 should replace exactly one current Tier 3 offer");

hooks.answerPrompt("I want 100 offers from tier 1");
bundle = hooks.currentRecommendationBundle();
assertEqual(bundle.rows.length, 45, "bundle should return fewer rows when the tier does not have enough candidates");
assertEqual(bundle.gaps.length, 1, "bundle should report a shortage when candidates are insufficient");
assertEqual(bundle.gaps[0].tier, "Tier 1", "shortage should identify the tier");
assertEqual(bundle.gaps[0].gap, 55, "shortage should report the missing count");

const paymentRows = hooks.getPaymentRecords();
const paymentMonthCounts = paymentRows.reduce((counts, record) => {
  counts[record.reportMonth] = (counts[record.reportMonth] || 0) + 1;
  return counts;
}, {});
const paymentPlaceholderCounts = paymentRows.reduce((counts, record) => {
  if (record.isPlaceholder) counts[record.reportMonth] = (counts[record.reportMonth] || 0) + 1;
  return counts;
}, {});
assertTruthy(paymentMonthCounts.May > 0, "May pending payment rows should survive frontend filtering");
assertTruthy(paymentMonthCounts.June > 0, "June pending payment rows should survive frontend filtering");
assertTruthy(paymentPlaceholderCounts.May > 0, "May placeholder payment rows should remain visible");
assertTruthy(paymentPlaceholderCounts.June > 0, "June placeholder payment rows should remain visible");

const zhPaymentCycleBelow = hooks.extractPaymentCycleFilter("付款周期在100天以下的offer");
assertEqual(zhPaymentCycleBelow.operator, "<", "Chinese 以下 should be strict below");
assertEqual(zhPaymentCycleBelow.threshold, 100, "Chinese payment cycle filter should parse threshold");
assertEqual(hooks.paymentCycleFilterText(zhPaymentCycleBelow, "zh"), "付款周期少于100天", "Chinese payment cycle text should be localized");

const zhPaymentCycleWithin = hooks.extractPaymentCycleFilter("付款周期100天以内的offer");
assertEqual(zhPaymentCycleWithin.operator, "<=", "Chinese 以内 should be inclusive below");
assertEqual(zhPaymentCycleWithin.threshold, 100, "Chinese inclusive payment cycle filter should parse threshold");

const zhPaymentCycleNoMoreThan = hooks.extractPaymentCycleFilter("结算周期不超过100天的offer");
assertEqual(zhPaymentCycleNoMoreThan.operator, "<=", "Chinese 不超过 should be inclusive below");

const zhPaymentCycleAbove = hooks.extractPaymentCycleFilter("回款周期超过120天的offer");
assertEqual(zhPaymentCycleAbove.operator, ">", "Chinese 超过 should be strict above");
assertEqual(zhPaymentCycleAbove.threshold, 120, "Chinese above payment cycle filter should parse threshold");

const zhPaymentCycleAnswer = hooks.answerPrompt("付款周期在100天以下的offer");
assertMatch(zhPaymentCycleAnswer, /付款周期筛选预览/, "Chinese payment-cycle query should return a Chinese preview");
assertMatch(zhPaymentCycleAnswer, /下载 Excel/, "Chinese payment-cycle query should offer Excel download");

const aovAbove = hooks.extractMetricFilters("aov above 100")[0];
assertEqual(aovAbove.field, "aov", "aov above filter should use AOV");
assertEqual(aovAbove.operator, ">", "aov above filter should be greater-than");
assertEqual(aovAbove.threshold, 100, "aov above filter should keep the numeric threshold");

const epcLower = hooks.extractMetricFilters("epc lower than 1")[0];
assertEqual(epcLower.field, "epc", "epc lower filter should use EPC");
assertEqual(epcLower.operator, "<", "epc lower filter should be less-than");
assertEqual(epcLower.threshold, 1, "epc lower filter should keep the numeric threshold");

const conversionAbove = hooks.extractMetricFilters("recommend me conversion above 10%")[0];
assertEqual(conversionAbove.field, "conversionRate", "conversion filter should use CVR");
assertEqual(conversionAbove.operator, ">", "conversion above filter should be greater-than");
assertApprox(conversionAbove.threshold, 0.1, "conversion percent threshold should normalize to decimal");
assertEqual(hooks.detectQueryIntent("recommend me conversion above 10%"), "recommendation", "metric filter recommendation should route to recommendations");

const conversionBelow = hooks.extractMetricFilters("conversion below 2%")[0];
assertEqual(conversionBelow.field, "conversionRate", "conversion below filter should use CVR");
assertEqual(conversionBelow.operator, "<", "conversion below filter should be less-than");
assertApprox(conversionBelow.threshold, 0.02, "conversion below percent threshold should normalize to decimal");

const revenueSort = hooks.extractMetricSortIntent("offers with highest revenue");
assertEqual(revenueSort.field, "salesAmount", "highest revenue should sort by revenue field");
assertEqual(revenueSort.direction, "desc", "highest revenue should sort descending");
assertEqual(hooks.detectQueryIntent("offers with highest revenue"), "recommendation", "highest revenue should route to recommendations");
assertEqual(hooks.extractMetricSortIntent("offers with revenue highest").field, "salesAmount", "revenue highest wording should sort by revenue field");

const commissionSort = hooks.extractMetricSortIntent("10 offers with highest commission");
assertEqual(commissionSort.field, "affCommission", "highest commission should sort by commission made");
assertEqual(commissionSort.direction, "desc", "highest commission should sort descending");
assertEqual(hooks.requestedRecommendationCount("10 offers with highest commission"), 10, "requested count should respect 10 offers");

const rankedByCommission = hooks.rankedRecommendations([
  { brand: "Tier 2 large commission", tier: "Tier 2", salesAmount: 10000, orders: 20, conversionRate: 0.2, aov: 500, epc: 2, affCommission: 900 },
  { brand: "Tier 1 smaller commission", tier: "Tier 1", salesAmount: 100, orders: 2, conversionRate: 0.01, aov: 50, epc: 0.5, affCommission: 100 },
  { brand: "Tier 1 larger commission", tier: "Tier 1", salesAmount: 200, orders: 3, conversionRate: 0.02, aov: 70, epc: 0.6, affCommission: 300 }
], { metricSort: commissionSort });
assertEqual(rankedByCommission[0].brand, "Tier 1 larger commission", "metric sort should keep Tier 1 first and sort inside the tier");
assertEqual(rankedByCommission[1].brand, "Tier 1 smaller commission", "lower Tier 1 commission should stay before lower tier offers");
assertEqual(rankedByCommission[2].brand, "Tier 2 large commission", "large lower-tier commission should not jump ahead of Tier 1");

assertEqual(hooks.displayCategory({
  brand: "Subcategory source",
  category: "Open-Ear Headphones",
  mainCategory: "Electronics",
  categorySource: "Levanta"
}), "Electronics", "dashboard display category should prefer mainCategory over subcategory-like category values");

const dashboardGroups = hooks.dashboardCategoryGroups([
  { brand: "Electronics A", category: "Open-Ear Headphones", mainCategory: "Electronics", categorySource: "Levanta", salesAmount: 300, orders: 6, clicks: 60, affCommission: 30 },
  { brand: "Electronics B", mainCategory: "Electronics", salesAmount: 200, orders: 4, clicks: 40, affCommission: 20 },
  { brand: "Beauty A", sheetCategory: "Beauty & Personal Care", mainCategory: "Beauty", salesAmount: 700, orders: 7, clicks: 70, affCommission: 70 },
  { brand: "Uncategorized A", salesAmount: 1000, orders: 10, clicks: 100, affCommission: 100 }
]);
assertEqual(dashboardGroups[0].category, "Beauty & Personal Care", "dashboard groups should sort main categories by revenue first");
assertEqual(dashboardGroups[1].category, "Electronics", "dashboard groups should use mainCategory for subcategory-style source rows");
assertEqual(dashboardGroups[2].category, "Uncategorized", "uncategorized group should stay last");
assertEqual(dashboardGroups[1].summary.totalRevenue, 500, "category revenue should aggregate salesAmount");
assertEqual(dashboardGroups[1].summary.avgAov, 50, "category AOV should aggregate revenue divided by orders");
assertApprox(dashboardGroups[1].summary.avgCvr, 0.1, "category CVR should aggregate orders divided by clicks");

console.log("Chatbot intent flow tests passed");
