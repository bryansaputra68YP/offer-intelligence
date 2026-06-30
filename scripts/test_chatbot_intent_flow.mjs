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

console.log("Chatbot intent flow tests passed");
