(function () {
  const data = window.CHATBOT_DATA || { summary: {}, offers: [] };
  const sheetReport = window.SHEET_REPORT_DATA || { sheets: [], tierSheets: [] };
  const offers = data.offers || [];
  const chatbotI18n = window.CHATBOT_I18N || {};
  const PAYMENT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ACTIVE_PAYMENT_MONTHS = ["March", "April", "May", "June"];
  const MAX_RECOMMENDATION_EXPORT = 1000;
  const AUTO_PAYMENT_SYNC_KEY = "offerPaymentLastAutoSync";
  const AUTO_PAYMENT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const PAYMENT_TODAY = new Date(`${localDateKey(new Date())}T00:00:00`);
  let paymentRecords = withPendingPaymentPlaceholders((data.paymentRecords || []).map(normalizePaymentRecord));
  const paymentRecordsByMerchant = new Map();
  rebuildPaymentIndex();

  const state = {
    page: "dashboard",
    tier: "all",
    network: "all",
    category: "all",
    minEpc: "",
    minAov: "",
    minCvr: "",
    notPaidOnly: false,
    sort: "epc",
    descending: true,
    lastOffer: null,
    lastRows: [],
    currentQuery: "",
    currentContext: { type: "default", items: [], summary: {}, filters: {} },
    payments: {
      month: "all",
      network: "all",
      tier: "all",
      status: "all",
      search: "",
      unpaidOnly: false,
      pendingOnly: false,
      overdueOnly: false
    },
    selectedTierPage: "Tier 1",
    tierSheetFilters: {
      search: "",
      network: "all",
      country: "all",
      minEpc: "",
      minRevenue: ""
    },
    targetFilters: {
      month: "",
      tier: "all"
    },
    paymentSource: "saved invoice file",
    livePaymentsLoaded: false,
    livePaymentsLoading: false,
    recommendationDownloads: {},
    downloadSequence: 0,
    language: localStorage.getItem("offerLanguage") === "zh" ? "zh" : "en"
  };

  const els = {
    dashboardNav: document.getElementById("dashboardNav"),
    paymentsNav: document.getElementById("paymentsNav"),
    sheetsNav: document.getElementById("sheetsNav"),
    tier: document.getElementById("tierFilter"),
    network: document.getElementById("networkFilter"),
    category: document.getElementById("categoryFilter"),
    minEpc: document.getElementById("minEpc"),
    minAov: document.getElementById("minAov"),
    minCvr: document.getElementById("minCvr"),
    notPaidOnly: document.getElementById("notPaidOnly"),
    reset: document.getElementById("resetFilters"),
    metrics: document.getElementById("metrics"),
    table: document.getElementById("offerRows"),
    tableCount: document.getElementById("tableCount"),
    chatLog: document.getElementById("chatLog"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    quickActions: document.getElementById("quickActions"),
    chart: document.getElementById("offerChart"),
    recBox: document.getElementById("recommendationBox"),
    stamp: document.getElementById("datasetStamp"),
    download: document.getElementById("downloadCsv"),
    contextTitle: document.getElementById("contextTitle"),
    contextSubtitle: document.getElementById("contextSubtitle"),
    paymentsPage: document.getElementById("paymentsPage"),
    sheetPage: document.getElementById("sheetPage"),
    sheetPageTitle: document.getElementById("sheetPageTitle"),
    sheetPageSubtitle: document.getElementById("sheetPageSubtitle"),
    sheetPageSummary: document.getElementById("sheetPageSummary"),
    sheetPageNotes: document.getElementById("sheetPageNotes"),
    targetMonthSelect: document.getElementById("targetMonthSelect"),
    targetTierFilter: document.getElementById("targetTierFilter"),
    sheetTableTitle: document.getElementById("sheetTableTitle"),
    sheetTableCount: document.getElementById("sheetTableCount"),
    sheetGridHead: document.getElementById("sheetGridHead"),
    sheetGridRows: document.getElementById("sheetGridRows"),
    tierPage: document.getElementById("tierPage"),
    tierPageTitle: document.getElementById("tierPageTitle"),
    tierPageSubtitle: document.getElementById("tierPageSubtitle"),
    tierPageSummary: document.getElementById("tierPageSummary"),
    tierPageNotes: document.getElementById("tierPageNotes"),
    tierTableTitle: document.getElementById("tierTableTitle"),
    tierTableCount: document.getElementById("tierTableCount"),
    tierSheetHead: document.getElementById("tierSheetHead"),
    tierSheetRows: document.getElementById("tierSheetRows"),
    tierSheetSearch: document.getElementById("tierSheetSearch"),
    tierSheetNetwork: document.getElementById("tierSheetNetwork"),
    tierSheetCountry: document.getElementById("tierSheetCountry"),
    tierSheetMinEpc: document.getElementById("tierSheetMinEpc"),
    tierSheetMinRevenue: document.getElementById("tierSheetMinRevenue"),
    tierNavButtons: Array.from(document.querySelectorAll(".tier-nav-button")),
    paymentSummary: document.getElementById("paymentSummary"),
    paymentRows: document.getElementById("paymentRows"),
    paymentTableCount: document.getElementById("paymentTableCount"),
    paymentStamp: document.getElementById("paymentStamp"),
    paymentSync: document.getElementById("paymentSync"),
    paymentMonth: document.getElementById("paymentMonthFilter"),
    paymentNetwork: document.getElementById("paymentNetworkFilter"),
    paymentTier: document.getElementById("paymentTierFilter"),
    paymentStatus: document.getElementById("paymentStatusFilter"),
    paymentSearch: document.getElementById("paymentSearch"),
    paymentUnpaidOnly: document.getElementById("paymentUnpaidOnly"),
    paymentPendingOnly: document.getElementById("paymentPendingOnly"),
    paymentOverdueOnly: document.getElementById("paymentOverdueOnly"),
    languageToggle: document.getElementById("languageToggle")
  };

  const quickPrompts = [
    { key: "quick.aiper", prompt: "Aiper" },
    { key: "quick.beauty", prompt: "Recommend 5 beauty offers" },
    { key: "quick.tier2", prompt: "Tier 2" },
    { key: "quick.unpaid", prompt: "Which offers are unpaid?" },
    { key: "quick.april", prompt: "April unpaid payments" },
    { key: "quick.asin", prompt: "Find ASIN B0D2HKCMBP" }
  ];

  const categoryAliases = {
    beauty: ["beauty", "personal care", "skin", "skincare", "hair"],
    home: ["home", "kitchen", "furniture", "bedding", "mattress", "office"],
    pet: ["pet", "dog", "cat"],
    electronics: ["electronics", "tech", "camera", "audio", "robot"],
    supplement: ["supplement", "health", "vitamin", "nutrition", "wellness"],
    baby: ["baby", "kid", "kids", "stroller"],
    outdoors: ["sports", "outdoor", "outdoors", "patio", "lawn", "garden"],
    automotive: ["automotive", "car", "vehicle"],
    tools: ["tools", "home improvement"]
  };

  const translations = {
    zh: {
      "brand.subtitle": "亚马逊分层分析",
      "nav.dashboard": "仪表盘",
      "nav.payments": "付款",
      "nav.reports": "报表",
      "nav.targets": "目标",
      "sidebar.status": "数据状态",
      "source.backendEpc": "后台 EPC",
      "source.payments": "3-6月付款",
      "source.sheets": "分层逻辑已加载",
      "dashboard.title": "推荐聊天机器人",
      "filters.dashboard": "仪表盘筛选",
      "filter.minEpc": "最低 EPC",
      "filter.minAov": "最低 AOV",
      "filter.minConversion": "最低转化率",
      "filter.minRevenue": "最低收入",
      "filter.unpaidOnly": "仅未付款",
      "filter.pendingOnly": "仅待处理",
      "filter.overdueOnly": "仅到期/逾期",
      "action.reset": "重置",
      "action.send": "发送",
      "chat.placeholder": "询问 EPC、分层、AOV、转化率、未付款 offer...",
      "table.offers": "Offer 列表",
      "payments.title": "付款",
      "payments.sync": "同步 Levanta",
      "payments.syncing": "同步中...",
      "payments.records": "付款记录",
      "payments.search": "商家搜索",
      "payments.searchPlaceholder": "商家名称或 ID",
      "tier.searchPlaceholder": "商家、ID、原因、推荐",
      "tier.networkAgency": "网络 / Agency",
      "label.Brand": "品牌",
      "label.Merchant": "商家",
      "label.Merchant ID": "商家 ID",
      "label.Tier": "分层",
      "label.Network": "网络",
      "label.Category": "品类",
      "label.Month": "月份",
      "label.Status": "状态",
      "label.Search": "搜索",
      "label.Country": "国家",
      "label.Orders": "订单",
      "label.Payment": "付款",
      "label.Highlight": "重点",
      "label.Revenue": "收入",
      "label.Commission": "佣金",
      "label.Action": "动作",
      "label.Cycle": "周期",
      "label.Available": "可检查日期",
      "label.Last Checked": "上次检查",
      "label.Notes": "备注",
      "label.Records": "记录",
      "label.Merchants": "商家数",
      "label.Columns": "列数",
      "label.Offers": "Offer 数",
      "label.Commission EPC": "佣金 EPC",
      "label.AOV": "AOV",
      "label.CVR": "CVR",
      "label.Revenue made": "产生收入",
      "label.Commission made": "产生佣金",
      "label.Unpaid risk": "付款风险",
      "label.Unpaid merchants": "未付款商家",
      "label.Pending merchants": "待处理商家",
      "label.Overdue rows": "到期/逾期记录",
      "label.Offers in category": "该品类 Offer",
      "label.Average AOV": "平均 AOV",
      "label.Blended EPC": "综合 EPC",
      "label.Average CVR": "平均 CVR",
      "label.Best by EPC": "EPC 最佳",
      "label.Best by CVR": "CVR 最佳",
      "label.Best by revenue": "收入最佳",
      "label.Best by commission": "佣金最佳",
      "label.Payment risk": "付款风险",
      "label.Caution watch": "注意观察",
      "label.Rows": "行数",
      "label.Brand Count": "品牌数",
      "label.Total Clicks": "总点击",
      "label.Order Count": "订单数",
      "label.New Tier Entries": "新进分层",
      "label.Tier Exits": "退出分层",
      "label.Target": "目标",
      "option.All tiers": "全部分层",
      "option.All networks": "全部网络",
      "option.All categories": "全部品类",
      "option.All months": "全部月份",
      "option.All statuses": "全部状态",
      "option.All countries": "全部国家",
      "option.Paid": "已付款",
      "option.Unpaid": "未付款",
      "option.Pending": "待处理",
      "option.Partial": "部分付款",
      "option.Unknown": "未知",
      "option.March": "三月",
      "option.April": "四月",
      "option.May": "五月",
      "option.June": "六月",
      "quick.aiper": "Aiper",
      "quick.beauty": "推荐 5 个美妆 offer",
      "quick.tier2": "Tier 2",
      "quick.unpaid": "哪些 offer 未付款？",
      "quick.april": "四月未付款",
      "quick.asin": "查找 ASIN B0D2HKCMBP",
      "context.defaultTitle": "上下文概览",
      "context.defaultSubtitle": "整体 offer 快照",
      "context.recommendationTitle": "推荐概览",
      "context.merchantTitle": "商家数据",
      "context.asinTitle": "ASIN 数据",
      "context.categoryTitle": "品类概览",
      "context.tierTitle": "分层概览",
      "context.paymentTitle": "付款概览",
      "context.generalFiltered": "当前筛选视图",
      "context.basedOn": "基于：",
      "context.noMatches": "没有找到匹配记录。",
      "payment.followup": "需要跟进的商家",
      "payment.none": "无",
      "payment.checkable": "可检查",
      "payment.pending": "未到检查时间",
      "payment.summary": "付款概览",
      "payment.recordsAcross": "条记录，覆盖",
      "payment.merchants": "个商家",
      "payment.unpaid": "未付款",
      "payment.pendingCount": "待处理",
      "payment.overdue": "到期/逾期",
      "payment.cycle": "付款周期",
      "payment.notAvailable": "当前数据不可用",
      "payment.tableCount": "条付款记录匹配",
      "table.offerCount": "个 offer 匹配",
      "dataset.loaded": "个 offers 已加载 / 生成于",
      "payments.stampSaved": "条已保存 Levanta 付款记录 / 可按周期检查 / 检查日期",
      "payments.stampLive": "条 Levanta 实时付款记录 / 检查日期",
      "payments.stampUnavailable": "条已保存 Levanta 付款记录 / 实时 API 不可用 / 检查日期",
      "sheet.targets": "月度目标",
      "sheet.noTargets": "当前表格导出中没有目标行",
      "sheet.noTargetMatch": "当前筛选没有匹配的目标数据。",
      "sheet.targetSummary": "目标和表现汇总",
      "sheet.noTargetNotes": "当前选择没有文字目标备注。",
      "sheet.targetRecords": "月度目标记录",
      "sheet.targetRows": "条目标记录",
      "tier.imported": "从 Google Sheets 导入",
      "tier.notFound": "未找到 Google Sheet 标签页",
      "tier.noMatch": "当前导出中没有找到匹配的 Sheet 标签页。",
      "language.button.zh": "中文简体",
      "language.button.en": "English"
    }
  };

  function t(key, fallback = key) {
    if (state.language !== "zh") return fallback;
    return translations.zh[key] || fallback;
  }

  function labelText(label) {
    return t(`label.${label}`, label);
  }

  function optionText(value) {
    return t(`option.${value}`, value);
  }

  function statusText(value) {
    return t(`option.${value}`, value || "Unknown");
  }

  function responseLanguageFor(prompt = state.currentQuery) {
    if (chatbotI18n.responseLanguage) return chatbotI18n.responseLanguage(prompt, state.language);
    return state.language === "zh" ? "zh" : "en";
  }

  function chatCopy(language) {
    return chatbotI18n.copy ? chatbotI18n.copy(language) : {};
  }

  function chatFormat(template, values) {
    if (chatbotI18n.format) return chatbotI18n.format(template, values);
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  }

  function chatLabelText(label, language) {
    if (chatbotI18n.label) return chatbotI18n.label(label, language);
    return language === "zh" ? label : labelText(label);
  }

  function promptHasPaymentTerms(text) {
    return /payment|paid|unpaid|late|issue|cycle|付款|未付款|没付款|已付款|逾期|到期|周期|佣金|欠款|待处理|部分付款/.test(String(text || "").toLowerCase());
  }

  function applyStaticLanguage() {
    document.documentElement.lang = state.language === "zh" ? "zh-Hans" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!el.dataset.i18nFallback) el.dataset.i18nFallback = el.textContent;
      el.textContent = t(el.dataset.i18n, el.dataset.i18nFallback);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      if (!el.dataset.i18nPlaceholderFallback) el.dataset.i18nPlaceholderFallback = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder, el.dataset.i18nPlaceholderFallback));
    });
    if (els.languageToggle) {
      els.languageToggle.textContent = state.language === "zh"
        ? t("language.button.en", "English")
        : t("language.button.zh", "中文简体");
    }
  }

  function syncDashboardOptionLabels() {
    const defaults = [
      [els.tier, "All tiers"],
      [els.network, "All networks"],
      [els.category, "All categories"]
    ];
    defaults.forEach(([select, label]) => {
      const option = select && select.querySelector('option[value="all"]');
      if (option) option.textContent = optionText(label);
    });
  }

  function updateQuickPromptLabels() {
    Array.from(els.quickActions.querySelectorAll("[data-prompt-key]")).forEach((button) => {
      button.textContent = t(button.dataset.promptKey, button.dataset.prompt);
    });
  }

  function setDatasetStamp() {
    els.stamp.textContent = `${offers.length.toLocaleString()} ${t("dataset.loaded", "offers loaded / generated")} ${data.summary.generatedAt || ""}`;
  }

  function setPaymentStamp(mode = "saved", checkedAt = isoDate(PAYMENT_TODAY)) {
    const count = paymentRecords.length.toLocaleString();
    if (mode === "live") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampLive", "live Levanta payment records / checked")} ${checkedAt}`;
      return;
    }
    if (mode === "unavailable") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampUnavailable", "saved Levanta payment records / live API unavailable / checked")} ${checkedAt}`;
      return;
    }
    els.paymentStamp.textContent = `${count} ${t("payments.stampSaved", "saved Levanta payment records / cycle-aware availability / checked")} ${checkedAt}`;
  }

  function rerenderForLanguage() {
    applyStaticLanguage();
    syncDashboardOptionLabels();
    updateQuickPromptLabels();
    refreshPaymentFilterOptions();
    refreshTargetFilters();
    syncControls();
    syncPaymentControls();
    setDatasetStamp();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "payments") {
      renderPaymentsPage();
    } else if (state.page === "sheets") {
      renderSheetPage();
    } else if (state.page === "tier") {
      renderTierPage(state.selectedTierPage);
    } else {
      renderAll();
      if (state.currentContext.type !== "default") renderContextPanel(state.currentContext);
    }
  }

  function toggleLanguage() {
    state.language = state.language === "zh" ? "en" : "zh";
    localStorage.setItem("offerLanguage", state.language);
    rerenderForLanguage();
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isAvailable(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== "";
  }

  function textValue(value) {
    return isAvailable(value) ? String(value) : "not available in current data";
  }

  function money(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function shortMoney(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function pct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortPct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortEpc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toFixed(3);
  }

  function epc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toFixed(3);
  }

  function countValue(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return Number(value).toLocaleString();
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  }

  function words(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function textIncludesAlias(haystack, alias) {
    const term = String(alias || "").toLowerCase().trim();
    if (!term) return false;
    if (term.length <= 3) return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack);
    return haystack.includes(term);
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isoDate(date) {
    return localDateKey(date);
  }

  function monthNameFromText(value) {
    const zhMonth = chatbotI18n.monthNameFromText && chatbotI18n.monthNameFromText(value);
    if (zhMonth) return zhMonth;
    const text = String(value || "").toLowerCase();
    const direct = PAYMENT_MONTHS.find((month) => textIncludesAlias(text, month.toLowerCase()));
    if (direct) return direct;
    const key = text.match(/\b2026-(0[1-9]|1[0-2])\b/);
    if (key) return PAYMENT_MONTHS[Number(key[1]) - 1];
    return null;
  }

  function monthKey(record) {
    if (record.reportMonthKey) return record.reportMonthKey;
    const month = monthNameFromText(record.reportMonth);
    const index = PAYMENT_MONTHS.indexOf(month);
    const year = Number(record.reportYear || 2026);
    return index >= 0 ? `${year}-${String(index + 1).padStart(2, "0")}` : "";
  }

  function addDaysIso(date, days) {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
    return copy.toISOString().slice(0, 10);
  }

  function calculatePaymentAvailabilityDate(recordOrMonth, year = 2026) {
    const month = typeof recordOrMonth === "string" ? monthNameFromText(recordOrMonth) : monthNameFromText(recordOrMonth.reportMonth || recordOrMonth.reportMonthKey);
    const reportYear = typeof recordOrMonth === "object" ? Number(recordOrMonth.reportYear || year) : Number(year);
    const index = PAYMENT_MONTHS.indexOf(month);
    if (index < 0) return "";
    const cycle = typeof recordOrMonth === "object" ? number(recordOrMonth.paymentCycle) : 0;
    if (cycle > 0) {
      return addDaysIso(new Date(Date.UTC(reportYear, index, 2)), cycle);
    }
    const date = new Date(Date.UTC(reportYear, index + 2, 3));
    return date.toISOString().slice(0, 10);
  }

  function calculatePaymentStatus(record) {
    const raw = String(record.rawStatus || record.paymentStatus || "").toLowerCase();
    const expected = number(record.expectedPaymentAmount ?? record.commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const availableDate = dateOnly(record.paymentAvailabilityDate || calculatePaymentAvailabilityDate(record));
    const due = availableDate ? PAYMENT_TODAY >= availableDate : false;

    if (raw === "paid" || (expected > 0 && paid >= expected - 0.01 && !raw.includes("late") && !raw.includes("unpaid"))) return "Paid";
    if (expected <= 0 && paid <= 0) {
      if (raw.includes("pending")) return "Pending";
      return "Unknown";
    }
    if (paid > 0 && remaining > 0.01) return "Partial";
    if (!due || raw.includes("pending")) return "Pending";
    if (raw.includes("late") || raw.includes("unpaid") || due) return "Unpaid";
    return "Unknown";
  }

  function normalizePaymentRecord(record) {
    const expected = number(record.expectedPaymentAmount ?? record.commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const normalized = {
      ...record,
      merchantId: String(record.merchantId || "").trim(),
      merchantName: String(record.merchantName || record.brand || "").trim(),
      network: record.network || "Levanta",
      tier: record.tier || "Unknown",
      category: record.category || "Uncategorized",
      reportMonth: record.reportMonth || monthNameFromText(record.reportMonthKey) || "Unknown",
      reportYear: Number(record.reportYear || 2026),
      reportMonthKey: record.reportMonthKey || monthKey(record),
      revenueMade: number(record.revenueMade),
      commissionMade: number(record.commissionMade ?? expected),
      expectedPaymentAmount: expected,
      paidAmount: paid,
      remainingAmount: remaining,
      paymentCycle: record.paymentCycle || "",
      lastCheckedDate: record.lastCheckedDate || data.summary.generatedAt || "",
      notes: record.notes || ""
    };
    normalized.paymentAvailabilityDate = calculatePaymentAvailabilityDate(normalized) || record.paymentAvailabilityDate || "";
    normalized.paymentStatus = calculatePaymentStatus(normalized);
    return normalized;
  }

  function offerForPaymentMerchant(record) {
    const merchantId = String(record.merchantId || "").trim();
    if (merchantId) {
      const byId = offers.find((offer) => String(offer.merchantId || "").trim() === merchantId);
      if (byId) return byId;
    }
    const merchantName = normalize(record.merchantName || record.brand);
    if (!merchantName) return null;
    return offers.find((offer) => {
      const brand = normalize(offer.brand);
      return brand && (brand === merchantName || brand.includes(merchantName) || merchantName.includes(brand));
    });
  }

  function paymentMerchantKey(record) {
    return String(record.merchantId || normalize(record.merchantName || record.brand)).trim();
  }

  function createPendingPaymentRecord(source, month) {
    const monthIndex = PAYMENT_MONTHS.indexOf(month);
    const reportYear = Number(source.reportYear || 2026);
    const offer = offerForPaymentMerchant(source) || {};
    const merchantId = String(source.merchantId || offer.merchantId || "").trim();
    const merchantName = String(source.merchantName || source.brand || offer.brand || merchantId || "Unknown merchant").trim();
    const record = {
      id: `${merchantId || normalize(merchantName)}::${reportYear}-${String(monthIndex + 1).padStart(2, "0")}::pending-placeholder`,
      merchantId,
      merchantName,
      network: "Levanta",
      tier: source.tier || offer.tier || "Unknown",
      category: source.category || offer.category || offer.levantaCategory || "Uncategorized",
      reportMonth: month,
      reportYear,
      reportMonthKey: `${reportYear}-${String(monthIndex + 1).padStart(2, "0")}`,
      revenueMade: 0,
      commissionMade: 0,
      expectedPaymentAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentCycle: source.paymentCycle || offer.paymentCycle || "",
      rawStatus: "pending",
      lastCheckedDate: isoDate(PAYMENT_TODAY),
      currency: source.currency || "USD",
      isPlaceholder: true,
      notes: "No Levanta invoice row found yet; marked pending until the month becomes payable or Levanta returns a final status."
    };
    record.paymentAvailabilityDate = calculatePaymentAvailabilityDate(record);
    record.paymentStatus = "Pending";
    return normalizePaymentRecord(record);
  }

  function withPendingPaymentPlaceholders(records) {
    const normalized = records.map(normalizePaymentRecord);
    const existingKeys = new Set(normalized.map((record) => `${paymentMerchantKey(record)}::${record.reportMonthKey}`));
    const merchants = Array.from(new Map(normalized
      .filter((record) => paymentMerchantKey(record))
      .map((record) => [paymentMerchantKey(record), record])).values());
    const additions = [];

    merchants.forEach((merchant) => {
      ACTIVE_PAYMENT_MONTHS.forEach((month) => {
        const monthIndex = PAYMENT_MONTHS.indexOf(month);
        if (monthIndex < 0) return;
        const key = `${paymentMerchantKey(merchant)}::2026-${String(monthIndex + 1).padStart(2, "0")}`;
        if (existingKeys.has(key)) return;
        additions.push(createPendingPaymentRecord(merchant, month));
        existingKeys.add(key);
      });
    });

    return normalized.concat(additions);
  }

  function rebuildPaymentIndex() {
    paymentRecordsByMerchant.clear();
    paymentRecords.forEach((record) => {
      const key = String(record.merchantId || record.merchantName || "").trim();
      if (!key) return;
      if (!paymentRecordsByMerchant.has(key)) paymentRecordsByMerchant.set(key, []);
      paymentRecordsByMerchant.get(key).push(record);
    });
  }

  function getPaymentRecords() {
    return paymentRecords.map((record) => ({ ...record, paymentStatus: calculatePaymentStatus(record) }));
  }

  function getPaymentByMerchant(merchant) {
    const key = normalize(merchant);
    return getPaymentRecords().filter((record) => (
      normalize(record.merchantId) === key ||
      normalize(record.merchantName) === key ||
      normalize(record.merchantName).includes(key) ||
      normalize(record.merchantId).includes(key)
    ));
  }

  function getPaymentByMonth(reportMonth) {
    const month = monthNameFromText(reportMonth);
    const key = String(reportMonth || "");
    return getPaymentRecords().filter((record) => (
      (month && record.reportMonth === month) ||
      record.reportMonthKey === key
    ));
  }

  function getPaymentByStatus(status) {
    const wanted = String(status || "").toLowerCase();
    return getPaymentRecords().filter((record) => record.paymentStatus.toLowerCase() === wanted);
  }

  function getUnpaidPayments() {
    return getPaymentByStatus("Unpaid");
  }

  function getPendingPayments() {
    return getPaymentByStatus("Pending");
  }

  function isPaymentOverdue(record) {
    const dueDate = dateOnly(record.paymentAvailabilityDate);
    return Boolean(dueDate && PAYMENT_TODAY >= dueDate && number(record.remainingAmount) > 0 && record.paymentStatus !== "Pending");
  }

  function getOverduePayments() {
    return getPaymentRecords().filter(isPaymentOverdue);
  }

  function updatePaymentSummary(rows = getPaymentRecords()) {
    const merchantIds = new Set(rows.map((record) => record.merchantId || record.merchantName).filter(Boolean));
    const unpaidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Unpaid").map((record) => record.merchantId || record.merchantName));
    const pendingMerchants = new Set(rows.filter((record) => record.paymentStatus === "Pending").map((record) => record.merchantId || record.merchantName));
    const paidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Paid").map((record) => record.merchantId || record.merchantName));
    return {
      recordCount: rows.length,
      merchantCount: merchantIds.size,
      totalRevenueMade: rows.reduce((sum, record) => sum + number(record.revenueMade), 0),
      totalCommissionMade: rows.reduce((sum, record) => sum + number(record.commissionMade), 0),
      totalExpectedPayment: rows.reduce((sum, record) => sum + number(record.expectedPaymentAmount), 0),
      totalPaidAmount: rows.reduce((sum, record) => sum + number(record.paidAmount), 0),
      totalRemainingAmount: rows.reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalUnpaidAmount: rows.filter((record) => record.paymentStatus === "Unpaid").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPendingAmount: rows.filter((record) => record.paymentStatus === "Pending").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPartialAmount: rows.filter((record) => record.paymentStatus === "Partial").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      unpaidMerchantCount: unpaidMerchants.size,
      pendingMerchantCount: pendingMerchants.size,
      paidMerchantCount: paidMerchants.size,
      overdueCount: rows.filter(isPaymentOverdue).length
    };
  }

  function syncLevantaPayments() {
    const summary = updatePaymentSummary(getPaymentRecords());
    return {
      status: "file-based",
      checkedAt: isoDate(PAYMENT_TODAY),
      summary
    };
  }

  async function refreshLevantaPayments(options = {}) {
    if (state.livePaymentsLoading) return;
    state.livePaymentsLoading = true;
    if (els.paymentSync) {
      els.paymentSync.disabled = true;
      els.paymentSync.textContent = t("payments.syncing", "Syncing...");
    }
    try {
      const response = await fetch("/api/levanta/payments?start=2026-03&end=2026-06", { cache: "no-store" });
      if (!response.ok) throw new Error(`Levanta API sync returned ${response.status}`);
      const payload = await response.json();
      if (!payload.records || !payload.records.length) throw new Error("Levanta API returned no payment records");
      paymentRecords = withPendingPaymentPlaceholders(payload.records.map(normalizePaymentRecord));
      rebuildPaymentIndex();
      state.paymentSource = "Levanta API";
      state.livePaymentsLoaded = true;
      if (options.auto) localStorage.setItem(AUTO_PAYMENT_SYNC_KEY, localDateKey(new Date()));
      refreshPaymentFilterOptions();
      syncPaymentControls();
      setPaymentStamp("live", String(payload.checkedAt || "").slice(0, 10) || isoDate(PAYMENT_TODAY));
      renderPaymentsPage();
      if (state.currentContext.type === "payment") {
        setContext(buildPaymentContext(getFilteredPayments().slice(0, 60), state.currentQuery || "Payment sync"));
      }
    } catch (error) {
      state.paymentSource = "saved invoice file";
      setPaymentStamp("unavailable", isoDate(PAYMENT_TODAY));
      if (!options.silent) {
        addMessage("assistant", `I could not reach the live Levanta API from this server, so I kept the saved invoice data loaded. The server needs <strong>LEVANTA_API_KEY</strong> configured for live sync.`);
      }
      renderPaymentsPage();
    } finally {
      if (els.paymentSync) {
        els.paymentSync.disabled = false;
        els.paymentSync.textContent = t("payments.sync", "Sync Levanta");
      }
      state.livePaymentsLoading = false;
    }
  }

  function maybeAutoSyncLevantaPayments() {
    const today = localDateKey(new Date());
    if (!today || localStorage.getItem(AUTO_PAYMENT_SYNC_KEY) === today || state.livePaymentsLoading) return;
    refreshLevantaPayments({ silent: true, auto: true });
  }

  function paymentRecordsForOffer(offer) {
    const byId = paymentRecordsByMerchant.get(String(offer.merchantId || "").trim()) || [];
    if (byId.length) return byId;
    const brandKey = normalize(offer.brand);
    if (!brandKey) return [];
    return paymentRecords.filter((record) => normalize(record.merchantName) === brandKey);
  }

  function hasOfferOverduePayment(offer) {
    return paymentRecordsForOffer(offer).some(isPaymentOverdue);
  }

  function paymentRiskTextForOffer(offer) {
    const overdue = paymentRecordsForOffer(offer).filter(isPaymentOverdue);
    if (overdue.length) {
      const total = overdue.reduce((sum, record) => sum + number(record.remainingAmount), 0);
      const months = Array.from(new Set(overdue.map((record) => record.reportMonth))).join(", ");
      return `${months} overdue payment (${shortMoney(total)} remaining)`;
    }
    return offer.paymentStatus || "payment risk";
  }

  function hasPaymentRisk(offer) {
    return Boolean(offer.paymentRisk || offer.paymentState === "unpaid" || hasOfferOverduePayment(offer));
  }

  function hasPaidSignal(offer) {
    return offer.paymentState === "paid" || paymentRecordsForOffer(offer).some((record) => record.paymentStatus === "Paid");
  }

  function tierGroup(offer) {
    const tier = offer.tier || "";
    const reason = `${offer.reason || ""} ${offer.recommendation || ""}`.toLowerCase();
    if (tier === "BLACK TIER") return "Black Tier";
    if (tier === "Tier 1") return "Tier 1";
    if (tier === "Tier 2" && /manual keep|monitor|underperformance|declined|watch|careful/.test(reason)) return "Tier 2 Watch";
    if (tier === "Tier 2") return "Core Tier 2";
    if (tier === "Tier 3") return "Tier 3";
    if (tier === "Tier 4") return "Tier 4";
    return tier || "Unknown";
  }

  function tierPriority(offer, includeTier4 = false, includeBlack = false) {
    const group = tierGroup(offer);
    if (group === "Tier 1") return 1;
    if (group === "Core Tier 2") return 2;
    if (group === "Tier 2 Watch") return 3;
    if (group === "Tier 3") return 4;
    if (group === "Tier 4") return includeTier4 ? 5 : 99;
    if (group === "Black Tier") return includeBlack ? 6 : 100;
    return 50;
  }

  function highlightStatus(offer) {
    const group = tierGroup(offer);
    const phase = String(offer.phase || "").toLowerCase();
    if (group === "Tier 1") return "Strategic push";
    if (group === "Tier 2 Watch") return "Red caution test";
    if (group === "Core Tier 2" && phase.includes("growing")) return "Green active opportunity";
    if (group === "Core Tier 2") return "Yellow publisher expansion";
    if (group === "Tier 3") return "Development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "No push";
    return "Optimization only";
  }

  function recommendedAction(offer, language = state.language) {
    const group = tierGroup(offer);
    if (language === "zh") {
      if (hasPaymentRisk(offer)) return "放量前先跟进付款风险";
      if (group === "Tier 1") return "战略性推进";
      if (group === "Core Tier 2") {
        const map = {
          "Green active opportunity": "绿色主动机会",
          "Yellow publisher expansion": "黄色 publisher 扩展机会",
          "Optimization only": "仅优化"
        };
        return map[highlightStatus(offer)] || highlightStatus(offer);
      }
      if (group === "Tier 2 Watch") return "仅做精选 publisher 测试";
      if (group === "Tier 3") return "控制节奏做发展测试";
      if (group === "Tier 4") return "仅复测";
      if (group === "Black Tier") return "不要推进";
      return "仅优化";
    }
    if (hasPaymentRisk(offer)) return "Follow up payment before scaling";
    if (group === "Tier 1") return "Push strategically";
    if (group === "Core Tier 2") return highlightStatus(offer);
    if (group === "Tier 2 Watch") return "Selected publisher test only";
    if (group === "Tier 3") return "Controlled development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "Do not push";
    return "Optimize only";
  }

  function caution(offer, language = state.language) {
    const group = tierGroup(offer);
    if (language === "zh") {
      if (group === "Black Tier") return "Black Tier，不建议推进。";
      if (hasPaymentRisk(offer)) return `付款风险：${paymentRiskTextForOffer(offer)}。`;
      if (group === "Tier 4") return "仅在角度明确时复测。";
      if (group === "Tier 2 Watch") return "放量前需要继续观察。";
      if (number(offer.conversionRate) < 0.01) return "CVR 低于 1%，建议使用高意图流量。";
      return "持续观察 EPC、CVR 和付款状态。";
    }
    if (group === "Black Tier") return "Black tier; do not push.";
    if (hasPaymentRisk(offer)) return `Payment risk: ${paymentRiskTextForOffer(offer)}.`;
    if (group === "Tier 4") return "Retest only with a clear angle.";
    if (group === "Tier 2 Watch") return "Needs monitoring before broader scale.";
    if (number(offer.conversionRate) < 0.01) return "CVR is below 1%; use high-intent traffic.";
    return "Monitor EPC, CVR, and payment status.";
  }

  function bestAngle(offer, context = {}) {
    const category = offer.category && offer.category !== "Uncategorized" ? offer.category : "category";
    const link = offer.recommendedLink ? `${offer.recommendedLink.toLowerCase()} traffic` : "selected publisher traffic";
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    if (language === "zh") {
      const categoryText = category === "category" ? "该品类" : category;
      const linkText = offer.recommendedLink ? `${offer.recommendedLink} 流量` : "精选 publisher 流量";
      if (context.google) {
        if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${categoryText} 关键词、测评、对比和高意图搜索流量。`;
        return `${categoryText} 关键词测试，先收紧意图；CVR 改善前不要大规模放量。`;
      }
      if (offer.hasDiscount) return `${categoryText} deal、coupon、对比和测评流量。`;
      if (offer.hasAsin) return `${categoryText} ASIN 测评、对比和购买指南流量。`;
      return `${categoryText} ${linkText}、对比内容和控制测试流量。`;
    }
    if (context.google) {
      if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${category} keyword, review, comparison, and high-intent search traffic.`;
      return `${category} keyword tests with tighter intent; avoid broad scaling until CVR improves.`;
    }
    if (offer.hasDiscount) return `${category} deal, coupon, comparison, and review traffic.`;
    if (offer.hasAsin) return `${category} ASIN review, comparison, and buying-guide traffic.`;
    return `${category} ${link}, comparison, and controlled test traffic.`;
  }

  function aggregateRows(rows) {
    const totalRevenue = rows.reduce((sum, offer) => sum + number(offer.salesAmount), 0);
    const totalCommission = rows.reduce((sum, offer) => sum + number(offer.affCommission), 0);
    const totalClicks = rows.reduce((sum, offer) => sum + number(offer.clicks), 0);
    const totalDpv = rows.reduce((sum, offer) => sum + number(offer.dpv), 0);
    const totalAtc = rows.reduce((sum, offer) => sum + number(offer.atc), 0);
    const totalOrders = rows.reduce((sum, offer) => sum + number(offer.orders), 0);
    const tierBreakdown = rows.reduce((acc, offer) => {
      const tier = tierGroup(offer);
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});
    const tier2Breakdown = rows.filter((offer) => offer.tier === "Tier 2").reduce((acc, offer) => {
      const status = highlightStatus(offer);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return {
      totalOffers: rows.length,
      totalRevenue,
      totalCommission,
      totalClicks,
      totalDpv,
      totalAtc,
      totalOrders,
      avgAov: totalOrders ? totalRevenue / totalOrders : null,
      blendedEpc: totalClicks ? totalCommission / totalClicks : null,
      avgCvr: totalClicks ? totalOrders / totalClicks : null,
      paymentRiskCount: rows.filter(hasPaymentRisk).length,
      tierBreakdown,
      tier2Breakdown
    };
  }

  function bestBy(rows, metric) {
    return rows.reduce((best, offer) => number(offer[metric]) > number(best && best[metric]) ? offer : best, null);
  }

  function uniqueValues(key) {
    return Array.from(new Set(offers.map((offer) => offer[key]).filter(Boolean))).sort((a, b) => {
      if (String(a).startsWith("Tier") && String(b).startsWith("Tier")) return String(a).localeCompare(String(b), undefined, { numeric: true });
      return String(a).localeCompare(String(b));
    });
  }

  function fillSelect(select, values) {
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionText(value);
      select.appendChild(option);
    });
  }

  function replaceSelectOptions(select, firstLabel, values, selectedValue) {
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "all";
    first.textContent = optionText(firstLabel);
    select.appendChild(first);
    fillSelect(select, values);
    select.value = values.includes(selectedValue) ? selectedValue : "all";
  }

  function replaceSelectWithOptions(select, options, selectedValue) {
    select.innerHTML = "";
    options.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = optionText(option.label);
      select.appendChild(el);
    });
    if (options.some((option) => option.value === selectedValue)) {
      select.value = selectedValue;
    } else if (options[0]) {
      select.value = options[0].value;
    }
  }

  function parseSheetNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function rowValue(row, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
    }
    return "";
  }

  function getFiltered() {
    const minEpc = Number(state.minEpc || 0);
    const minAov = Number(state.minAov || 0);
    const minCvr = Number(state.minCvr || 0) / 100;
    return offers
      .filter((offer) => state.tier === "all" || offer.tier === state.tier)
      .filter((offer) => state.network === "all" || offer.network === state.network)
      .filter((offer) => state.category === "all" || offer.category === state.category)
      .filter((offer) => number(offer.epc) >= minEpc)
      .filter((offer) => number(offer.aov) >= minAov)
      .filter((offer) => number(offer.conversionRate) >= minCvr)
      .filter((offer) => !state.notPaidOnly || hasPaymentRisk(offer))
      .sort((a, b) => (number(b[state.sort]) - number(a[state.sort])) * (state.descending ? 1 : -1));
  }

  function fuzzyScore(query, offer) {
    const q = normalize(query);
    const brand = normalize(offer.brand);
    if (!q || !brand) return 0;
    if (brand === q) return 100;
    if (offer.merchantId === query.trim()) return 100;
    if (brand.startsWith(q)) return 92;
    if (brand.includes(q)) return 82;
    const queryWords = words(query);
    const haystack = words(`${offer.brand} ${offer.category} ${offer.network}`);
    const matched = queryWords.filter((word) => haystack.some((item) => item.includes(word) || word.includes(item))).length;
    const tokenScore = queryWords.length ? (matched / queryWords.length) * 70 : 0;
    const overlap = [...q].filter((char) => brand.includes(char)).length / Math.max(q.length, 1);
    return Math.max(tokenScore, overlap * 45);
  }

  function findMerchantMatches(query) {
    const cleaned = query.replace(/\b(search|find|merchant|overview|info|information|about|for)\b/gi, " ").trim();
    const scored = offers
      .map((offer) => {
        const score = fuzzyScore(cleaned, offer);
        let adjusted = score;
        if (tierPriority(offer, false, false) < 99) adjusted += 18;
        if (number(offer.orders) > 0 || number(offer.clicks) > 0) adjusted += 8;
        if (offer.tier === "Tier 4") adjusted -= 22;
        if (offer.tier === "BLACK TIER") adjusted -= 60;
        return { offer, score, adjusted };
      })
      .filter((item) => item.score >= 45)
      .sort((a, b) => b.adjusted - a.adjusted || b.score - a.score || tierPriority(a.offer, true, true) - tierPriority(b.offer, true, true));
    const seen = new Set();
    return scored.filter(({ offer }) => {
      const key = `${offer.merchantId}:${normalize(offer.brand)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  function findByMerchantId(text) {
    const match = text.match(/\b\d{5,8}(?:\.0)?\b/);
    if (!match) return null;
    const id = match[0].replace(/\.0$/, "");
    return offers.find((offer) => offer.merchantId === id) || null;
  }

  function findByAsin(text) {
    const match = text.toUpperCase().match(/\bB[A-Z0-9]{9}\b/);
    if (!match) return null;
    const asin = match[0];
    return { asin, rows: offers.filter((offer) => (offer.topAsins || []).includes(asin)) };
  }

  function categoryForPrompt(text) {
    const zhCategory = chatbotI18n.categoryForPrompt && chatbotI18n.categoryForPrompt(text, uniqueValues("category"));
    if (zhCategory) return zhCategory;
    const lower = text.toLowerCase();
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
    }
    return uniqueValues("category").find((cat) => cat !== "Uncategorized" && lower.includes(cat.toLowerCase())) || null;
  }

  function categoryMatches(offer, category) {
    if (!category) return true;
    const aliases = categoryAliases[category] || [category];
    const haystack = `${offer.category || ""} ${offer.brand || ""}`.toLowerCase();
    return aliases.some((alias) => textIncludesAlias(haystack, alias));
  }

  function tierFromPrompt(text) {
    const zhTier = chatbotI18n.tierFromPrompt && chatbotI18n.tierFromPrompt(text);
    if (zhTier) return zhTier;
    const black = /black\s*tier|blocked/i.test(text);
    if (black) return "BLACK TIER";
    const match = text.match(/tier\s*([1-4])/i);
    return match ? `Tier ${match[1]}` : null;
  }

  function detectQueryIntent(userMessage) {
    const lower = userMessage.toLowerCase().trim();
    if (findByAsin(userMessage)) return "asin";
    if (findByMerchantId(userMessage)) return "merchant";
    const zhIntent = chatbotI18n.detectIntent && chatbotI18n.detectIntent(userMessage);
    if (zhIntent) return zhIntent;
    if (promptHasPaymentTerms(lower)) return "payment";
    if (/recommend|push|focus|best|should we/.test(lower)) return "recommendation";
    if (tierFromPrompt(userMessage)) return "tier";
    if (categoryForPrompt(userMessage)) return "category";
    if (contextFollowup(lower)) return "merchant";
    return "merchant";
  }

  function recommendationScore(offer, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    const priority = tierPriority(offer, includeTier4, includeBlack);
    if (priority >= 99) return -9999;
    if (offer.tier === "Tier 2" && highlightStatus(offer) === "Optimization only") return -9999;

    let score = 100 - priority * 14;
    score += Math.log10(number(offer.orders) + 1) * 12;
    score += Math.log10(number(offer.clicks) + 1) * 3;
    score += number(offer.conversionRate) * 260;
    score += Math.min(number(offer.epc), 5) * 8;
    score += Math.min(number(offer.salesAmount), 100000) / 12000;
    score += Math.min(number(offer.atc), 500) / 80;
    score += offer.hasDiscount ? 7 : 0;
    score += offer.hasAsin ? 2 : 0;
    score += offer.recommendedLink ? 2 : 0;
    score -= hasPaymentRisk(offer) ? 32 : 0;
    score -= offer.trackingIssue ? 20 : 0;
    score -= offer.tier === "Tier 4" ? 40 : 0;
    score -= offer.tier === "BLACK TIER" ? 100 : 0;

    if (context.category && categoryMatches(offer, context.category)) score += 14;
    if (context.google) {
      score += number(offer.orders) >= 50 ? 8 : -4;
      score += number(offer.conversionRate) >= 0.01 ? 7 : -2;
      score += number(offer.clicks) >= 500 ? 4 : 0;
    }
    return score;
  }

  function sortedForCategory(category, options = {}) {
    const includeTier4 = options.includeTier4 || /tier 4|retest/i.test(options.prompt || "");
    const includeBlack = options.includeBlack || /black|blocked/i.test(options.prompt || "");
    return offers
      .filter((offer) => categoryMatches(offer, category))
      .filter((offer) => !options.tier || offer.tier === options.tier)
      .filter((offer) => includeTier4 || offer.tier !== "Tier 4")
      .filter((offer) => includeBlack || offer.tier !== "BLACK TIER")
      .sort((a, b) => (
        tierPriority(a, includeTier4, includeBlack) - tierPriority(b, includeTier4, includeBlack) ||
        number(b.orders) - number(a.orders) ||
        number(b.conversionRate) - number(a.conversionRate) ||
        number(b.salesAmount) - number(a.salesAmount) ||
        number(b.epc) - number(a.epc)
      ));
  }

  function rankedRecommendations(pool, context = {}) {
    return pool
      .filter((offer) => context.includeBlack || offer.tier !== "BLACK TIER")
      .filter((offer) => context.includeTier4 || offer.tier !== "Tier 4")
      .map((offer) => ({ offer, score: recommendationScore(offer, context) }))
      .filter((item) => item.score > -9999)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.offer);
  }

  function topRecommendations(pool, context = {}) {
    return rankedRecommendations(pool, context)
      .slice(0, 5);
  }

  function whyRecommended(offer, context = {}) {
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    if (offer.recommendation) return offer.recommendation;
    const signals = [];
    if (language === "zh") {
      if (tierGroup(offer) === "Tier 1") signals.push("优先 Tier 1 offer");
      if (tierGroup(offer) === "Core Tier 2") signals.push("Tier 2 表现较强");
      if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} 个订单`);
      if (number(offer.conversionRate) >= 0.01) signals.push("CVR 健康");
      if (number(offer.epc) > 0.25) signals.push("EPC 可用");
      if (context.category && categoryMatches(offer, context.category)) signals.push("品类匹配");
      return signals.length ? signals.join("，") : "当前筛选结果中综合评分最高";
    }
    if (tierGroup(offer) === "Tier 1") signals.push("priority Tier 1 offer");
    if (tierGroup(offer) === "Core Tier 2") signals.push("strong Tier 2 performance");
    if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} orders`);
    if (number(offer.conversionRate) >= 0.01) signals.push("healthy CVR");
    if (number(offer.epc) > 0.25) signals.push("usable EPC");
    if (context.category && categoryMatches(offer, context.category)) signals.push("category fit");
    return signals.length ? signals.join(", ") : "best available score in the filtered set";
  }

  function contextFollowup(lower) {
    if (!state.lastOffer) return false;
    if (/^tier\s*[1-4]\b|^black\s*tier\b/.test(lower)) return false;
    if (/\b(it|its|this|that|the merchant|this merchant|that merchant)\b/.test(lower)) return true;
    return /^(epc|aov|orders?|order count|cvr|conversion|payment|paid|category|tier|commission|revenue|clicks?|dpv|atc)\b/.test(lower);
  }

  function setContext(context) {
    state.currentContext = context;
    renderContextPanel(context);
  }

  function buildRecommendationContext(items, filters = {}) {
    return { type: "recommendation", items, summary: aggregateRows(items), filters };
  }

  function buildMerchantContext(merchant) {
    state.lastOffer = merchant;
    state.lastRows = [merchant];
    return { type: "merchant", items: [merchant], summary: aggregateRows([merchant]), filters: {} };
  }

  function buildASINContext(asinResult) {
    const primary = asinResult.rows[0] || null;
    if (primary) {
      state.lastOffer = primary;
      state.lastRows = [primary];
    }
    return { type: "asin", items: asinResult.rows, summary: aggregateRows(asinResult.rows), filters: { asin: asinResult.asin, primary } };
  }

  function buildCategoryContext(category, rows) {
    state.lastRows = rows;
    return { type: "category", items: rows, summary: aggregateRows(rows), filters: { category } };
  }

  function buildTierContext(tier, rows) {
    state.lastRows = rows;
    return { type: "tier", items: rows, summary: aggregateRows(rows), filters: { tier } };
  }

  function buildPaymentContext(rows, prompt) {
    state.lastRows = rows;
    const summary = updatePaymentSummary(rows);
    summary.monthBreakdown = ["March", "April", "May", "June"].map((month) => monthStatus(month, rows));
    return { type: "payment", items: rows, summary, filters: { prompt } };
  }

  function monthStatus(month, rows) {
    const checkDate = calculatePaymentAvailabilityDate(month);
    const checkable = dateOnly(checkDate) ? PAYMENT_TODAY >= dateOnly(checkDate) : false;
    const monthRows = rows.filter((record) => record.reportMonth === month);
    const unpaid = monthRows.filter((record) => record.paymentStatus === "Unpaid").length;
    const paid = monthRows.filter((record) => record.paymentStatus === "Paid").length;
    const pending = monthRows.filter((record) => record.paymentStatus === "Pending").length;
    const remaining = monthRows.reduce((sum, record) => sum + number(record.remainingAmount), 0);
    return { month, checkDate, status: checkable ? "checkable" : "pending", unpaid, paid, pending, remaining };
  }

  function statCards(cards) {
    return `<div class="context-stats">${cards.map(([label, value]) => (
      `<div class="context-stat"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`
    )).join("")}</div>`;
  }

  function miniTable(rows, columns) {
    if (!rows.length) return `<p>${escapeHtml(t("context.noMatches", "No matching offers found."))}</p>`;
    return `<div class="mini-table-wrap"><table class="mini-table">
      <thead><tr>${columns.map((col) => `<th>${escapeHtml(labelText(col.label))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((col) => `<td>${col.render(row)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  const contextColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Highlight", render: (o) => escapeHtml(highlightStatus(o)) },
    { label: "Category", render: (o) => escapeHtml(o.category || "Uncategorized") },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "CVR", render: (o) => shortPct(o.conversionRate) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Commission", render: (o) => shortMoney(o.affCommission) },
    { label: "Payment", render: (o) => escapeHtml(o.paymentStatus || "not available") },
    { label: "Action", render: (o) => escapeHtml(recommendedAction(o)) }
  ];

  function insightList(rows) {
    const bestEpc = bestBy(rows, "epc");
    const bestCvr = bestBy(rows, "conversionRate");
    const bestRevenue = bestBy(rows, "salesAmount");
    const bestCommission = bestBy(rows, "affCommission");
    const paymentRisk = rows.find(hasPaymentRisk);
    const cautionOffer = rows.find((offer) => /caution|monitor|retest|selected/i.test(recommendedAction(offer))) || rows.find((offer) => number(offer.conversionRate) < 0.01);
    const items = [
      ["Best by EPC", bestEpc ? `${bestEpc.brand} (${shortEpc(bestEpc.epc)})` : "not available in current data"],
      ["Best by CVR", bestCvr ? `${bestCvr.brand} (${shortPct(bestCvr.conversionRate)})` : "not available in current data"],
      ["Highest revenue", bestRevenue ? `${bestRevenue.brand} (${shortMoney(bestRevenue.salesAmount)})` : "not available in current data"],
      ["Highest commission", bestCommission ? `${bestCommission.brand} (${shortMoney(bestCommission.affCommission)})` : "not available in current data"],
      ["Payment risk", paymentRisk ? `${paymentRisk.brand}: ${paymentRisk.paymentStatus}` : "None in this result"],
      ["Needs caution", cautionOffer ? `${cautionOffer.brand}: ${caution(cautionOffer)}` : "None flagged"]
    ];
    return `<div class="insight-list">${items.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}</div>`;
  }

  function renderRecommendationStats(context) {
    const rows = context.items;
    const s = context.summary;
    const tierText = Object.entries(s.tierBreakdown).map(([tier, count]) => `${tier}: ${count}`).join(", ") || "not available";
    const tier2Text = Object.entries(s.tier2Breakdown).map(([status, count]) => `${status}: ${count}`).join(", ");
    return statCards([
      ["Offers", String(s.totalOffers)],
      ["Revenue made", shortMoney(s.totalRevenue)],
      ["Commission made", shortMoney(s.totalCommission)],
      ["Orders", countValue(s.totalOrders)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    `<div class="context-note"><strong>Tier breakdown:</strong> ${escapeHtml(tierText)}${tier2Text ? `<br><strong>Tier 2 highlights:</strong> ${escapeHtml(tier2Text)}` : ""}</div>` +
    miniTable(rows, contextColumns) +
    insightList(rows);
  }

  function renderMerchantStats(offer) {
    return `<div class="merchant-focus">
      <h4>${escapeHtml(offer.brand || "Merchant")}</h4>
      ${statCards([
        ["Merchant ID", textValue(offer.merchantId)],
        ["Tier", tierGroup(offer)],
        ["Network", textValue(offer.network)],
        ["Category", textValue(offer.category)],
        ["AOV", money(offer.aov)],
        ["EPC", epc(offer.epc)],
        ["CVR", pct(offer.conversionRate)],
        ["Revenue made", money(offer.salesAmount)],
        ["Commission made", money(offer.affCommission)],
        ["Orders", countValue(offer.orders)],
        ["Clicks", countValue(offer.clicks)],
        ["DPV", countValue(offer.dpv)],
        ["ATC", countValue(offer.atc)],
        ["Commission rate", pct(offer.commissionRate)],
        ["Payment", textValue(offer.paymentStatus)],
        ["Link status", textValue(offer.linkStatus || offer.recommendedLink)]
      ])}
      <div class="context-note">
        <strong>CPC:</strong> ${escapeHtml(textValue(offer.cpc))}<br>
        <strong>Discount/deal:</strong> ${escapeHtml(textValue(offer.dealInfo || offer.discountInfo))}<br>
        <strong>Payment by month:</strong> ${escapeHtml(paymentByMonthText(offer))}<br>
        <strong>Recommended action:</strong> ${escapeHtml(recommendedAction(offer))}<br>
        <strong>Notes:</strong> ${escapeHtml(textValue(offer.recommendation || offer.reason))}
      </div>
    </div>`;
  }

  function renderASINStats(context) {
    const asin = context.filters.asin;
    const primary = context.filters.primary;
    if (!primary) return `<p>ASIN <strong>${escapeHtml(asin)}</strong> was not found in the current data.</p>`;
    return `<div class="context-note">
      <strong>ASIN:</strong> ${escapeHtml(asin)}<br>
      <strong>Product name:</strong> not available in current data<br>
      <strong>Product URL:</strong> not available in current data<br>
      <strong>Deal price:</strong> not available in current data<br>
      <strong>Original price:</strong> not available in current data<br>
      <strong>Discount %:</strong> not available in current data<br>
      ASIN-level performance is not available. Showing merchant-level performance instead.
    </div>${renderMerchantStats(primary)}`;
  }

  function renderPaymentStats(context) {
    const rows = context.items;
    const s = context.summary;
    const followUp = rows
      .filter((record) => record.paymentStatus === "Unpaid" || record.paymentStatus === "Partial")
      .sort((a, b) => paymentStatusRank(a.paymentStatus) - paymentStatusRank(b.paymentStatus))
      .slice(0, 8)
      .map((record) => `${record.merchantName} ${optionText(record.reportMonth)} (${statusText(record.paymentStatus)})`)
      .join(", ") || t("payment.none", "None");
    const months = s.monthBreakdown.map((item) => (
      `<p><strong>${escapeHtml(optionText(item.month))}:</strong> ${escapeHtml(t(`payment.${item.status}`, item.status))} ${escapeHtml(item.checkDate)}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${item.unpaid}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${item.pending}</p>`
    )).join("");
    return statCards([
      ["Revenue made", shortMoney(s.totalRevenueMade)],
      ["Commission made", shortMoney(s.totalCommissionMade)],
      ["Unpaid merchants", String(s.unpaidMerchantCount)],
      ["Pending merchants", String(s.pendingMerchantCount)],
      ["Overdue rows", String(s.overdueCount)]
    ]) +
    `<div class="insight-list">${months}</div>` +
    `<div class="context-note"><strong>${escapeHtml(t("payment.followup", "Merchants needing follow-up"))}:</strong> ${escapeHtml(followUp)}</div>` +
    miniTable(rows.slice(0, 20), [
      { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
      { label: "Month", render: (o) => escapeHtml(`${optionText(o.reportMonth)} ${o.reportYear}`) },
      { label: "Status", render: (o) => escapeHtml(statusText(o.paymentStatus || "Unknown")) },
      { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
      { label: "Revenue", render: (o) => shortMoney(o.revenueMade) },
      { label: "Commission made", render: (o) => shortMoney(o.commissionMade) },
      { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
      { label: "Available", render: (o) => escapeHtml(o.paymentAvailabilityDate || "not available") }
    ]);
  }

  function renderCategoryStats(context) {
    const rows = context.items;
    const top = topRecommendations(rows, { category: context.filters.category });
    const s = aggregateRows(rows);
    return statCards([
      ["Offers in category", String(rows.length)],
      ["Revenue", shortMoney(s.totalRevenue)],
      ["Commission", shortMoney(s.totalCommission)],
      ["Average AOV", shortMoney(s.avgAov)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    `<div class="context-note"><strong>Best traffic angle:</strong> ${escapeHtml(top[0] ? bestAngle(top[0], { category: context.filters.category }) : "not available in current data")}</div>` +
    miniTable(top, contextColumns.slice(0, 9)) +
    insightList(top);
  }

  function renderContextPanel(context) {
    const query = state.currentQuery ? `${t("context.basedOn", "Based on:")} ${state.currentQuery}` : t("context.generalFiltered", "General filtered view");
    const titles = {
      default: [t("context.defaultTitle", "Context Overview"), t("context.defaultSubtitle", "General offer snapshot")],
      recommendation: [t("context.recommendationTitle", "Recommendation Overview"), query],
      merchant: [t("context.merchantTitle", "Merchant Statistics"), query],
      asin: [t("context.asinTitle", "ASIN Statistics"), query],
      category: [t("context.categoryTitle", "Category Overview"), query],
      tier: [t("context.tierTitle", "Tier Overview"), query],
      payment: [t("context.paymentTitle", "Payment Overview"), query]
    };
    const [title, subtitle] = titles[context.type] || titles.default;
    els.contextTitle.textContent = title;
    els.contextSubtitle.textContent = subtitle;

    if (context.type === "merchant") {
      els.recBox.innerHTML = renderMerchantStats(context.items[0]);
    } else if (context.type === "asin") {
      els.recBox.innerHTML = renderASINStats(context);
    } else if (context.type === "payment") {
      els.recBox.innerHTML = renderPaymentStats(context);
    } else if (context.type === "category") {
      els.recBox.innerHTML = renderCategoryStats(context);
    } else if (context.type === "tier") {
      els.recBox.innerHTML = renderRecommendationStats(buildRecommendationContext(topRecommendations(context.items, { includeTier4: true, includeBlack: true }), context.filters));
    } else if (context.type === "recommendation") {
      els.recBox.innerHTML = renderRecommendationStats(context);
    } else {
      const rows = getFiltered();
      const top = topRecommendations(rows, {});
      els.recBox.innerHTML = renderRecommendationStats(buildRecommendationContext(top, {}));
    }
    renderContextChart(context.items.length ? context.items : getFiltered(), context.type);
  }

  function renderContextChart(rows, contextType) {
    const canvas = els.chart;
    if (contextType === "payment") {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfcfc";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#dce3e7";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(42, 18 + ((h - 50) * i) / 4);
      ctx.lineTo(w - 18, 18 + ((h - 50) * i) / 4);
      ctx.stroke();
    }
    ctx.fillStyle = "#687277";
    ctx.font = "12px system-ui";
    ctx.fillText("CVR", 10, 18);
    ctx.fillText("EPC", w - 44, h - 10);

    const limit = contextType === "default" ? 120 : 60;
    const sample = rows.filter((offer) => number(offer.epc) > 0 || number(offer.conversionRate) > 0).slice(0, limit);
    const maxEpc = Math.max(0.2, ...sample.map((offer) => number(offer.epc)));
    const maxCvr = Math.max(0.02, ...sample.map((offer) => number(offer.conversionRate)));
    sample.forEach((offer) => {
      const x = 42 + (Math.min(number(offer.epc), maxEpc) / maxEpc) * (w - 66);
      const y = h - 32 - (Math.min(number(offer.conversionRate), maxCvr) / maxCvr) * (h - 58);
      ctx.beginPath();
      ctx.fillStyle = hasPaymentRisk(offer) ? "rgba(185,75,95,.78)" : offer.tier === "Tier 1" ? "rgba(23,123,115,.78)" : "rgba(49,95,155,.62)";
      ctx.arc(x, y, contextType === "merchant" || contextType === "recommendation" ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function paymentByMonthText(offer) {
    const paid = offer.paidInvoiceMonths || [];
    const unpaid = offer.paymentRiskMonths || [];
    const parts = [];
    if (paid.length) parts.push(`Paid: ${paid.join(", ")}`);
    if (unpaid.length) parts.push(`Unpaid: ${unpaid.join(", ")}`);
    return parts.length ? parts.join("; ") : "not available in current data";
  }

  function fieldRows(offer, language = state.language) {
    const notAvailable = language === "zh" ? chatCopy(language).notAvailable : "not available in current data";
    return [
      ["Merchant ID", textValue(offer.merchantId)],
      ["Merchant name", textValue(offer.brand)],
      ["Tier", textValue(tierGroup(offer))],
      ["Category", textValue(offer.category)],
      ["Network", textValue(offer.network)],
      ["AOV", money(offer.aov)],
      ["EPC", epc(offer.epc)],
      ["CPC", textValue(offer.cpc)],
      ["Clicks", countValue(offer.clicks)],
      ["DPV", countValue(offer.dpv)],
      ["ATC", countValue(offer.atc)],
      ["Order count", countValue(offer.orders)],
      ["Revenue", money(offer.salesAmount)],
      ["Conversion rate", pct(offer.conversionRate)],
      ["Commission", money(offer.affCommission)],
      ["Commission rate", pct(offer.commissionRate)],
      ["Discount/deal info", textValue(offer.dealInfo || offer.discountInfo)],
      ["Top ASINs", offer.topAsins && offer.topAsins.length ? offer.topAsins.slice(0, 8).join(", ") : notAvailable],
      ["Payment status", textValue(offer.paymentStatus)],
      ["Payment cycle", offer.paymentCycle ? `${offer.paymentCycle} days` : notAvailable],
      ["Link status", textValue(offer.linkStatus || offer.recommendedLink)],
      ["Recommended action", recommendedAction(offer, language)],
      ["Notes / recommendation", textValue(offer.recommendation || offer.reason)]
    ];
  }

  function merchantOverview(offer, extra = "", language = responseLanguageFor()) {
    setContext(buildMerchantContext(offer));
    return merchantOverviewHtml(offer, extra, language);
  }

  function merchantOverviewHtml(offer, extra = "", language = responseLanguageFor()) {
    const rows = fieldRows(offer, language)
      .map(([label, value]) => `<li><strong>${escapeHtml(chatLabelText(label, language))}:</strong> ${escapeHtml(value)}</li>`)
      .join("");
    return `<div class="merchant-card"><h4>${escapeHtml(offer.brand || chatCopy(language).merchantOverview || "Merchant")} ${extra}</h4><ul>${rows}</ul></div>`;
  }

  function resultTable(rows, columns, language = state.language) {
    if (!rows.length) return `<p>${escapeHtml(language === "zh" ? chatCopy(language).noMatches : t("context.noMatches", "No matching offers found."))}</p>`;
    return `<div class="result-table-wrap"><table class="result-table">
      <thead><tr>${columns.map((col) => `<th>${escapeHtml(chatLabelText(col.label, language))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((col) => `<td>${col.render(row)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  const compactColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Category", render: (o) => escapeHtml(o.category || "Uncategorized") },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "CVR", render: (o) => shortPct(o.conversionRate) },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Payment", render: (o) => escapeHtml(o.paymentStatus || "not available") }
  ];

  const paymentColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
    { label: "Month", render: (o) => escapeHtml(`${optionText(o.reportMonth)} ${o.reportYear}`) },
    { label: "Status", render: (o) => escapeHtml(statusText(o.paymentStatus || "Unknown")) },
    { label: "Revenue made", render: (o) => shortMoney(o.revenueMade) },
    { label: "Commission made", render: (o) => shortMoney(o.commissionMade) },
    { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
    { label: "Available", render: (o) => escapeHtml(o.paymentAvailabilityDate || "not available") },
    { label: "Notes", render: (o) => escapeHtml(o.notes || "not available") }
  ];

  function chatStatusText(value, language) {
    if (language !== "zh") return statusText(value);
    const map = { Paid: "已付款", Unpaid: "未付款", Pending: "待处理", Partial: "部分付款", Unknown: "未知" };
    return map[value] || value || "未知";
  }

  function chatMonthText(value, language) {
    if (language !== "zh") return optionText(value);
    const map = { March: "三月", April: "四月", May: "五月", June: "六月" };
    return map[value] || value || "";
  }

  function chatPaymentNoteText(value, language) {
    if (language !== "zh") return value || "not available";
    const text = String(value || "");
    if (/Payment is due and needs follow-up/i.test(text)) return "付款已到期，需要跟进。";
    if (/Payment confirmed by Levanta/i.test(text)) return "Levanta 已确认付款。";
    if (/Partial payment/i.test(text)) return "已记录部分付款，需要跟进剩余金额。";
    if (/Payment is not due yet|Payment not due/i.test(text)) return "付款尚未到检查时间。";
    return text || "当前数据不可用";
  }

  function paymentColumnsFor(language) {
    if (language !== "zh") return paymentColumns;
    return [
      { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
      { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
      { label: "Month", render: (o) => escapeHtml(`${chatMonthText(o.reportMonth, language)} ${o.reportYear}`) },
      { label: "Status", render: (o) => escapeHtml(chatStatusText(o.paymentStatus || "Unknown", language)) },
      { label: "Revenue made", render: (o) => shortMoney(o.revenueMade) },
      { label: "Commission made", render: (o) => shortMoney(o.commissionMade) },
      { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
      { label: "Available", render: (o) => escapeHtml(o.paymentAvailabilityDate || "not available") },
      { label: "Notes", render: (o) => escapeHtml(chatPaymentNoteText(o.notes, language)) }
    ];
  }

  function paymentStatusRank(status) {
    const ranks = { Unpaid: 1, Partial: 2, Unknown: 3, Pending: 4, Paid: 5 };
    return ranks[status] || 9;
  }

  function sortPaymentRows(rows) {
    return rows.slice().sort((a, b) => (
      paymentStatusRank(a.paymentStatus) - paymentStatusRank(b.paymentStatus) ||
      number(b.remainingAmount) - number(a.remainingAmount) ||
      String(b.reportMonthKey).localeCompare(String(a.reportMonthKey))
    ));
  }

  function findPaymentMerchantMatches(query) {
    const cleaned = query
      .replace(/\b(what|is|are|the|payment|payments|cycle|for|merchant|paid|unpaid|status|of|this|that|issue|issues|does|have|has|already|which|offers|with|show|all|late|pending|partial|unknown|remaining|expected|commission|revenue|march|april|may|june|july|august|report|month|in|on|not)\b/gi, " ")
      .trim();
    if (cleaned.length < 3) return [];
    const merchants = Array.from(new Map(getPaymentRecords().map((record) => [
      record.merchantId || normalize(record.merchantName),
      { brand: record.merchantName, merchantId: record.merchantId, category: record.category, network: record.network }
    ])).values());
    return merchants
      .map((merchant) => ({ merchant, score: fuzzyScore(cleaned, merchant) }))
      .filter((item) => item.score >= 45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  function closestMatchesHtml(matches, query) {
    const language = responseLanguageFor(query);
    const copy = chatCopy(language);
    if (!matches.length) {
      setContext({ type: "default", items: getFiltered().slice(0, 80), summary: {}, filters: {} });
      if (language === "zh") return `${escapeHtml(copy.notFoundPrefix)} <strong>${escapeHtml(query)}</strong>。${escapeHtml(copy.tryLookup)}`;
      return `I could not find <strong>${escapeHtml(query)}</strong>. Try merchant ID, ASIN, or category.`;
    }
    const rows = matches.map((item) => item.offer);
    state.lastRows = rows;
    setContext(buildCategoryContext("closest matches", rows));
    if (language === "zh") return `${escapeHtml(copy.closeMatches)}<br>${resultTable(rows, compactColumns.slice(0, 5), language)}`;
    return `I found multiple close merchant matches. Which one do you mean?<br>${resultTable(rows, compactColumns.slice(0, 5), language)}`;
  }

  function requestedRecommendationCount(prompt, fallback = 5) {
    const text = String(prompt || "");
    if (chatbotI18n.requestedRecommendationCount) {
      const requested = chatbotI18n.requestedRecommendationCount(text, fallback, MAX_RECOMMENDATION_EXPORT);
      if (requested !== fallback) return requested;
    }
    const patterns = [
      /\b(?:top|give|show|list|export|download)\s+(\d{1,4})\b/i,
      /\b(\d{1,4})\s+(?:offers?|brands?|recommendations?)\b/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const before = text.slice(Math.max(0, match.index - 8), match.index);
      if (/tier\s*$/i.test(before)) continue;
      const requested = Number(match[1]);
      if (Number.isFinite(requested) && requested > 0) {
        return Math.min(Math.max(Math.floor(requested), 1), MAX_RECOMMENDATION_EXPORT);
      }
    }
    return fallback;
  }

  function recommendationHtml(rows, context = {}) {
    const language = responseLanguageFor(context.prompt || state.currentQuery);
    const copy = chatCopy(language);
    const localizedContext = { ...context, language };
    const requestedCount = number(context.requestedCount) || 5;
    const ranked = rankedRecommendations(rows, localizedContext);
    const exportRows = ranked.slice(0, requestedCount);
    const top = exportRows.slice(0, 5);
    setContext(buildRecommendationContext(top, { ...localizedContext, requestedCount, exportCount: exportRows.length }));
    if (!top.length) return language === "zh" ? copy.recommendationEmpty : "I found no offers that fit this recommendation request with the current filters.";
    const label = language === "zh"
      ? context.category ? `（${escapeHtml(context.category)}）` : context.tier ? `（${escapeHtml(context.tier)}）` : ""
      : context.category ? ` for ${escapeHtml(context.category)}` : context.tier ? ` from ${escapeHtml(context.tier)}` : "";
    const downloadId = registerRecommendationDownload(exportRows, localizedContext, requestedCount);
    const exportNote = language === "zh"
      ? exportRows.length < requestedCount
        ? chatFormat(copy.exportPartial, { count: exportRows.length.toLocaleString() })
        : chatFormat(copy.exportComplete, { count: exportRows.length.toLocaleString() })
      : exportRows.length < requestedCount
        ? `I found ${exportRows.length.toLocaleString()} offers that fit.`
        : `The Excel download includes all ${exportRows.length.toLocaleString()} requested offers.`;
    const previewTitle = language === "zh" ? copy.recommendationPreview : "Recommendation preview";
    const showingText = language === "zh"
      ? chatFormat(copy.showingTop, { count: top.length.toLocaleString() })
      : `showing the top ${top.length.toLocaleString()} here so the chat stays readable.`;
    return `<p><strong>${escapeHtml(previewTitle)}${label}:</strong> ${escapeHtml(showingText)} ${escapeHtml(exportNote)}</p>` +
      `<div class="download-card">
        <div>
          <strong>${escapeHtml(language === "zh" ? copy.fullRecommendationFile : "Full recommendation file")}</strong>
          <span>${escapeHtml(language === "zh" ? `${exportRows.length.toLocaleString()} 个 offer，${copy.rankedBy}` : `${exportRows.length.toLocaleString()} offers ranked by tier, EPC, CVR, revenue, ATC, DPV, and payment risk.`)}</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">${escapeHtml(language === "zh" ? copy.downloadExcel : "Download Excel")}</button>
      </div>` +
      top.map((offer, index) => `<div class="recommendation-answer">
        <strong>${index + 1}. ${escapeHtml(offer.brand || "")}</strong> - ${escapeHtml(tierGroup(offer))}
        <ul>
          <li><strong>${escapeHtml(language === "zh" ? copy.merchantId : "Merchant ID")}:</strong> ${escapeHtml(offer.merchantId || (language === "zh" ? copy.notAvailable : "not available"))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.keyMetrics : "Key metrics")}:</strong> AOV ${shortMoney(offer.aov)}, EPC ${shortEpc(offer.epc)}, clicks ${number(offer.clicks).toLocaleString()}, orders ${number(offer.orders).toLocaleString()}, CVR ${shortPct(offer.conversionRate)}, revenue ${shortMoney(offer.salesAmount)}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.whyRecommended : "Why recommended")}:</strong> ${escapeHtml(whyRecommended(offer, localizedContext))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.bestTrafficAngle : "Best traffic angle")}:</strong> ${escapeHtml(bestAngle(offer, localizedContext))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.cautionNextStep : "Caution / next step")}:</strong> ${escapeHtml(caution(offer, language))}</li>
        </ul>
      </div>`).join("");
  }

  function paymentAnswer(prompt) {
    const lower = prompt.toLowerCase();
    const language = responseLanguageFor(prompt);
    const copy = chatCopy(language);
    const month = monthNameFromText(prompt);
    const tier = tierFromPrompt(prompt);
    const merchantMatches = findPaymentMerchantMatches(prompt);
    let rows = getPaymentRecords();

    if (merchantMatches.length) {
      const merchant = merchantMatches[0].merchant;
      rows = getPaymentByMerchant(merchant.merchantId || merchant.brand);
      if (month) rows = rows.filter((record) => record.reportMonth === month);
      rows = sortPaymentRows(rows);
      setContext(buildPaymentContext(rows, prompt));
      const s = updatePaymentSummary(rows);
      const cycle = rows.find((record) => record.paymentCycle);
      const title = `${merchant.brand}${month ? ` - ${month}` : ""}`;
      const cycleText = cycle ? `${cycle.paymentCycle} days` : language === "zh" ? copy.notAvailable : t("payment.notAvailable", "not available in current data");
      if (language === "zh") {
        return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(copy.paymentSummary)}: ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。${escapeHtml(copy.paymentCycle)}：${escapeHtml(cycleText)}。</p>` +
          resultTable(rows, paymentColumnsFor(language), language);
      }
      return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(t("payment.summary", "payment summary"))}: ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}. ${escapeHtml(t("payment.cycle", "payment cycle"))}: ${escapeHtml(cycleText)}.</p>` +
        resultTable(rows, paymentColumnsFor(language), language);
    }

    if (month) rows = rows.filter((record) => record.reportMonth === month);
    if (tier) rows = rows.filter((record) => record.tier === tier);
    if (/unpaid|issue|late|not paid|overdue|due|未付款|没付款|逾期|到期|欠款|问题/.test(lower)) rows = rows.filter((record) => record.paymentStatus === "Unpaid" || isPaymentOverdue(record));
    else if (/partial|部分付款/.test(lower)) rows = rows.filter((record) => record.paymentStatus === "Partial");
    else if (/pending|not available yet|before due|待处理|未到|还没到/.test(lower)) rows = rows.filter((record) => record.paymentStatus === "Pending");
    else if (/already paid|\bpaid\b|已付款/.test(lower)) rows = rows.filter((record) => record.paymentStatus === "Paid");
    else rows = rows.filter((record) => record.paymentStatus !== "Paid" || /all|summary|overview/.test(lower));

    rows = sortPaymentRows(rows).slice(0, 60);
    setContext(buildPaymentContext(rows, prompt));
    const s = updatePaymentSummary(rows);
    const label = month ? `${month} payment records` : "Payment records";
    if (language === "zh") {
      const title = month ? `${month} ${copy.paymentRecords}` : copy.paymentRecords;
      return `<p><strong>${escapeHtml(title)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。</p>` +
        resultTable(rows, paymentColumnsFor(language), language);
    }
    return `<p><strong>${escapeHtml(state.language === "zh" ? `${optionText(month || "") || t("payments.records", "Payment records")}` : label)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}.</p>` +
      resultTable(rows, paymentColumnsFor(language), language);
  }

  function asinAnswer(result) {
    const language = responseLanguageFor();
    const copy = chatCopy(language);
    setContext(buildASINContext(result));
    if (!result.rows.length) return language === "zh"
      ? `ASIN <strong>${escapeHtml(result.asin)}</strong> ${escapeHtml(copy.asinNotFound)}`
      : `ASIN <strong>${escapeHtml(result.asin)}</strong> was not found in the current data.`;
    const primary = result.rows[0];
    if (language === "zh") {
      return `ASIN <strong>${escapeHtml(result.asin)}</strong> ${escapeHtml(copy.asinBelongsTo)}<br>${merchantOverviewHtml(primary, "(ASIN match)", language)}
        <p><strong>${escapeHtml(copy.productAsinInfo)}:</strong> ${escapeHtml(primary.asinsText || result.asin)}</p>
        <p><strong>${escapeHtml(copy.recommendedTrafficAngle)}:</strong> ${escapeHtml(bestAngle(primary, { language }))}</p>`;
    }
    return `ASIN <strong>${escapeHtml(result.asin)}</strong> belongs to:<br>${merchantOverviewHtml(primary, "(ASIN match)", language)}
      <p><strong>Product/ASIN info:</strong> ${escapeHtml(primary.asinsText || result.asin)}</p>
      <p><strong>Recommended traffic angle:</strong> ${escapeHtml(bestAngle(primary, { language }))}</p>`;
  }

  function answerPrompt(prompt) {
    state.currentQuery = prompt;
    const lower = prompt.toLowerCase().trim();
    const language = responseLanguageFor(prompt);
    const copy = chatCopy(language);
    const intent = detectQueryIntent(prompt);
    const asin = findByAsin(prompt);
    if (asin && intent === "asin") return asinAnswer(asin);

    const exact = findByMerchantId(prompt);
    if (exact) return merchantOverview(exact, "", language);

    if (contextFollowup(lower)) {
      if (promptHasPaymentTerms(lower)) {
        return paymentAnswer(`${state.lastOffer.brand} ${prompt}`);
      }
      if (/epc/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.epcIs)} ${epc(state.lastOffer.epc)}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> EPC is ${epc(state.lastOffer.epc)}.`;
      }
      if (/aov/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.aovIs)} ${money(state.lastOffer.aov)}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> AOV is ${money(state.lastOffer.aov)}.`;
      }
      if (/order|订单/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.orderCountIs)} ${number(state.lastOffer.orders).toLocaleString()}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> order count is ${number(state.lastOffer.orders).toLocaleString()}.`;
      }
      return merchantOverview(state.lastOffer, "", language);
    }

    const category = categoryForPrompt(prompt);
    const tier = tierFromPrompt(prompt);
    const wantsTier4 = /tier 4|retest|四层|四级|第4层|第4级/i.test(prompt);
    const wantsBlack = /black|blocked|黑名单|黑层/i.test(prompt);
    const wantsRecommendation = intent === "recommendation";
    const wantsGoogle = /google|keyword|brand keyword|search/.test(lower);

    if (intent === "payment") {
      return paymentAnswer(prompt);
    }

    if (wantsRecommendation) {
      let pool = category ? sortedForCategory(category, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt, tier }) : offers;
      if (tier) pool = pool.filter((offer) => offer.tier === tier);
      return recommendationHtml(pool, { category, tier, google: wantsGoogle, includeTier4: wantsTier4, includeBlack: wantsBlack, requestedCount: requestedRecommendationCount(prompt), prompt });
    }

    if (tier) {
      const rows = offers
        .filter((offer) => offer.tier === tier)
        .filter((offer) => wantsTier4 || offer.tier !== "Tier 4" || tier === "Tier 4")
        .filter((offer) => wantsBlack || offer.tier !== "BLACK TIER" || tier === "BLACK TIER")
        .sort((a, b) => recommendationScore(b, { includeTier4: true, includeBlack: true }) - recommendationScore(a, { includeTier4: true, includeBlack: true }));
      setContext(buildTierContext(tier, rows));
      if (language === "zh") return `${escapeHtml(tier)} ${escapeHtml(copy.tierOverview)}<br>${resultTable(topRecommendations(rows, { tier, includeTier4: true, includeBlack: true, language }), compactColumns, language)}`;
      return `${escapeHtml(tier)} overview and top candidates:<br>${resultTable(topRecommendations(rows, { tier, includeTier4: true, includeBlack: true }), compactColumns, language)}`;
    }

    if (category) {
      const rows = sortedForCategory(category, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt }).slice(0, 40);
      setContext(buildCategoryContext(category, rows));
      if (language === "zh") return `<strong>${escapeHtml(category)}</strong> ${escapeHtml(copy.categoryOffers)}<br>${resultTable(rows.slice(0, 25), compactColumns, language)}`;
      return `Relevant <strong>${escapeHtml(category)}</strong> offers, sorted by tier priority and performance:<br>${resultTable(rows.slice(0, 25), compactColumns, language)}`;
    }

    if (/high epc|high aov|low conversion|low cvr|tracking issue|has asin|discount/.test(lower)) {
      const rows = offers
        .filter((offer) => !/tracking issue/.test(lower) || offer.trackingIssue)
        .filter((offer) => !/has asin/.test(lower) || offer.hasAsin)
        .filter((offer) => !/discount/.test(lower) || offer.hasDiscount)
        .sort((a, b) => {
          if (/low conversion|low cvr/.test(lower)) return number(a.conversionRate) - number(b.conversionRate);
          if (/high aov/.test(lower)) return number(b.aov) - number(a.aov);
          return number(b.epc) - number(a.epc);
        })
        .slice(0, 30);
      setContext(buildCategoryContext("filtered result", rows));
      return resultTable(rows, compactColumns, language);
    }

    if (lower.length < 3 || /^(help|hello|hi|what can you do)\??$/.test(lower) || /帮助|你好|能做什么/.test(prompt)) {
      setContext({ type: "default", items: getFiltered().slice(0, 80), summary: {}, filters: {} });
      return language === "zh" ? copy.help : "What do you want to look up: merchant name, merchant ID, ASIN, category, payment status, or recommendations?";
    }

    const matches = findMerchantMatches(prompt);
    if (matches.length === 1 || (matches[0] && matches[0].adjusted >= 95 && (!matches[1] || matches[0].adjusted - matches[1].adjusted > 10))) {
      return merchantOverview(matches[0].offer, "", language);
    }
    return closestMatchesHtml(matches, prompt);
  }

  function addMessage(role, html) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;
    msg.innerHTML = html;
    els.chatLog.appendChild(msg);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function applyPrompt(prompt) {
    addMessage("user", escapeHtml(prompt));
    addMessage("assistant", answerPrompt(prompt));
  }

  function renderMetrics(rows) {
    const s = aggregateRows(rows);
    const cards = [
      ["Offers", rows.length.toLocaleString()],
      ["Revenue", shortMoney(s.totalRevenue)],
      ["Commission EPC", shortEpc(s.blendedEpc)],
      ["AOV", shortMoney(s.avgAov)],
      ["CVR", shortPct(s.avgCvr)],
      ["Unpaid risk", s.paymentRiskCount.toLocaleString()]
    ];
    els.metrics.innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function renderTable(rows) {
    els.tableCount.textContent = `${rows.length.toLocaleString()} ${t("table.offerCount", "matching offers")}`;
    els.table.innerHTML = rows.slice(0, 80).map((offer) => {
      const paidClass = hasPaymentRisk(offer) ? "unpaid" : hasPaidSignal(offer) ? "paid" : "neutral";
      return `<tr>
        <td><strong>${escapeHtml(offer.brand || "")}</strong><p>${escapeHtml(offer.merchantId || "")}</p></td>
        <td><span class="badge tier">${escapeHtml(tierGroup(offer))}</span></td>
        <td>${escapeHtml(offer.network || "")}</td>
        <td>${escapeHtml(offer.category || "Uncategorized")}</td>
        <td>${shortEpc(offer.epc)}</td>
        <td>${shortMoney(offer.aov)}</td>
        <td>${shortPct(offer.conversionRate)}</td>
        <td>${number(offer.orders).toLocaleString()}</td>
        <td><span class="badge ${paidClass}">${escapeHtml(offer.paymentStatus || "not available")}</span></td>
      </tr>`;
    }).join("");
  }

  function renderAll(rows = getFiltered()) {
    renderMetrics(rows);
    renderTable(rows);
    if (state.currentContext.type === "default") {
      setContext({ type: "default", items: rows.slice(0, 120), summary: aggregateRows(rows), filters: {} });
    }
  }

  function syncControls() {
    els.tier.value = state.tier;
    els.network.value = state.network;
    els.category.value = state.category;
    els.minEpc.value = state.minEpc;
    els.minAov.value = state.minAov;
    els.minCvr.value = state.minCvr;
    els.notPaidOnly.checked = state.notPaidOnly;
    document.querySelectorAll(".sort-button").forEach((button) => button.classList.toggle("active", button.dataset.sort === state.sort));
  }

  function resetFilters() {
    Object.assign(state, { tier: "all", network: "all", category: "all", minEpc: "", minAov: "", minCvr: "", notPaidOnly: false, sort: "epc", descending: true });
    state.currentContext = { type: "default", items: [], summary: {}, filters: {} };
    syncControls();
    renderAll();
  }

  function downloadFilteredCsv() {
    const rows = getFiltered();
    const columns = ["brand", "merchantId", "tier", "network", "category", "epc", "aov", "conversionRate", "orders", "salesAmount", "affCommission", "paymentStatus", "paymentCycle", "recommendedLink", "topAsins"];
    const csv = [columns.join(",")]
      .concat(rows.map((offer) => columns.map((col) => `"${String(Array.isArray(offer[col]) ? offer[col].join(" ") : offer[col] ?? "").replace(/"/g, '""')}"`).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filtered_offers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function safeFilePart(value) {
    const text = String(value || "recommendations").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return text || "recommendations";
  }

  function registerRecommendationDownload(rows, context = {}, requestedCount = rows.length) {
    const id = `recommendation-${++state.downloadSequence}`;
    const today = isoDate(PAYMENT_TODAY) || new Date().toISOString().slice(0, 10);
    const scope = context.category || context.tier || "top";
    state.recommendationDownloads[id] = {
      rows,
      context,
      requestedCount,
      filename: `offer_recommendations_${safeFilePart(scope)}_${rows.length}_offers_${today}.xlsx`
    };
    return id;
  }

  function recommendationExportColumns() {
    return [
      ["Rank", (offer, index) => index + 1],
      ["Brand", (offer) => offer.brand || ""],
      ["Merchant ID", (offer) => offer.merchantId || ""],
      ["Tier", (offer) => tierGroup(offer)],
      ["Network", (offer) => offer.network || ""],
      ["Category", (offer) => offer.category || "Uncategorized"],
      ["EPC", (offer) => number(offer.epc)],
      ["AOV", (offer) => number(offer.aov)],
      ["Conversion Rate", (offer) => number(offer.conversionRate)],
      ["Clicks", (offer) => number(offer.clicks)],
      ["DPV", (offer) => number(offer.dpv)],
      ["ATC", (offer) => number(offer.atc)],
      ["Orders", (offer) => number(offer.orders)],
      ["Revenue", (offer) => number(offer.salesAmount)],
      ["Commission", (offer) => number(offer.affCommission)],
      ["Payment Status", (offer) => offer.paymentStatus || ""],
      ["Payment Cycle", (offer) => offer.paymentCycle || ""],
      ["Recommended Link", (offer) => offer.recommendedLink || ""],
      ["Top ASINs", (offer) => Array.isArray(offer.topAsins) ? offer.topAsins.join(", ") : (offer.topAsins || offer.asinsText || "")],
      ["Recommended Action", (offer, index, context) => recommendedAction(offer, context.language || state.language)],
      ["Why Recommended", (offer, index, context) => whyRecommended(offer, context)],
      ["Best Traffic Angle", (offer, index, context) => bestAngle(offer, context)],
      ["Caution", (offer, index, context) => caution(offer, context.language || state.language)]
    ];
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
  }

  function columnName(index) {
    let name = "";
    let n = index + 1;
    while (n > 0) {
      const remainder = (n - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function worksheetXml(rows, context = {}) {
    const columns = recommendationExportColumns();
    const sheetRows = [
      columns.map(([header]) => header),
      ...rows.map((offer, index) => columns.map(([, getter]) => getter(offer, index, context)))
    ];
    const rowXml = sheetRows.map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const ref = `${columnName(colIndex)}${rowIndex + 1}`;
        if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const widths = columns.map(([, , width], index) => `<col min="${index + 1}" max="${index + 1}" width="${width || (index < 6 ? 18 : 14)}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${widths}</cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
  }

  function workbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Recommendations" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  }

  function workbookRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  function contentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function dosTimestamp() {
    const date = new Date();
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const { time, day } = dosTimestamp();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const checksum = crc32(dataBytes);
      const local = concatBytes([
        uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
        uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0),
        nameBytes, dataBytes
      ]);
      const central = concatBytes([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
        uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const centralDirectory = concatBytes(centrals);
    const end = concatBytes([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
      uint32(centralDirectory.length), uint32(offset), uint16(0)
    ]);
    return concatBytes([...locals, centralDirectory, end]);
  }

  function createRecommendationWorkbook(rows, context = {}) {
    return createZip([
      { name: "[Content_Types].xml", data: contentTypesXml() },
      { name: "_rels/.rels", data: rootRelsXml() },
      { name: "xl/workbook.xml", data: workbookXml() },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml() },
      { name: "xl/styles.xml", data: stylesXml() },
      { name: "xl/worksheets/sheet1.xml", data: worksheetXml(rows, context) }
    ]);
  }

  function downloadRecommendationXlsx(downloadId) {
    const item = state.recommendationDownloads[downloadId];
    if (!item || !item.rows || !item.rows.length) return;
    const workbook = createRecommendationWorkbook(item.rows, item.context);
    const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function paymentStatusClass(status) {
    const text = String(status || "").toLowerCase();
    if (text === "paid") return "paid";
    if (text === "unpaid") return "unpaid";
    if (text === "partial" || text === "pending") return "warn";
    return "neutral";
  }

  function uniquePaymentValues(key) {
    const base = paymentRecords.map((record) => record[key]).filter(Boolean);
    const values = key === "reportMonth" ? [...ACTIVE_PAYMENT_MONTHS, ...base] : base;
    return Array.from(new Set(values)).sort((a, b) => {
      if (key === "reportMonth") {
        const aIndex = PAYMENT_MONTHS.indexOf(a);
        const bIndex = PAYMENT_MONTHS.indexOf(b);
        return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
      }
      if (String(a).startsWith("Tier") && String(b).startsWith("Tier")) return String(a).localeCompare(String(b), undefined, { numeric: true });
      return String(a).localeCompare(String(b));
    });
  }

  function refreshPaymentFilterOptions() {
    replaceSelectOptions(els.paymentMonth, "All months", uniquePaymentValues("reportMonth"), state.payments.month);
    replaceSelectOptions(els.paymentNetwork, "All networks", uniquePaymentValues("network"), state.payments.network);
    replaceSelectOptions(els.paymentTier, "All tiers", uniquePaymentValues("tier"), state.payments.tier);
    replaceSelectOptions(els.paymentStatus, "All statuses", uniquePaymentValues("paymentStatus"), state.payments.status);
    state.payments.month = els.paymentMonth.value;
    state.payments.network = els.paymentNetwork.value;
    state.payments.tier = els.paymentTier.value;
    state.payments.status = els.paymentStatus.value;
  }

  function syncPaymentControls() {
    els.paymentMonth.value = state.payments.month;
    els.paymentNetwork.value = state.payments.network;
    els.paymentTier.value = state.payments.tier;
    els.paymentStatus.value = state.payments.status;
    els.paymentSearch.value = state.payments.search;
    els.paymentUnpaidOnly.checked = state.payments.unpaidOnly;
    els.paymentPendingOnly.checked = state.payments.pendingOnly;
    els.paymentOverdueOnly.checked = state.payments.overdueOnly;
  }

  function getFilteredPayments() {
    const search = normalize(state.payments.search);
    return sortPaymentRows(getPaymentRecords()
      .filter((record) => state.payments.month === "all" || record.reportMonth === state.payments.month || record.reportMonthKey === state.payments.month)
      .filter((record) => state.payments.network === "all" || record.network === state.payments.network)
      .filter((record) => state.payments.tier === "all" || record.tier === state.payments.tier)
      .filter((record) => state.payments.status === "all" || record.paymentStatus === state.payments.status)
      .filter((record) => !state.payments.unpaidOnly || record.paymentStatus === "Unpaid")
      .filter((record) => !state.payments.pendingOnly || record.paymentStatus === "Pending")
      .filter((record) => !state.payments.overdueOnly || isPaymentOverdue(record))
      .filter((record) => !search || normalize(`${record.merchantName} ${record.merchantId}`).includes(search)));
  }

  function renderPaymentSummary(rows) {
    const s = updatePaymentSummary(rows);
    const cards = [
      ["Records", s.recordCount.toLocaleString()],
      ["Merchants", s.merchantCount.toLocaleString()],
      ["Revenue made", shortMoney(s.totalRevenueMade)],
      ["Commission made", shortMoney(s.totalCommissionMade)],
      ["Unpaid merchants", s.unpaidMerchantCount.toLocaleString()],
      ["Pending merchants", s.pendingMerchantCount.toLocaleString()],
      ["Overdue rows", s.overdueCount.toLocaleString()]
    ];
    els.paymentSummary.innerHTML = cards.map(([label, value]) => `<div class="metric payment-metric"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function renderPaymentRows(rows) {
    els.paymentTableCount.textContent = `${rows.length.toLocaleString()} ${t("payment.tableCount", "matching payment records")}`;
    els.paymentRows.innerHTML = rows.map((record) => (
      `<tr data-merchant-id="${escapeHtml(record.merchantId || record.merchantName)}">
        <td>${escapeHtml(record.merchantId || "")}</td>
        <td><strong>${escapeHtml(record.merchantName || "")}</strong><p>${escapeHtml(record.category || "Uncategorized")}</p></td>
        <td>${escapeHtml(record.network || "")}</td>
        <td><span class="badge tier">${escapeHtml(record.tier || "Unknown")}</span></td>
        <td>${escapeHtml(`${optionText(record.reportMonth)} ${record.reportYear}`)}</td>
        <td><span class="badge ${paymentStatusClass(record.paymentStatus)}">${escapeHtml(statusText(record.paymentStatus || "Unknown"))}</span></td>
        <td>${shortMoney(record.revenueMade)}</td>
        <td>${shortMoney(record.commissionMade)}</td>
        <td>${escapeHtml(record.paymentCycle ? `${record.paymentCycle} days` : "-")}</td>
        <td>${escapeHtml(record.paymentAvailabilityDate || "-")}</td>
        <td>${escapeHtml(record.lastCheckedDate || "-")}</td>
        <td>${escapeHtml(record.notes || "-")}</td>
      </tr>`
    )).join("");
  }

  function renderPaymentsPage() {
    const rows = getFilteredPayments();
    renderPaymentSummary(rows);
    renderPaymentRows(rows);
  }

  function sheetByName(name) {
    return (sheetReport.sheets || []).find((sheet) => sheet.name === name) || null;
  }

  function compactUnique(values) {
    const seen = new Set();
    return values.map((value) => String(value || "").trim()).filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function tierLogicItems(sheet) {
    const rows = sheet.introRows || [];
    const textRows = rows.map((row) => compactUnique(row)).filter((row) => row.length);
    const title = textRows[0] && textRows[0][0] ? textRows[0][0] : sheet.title || sheet.name;
    const description = textRows[1] && textRows[1][0] ? textRows[1][0] : "";
    const excluded = new Set(["brand count", "total clicks", "order count", "revenue", "avg conversion", "objective", "target", "logic:", "phase:"]);
    const summaryValues = new Set((sheet.summaryCards || []).map((card) => String(card.value || "").trim().toLowerCase()).filter(Boolean));
    const details = [];
    textRows.slice(2).forEach((row) => {
      const useful = row.filter((value) => {
        const lower = value.toLowerCase();
        if (excluded.has(lower)) return false;
        if (summaryValues.has(lower)) return false;
        if (/^\$?[\d,.]+%?$/.test(value)) return false;
        return true;
      });
      if (useful.length) details.push(useful.join(" / "));
    });
    return { title, description, details: compactUnique(details).map(summarizeLogicText).slice(0, 5) };
  }

  function summarizeLogicText(value) {
    let text = String(value || "")
      .replace(/\(Steady sales made over the past 3 months\)/gi, "")
      .replace(/\(Sales is growing over the past 3 months\)/gi, "")
      .replace(/\(Sales is declining over the past 3 months\)/gi, "")
      .replace(/Newly added coming from Tier 3 -> Tier 2/gi, "New from Tier 3")
      .replace(/Newly added coming from Tier 4 -> Tier 3/gi, "New from Tier 4")
      .replace(/Newly added coming from Tier 2 -> Tier 3/gi, "Moved from Tier 2")
      .replace(/Need to add more publisher to try it out and optimize/gi, "Add publishers and optimize")
      .replace(/Need to add optimize and add more publisher to try it out since it is in declining phase \(Potentially moving to Tier 3 in the upcoming months\)/gi, "Optimize publishers; monitor Tier 3 risk")
      .replace(/Need to add optimize and add more publisher to try it out since it is in declining phase/gi, "Optimize publishers; monitor risk")
      .replace(/\s*\/\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 150 ? `${text.slice(0, 147).trim()}...` : text;
  }

  function renderTierLogicSummary(sheet) {
    const logic = tierLogicItems(sheet);
    const detailHtml = logic.details.length
      ? `<div class="logic-list">${logic.details.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
      : "";
    return `<div class="logic-summary">
      <div>
        <strong>${escapeHtml(logic.title)}</strong>
        <p>${escapeHtml(logic.description || "Tier logic is imported from the Google Sheet.")}</p>
      </div>
      ${detailHtml}
    </div>`;
  }

  function renderTierSummary(sheet) {
    const cards = sheet.summaryCards && sheet.summaryCards.length
      ? sheet.summaryCards
      : [
          { label: "Rows", value: String((sheet.rows || []).length) },
          { label: "Columns", value: String((sheet.headers || []).length) }
        ];
    els.tierPageSummary.innerHTML = cards.map((card) => (
      `<div class="metric"><span>${escapeHtml(labelText(card.label))}</span><strong>${escapeHtml(card.value)}</strong></div>`
    )).join("");
  }

  function columnLabel(index) {
    let label = "";
    let value = index + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function renderSheetTable(sheet, titleEl, countEl, headEl, rowsEl, customRows = null) {
    const headers = sheet.headers || [];
    const rows = customRows || sheet.rows || [];
    const grid = sheet.grid || [];
    titleEl.textContent = `${sheet.name} ${t("sheet.targetRecords", "Sheet Records")}`;
    if (headers.length) {
      countEl.textContent = `${rows.length.toLocaleString()} rows / ${headers.length.toLocaleString()} columns`;
      headEl.innerHTML = `<tr>${headers.map((header) => `<th>${escapeHtml(labelText(header))}</th>`).join("")}</tr>`;
      rowsEl.innerHTML = rows.map((row) => (
        `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`).join("")}</tr>`
      )).join("");
      return;
    }

    const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    countEl.textContent = `${grid.length.toLocaleString()} rows / ${maxCols.toLocaleString()} columns`;
    headEl.innerHTML = maxCols
      ? `<tr>${Array.from({ length: maxCols }, (_, index) => `<th>${columnLabel(index)}</th>`).join("")}</tr>`
      : "";
    rowsEl.innerHTML = grid.map((row) => (
      `<tr>${Array.from({ length: maxCols }, (_, index) => `<td>${escapeHtml(row[index] || "")}</td>`).join("")}</tr>`
    )).join("");
  }

  function renderTierSheetTable(sheet) {
    renderSheetTable(sheet, els.tierTableTitle, els.tierTableCount, els.tierSheetHead, els.tierSheetRows, getFilteredTierSheetRows(sheet));
  }

  function sheetRowUniqueValues(rows, keys) {
    return Array.from(new Set(rows.map((row) => String(rowValue(row, keys) || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function refreshTierSheetFilters(sheet) {
    const rows = sheet.rows || [];
    const currentNetwork = state.tierSheetFilters.network;
    const currentCountry = state.tierSheetFilters.country;
    replaceSelectOptions(els.tierSheetNetwork, "All networks", sheetRowUniqueValues(rows, ["Network", "Agency"]), currentNetwork);
    replaceSelectOptions(els.tierSheetCountry, "All countries", sheetRowUniqueValues(rows, ["COUNTRY", "Country"]), currentCountry);
    state.tierSheetFilters.network = els.tierSheetNetwork.value;
    state.tierSheetFilters.country = els.tierSheetCountry.value;
    els.tierSheetSearch.value = state.tierSheetFilters.search;
    els.tierSheetMinEpc.value = state.tierSheetFilters.minEpc;
    els.tierSheetMinRevenue.value = state.tierSheetFilters.minRevenue;
  }

  function getFilteredTierSheetRows(sheet) {
    const search = normalize(state.tierSheetFilters.search);
    const minEpc = Number(state.tierSheetFilters.minEpc || 0);
    const minRevenue = Number(state.tierSheetFilters.minRevenue || 0);
    return (sheet.rows || [])
      .filter((row) => !search || normalize(Object.values(row).join(" ")).includes(search))
      .filter((row) => state.tierSheetFilters.network === "all" || String(rowValue(row, ["Network", "Agency"])) === state.tierSheetFilters.network)
      .filter((row) => state.tierSheetFilters.country === "all" || String(rowValue(row, ["COUNTRY", "Country"])) === state.tierSheetFilters.country)
      .filter((row) => parseSheetNumber(rowValue(row, ["Backend EPC", "EPC"])) >= minEpc)
      .filter((row) => parseSheetNumber(rowValue(row, ["Revenue", "June Revenue", "May Revenue"])) >= minRevenue);
  }

  function renderTierPage(tierName) {
    const sheet = sheetByName(tierName);
    els.tierPageTitle.textContent = tierName;
    els.tierPageSubtitle.textContent = sheet ? `${sheet.title} / ${t("tier.imported", "imported from Google Sheets")}` : t("tier.notFound", "Google Sheet tab not found");
    if (!sheet) {
      els.tierPageSummary.innerHTML = "";
      els.tierPageNotes.innerHTML = `<p>${escapeHtml(t("tier.noMatch", "No matching sheet tab was found in the current export."))}</p>`;
      els.tierSheetHead.innerHTML = "";
      els.tierSheetRows.innerHTML = "";
      els.tierTableCount.textContent = "";
      return;
    }
    refreshTierSheetFilters(sheet);
    renderTierSummary(sheet);
    els.tierPageNotes.innerHTML = renderTierLogicSummary(sheet);
    renderTierSheetTable(sheet);
  }

  function targetRecords() {
    const sheet = sheetByName("Tier Summary & Target");
    const grid = (sheet && sheet.grid) || [];
    const records = [];
    let headers = [];
    let currentMonth = "";
    grid.forEach((row) => {
      const first = String(row[0] || "").trim();
      const tier = String(row[1] || "").trim();
      if (row.some((value) => String(value || "").trim() === "Tier")) {
        headers = row.map((value) => String(value || "").trim());
        return;
      }
      if (first && /^\d{4}-\d{2}-\d{2}/.test(first)) {
        const date = new Date(`${first.slice(0, 10)}T00:00:00`);
        currentMonth = Number.isNaN(date.getTime())
          ? first
          : date.toLocaleString(undefined, { month: "long", year: "numeric" });
      }
      if (!headers.length || !tier) return;
      const record = { Month: currentMonth };
      headers.forEach((header, index) => {
        if (!header) return;
        record[header] = row[index] || "";
      });
      if (record.Tier) records.push(record);
    });
    return records;
  }

  function filteredTargetRecords() {
    return targetRecords()
      .filter((record) => state.targetFilters.month === "all" || record.Month === state.targetFilters.month)
      .filter((record) => state.targetFilters.tier === "all" || record.Tier === state.targetFilters.tier);
  }

  function refreshTargetFilters() {
    const records = targetRecords();
    const months = Array.from(new Set(records.map((record) => record.Month).filter(Boolean)));
    const tiers = Array.from(new Set(records.map((record) => record.Tier).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const monthOptions = months.map((month) => ({ value: month, label: month }));
    if (!state.targetFilters.month && monthOptions.length) state.targetFilters.month = monthOptions[monthOptions.length - 1].value;
    replaceSelectWithOptions(els.targetMonthSelect, [{ value: "all", label: "All months" }, ...monthOptions], state.targetFilters.month || "all");
    replaceSelectOptions(els.targetTierFilter, "All tiers", tiers, state.targetFilters.tier);
    state.targetFilters.month = els.targetMonthSelect.value;
    state.targetFilters.tier = els.targetTierFilter.value;
  }

  function renderSheetSummary(records) {
    const summaryRows = records.some((record) => record.Tier === "Total")
      ? records.filter((record) => record.Tier === "Total")
      : records;
    const totals = summaryRows.reduce((acc, record) => {
      acc.brands += parseSheetNumber(record["Brand Count"]);
      acc.clicks += parseSheetNumber(record["Total Clicks"]);
      acc.orders += parseSheetNumber(record["Order Count"]);
      acc.revenue += parseSheetNumber(record.Revenue);
      return acc;
    }, { brands: 0, clicks: 0, orders: 0, revenue: 0 });
    const cards = [
      { label: "Rows", value: String(records.length) },
      { label: "Brand Count", value: totals.brands.toLocaleString() },
      { label: "Total Clicks", value: totals.clicks.toLocaleString() },
      { label: "Order Count", value: totals.orders.toLocaleString() },
      { label: "Revenue", value: shortMoney(totals.revenue) }
    ];
    els.sheetPageSummary.innerHTML = cards.map((card) => (
      `<div class="metric"><span>${escapeHtml(labelText(card.label))}</span><strong>${escapeHtml(card.value)}</strong></div>`
    )).join("");
  }

  function renderSheetPage() {
    refreshTargetFilters();
    const rows = filteredTargetRecords();
    if (!rows.length) {
      els.sheetPageTitle.textContent = t("sheet.targets", "Monthly Targets");
      els.sheetPageSubtitle.textContent = t("sheet.noTargets", "No target rows found in the current sheet export");
      els.sheetPageSummary.innerHTML = "";
      els.sheetPageNotes.innerHTML = `<p>${escapeHtml(t("sheet.noTargetMatch", "No target data matched the selected filters."))}</p>`;
      els.sheetGridHead.innerHTML = "";
      els.sheetGridRows.innerHTML = "";
      els.sheetTableCount.textContent = "";
      return;
    }
    els.sheetPageTitle.textContent = t("sheet.targets", "Monthly Targets");
    els.sheetPageSubtitle.textContent = `${state.targetFilters.month === "all" ? optionText("All months") : state.targetFilters.month} / ${t("sheet.targetSummary", "target and performance summary")}`;
    renderSheetSummary(rows);
    const targetRows = rows.filter((record) => String(record.Target || "").trim());
    els.sheetPageNotes.innerHTML = targetRows.length
      ? `<div class="target-list">${targetRows.map((record) => `<span><strong>${escapeHtml(record.Tier)}</strong>${escapeHtml(record.Target)}</span>`).join("")}</div>`
      : `<p>${escapeHtml(t("sheet.noTargetNotes", "No written target notes for this selection."))}</p>`;
    const headers = ["Month", "Tier", "Brand Count", "Total Clicks", "Order Count", "Revenue", "Avg Conversion", "New Tier Entries", "Tier Exits", "Target"];
    els.sheetTableTitle.textContent = t("sheet.targetRecords", "Monthly Target Records");
    els.sheetTableCount.textContent = `${rows.length.toLocaleString()} ${t("sheet.targetRows", "target rows")}`;
    els.sheetGridHead.innerHTML = `<tr>${headers.map((header) => `<th>${escapeHtml(labelText(header))}</th>`).join("")}</tr>`;
    els.sheetGridRows.innerHTML = rows.map((row) => (
      `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`
    )).join("");
  }

  function switchPage(page) {
    state.page = page;
    const isTier = page === "tier";
    const isSheets = page === "sheets";
    document.querySelectorAll(".dashboard-page").forEach((el) => el.classList.toggle("hidden", page !== "dashboard"));
    els.paymentsPage.classList.toggle("hidden", page !== "payments");
    els.sheetPage.classList.toggle("hidden", !isSheets);
    els.tierPage.classList.toggle("hidden", !isTier);
    els.dashboardNav.classList.toggle("active", page === "dashboard");
    els.paymentsNav.classList.toggle("active", page === "payments");
    els.sheetsNav.classList.toggle("active", isSheets || isTier);
    els.tierNavButtons.forEach((button) => {
      button.classList.toggle("active", isTier && button.dataset.tierPage === state.selectedTierPage);
    });
    if (page === "payments") {
      renderPaymentsPage();
      if (!state.livePaymentsLoaded) refreshLevantaPayments({ silent: true });
    }
    if (isSheets) renderSheetPage();
    if (isTier) renderTierPage(state.selectedTierPage);
  }

  function init() {
    fillSelect(els.tier, uniqueValues("tier"));
    fillSelect(els.network, uniqueValues("network"));
    fillSelect(els.category, uniqueValues("category"));
    refreshPaymentFilterOptions();
    refreshTargetFilters();
    setDatasetStamp();
    setPaymentStamp("saved", isoDate(PAYMENT_TODAY));
    quickPrompts.forEach(({ key, prompt }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.promptKey = key;
      button.dataset.prompt = prompt;
      button.textContent = t(key, prompt);
      button.addEventListener("click", () => applyPrompt(prompt));
      els.quickActions.appendChild(button);
    });

    [els.tier, els.network, els.category].forEach((select) => {
      select.addEventListener("change", () => {
        state[select.id.replace("Filter", "")] = select.value;
        renderAll();
      });
    });
    els.minEpc.addEventListener("input", () => { state.minEpc = els.minEpc.value; renderAll(); });
    els.minAov.addEventListener("input", () => { state.minAov = els.minAov.value; renderAll(); });
    els.minCvr.addEventListener("input", () => { state.minCvr = els.minCvr.value; renderAll(); });
    els.notPaidOnly.addEventListener("change", () => { state.notPaidOnly = els.notPaidOnly.checked; renderAll(); });
    els.dashboardNav.addEventListener("click", () => switchPage("dashboard"));
    els.paymentsNav.addEventListener("click", () => switchPage("payments"));
    els.sheetsNav.addEventListener("click", () => switchPage("sheets"));
    els.targetMonthSelect.addEventListener("change", () => {
      state.targetFilters.month = els.targetMonthSelect.value;
      renderSheetPage();
    });
    els.targetTierFilter.addEventListener("change", () => {
      state.targetFilters.tier = els.targetTierFilter.value;
      renderSheetPage();
    });
    els.tierNavButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedTierPage = button.dataset.tierPage;
        switchPage("tier");
      });
    });
    els.tierSheetSearch.addEventListener("input", () => { state.tierSheetFilters.search = els.tierSheetSearch.value; renderTierPage(state.selectedTierPage); });
    els.tierSheetNetwork.addEventListener("change", () => { state.tierSheetFilters.network = els.tierSheetNetwork.value; renderTierPage(state.selectedTierPage); });
    els.tierSheetCountry.addEventListener("change", () => { state.tierSheetFilters.country = els.tierSheetCountry.value; renderTierPage(state.selectedTierPage); });
    els.tierSheetMinEpc.addEventListener("input", () => { state.tierSheetFilters.minEpc = els.tierSheetMinEpc.value; renderTierPage(state.selectedTierPage); });
    els.tierSheetMinRevenue.addEventListener("input", () => { state.tierSheetFilters.minRevenue = els.tierSheetMinRevenue.value; renderTierPage(state.selectedTierPage); });
    els.paymentMonth.addEventListener("change", () => { state.payments.month = els.paymentMonth.value; renderPaymentsPage(); });
    els.paymentNetwork.addEventListener("change", () => { state.payments.network = els.paymentNetwork.value; renderPaymentsPage(); });
    els.paymentTier.addEventListener("change", () => { state.payments.tier = els.paymentTier.value; renderPaymentsPage(); });
    els.paymentStatus.addEventListener("change", () => { state.payments.status = els.paymentStatus.value; renderPaymentsPage(); });
    els.paymentSearch.addEventListener("input", () => { state.payments.search = els.paymentSearch.value; renderPaymentsPage(); });
    els.paymentUnpaidOnly.addEventListener("change", () => { state.payments.unpaidOnly = els.paymentUnpaidOnly.checked; renderPaymentsPage(); });
    els.paymentPendingOnly.addEventListener("change", () => { state.payments.pendingOnly = els.paymentPendingOnly.checked; renderPaymentsPage(); });
    els.paymentOverdueOnly.addEventListener("change", () => { state.payments.overdueOnly = els.paymentOverdueOnly.checked; renderPaymentsPage(); });
    els.paymentSync.addEventListener("click", () => refreshLevantaPayments());
    els.languageToggle.addEventListener("click", toggleLanguage);
    els.reset.addEventListener("click", resetFilters);
    els.download.addEventListener("click", downloadFilteredCsv);
    document.querySelectorAll(".sort-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.sort = button.dataset.sort;
        state.descending = true;
        syncControls();
        renderAll();
      });
    });
    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = els.chatInput.value.trim();
      if (!prompt) return;
      els.chatInput.value = "";
      applyPrompt(prompt);
    });
    els.chatLog.addEventListener("click", (event) => {
      const button = event.target.closest("[data-download-id]");
      if (!button) return;
      downloadRecommendationXlsx(button.dataset.downloadId);
    });

    addMessage("assistant", `Loaded <strong>${offers.length.toLocaleString()}</strong> internal offers. Search merchant name, merchant ID, ASIN, category, payment status, or ask for recommendations.`);
    state.currentContext = { type: "default", items: [], summary: {}, filters: {} };
    syncPaymentControls();
    renderAll();
    renderPaymentsPage();
    rerenderForLanguage();
    maybeAutoSyncLevantaPayments();
    window.setInterval(maybeAutoSyncLevantaPayments, AUTO_PAYMENT_SYNC_INTERVAL_MS);
  }

  init();
})();
