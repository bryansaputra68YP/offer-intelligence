import fs from "node:fs";
import vm from "node:vm";

const helperSource = fs.readFileSync("public/tier2_recommendation_rules.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const i18n = fs.readFileSync("public/chatbot_i18n.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(helperSource, sandbox, { filename: "public/tier2_recommendation_rules.js" });

const rules = sandbox.window.TIER2_RECOMMENDATION_RULES;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertClose(actual, expected, message) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertMatch(actual, pattern, message) {
  if (!pattern.test(actual)) {
    throw new Error(`${message}\nActual: ${actual}`);
  }
}

const parsed = rules.parsePublisherCount("14/20");
assertEqual(parsed.convertingPublishers, 14, "Publisher count should parse converting publishers.");
assertEqual(parsed.totalPublishers, 20, "Publisher count should parse total publishers.");
assertClose(parsed.successRate, 0.7, "Publisher count should derive success rate.");

assertEqual(rules.parsePublisherCount("46256.0"), null, "Excel serial-like publisher count values should be ignored.");

const metrics = rules.publisherMetrics({
  publisherCount: "15/28",
  successRate: 0.5357,
  publisherCountJune: "46256.0",
  successRateJune: 0.3636
});
assertEqual(metrics.june, null, "Invalid June publisher count should not be treated as x/y publisher data.");
assertEqual(metrics.successRateText, "53.6%", "Current success rate should be preferred for Tier 2 rules.");

const green = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Growing", publisherCount: "45/102", successRate: 0.4412 },
  { tierGroup: "Core Tier 2", highlightStatus: "Green active opportunity", language: "en" }
);
assertEqual(green.code, "green_optimize", "Green Tier 2 with enough publishers should stay in optimization mode.");
assertMatch(green.action, /do not bring more publishers/i, "Green optimization should avoid new publisher additions.");

const greenUnderSample = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Growing", publisherCount: "9/19", successRate: 0.4737 },
  { tierGroup: "Core Tier 2", highlightStatus: "Green active opportunity", language: "en" }
);
assertEqual(greenUnderSample.code, "green_optimize", "Green Tier 2 below 20 publishers should still stay in optimization mode.");
assertMatch(greenUnderSample.idea, /keep the publishers that already work/i, "Green Tier 2 should keep and scale working publishers.");

const underSample = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Stable", publisherCount: "9/19", successRate: 0.4737 },
  { tierGroup: "Core Tier 2", highlightStatus: "Yellow publisher expansion", language: "en" }
);
assertEqual(underSample.code, "under_sample", "Non-green Tier 2 below 20 publishers should expand the test pool.");
assertMatch(underSample.idea, /20-30 target/i, "Under-sampled Tier 2 should target the 20-30 publisher pool.");

const lowSuccess = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Stable", publisherCount: "12/40", successRate: 0.3 },
  { tierGroup: "Core Tier 2", highlightStatus: "Yellow publisher expansion", language: "en" }
);
assertEqual(lowSuccess.code, "low_success_replace", "Adequate publisher pool with low success should trigger replacement.");
assertMatch(lowSuccess.action, /replace or rotate/i, "Low success should recommend replacing or rotating publishers.");
assertMatch(lowSuccess.idea, /replace weaker publishers in the 20-30 person test pool/i, "Low success should replace publishers within the existing test pool.");

const redDeclining = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Declining", publisherCount: "6/18", successRate: 0.3333 },
  { tierGroup: "Tier 2 Watch", highlightStatus: "Red caution test", language: "en" }
);
assertEqual(redDeclining.code, "red_recovery", "Red or declining Tier 2 should trigger recovery testing.");
assertMatch(redDeclining.action, /sales\/orders/i, "Red recovery should focus on recovering sales/orders.");
assertMatch(redDeclining.action, /Tier 3/i, "Red recovery should call out Tier 3 risk.");
assertMatch(redDeclining.idea, /bring in more qualified publishers/i, "Red recovery should add more qualified publishers.");

const redZh = rules.strategyForOffer(
  { tier: "Tier 2", phase: "Declining", publisherCount: "6/18", successRate: 0.3333 },
  { tierGroup: "Tier 2 Watch", highlightStatus: "Red caution test", language: "zh" }
);
assertMatch(redZh.action, /新增测试 publisher/, "Chinese Tier 2 recovery copy should be available.");

assert(
  html.includes("tier2_recommendation_rules.js") &&
    html.indexOf("tier2_recommendation_rules.js") > html.indexOf("chatbot_i18n.js") &&
    html.indexOf("tier2_recommendation_rules.js") < html.indexOf("app.js"),
  "index.html should load tier2_recommendation_rules.js after i18n and before app.js."
);

[
  "window.TIER2_RECOMMENDATION_RULES",
  "tier2RecommendationDetailsHtml",
  "tier2OptimizationIdea",
  "Publisher Success Rate",
  "Tier 2 Optimization Idea"
].forEach((needle) => {
  assert(app.includes(needle), `app.js should include Tier 2 publisher wiring: ${needle}`);
});

[
  "Publisher Count",
  "Success Rate",
  "Tier 2 Optimization Idea"
].forEach((needle) => {
  assert(i18n.includes(needle), `chatbot_i18n.js should expose label: ${needle}`);
});

console.log("Tier 2 publisher recommendation rule tests passed.");
