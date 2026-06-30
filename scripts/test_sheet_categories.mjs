import fs from "node:fs";
import vm from "node:vm";

function loadWindowPayload(file, name) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
  return context.window[name];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const chatbotData = loadWindowPayload("public/chatbot_data.js", "CHATBOT_DATA");
const sheetReportData = loadWindowPayload("public/sheet_report_data.js", "SHEET_REPORT_DATA");

const categoryColumnByTier = {
  "Tier 1": 22,
  "Tier 2": 22,
  "Tier 3": 12,
  "Tier 4": 13
};

for (const [tier, expectedIndex] of Object.entries(categoryColumnByTier)) {
  const sheet = sheetReportData.sheets.find((entry) => entry.name === tier);
  if (!sheet) throw new Error(`${tier}: sheet report payload is missing the tier sheet`);
  assertEqual(sheet.headers.indexOf("Category") + 1, expectedIndex, `${tier} Category column`);
}

const expectedOfferCategories = [
  ["Tier 1", "362653", "Shokz Official", "Electronics"],
  ["Tier 2", "369227", "True Classic", "Clothing, Shoes & Jewelry"],
  ["Tier 3", "380681", "Lebanta Haircare", "Beauty & Personal Care"],
  ["Tier 4", "363153", "EGOHOME by MLILY", "Home & Kitchen"]
];

for (const [tier, merchantId, brand, category] of expectedOfferCategories) {
  const offer = chatbotData.offers.find((entry) => (
    entry.tier === tier && entry.merchantId === merchantId && entry.brand === brand
  ));
  if (!offer) throw new Error(`${tier} ${merchantId} ${brand}: offer is missing`);
  assertEqual(offer.sheetCategory, category, `${tier} ${brand} sheetCategory`);
  assertEqual(offer.category, category, `${tier} ${brand} category`);
  assertEqual(offer.mainCategory, category, `${tier} ${brand} mainCategory`);
  assertEqual(offer.categorySource, "Google Sheet", `${tier} ${brand} categorySource`);
}

console.log("Sheet category checks passed");
