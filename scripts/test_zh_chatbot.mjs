import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/chatbot_i18n.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "public/chatbot_i18n.js" });

const i18n = sandbox.window.CHATBOT_I18N;

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertMatch(actual, pattern, message) {
  if (!pattern.test(actual)) {
    throw new Error(`${message}\nActual: ${actual}`);
  }
}

assertEqual(
  i18n.responseLanguage("推荐5个美妆offer", "en"),
  "zh",
  "Chinese input should force a Chinese chatbot response.",
);

assertEqual(
  i18n.detectIntent("推荐5个美妆offer"),
  "recommendation",
  "Chinese recommendation prompts should be detected.",
);

assertEqual(
  i18n.detectIntent("四月未付款有哪些？"),
  "payment",
  "Chinese payment prompts should be detected.",
);

assertEqual(
  i18n.monthNameFromText("四月未付款有哪些？"),
  "April",
  "Chinese month names should map to English report months.",
);

assertEqual(
  i18n.categoryForPrompt("推荐5个美妆offer", ["Beauty & Personal Care"]),
  "beauty",
  "Chinese category aliases should map to canonical categories.",
);

assertMatch(
  i18n.copy("zh").recommendationPreview,
  /推荐预览/,
  "Chinese chatbot copy should be available.",
);

if (!html.includes("chatbot_i18n.js") || html.indexOf("chatbot_i18n.js") > html.indexOf("app.js")) {
  throw new Error("index.html should load chatbot_i18n.js before app.js.");
}

if (!app.includes("window.CHATBOT_I18N") || !app.includes("responseLanguageFor")) {
  throw new Error("app.js should use CHATBOT_I18N for chatbot responses.");
}

console.log("Chinese chatbot helper tests passed.");
