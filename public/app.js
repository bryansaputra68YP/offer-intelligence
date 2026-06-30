(function () {
  const data = window.CHATBOT_DATA || { summary: {}, offers: [] };
  const sheetReport = window.SHEET_REPORT_DATA || { sheets: [], tierSheets: [] };
  const offers = data.offers || [];
  const chatbotI18n = window.CHATBOT_I18N || {};
  const tier2Rules = window.TIER2_RECOMMENDATION_RULES || {};
  offers.forEach((offer) => {
    offer.paymentCycle = normalizePaymentCycle(offer.paymentCycle, offer.network);
  });
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
    targetSort: {
      key: "",
      direction: "asc"
    },
    tierSheetSort: {
      key: "",
      direction: "asc"
    },
    paymentSource: "saved invoice file",
    livePaymentsLoaded: false,
    livePaymentsLoading: false,
    activeRecommendationBundle: null,
    excludedRecommendationKeys: new Set(),
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
    recBox: document.getElementById("recommendationBox"),
    stamp: document.getElementById("datasetStamp"),
    download: document.getElementById("downloadCsv"),
    paymentDownload: document.getElementById("downloadPaymentsXlsx"),
    sheetDownload: document.getElementById("downloadSheetXlsx"),
    tierDownload: document.getElementById("downloadTierXlsx"),
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
    beauty: ["beauty", "personal care", "skin", "skin care", "skincare", "facial", "face", "hair", "makeup", "nail", "wrinkle", "anti aging", "anti-aging", "serum", "moisturizer", "sunscreen", "eyelash", "美妆", "美容", "护肤", "个护", "皮肤", "面部", "头发", "彩妆", "指甲", "抗老", "精华", "面霜", "防晒", "睫毛"],
    home: ["home", "kitchen", "furniture", "bedding", "mattress", "office", "chair", "desk", "cookware", "vacuum", "fireplace", "家居", "家用", "厨房", "家具", "床品", "床垫", "办公", "椅子", "桌子", "厨具", "吸尘器", "扫地机器人", "壁炉"],
    pet: ["pet", "dog", "cat", "pet supplies", "宠物", "狗", "猫", "宠物用品"],
    electronics: ["electronics", "tech", "camera", "audio", "robot", "headphone", "earbud", "projector", "smartwatch", "smart watch", "wifi", "usb", "电子", "科技", "数码", "相机", "摄像头", "音频", "耳机", "投影仪", "智能手表", "智能戒指", "路由器", "无线网", "蓝牙"],
    supplement: ["supplement", "health", "vitamin", "nutrition", "wellness", "probiotic", "magnesium", "creatine", "protein", "保健品", "健康", "维生素", "营养", "益生菌", "镁", "肌酸", "蛋白"],
    baby: ["baby", "kid", "kids", "stroller", "母婴", "婴儿", "宝宝", "儿童", "童车", "推车"],
    outdoors: ["sports", "outdoor", "outdoors", "patio", "lawn", "garden", "pool", "camping", "hiking", "fishing", "运动", "户外", "庭院", "草坪", "花园", "泳池", "游泳池", "泳池清洁", "露营", "徒步", "钓鱼"],
    automotive: ["automotive", "car", "vehicle", "汽车", "车载", "车辆"],
    tools: ["tools", "home improvement", "工具", "家装", "五金", "维修"],
    shoes: ["shoes", "sneakers", "loafers", "slippers", "boots", "insoles", "鞋", "鞋子", "运动鞋", "乐福鞋", "拖鞋", "靴", "鞋垫"],
    fashion: ["clothing", "jewelry", "apparel", "fashion", "shirt", "jeans", "dress", "necklace", "服装", "衣服", "珠宝", "饰品", "牛仔裤", "裙子", "项链"],
    pool: ["pool cleaner", "pool cleaners", "robotic pool", "robotic pool cleaner", "泳池机器人", "泳池清洁机器人", "泳池清洁器"]
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
      "label.Publisher Count": "Publisher 数量",
      "label.Success Rate": "成功率",
      "label.Tier 2 Optimization Idea": "Tier 2 优化建议",
      "label.Revenue": "收入",
      "label.Commission": "佣金",
      "label.Action": "动作",
      "label.Cycle": "周期",
      "label.Available": "预计收款日期",
      "label.Expected Payment Date": "预计收款日期",
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
      "option.Overdue": "逾期",
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
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function words(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  }

  function singularToken(token) {
    const text = String(token || "").toLowerCase();
    if (text.length > 5 && text.endsWith("ies")) return `${text.slice(0, -3)}y`;
    if (text.length > 4 && text.endsWith("s")) return text.slice(0, -1);
    return text;
  }

  const categoryStopWords = new Set([
    "a", "an", "and", "are", "based", "best", "brand", "brands", "category", "for", "from",
    "give", "has", "have", "in", "list", "match", "me", "of", "offer", "offers", "or",
    "please", "pull", "recommend", "recommendation", "recommendations", "show", "that",
    "the", "tier", "to", "top", "want", "with", "推荐", "品牌", "商家", "品类", "类别", "类目",
    "给我", "显示", "列出", "拉取", "下载", "导出", "最好", "最佳", "前", "个", "款", "条"
  ]);

  function meaningfulTokens(value) {
    return words(value)
      .map(singularToken)
      .filter((token) => token.length > 1 && !categoryStopWords.has(token));
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
    if (/[^\x00-\x7f]/.test(term)) return haystack.includes(term);
    if (term.length <= 3) return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack);
    return haystack.includes(term);
  }

  function cleanCategoryValue(value) {
    const text = String(value || "").trim();
    return text && text !== "Uncategorized" ? text : "";
  }

  function sheetMainCategory(item) {
    if (!item) return "Uncategorized";
    const sheetCategory = cleanCategoryValue(item.sheetCategory);
    if (sheetCategory) return sheetCategory;
    const mainCategory = cleanCategoryValue(item.mainCategory);
    if (mainCategory) return mainCategory;
    const feishuMainCategory = cleanCategoryValue(item.feishuMainCategory);
    if (feishuMainCategory) return feishuMainCategory;
    const category = cleanCategoryValue(item.category);
    if (category && item.categorySource !== "Feishu") return category;
    if (category) return category;
    return cleanCategoryValue(item.levantaCategory) || "Uncategorized";
  }

  function categoryParts(item) {
    return [
      sheetMainCategory(item),
      item && item.sheetCategory,
      item && item.feishuMainCategory,
      item && item.feishuSubCategory,
      item && item.mainCategory,
      item && item.subCategory,
      item && item.mainCategoryCn,
      item && item.subCategoryCn,
      item && item.categoryPath,
      item && item.category,
      item && item.levantaCategory
    ].filter((value) => String(value || "").trim() && String(value).trim() !== "Uncategorized");
  }

  function displayCategory(item) {
    return sheetMainCategory(item);
  }

  function categorySearchText(item) {
    return categoryParts(item).concat(item && item.brand, item && item.merchantName).filter(Boolean).join(" ").toLowerCase();
  }

  let mainCategoryNormsCache = null;

  function uniqueCategoryValues() {
    const values = new Set();
    offers.forEach((offer) => {
      const category = sheetMainCategory(offer);
      if (category !== "Uncategorized") values.add(category);
    });
    return Array.from(values).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  let allCategoryValuesCache = null;

  function allCategoryValues() {
    if (!allCategoryValuesCache) {
      const values = new Set();
      offers.forEach((offer) => {
        categoryParts(offer).forEach((value) => values.add(String(value).trim()));
      });
      allCategoryValuesCache = Array.from(values).sort((a, b) => String(b).length - String(a).length);
    }
    return allCategoryValuesCache;
  }

  function hasMainCategoryValue(category) {
    if (!mainCategoryNormsCache) {
      mainCategoryNormsCache = new Set(uniqueCategoryValues().map((value) => normalize(value)));
    }
    return mainCategoryNormsCache.has(normalize(category));
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
    const zhMonths = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const zhDirect = zhMonths.findIndex((month) => text.includes(month));
    if (zhDirect >= 0) return PAYMENT_MONTHS[zhDirect];
    const numericMonth = text.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*(?:月|月份)/);
    if (numericMonth) return PAYMENT_MONTHS[Number(numericMonth[1]) - 1];
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

  function normalizePaymentCycle(value, network) {
    if (String(network || "").trim().toLowerCase() === "wayward") return 105;
    const cycle = number(value);
    return cycle > 0 ? Math.round(cycle) : 60;
  }

  function paymentDueDate(record, cycleOverride) {
    const cycle = cycleOverride === undefined
      ? Math.max(60, normalizePaymentCycle(record.paymentCycle, record.network))
      : Number(cycleOverride);
    const computed = calculatePaymentAvailabilityDate({ ...record, paymentCycle: cycle });
    return dateOnly(computed || record.expectedPaymentDate || record.paymentAvailabilityDate);
  }

  function calculatePaymentStatus(record) {
    const raw = String(record.rawStatus || record.paymentStatus || "").toLowerCase();
    const expected = number(record.expectedPaymentAmount ?? record.commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const baselineDate = paymentDueDate(record, 60);
    const cycleDate = paymentDueDate(record);
    const pastBaseline = baselineDate ? PAYMENT_TODAY > baselineDate : false;
    const pastCycle = cycleDate ? PAYMENT_TODAY > cycleDate : false;

    if (raw === "paid" || (expected > 0 && paid >= expected - 0.01 && !raw.includes("late") && !raw.includes("unpaid"))) return "Paid";
    if (expected <= 0 && paid <= 0) {
      if (raw.includes("pending")) return "Pending";
      return "Unknown";
    }
    if (!pastBaseline) return "Pending";
    if (pastCycle && remaining > 0.01) return "Overdue";
    if (paid > 0 && remaining > 0.01) return "Partial";
    if (raw.includes("pending") || raw.includes("late") || raw.includes("unpaid") || remaining > 0.01) return "Unpaid";
    return "Unknown";
  }

  function firstRecordNumber(record, keys) {
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null || record[key] === "") continue;
      return number(record[key]);
    }
    return null;
  }

  function normalizePaymentRecord(record) {
    const revenueMade = firstRecordNumber(record, ["revenueMade", "sales", "revenue", "salesAmount", "totalSales"]) ?? 0;
    const directCommissionMade = firstRecordNumber(record, ["commissionMade", "totalCommission", "commissionOwed", "expectedPaymentAmount"]);
    const rawCommission = firstRecordNumber(record, ["commission"]);
    const cpcCommission = firstRecordNumber(record, ["cpcCommission", "cpc_commission"]) ?? 0;
    const commissionMade = directCommissionMade ?? ((rawCommission ?? 0) + cpcCommission);
    const expected = number(record.expectedPaymentAmount ?? commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const matchedOffer = offerForPaymentMerchant(record) || {};
    const network = record.network || matchedOffer.network || "Levanta";
    const normalized = {
      ...record,
      merchantId: String(record.merchantId || "").trim(),
      merchantName: String(record.merchantName || record.brand || "").trim(),
      network,
      tier: record.tier || "Unknown",
      category: record.category || matchedOffer.category || matchedOffer.levantaCategory || "Uncategorized",
      categoryPath: record.categoryPath || matchedOffer.categoryPath || "",
      mainCategory: record.mainCategory || matchedOffer.mainCategory || "",
      subCategory: record.subCategory || matchedOffer.subCategory || "",
      mainCategoryCn: record.mainCategoryCn || matchedOffer.mainCategoryCn || "",
      subCategoryCn: record.subCategoryCn || matchedOffer.subCategoryCn || "",
      reportMonth: record.reportMonth || monthNameFromText(record.reportMonthKey) || "Unknown",
      reportYear: Number(record.reportYear || 2026),
      reportMonthKey: record.reportMonthKey || monthKey(record),
      revenueMade,
      commissionMade,
      expectedPaymentAmount: expected,
      paidAmount: paid,
      remainingAmount: remaining,
      paymentCycle: normalizePaymentCycle(record.paymentCycle || matchedOffer.paymentCycle, network),
      lastCheckedDate: record.lastCheckedDate || data.summary.generatedAt || "",
      notes: record.notes || ""
    };
    normalized.paymentAvailabilityDate = calculatePaymentAvailabilityDate(normalized) || record.paymentAvailabilityDate || "";
    normalized.expectedPaymentDate = normalized.paymentAvailabilityDate;
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
    const network = source.network || offer.network || "Levanta";
    const record = {
      id: `${merchantId || normalize(merchantName)}::${reportYear}-${String(monthIndex + 1).padStart(2, "0")}::pending-placeholder`,
      merchantId,
      merchantName,
      network,
      tier: source.tier || offer.tier || "Unknown",
      category: source.category || offer.category || offer.levantaCategory || "Uncategorized",
      categoryPath: source.categoryPath || offer.categoryPath || "",
      mainCategory: source.mainCategory || offer.mainCategory || "",
      subCategory: source.subCategory || offer.subCategory || "",
      mainCategoryCn: source.mainCategoryCn || offer.mainCategoryCn || "",
      subCategoryCn: source.subCategoryCn || offer.subCategoryCn || "",
      reportMonth: month,
      reportYear,
      reportMonthKey: `${reportYear}-${String(monthIndex + 1).padStart(2, "0")}`,
      revenueMade: 0,
      commissionMade: 0,
      expectedPaymentAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentCycle: normalizePaymentCycle(source.paymentCycle || offer.paymentCycle, network),
      rawStatus: "pending",
      lastCheckedDate: isoDate(PAYMENT_TODAY),
      currency: source.currency || "USD",
      isPlaceholder: true,
      notes: "No Levanta invoice row found yet; marked pending until the month becomes payable or Levanta returns a final status."
    };
    record.paymentAvailabilityDate = calculatePaymentAvailabilityDate(record);
    record.expectedPaymentDate = record.paymentAvailabilityDate;
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
    return paymentRecords
      .map((record) => ({ ...record, paymentStatus: calculatePaymentStatus(record) }))
      .filter(isTrackablePaymentRecord);
  }

  function hasPayablePaymentAmount(record) {
    return (
      number(record.commissionMade) > 0 ||
      number(record.expectedPaymentAmount) > 0 ||
      number(record.paidAmount) > 0 ||
      number(record.remainingAmount) > 0
    );
  }

  function isTrackablePaymentRecord(record) {
    const status = String(record.paymentStatus || "").toLowerCase();
    const rawStatus = String(record.rawStatus || "").toLowerCase();
    const merchantKey = paymentMerchantKey(record);
    return hasPayablePaymentAmount(record) || Boolean(merchantKey && (record.isPlaceholder || status === "pending" || rawStatus.includes("pending")));
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
    const dueDate = paymentDueDate(record);
    return Boolean(dueDate && PAYMENT_TODAY > dueDate && number(record.remainingAmount) > 0 && record.paymentStatus !== "Paid");
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
      if (options.auto) localStorage.setItem(AUTO_PAYMENT_SYNC_KEY, String(Date.now()));
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
    const lastSync = Number(localStorage.getItem(AUTO_PAYMENT_SYNC_KEY) || 0);
    if (state.livePaymentsLoading) return;
    if (state.livePaymentsLoaded && Number.isFinite(lastSync) && Date.now() - lastSync < AUTO_PAYMENT_SYNC_INTERVAL_MS) return;
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

  function tier2PublisherStrategy(offer, language = state.language) {
    if (!tier2Rules.strategyForOffer || offer.tier !== "Tier 2") return null;
    return tier2Rules.strategyForOffer(offer, {
      language,
      tierGroup: tierGroup(offer),
      highlightStatus: highlightStatus(offer)
    });
  }

  function tier2PublisherCountText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.publisherCountText || "";
  }

  function tier2PublisherSuccessText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.successRateText || "";
  }

  function tier2OptimizationIdea(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    return strategy ? strategy.idea : "";
  }

  function tier2RecommendationDetailsHtml(offer, language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    const copy = chatCopy(language);
    const publisherLabel = language === "zh" ? chatLabelText("Publisher Count", language) : "Publisher count";
    const successLabel = language === "zh" ? chatLabelText("Success Rate", language) : "Success rate";
    const ideaLabel = language === "zh" ? (copy.tier2OptimizationIdea || chatLabelText("Tier 2 Optimization Idea", language)) : "Tier 2 optimization idea";
    return [
      `<li><strong>${escapeHtml(publisherLabel)}:</strong> ${escapeHtml(strategy.publisherCountText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(successLabel)}:</strong> ${escapeHtml(strategy.successRateText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(ideaLabel)}:</strong> ${escapeHtml(strategy.idea)}</li>`
    ].join("");
  }

  function tier2FieldRows(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return [];
    const notAvailable = language === "zh" ? chatCopy(language).notAvailable : "not available in current data";
    return [
      ["Publisher Count", strategy.publisherCountText || notAvailable],
      ["Success Rate", strategy.successRateText || notAvailable],
      ["Tier 2 Optimization Idea", strategy.idea]
    ];
  }

  function recommendedAction(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (hasPaymentRisk(offer)) return "放量前先跟进付款风险";
      if (group === "Tier 1") return "战略性推进";
      if (publisherStrategy) return publisherStrategy.action;
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
    if (publisherStrategy) return publisherStrategy.action;
    if (group === "Core Tier 2") return highlightStatus(offer);
    if (group === "Tier 2 Watch") return "Selected publisher test only";
    if (group === "Tier 3") return "Controlled development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "Do not push";
    return "Optimize only";
  }

  function caution(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (group === "Black Tier") return "Black Tier，不建议推进。";
      if (hasPaymentRisk(offer)) return `付款风险：${paymentRiskTextForOffer(offer)}。`;
      if (publisherStrategy) return publisherStrategy.caution;
      if (group === "Tier 4") return "仅在角度明确时复测。";
      if (group === "Tier 2 Watch") return "放量前需要继续观察。";
      if (number(offer.conversionRate) < 0.01) return "CVR 低于 1%，建议使用高意图流量。";
      return "持续观察 EPC、CVR 和付款状态。";
    }
    if (group === "Black Tier") return "Black tier; do not push.";
    if (hasPaymentRisk(offer)) return `Payment risk: ${paymentRiskTextForOffer(offer)}.`;
    if (publisherStrategy) return publisherStrategy.caution;
    if (group === "Tier 4") return "Retest only with a clear angle.";
    if (group === "Tier 2 Watch") return "Needs monitoring before broader scale.";
    if (number(offer.conversionRate) < 0.01) return "CVR is below 1%; use high-intent traffic.";
    return "Monitor EPC, CVR, and payment status.";
  }

  function bestAngle(offer, context = {}) {
    const category = displayCategory(offer) !== "Uncategorized" ? displayCategory(offer) : "category";
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

  function isRateColumn(header) {
    const lower = String(header || "").toLowerCase();
    return /(success rate|conversion rate|completion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower) && !/count/.test(lower);
  }

  function percentageNumberForHeader(header, value) {
    if (!isRateColumn(header)) return null;
    const text = String(value ?? "").trim();
    if (!text) return null;
    const cleaned = text.replace(/%$/, "").replace(/,/g, "").trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const raw = Number(cleaned);
    if (!Number.isFinite(raw)) return null;
    if (text.includes("%")) return raw;
    return Math.abs(raw) <= 1 ? raw * 100 : raw;
  }

  function formatPercentNumber(value) {
    return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }

  function formatSheetCell(header, value) {
    const text = String(value ?? "");
    if (text.includes("%")) return text;
    const percentage = percentageNumberForHeader(header, text);
    return percentage === null ? text : formatPercentNumber(percentage);
  }

  function sortableReportValue(header, value) {
    const text = String(value ?? "").trim();
    if (!text) return { type: "empty", value: "" };
    const percentage = percentageNumberForHeader(header, text);
    if (percentage !== null) return { type: "number", value: percentage };
    const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction && Number(fraction[2]) !== 0) return { type: "number", value: Number(fraction[1]) / Number(fraction[2]) };
    const dateValue = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text.slice(0, 10)) : NaN;
    if (Number.isFinite(dateValue)) return { type: "number", value: dateValue };
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return { type: "number", value: Number(cleaned) };
    return { type: "text", value: text.toLowerCase() };
  }

  function compareReportValues(header, left, right) {
    const a = sortableReportValue(header, left);
    const b = sortableReportValue(header, right);
    if (a.type === "empty" || b.type === "empty") {
      if (a.type === b.type) return 0;
      return a.type === "empty" ? 1 : -1;
    }
    if (a.type === "number" && b.type === "number") return a.value - b.value;
    return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
  }

  function defaultReportSortDirection(header) {
    return /(rank|id|merchant|brand|network|agency|tier|phase|country|reason|recommendation|link|asin|target|objective|status)/i.test(String(header || "")) ? "asc" : "desc";
  }

  function sortReportRows(rows, sortState, getter) {
    if (!sortState || !sortState.key) return rows.slice();
    const multiplier = sortState.direction === "desc" ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = getter(a.row, sortState.key);
        const right = getter(b.row, sortState.key);
        const leftEmpty = String(left ?? "").trim() === "";
        const rightEmpty = String(right ?? "").trim() === "";
        if (leftEmpty || rightEmpty) {
          if (leftEmpty === rightEmpty) return a.index - b.index;
          return leftEmpty ? 1 : -1;
        }
        const result = compareReportValues(sortState.key, left, right);
        return result ? result * multiplier : a.index - b.index;
      })
      .map((item) => item.row);
  }

  function sortableHeaderHtml(header, sortState, scope) {
    const active = sortState && sortState.key === header;
    const direction = active ? sortState.direction : "";
    const indicator = active ? (direction === "asc" ? "▲" : "▼") : "↕";
    return `<th><button class="table-sort-button${active ? " active" : ""}" type="button" data-report-sort-scope="${escapeHtml(scope)}" data-report-sort-key="${escapeHtml(header)}" aria-label="Sort by ${escapeHtml(labelText(header))}">
      <span>${escapeHtml(labelText(header))}</span>
      <span class="sort-indicator" aria-hidden="true">${escapeHtml(indicator)}</span>
    </button></th>`;
  }

  function updateReportSort(sortState, key) {
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      return;
    }
    sortState.key = key;
    sortState.direction = defaultReportSortDirection(key);
  }

  function handleReportSortClick(event) {
    const button = event.target.closest("[data-report-sort-key]");
    if (!button) return;
    const key = button.dataset.reportSortKey || "";
    if (!key) return;
    if (button.dataset.reportSortScope === "target") {
      updateReportSort(state.targetSort, key);
      renderSheetPage();
      return;
    }
    updateReportSort(state.tierSheetSort, key);
    renderTierPage(state.selectedTierPage);
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
      .filter((offer) => state.category === "all" || categoryMatches(offer, state.category))
      .filter((offer) => number(offer.epc) >= minEpc)
      .filter((offer) => number(offer.aov) >= minAov)
      .filter((offer) => number(offer.conversionRate) >= minCvr)
      .filter((offer) => !state.notPaidOnly || hasPaymentRisk(offer))
      .sort((a, b) => (number(b[state.sort]) - number(a[state.sort])) * (state.descending ? 1 : -1));
  }

  function compareDashboardCategoryGroups(a, b) {
    if (a.category === "Uncategorized" && b.category !== "Uncategorized") return 1;
    if (b.category === "Uncategorized" && a.category !== "Uncategorized") return -1;
    return number(b.summary.totalRevenue) - number(a.summary.totalRevenue) ||
      number(b.summary.totalOrders) - number(a.summary.totalOrders) ||
      number(b.summary.totalOffers) - number(a.summary.totalOffers) ||
      String(a.category || "").localeCompare(String(b.category || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function dashboardCategoryGroups(rows) {
    const groups = new Map();
    rows.forEach((offer) => {
      const category = displayCategory(offer) || "Uncategorized";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(offer);
    });
    return Array.from(groups.entries())
      .map(([category, groupRows]) => ({
        category,
        rows: groupRows,
        summary: aggregateRows(groupRows)
      }))
      .sort(compareDashboardCategoryGroups);
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
    const haystack = words(`${offer.brand} ${categorySearchText(offer)} ${offer.network}`);
    const matched = queryWords.filter((word) => haystack.some((item) => item.includes(word) || word.includes(item))).length;
    const tokenScore = queryWords.length ? (matched / queryWords.length) * 70 : 0;
    const overlap = [...q].filter((char) => brand.includes(char)).length / Math.max(q.length, 1);
    return Math.max(tokenScore, overlap * 45);
  }

  function findMerchantMatches(query) {
    const cleaned = query
      .replace(/\b(search|find|merchant|overview|info|information|about|for)\b/gi, " ")
      .replace(/查找|搜索|查看|看看|商家|品牌|概览|信息|资料|关于|帮我|请|找/g, " ")
      .trim();
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

  function metricTermPattern() {
    return [
      "commission\\s+(?:made|amount|dollars?)",
      "affiliate\\s+commission",
      "aff\\s+commission",
      "commission\\s+(?:rate|percentage|percent)",
      "conversion(?:\\s+rate)?",
      "order\\s+count",
      "commissions?",
      "revenue",
      "sales",
      "clicks?",
      "orders?",
      "epc",
      "aov",
      "cvr",
      "dpv",
      "atc",
      "产生佣金",
      "佣金收入",
      "佣金金额",
      "佣金额",
      "联盟佣金",
      "佣金率",
      "佣金比例",
      "佣金百分比",
      "佣金",
      "客单价",
      "平均订单金额",
      "转化率",
      "转换率",
      "订单数量",
      "订单数",
      "订单",
      "销售额",
      "收入",
      "营收",
      "点击量",
      "点击",
      "详情页浏览量",
      "详情页浏览",
      "浏览量",
      "加购数",
      "加购",
      "加入购物车"
    ].join("|");
  }

  function comparisonTermPattern() {
    return [
      "greater\\s+than",
      "more\\s+than",
      "higher\\s+than",
      "at\\s+least",
      "less\\s+than",
      "lower\\s+than",
      "at\\s+most",
      "不低于",
      "不少于",
      "大于等于",
      "不超过",
      "小于等于",
      "above",
      "over",
      "minimum",
      "maximum",
      "below",
      "under",
      "min",
      "max",
      ">=",
      "<=",
      ">",
      "<",
      "至少",
      "最低",
      "最少",
      "高于",
      "超过",
      "大于",
      "以上",
      "最多",
      "最高",
      "低于",
      "少于",
      "小于",
      "以下",
      "以内"
    ].join("|");
  }

  function numberTokenPattern() {
    return "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[kKmM]|千|万)?";
  }

  function metricFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(${comparisonTermPattern()})\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?`, "gi");
  }

  function metricRangeFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(?:between|from|range|ranging|介于|从|在)?\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:and|to|-|–|—|到|至|和|与)\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:之间|范围)?`, "gi");
  }

  function metricTrailingComparisonPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(${comparisonTermPattern()})`, "gi");
  }

  function normalizeMetricName(metric) {
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text === "epc") return { field: "epc", label: "EPC", type: "money" };
    if (text === "aov" || /客单价|平均订单金额/.test(text)) return { field: "aov", label: "AOV", type: "money" };
    if (text === "cvr" || text.startsWith("conversion") || /转化率|转换率/.test(text)) return { field: "conversionRate", label: "CVR", type: "percent" };
    if (/dpv|详情页浏览|浏览量/.test(text)) return { field: "dpv", label: "DPV", type: "count" };
    if (/atc|加购|加入购物车/.test(text)) return { field: "atc", label: "ATC", type: "count" };
    if (/click|点击/.test(text)) return { field: "clicks", label: "Clicks", type: "count" };
    if (text.includes("commission") || /佣金/.test(text)) {
      if (/made|amount|dollar|affiliate|\baff\b|产生|收入|金额|金额|联盟/.test(text)) return { field: "affCommission", label: "Commission made", type: "money" };
      return { field: "commissionRate", label: "Commission rate", type: "percent" };
    }
    if (text === "revenue" || text === "sales" || /销售额|收入|营收/.test(text)) return { field: "salesAmount", label: "Revenue", type: "money" };
    return { field: "orders", label: "Orders", type: "count" };
  }

  function parseMetricNumber(value) {
    const text = String(value || "").trim().replace(/,/g, "");
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM]|千|万)?$/);
    if (!match) return NaN;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return NaN;
    const suffix = String(match[2] || "").toLowerCase();
    if (suffix === "k") return base * 1000;
    if (suffix === "m") return base * 1000000;
    if (suffix === "千") return base * 1000;
    if (suffix === "万") return base * 10000;
    return base;
  }

  function normalizeMetricThreshold(metric, raw, sourceText = "") {
    if (!Number.isFinite(raw)) return NaN;
    const hasPercent = sourceText.includes("%");
    return metric.type === "percent"
      ? (hasPercent || raw > 1 ? raw / 100 : raw)
      : raw;
  }

  function normalizeComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/lower\s+than/.test(text)) return "<";
    if (/below|under|less|at most|maximum|max|<=|<|低于|少于|小于|以下|以内|不超过|最多|最高|小于等于/.test(text)) {
      return text.includes("=") || /at most|maximum|max|不超过|最多|最高|小于等于|以内/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|不低于|不少于|大于等于|至少|最低|最少|以上/.test(text) ? ">=" : ">";
  }

  function normalizeCycleComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/before|below|under|less|shorter|<|within|up to|at most|maximum|max|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于/.test(text)) {
      return text.includes("=") || /within|up to|at most|maximum|max|以内|不超过|最多|至多|小于等于|少于等于|低于等于/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|不低于|不少于|大于等于|至少/.test(text) ? ">=" : ">";
  }

  function paymentCycleFilterPattern() {
    return new RegExp(`(?:payment|pay)\\s+cycle|付款周期|支付周期|结算周期|回款周期|周期`, "i");
  }

  function paymentCycleLeadingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|付款周期|支付周期|结算周期|回款周期|周期)\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于|高于|超过|大于|至少|以上|不低于|不少于|大于等于)\\s*(${numberTokenPattern()})\\s*(?:days?|d|天|日)?`, "i");
  }

  function paymentCycleTrailingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|付款周期|支付周期|结算周期|回款周期|周期)\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(${numberTokenPattern()})\\s*(?:days?|d|天|日)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于|高于|超过|大于|至少|以上|不低于|不少于|大于等于)`, "i");
  }

  function extractPaymentCycleFilter(prompt) {
    const text = String(prompt || "");
    if (!paymentCycleFilterPattern().test(text)) return null;
    const leading = paymentCycleLeadingFilterPattern().exec(text);
    const trailing = leading ? null : paymentCycleTrailingFilterPattern().exec(text);
    const match = leading || trailing;
    if (!match) return null;
    const threshold = parseMetricNumber(leading ? match[3] : match[2]);
    if (!Number.isFinite(threshold)) return null;
    return {
      operator: normalizeCycleComparisonOperator(leading ? match[2] : match[3]),
      threshold,
      raw: match[0].trim()
    };
  }

  function paymentCycleFilterMatches(offer, filter) {
    const cycle = number(offer.paymentCycle);
    if (cycle <= 0) return false;
    if (filter.operator === ">") return cycle > filter.threshold;
    if (filter.operator === ">=") return cycle >= filter.threshold;
    if (filter.operator === "<") return cycle < filter.threshold;
    if (filter.operator === "<=") return cycle <= filter.threshold;
    return true;
  }

  function paymentCycleFilterText(filter, language = "en") {
    if (!filter) return "";
    if (language === "zh") {
      const operatorText = {
        "<": "少于",
        "<=": "不超过",
        ">": "超过",
        ">=": "至少"
      }[filter.operator] || filter.operator;
      return `付款周期${operatorText}${Number(filter.threshold).toLocaleString()}天`;
    }
    return `Payment cycle ${filter.operator} ${Number(filter.threshold).toLocaleString()} days`;
  }

  function extractMetricFilters(prompt) {
    const filters = [];
    const text = String(prompt || "");
    let match;
    const rangePattern = metricRangeFilterPattern();
    while ((match = rangePattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const first = normalizeMetricThreshold(metric, parseMetricNumber(match[2]), match[0]);
      const second = normalizeMetricThreshold(metric, parseMetricNumber(match[3]), match[0]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      filters.push({
        ...metric,
        operator: "between",
        min: Math.min(first, second),
        max: Math.max(first, second),
        raw: match[0].trim()
      });
    }
    const pattern = metricFilterPattern();
    while ((match = pattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[3]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[2]),
        threshold,
        raw: match[0].trim()
      });
    }
    const trailingPattern = metricTrailingComparisonPattern();
    while ((match = trailingPattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[2]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[3]),
        threshold,
        raw: match[0].trim()
      });
    }
    const seen = new Set();
    return filters.filter((filter) => {
      const key = `${filter.field}:${filter.operator}:${filter.threshold}:${filter.min}:${filter.max}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function metricFilterMatches(offer, filter) {
    const value = number(offer[filter.field]);
    if (filter.operator === "between") return value >= filter.min && value <= filter.max;
    if (filter.operator === ">") return value > filter.threshold;
    if (filter.operator === ">=") return value >= filter.threshold;
    if (filter.operator === "<") return value < filter.threshold;
    if (filter.operator === "<=") return value <= filter.threshold;
    return true;
  }

  function applyMetricFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter((offer) => filters.every((filter) => metricFilterMatches(offer, filter)));
  }

  function metricThresholdText(filter) {
    if (filter.operator === "between") {
      return `${filter.label} between ${metricValueText(filter, filter.min)} and ${metricValueText(filter, filter.max)}`;
    }
    return `${filter.label} ${filter.operator} ${metricValueText(filter, filter.threshold)}`;
  }

  function metricValueText(filter, metricValue) {
    if (filter.type === "percent") return formatPercentNumber(metricValue * 100);
    if (filter.type === "money") return `$${Number(metricValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return Number(metricValue).toLocaleString();
  }

  function metricFilterText(filters) {
    return filters && filters.length ? filters.map(metricThresholdText).join(", ") : "";
  }

  function metricSortTermPattern() {
    return [
      "highest",
      "lowest",
      "top",
      "best",
      "maximum",
      "minimum",
      "max",
      "min",
      "most",
      "least",
      "largest",
      "biggest",
      "smallest",
      "desc(?:ending)?",
      "asc(?:ending)?"
    ].join("|");
  }

  function metricSortLeadingPattern() {
    return new RegExp(`\\b(${metricSortTermPattern()})\\s+(?:by\\s+|for\\s+|of\\s+)?(${metricTermPattern()})`, "gi");
  }

  function metricSortTrailingPattern() {
    return new RegExp(`(${metricTermPattern()})\\s+(?:is\\s+|are\\s+)?(${metricSortTermPattern()})\\b`, "gi");
  }

  function metricSortByPattern() {
    return new RegExp(`\\b(?:sort(?:ed)?\\s+by|order(?:ed)?\\s+by|rank(?:ed)?\\s+by|based\\s+on|by)\\s+(${metricTermPattern()})(?:\\s+(${metricSortTermPattern()}))?`, "gi");
  }

  function metricSortPatterns() {
    return [metricSortLeadingPattern(), metricSortTrailingPattern(), metricSortByPattern()];
  }

  function normalizeMetricSortDirection(term) {
    const text = String(term || "").toLowerCase();
    if (/lowest|minimum|\bmin\b|least|smallest|asc/.test(text)) return "asc";
    return "desc";
  }

  function normalizeMetricSortName(metric) {
    const normalized = normalizeMetricName(metric);
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text.includes("commission") && !/(rate|percentage|percent)/.test(text)) {
      return { field: "affCommission", label: "Commission made", type: "money" };
    }
    return normalized;
  }

  function extractMetricSortIntent(prompt) {
    const text = String(prompt || "");
    const matches = [];
    let match;
    const leading = metricSortLeadingPattern();
    while ((match = leading.exec(text))) {
      matches.push({ term: match[1], metric: match[2], index: match.index, raw: match[0].trim() });
    }
    const trailing = metricSortTrailingPattern();
    while ((match = trailing.exec(text))) {
      matches.push({ term: match[2], metric: match[1], index: match.index, raw: match[0].trim() });
    }
    const byPattern = metricSortByPattern();
    while ((match = byPattern.exec(text))) {
      matches.push({ term: match[2] || "highest", metric: match[1], index: match.index, raw: match[0].trim() });
    }
    if (!matches.length) return null;
    const best = matches.sort((a, b) => a.index - b.index)[0];
    const metric = normalizeMetricSortName(best.metric);
    return {
      ...metric,
      direction: normalizeMetricSortDirection(best.term),
      raw: best.raw
    };
  }

  function stripMetricSortPhrases(text) {
    return metricSortPatterns().reduce((output, pattern) => output.replace(pattern, " "), String(text || ""));
  }

  function cleanedCategoryPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\btier\s*[1-4]\b/gi, " ")
      .replace(/\bblack\s*tier\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|with|that|has|have|above|over|below|under|greater|less|than|minimum|maximum|min|max|at|least|most|tier)\b/gi, " ")
      .replace(/推荐|请|帮我|给我|显示|列出|拉取|下载|导出|找|筛选|最好|最佳|前\s*\d*|第?\s*[一二三四1-4]\s*(?:层|级|档)|分层|层级|档位|品类|类别|类目|品牌|商家|个|款|条|大于等于|小于等于|不低于|不少于|不超过|大于|高于|超过|以上|至少|最低|小于|低于|少于|以下|以内|最多|最高|介于|之间/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasCategoryIntentText(text) {
    return /\b(?:category|categories|subcategory|subcategories|main\s+category|category-wise|categorywise)\b/i.test(String(text || "")) ||
      /品类|类别|类目|主品类|主类目|子品类|子类目|分类/.test(String(text || ""));
  }

  function categoryScore(query, category) {
    const queryTokens = meaningfulTokens(query);
    if (!queryTokens.length) return 0;
    const categoryTokens = meaningfulTokens(category);
    const queryNorm = normalize(query);
    const categoryNorm = normalize(category);
    let score = 0;
    if (categoryNorm === queryNorm) score += 110;
    else if (categoryNorm.includes(queryNorm) || queryNorm.includes(categoryNorm)) score += 55;
    const matched = queryTokens.filter((queryToken) => (
      categoryTokens.some((categoryToken) => {
        if (categoryToken === queryToken) return true;
        if (categoryToken.length <= 3 || queryToken.length <= 3) return false;
        return categoryToken.includes(queryToken) || queryToken.includes(categoryToken);
      })
    )).length;
    score += (matched / queryTokens.length) * 70;
    score += categoryTokens.length ? (matched / categoryTokens.length) * 20 : 0;
    return score;
  }

  function categoryForPrompt(text) {
    const knownCategories = allCategoryValues();
    const zhCategory = /[\u4e00-\u9fff]/.test(String(text || "")) && chatbotI18n.categoryForPrompt && chatbotI18n.categoryForPrompt(text, knownCategories);
    if (zhCategory) return zhCategory;
    const lower = String(text || "").toLowerCase();
    const phrase = cleanedCategoryPhrase(text);
    const phraseTokens = meaningfulTokens(phrase);
    const mainCategories = uniqueCategoryValues()
      .filter((cat) => cat !== "Uncategorized")
      .sort((a, b) => String(b).length - String(a).length);
    const directMain = mainCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (directMain) return directMain;
    if (phrase) {
      const bestMain = mainCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const mainThreshold = hasCategoryIntentText(text) ? 52 : 68;
      if (bestMain && bestMain.score >= mainThreshold) return bestMain.category;
    }
    const direct = knownCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && categoryLower !== "uncategorized" && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (direct) return direct;
    if (phrase) {
      const best = knownCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const threshold = hasCategoryIntentText(text) ? 52 : 62;
      if (best && best.score >= threshold) return best.category;
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => words(alias).length > 1 && textIncludesAlias(lower, alias))) return canonical;
    }
    if (phraseTokens.length <= 1) {
      for (const [canonical, aliases] of Object.entries(categoryAliases)) {
        if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
      }
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
    }
    return null;
  }

  function categoryMatches(offer, category) {
    if (!category) return true;
    const aliases = categoryAliases[category] || [category];
    const mainCategory = sheetMainCategory(offer).toLowerCase();
    if (aliases.some((alias) => textIncludesAlias(mainCategory, alias))) return true;
    if (hasMainCategoryValue(category)) return false;
    const haystack = categorySearchText(offer);
    if (aliases.some((alias) => textIncludesAlias(haystack, alias))) return true;
    const queryTokens = meaningfulTokens(category);
    if (!queryTokens.length) return true;
    const haystackTokens = meaningfulTokens(haystack);
    const matched = queryTokens.filter((queryToken) => (
      haystackTokens.some((token) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))
    )).length;
    return matched >= Math.min(queryTokens.length, queryTokens.length <= 2 ? 2 : Math.ceil(queryTokens.length * 0.65));
  }

  function cleanedMerchantLookupPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull|find|search|recommend)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|find|search|merchant|brand|overview|info|information|about|for|the)\b/gi, " ")
      .replace(/推荐|请|帮我|给我|显示|列出|查找|搜索|拉取|下载|导出|最好|最佳|前\s*\d*|商家|品牌|信息|概览|关于/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function merchantLookupForPrompt(text) {
    const cleaned = cleanedMerchantLookupPhrase(text);
    if (meaningfulTokens(cleaned).length === 0 && normalize(cleaned).length < 2) return { cleaned, matches: [] };
    return { cleaned, matches: findMerchantMatches(cleaned) };
  }

  function hasStrongMerchantLookup(text, category = null) {
    if (category || hasCategoryIntentText(text) || findByAsin(text) || findByMerchantId(text)) return false;
    if (tierFromPrompt(text) || promptHasPaymentTerms(String(text || "").toLowerCase())) return false;
    if (extractMetricFilters(text).length || extractMetricSortIntent(text)) return false;
    const { cleaned, matches } = merchantLookupForPrompt(text);
    const first = matches[0];
    if (!first) return false;
    const cleanedNorm = normalize(cleaned);
    const brandNorm = normalize(first.offer.brand);
    if (!cleanedNorm || !brandNorm) return false;
    const directBrandMatch = brandNorm === cleanedNorm || brandNorm.startsWith(cleanedNorm) || brandNorm.includes(cleanedNorm) || cleanedNorm.includes(brandNorm);
    const second = matches[1];
    return (directBrandMatch && first.score >= 60) ||
      first.adjusted >= 95 ||
      (first.adjusted >= 85 && (!second || first.adjusted - second.adjusted > 12));
  }

  function tierFromPrompt(text) {
    const zhTier = chatbotI18n.tierFromPrompt && chatbotI18n.tierFromPrompt(text);
    if (zhTier) return zhTier;
    const black = /black\s*tier|blocked|黑名单|黑色\s*tier|黑色分层|屏蔽|暂停/i.test(text);
    if (black) return "BLACK TIER";
    const match = text.match(/tier\s*([1-4一二三四])/i) ||
      text.match(/(?:第\s*)?([一二三四1-4])\s*(?:层|级|档)/) ||
      text.match(/(?:分层|层级|档位)\s*([一二三四1-4])/);
    if (!match) return null;
    const tier = { 一: "1", 二: "2", 三: "3", 四: "4" }[match[1]] || match[1];
    return `Tier ${tier}`;
  }

  function wantsRecommendationList(text) {
    const lower = String(text || "").toLowerCase();
    const hasRankCommand = /\b(?:recommend|top|give|show|list|export|download|pull)\b/.test(lower) || /推荐|排行|排名|给我|显示|列出|拉取|导出|下载|筛选|前\s*\d+/.test(text);
    const endsLikeOfferRequest = /\b(?:offers?|brands?|recommendations?)\s*$/.test(lower) || /(?:offer|offers|品牌|商家|推荐)\s*$/.test(text);
    const hasMetricFilter = extractMetricFilters(text).length > 0;
    const metricSort = extractMetricSortIntent(text);
    if (!hasRankCommand && !endsLikeOfferRequest && !hasMetricFilter && !metricSort) return false;
    return requestedRecommendationCount(text, 0) > 0 ||
      /\b(?:offers?|brands?|recommendations?)\b/.test(lower) ||
      /offer|offers|品牌|商家|推荐/.test(text) ||
      hasMetricFilter ||
      Boolean(metricSort) ||
      Boolean(tierFromPrompt(text)) ||
      Boolean(categoryForPrompt(text));
  }

  function detectQueryIntent(userMessage) {
    const lower = userMessage.toLowerCase().trim();
    if (findByAsin(userMessage)) return "asin";
    if (findByMerchantId(userMessage)) return "merchant";
    const zhIntent = chatbotI18n.detectIntent && chatbotI18n.detectIntent(userMessage);
    const category = categoryForPrompt(userMessage);
    const metricSort = extractMetricSortIntent(userMessage);
    if (zhIntent && zhIntent !== "recommendation" && zhIntent !== "category") return zhIntent;
    if (/payment|paid|unpaid|late|issue|cycle/.test(lower) || /付款|未付款|没付款|未支付|已付款|已支付|逾期|到期|待处理|支付|结算|款项|付款周期|支付周期|结算周期/.test(userMessage)) return "payment";
    if (hasStrongMerchantLookup(userMessage, category)) return "merchant";
    if (zhIntent === "recommendation") return "recommendation";
    if (metricSort) return "recommendation";
    if (/recommend|push|focus|best|should we/.test(lower) || /推荐|排行|排名|最好|最佳|主推|重点|应该|筛选|前\s*\d+/.test(userMessage) || wantsRecommendationList(userMessage)) return "recommendation";
    if (tierFromPrompt(userMessage)) return "tier";
    if (category || zhIntent === "category") return "category";
    if (contextFollowup(lower)) return "merchant";
    return "merchant";
  }

  function recommendationScore(offer, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    const priority = tierPriority(offer, includeTier4, includeBlack);
    if (priority >= 99) return -9999;
    if (offer.tier === "Tier 2" && highlightStatus(offer) === "Optimization only") return -9999;

    const clicks = number(offer.clicks);
    const orders = number(offer.orders);
    const confidence = Math.min(1, Math.sqrt(Math.max(clicks, 0) / 250));

    let score = 100 - priority * 14;
    score += Math.log10(orders + 1) * 12;
    score += Math.log10(clicks + 1) * 3;
    score += number(offer.conversionRate) * 260 * confidence;
    score += Math.min(number(offer.epc), 5) * 8 * Math.max(confidence, 0.35);
    score += Math.min(number(offer.salesAmount), 100000) / 12000;
    score += Math.min(number(offer.atc), 500) / 80;
    score += offer.hasDiscount ? 7 : 0;
    score += offer.hasAsin ? 2 : 0;
    score += offer.recommendedLink ? 2 : 0;
    score -= clicks > 0 && clicks < 25 ? 12 : 0;
    score -= orders > 0 && orders < 5 ? 8 : 0;
    score -= hasPaymentRisk(offer) ? 32 : 0;
    score -= offer.trackingIssue ? 20 : 0;
    score -= offer.tier === "Tier 4" ? 40 : 0;
    score -= offer.tier === "BLACK TIER" ? 100 : 0;

    const publisherStrategy = tier2PublisherStrategy(offer, "en");
    if (publisherStrategy) {
      const publisherScoreAdjustments = {
        green_optimize: 7,
        green_under_sample: 5,
        under_sample: 3,
        maintain_optimize: 2,
        low_success_replace: -4,
        red_recovery: -6
      };
      score += publisherScoreAdjustments[publisherStrategy.code] || 0;
    }

    if (context.category && categoryMatches(offer, context.category)) score += 14;
    if (context.google) {
      score += number(offer.orders) >= 50 ? 8 : -4;
      score += number(offer.conversionRate) >= 0.01 ? 7 : -2;
      score += number(offer.clicks) >= 500 ? 4 : 0;
    }
    return score;
  }

  function compareRecommendationOffers(a, b, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    const metricSort = context.metricSort;
    if (metricSort && metricSort.field) {
      const tierDelta = tierPriority(a, includeTier4, includeBlack) - tierPriority(b, includeTier4, includeBlack);
      if (tierDelta) return tierDelta;
      const metricDelta = metricSort.direction === "asc"
        ? number(a[metricSort.field]) - number(b[metricSort.field])
        : number(b[metricSort.field]) - number(a[metricSort.field]);
      if (metricDelta) return metricDelta;
    }
    return (
      number(b.salesAmount) - number(a.salesAmount) ||
      number(b.orders) - number(a.orders) ||
      number(b.conversionRate) - number(a.conversionRate) ||
      number(b.aov) - number(a.aov) ||
      number(b.epc) - number(a.epc) ||
      tierPriority(a, includeTier4, includeBlack) - tierPriority(b, includeTier4, includeBlack) ||
      number(b.affCommission) - number(a.affCommission) ||
      number(b.clicks) - number(a.clicks) ||
      String(a.brand || "").localeCompare(String(b.brand || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  function sortedForCategory(category, options = {}) {
    const includeTier4 = options.includeTier4 || /tier 4|retest/i.test(options.prompt || "");
    const includeBlack = options.includeBlack || /black|blocked/i.test(options.prompt || "");
    return offers
      .filter((offer) => categoryMatches(offer, category))
      .filter((offer) => !options.tier || offer.tier === options.tier)
      .filter((offer) => includeTier4 || offer.tier !== "Tier 4")
      .filter((offer) => includeBlack || offer.tier !== "BLACK TIER")
      .sort((a, b) => compareRecommendationOffers(a, b, { includeTier4, includeBlack }));
  }

  function rankedRecommendations(pool, context = {}) {
    return pool
      .filter((offer) => context.includeBlack || offer.tier !== "BLACK TIER")
      .filter((offer) => context.includeTier4 || offer.tier !== "Tier 4")
      .map((offer) => ({ offer, score: recommendationScore(offer, context) }))
      .filter((item) => item.score > -9999)
      .sort((a, b) => compareRecommendationOffers(a.offer, b.offer, context))
      .map((item) => item.offer);
  }

  function topRecommendations(pool, context = {}) {
    return rankedRecommendations(pool, context)
      .slice(0, 5);
  }

  function whyRecommended(offer, context = {}) {
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (offer.recommendation) {
      if (publisherStrategy) {
        const prefix = language === "zh" ? "Publisher 策略" : "Publisher strategy";
        return `${offer.recommendation} ${prefix}: ${publisherStrategy.idea}`;
      }
      return offer.recommendation;
    }
    const signals = [];
    if (language === "zh") {
      if (tierGroup(offer) === "Tier 1") signals.push("优先 Tier 1 offer");
      if (tierGroup(offer) === "Core Tier 2") signals.push("Tier 2 表现较强");
      if (publisherStrategy) signals.push(publisherStrategy.label);
      if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} 个订单`);
      if (number(offer.conversionRate) >= 0.01) signals.push("CVR 健康");
      if (number(offer.epc) > 0.25) signals.push("EPC 可用");
      if (context.category && categoryMatches(offer, context.category)) signals.push("品类匹配");
      return signals.length ? signals.join("，") : "当前筛选结果中综合评分最高";
    }
    if (tierGroup(offer) === "Tier 1") signals.push("priority Tier 1 offer");
    if (tierGroup(offer) === "Core Tier 2") signals.push("strong Tier 2 performance");
    if (publisherStrategy) signals.push(publisherStrategy.label);
    if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} orders`);
    if (number(offer.conversionRate) >= 0.01) signals.push("healthy CVR");
    if (number(offer.epc) > 0.25) signals.push("usable EPC");
    if (context.category && categoryMatches(offer, context.category)) signals.push("category fit");
    return signals.length ? signals.join(", ") : "best available score in the filtered set";
  }

  function contextFollowup(lower) {
    if (!state.lastOffer) return false;
    if (/^tier\s*[1-4]\b|^black\s*tier\b/.test(lower)) return false;
    if (/\b(it|its|this|that|the merchant|this merchant|that merchant)\b/.test(lower) || /^(它|它的|这个|这个商家|该商家|这个品牌|该品牌)/.test(lower)) return true;
    return /^(epc|aov|orders?|order count|cvr|conversion|payment|paid|category|tier|commission|revenue|clicks?|dpv|atc)\b/.test(lower) ||
      /^(订单|订单数|转化|转化率|转换率|付款|支付|未付款|已付款|品类|类别|分层|佣金|佣金率|收入|营收|销售额|点击|点击量|加购|详情页)/.test(lower);
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
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small><br><small>${escapeHtml(displayCategory(o))}</small>` },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Highlight", render: (o) => escapeHtml(highlightStatus(o)) },
    { label: "Category", render: (o) => escapeHtml(displayCategory(o)) },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "CVR", render: (o) => shortPct(o.conversionRate) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Commission", render: (o) => shortMoney(o.affCommission) },
    { label: "Payment", render: (o) => escapeHtml(o.paymentStatus || "not available") },
    { label: "Action", render: (o) => escapeHtml(recommendedAction(o)) }
  ];

  const tier2PublisherColumns = [
    { label: "Publisher Count", render: (o) => escapeHtml(tier2PublisherCountText(o) || textValue(o.publisherCount)) },
    { label: "Success Rate", render: (o) => escapeHtml(tier2PublisherSuccessText(o) || (o.successRate === undefined ? "not available" : shortPct(o.successRate))) },
    { label: "Tier 2 Optimization Idea", render: (o) => escapeHtml(tier2OptimizationIdea(o) || "not applicable") }
  ];

  function contextColumnsFor(rows) {
    if (!rows.some((offer) => offer.tier === "Tier 2")) return contextColumns;
    return [
      ...contextColumns.slice(0, 3),
      ...tier2PublisherColumns,
      ...contextColumns.slice(3)
    ];
  }

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
    const filterText = [
      metricFilterText(context.filters && context.filters.metricFilters),
      paymentCycleFilterText(context.filters && context.filters.paymentCycleFilter)
    ].filter(Boolean).join(", ");
    const scopeText = context.filters && context.filters.exportCount
      ? `<div class="context-note"><strong>Overview scope:</strong> ${Number(context.filters.exportCount).toLocaleString()} requested offers. The chat preview stays at 5.${filterText ? ` Filter: ${escapeHtml(filterText)}.` : ""}</div>`
      : "";
    return statCards([
      ["Offers", String(s.totalOffers)],
      ["Revenue made", shortMoney(s.totalRevenue)],
      ["Commission made", shortMoney(s.totalCommission)],
      ["Orders", countValue(s.totalOrders)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    scopeText +
    `<div class="context-note"><strong>Tier breakdown:</strong> ${escapeHtml(tierText)}${tier2Text ? `<br><strong>Tier 2 highlights:</strong> ${escapeHtml(tier2Text)}` : ""}</div>` +
    miniTable(rows, contextColumnsFor(rows)) +
    insightList(rows);
  }

  function renderMerchantStats(offer) {
    return `<div class="merchant-focus">
      <h4>${escapeHtml(offer.brand || "Merchant")}</h4>
      ${statCards([
        ["Merchant ID", textValue(offer.merchantId)],
        ["Tier", tierGroup(offer)],
        ["Network", textValue(offer.network)],
        ["Category", textValue(displayCategory(offer))],
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
      { label: "Expected payment date", render: (o) => escapeHtml(o.expectedPaymentDate || o.paymentAvailabilityDate || "not available") }
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
    miniTable(top, contextColumnsFor(top).slice(0, 9)) +
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
      ["Category", textValue(displayCategory(offer))],
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
      ...tier2FieldRows(offer, language),
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
    return `<div class="merchant-card"><h4>${escapeHtml(offer.brand || chatCopy(language).merchantOverview || "Merchant")} ${extra}</h4><ul>${rows}</ul></div>` +
      downloadCardHtml([offer], {
        downloadType: "offers",
        filePrefix: "merchant_offer",
        exportScope: offer.brand || offer.merchantId || "merchant",
        sheetName: "Merchant"
      }, {
        title: "Merchant file",
        description: "1 offer row with metrics, payment status, ASINs, and recommendation notes."
      });
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

  const tier2CompactColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Highlight", render: (o) => escapeHtml(highlightStatus(o)) },
    { label: "Publisher Count", render: (o) => escapeHtml(tier2PublisherCountText(o) || textValue(o.publisherCount)) },
    { label: "Success Rate", render: (o) => escapeHtml(tier2PublisherSuccessText(o) || "not available") },
    { label: "Tier 2 Optimization Idea", render: (o) => escapeHtml(tier2OptimizationIdea(o) || "not available") },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "CVR", render: (o) => shortPct(o.conversionRate) },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Payment", render: (o) => escapeHtml(o.paymentStatus || "not available") }
  ];

  const paymentCycleOfferColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Category", render: (o) => escapeHtml(o.category || "Uncategorized") },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
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
    { label: "Expected payment date", render: (o) => escapeHtml(o.expectedPaymentDate || o.paymentAvailabilityDate || "not available") },
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
    const ranks = { Overdue: 1, Unpaid: 2, Partial: 3, Unknown: 4, Pending: 5, Paid: 6 };
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
      .replace(/付款|支付|结算|周期|商家|品牌|已付款|未付款|没付款|未支付|状态|问题|逾期|到期|待处理|部分付款|未知|剩余|预期|佣金|收入|三月|四月|五月|六月|七月|八月|报表|月份|查看|显示|全部|所有|请|帮我|哪些|哪个|是否|已经|还没|没有|未/g, " ")
      .trim();
    if (cleaned.length < 3) return [];
    const merchants = Array.from(new Map(getPaymentRecords().map((record) => [
      record.merchantId || normalize(record.merchantName),
      {
        brand: record.merchantName,
        merchantId: record.merchantId,
        category: record.category,
        categoryPath: record.categoryPath,
        mainCategory: record.mainCategory,
        subCategory: record.subCategory,
        mainCategoryCn: record.mainCategoryCn,
        subCategoryCn: record.subCategoryCn,
        network: record.network
      }
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
    const message = language === "zh" ? escapeHtml(copy.closeMatches) : "I found multiple close merchant matches. Which one do you mean?";
    return `${message}<br>` +
      downloadCardHtml(rows, {
        downloadType: "offers",
        filePrefix: "merchant_matches",
        exportScope: query || "closest_matches",
        sheetName: "Closest Matches"
      }, {
        title: "Closest matches file",
        description: `${rows.length.toLocaleString()} matching offers from this lookup.`
      }) +
      resultTable(rows, compactColumns.slice(0, 5), language);
  }

  function requestedRecommendationCount(prompt, fallback = 5) {
    const text = String(prompt || "");
    if (chatbotI18n.requestedRecommendationCount) {
      const requested = chatbotI18n.requestedRecommendationCount(text, fallback, MAX_RECOMMENDATION_EXPORT);
      if (requested !== fallback) return requested;
    }
    const patterns = [
      /\b(?:top|give|show|list|export|download|pull)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?(\d{1,4})\b/i,
      /\b(\d{1,4})\s+(?:offers?|brands?|recommendations?)\b/i,
      /\b(\d{1,4})\s+tier\s*[1-4]\s*(?:offers?|brands?|recommendations?)?\b/i,
      /(?:推荐|给我|显示|列出|拉取|导出|下载|筛选|找)\s*(\d{1,4})\s*(?:个|款|条)?/i,
      /前\s*(\d{1,4})\s*(?:个|款|条)?/i,
      /(\d{1,4})\s*(?:个|款|条)?\s*(?:offer|offers|品牌|商家|推荐)/i
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

  function recommendationPreviewCount(requestedCount, availableCount) {
    const requested = Math.max(1, Math.floor(number(requestedCount) || 5));
    const limit = requested <= 10 ? requested : 10;
    return Math.min(limit, availableCount);
  }

  function offerIdentityKey(offer) {
    return `${String(offer && offer.merchantId || "").trim()}::${normalize(offer && offer.brand)}`;
  }

  function tierNameFromToken(value) {
    const token = String(value || "").trim().toLowerCase();
    if (token === "1" || token === "one") return "Tier 1";
    if (token === "2" || token === "two") return "Tier 2";
    if (token === "3" || token === "three") return "Tier 3";
    if (token === "4" || token === "four") return "Tier 4";
    return "";
  }

  function mergeTierPlanItem(plan, tier, count) {
    if (!tier || !Number.isFinite(count) || count <= 0) return;
    const existing = plan.find((item) => item.tier === tier);
    const safeCount = Math.min(Math.floor(count), MAX_RECOMMENDATION_EXPORT);
    if (existing) existing.count = safeCount;
    else plan.push({ tier, count: safeCount });
  }

  function parseTierOfferRequest(prompt) {
    const text = String(prompt || "");
    const plan = [];
    const countFirst = /\b(\d{1,4})\s*(?:offers?|brands?|recommendations?)?\s*(?:from|for|in|of)?\s*tier\s*([1-4])\b/gi;
    const tierFirst = /\btier\s*([1-4])\s*(?:[:=\-]|with|for|of)?\s*(\d{1,4})\s*(?:offers?|brands?|recommendations?)?/gi;
    let match;
    while ((match = countFirst.exec(text))) {
      mergeTierPlanItem(plan, tierNameFromToken(match[2]), Number(match[1]));
    }
    while ((match = tierFirst.exec(text))) {
      mergeTierPlanItem(plan, tierNameFromToken(match[1]), Number(match[2]));
    }
    return plan;
  }

  function bundleRequestedCount(plan) {
    return (plan || []).reduce((sum, item) => sum + number(item.count), 0);
  }

  function tierBundleCounts(rows) {
    return rows.reduce((counts, offer) => {
      counts[offer.tier] = (counts[offer.tier] || 0) + 1;
      return counts;
    }, {});
  }

  function tierCandidatePool(tier, context = {}) {
    const metricFilters = context.metricFilters || [];
    const pool = applyMetricFilters(offers.filter((offer) => offer.tier === tier), metricFilters);
    return rankedRecommendations(pool, {
      ...context,
      includeTier4: true,
      includeBlack: tier === "BLACK TIER" || context.includeBlack
    });
  }

  function isExcludedRecommendationOffer(offer) {
    return state.excludedRecommendationKeys.has(offerIdentityKey(offer));
  }

  function rebuildRecommendationBundle(plan, options = {}) {
    const previousRows = options.previousRows || [];
    const context = options.context || {};
    const rows = [];
    const gaps = [];
    const selectedKeys = new Set();

    plan.forEach((item) => {
      const tier = item.tier;
      const requested = Math.min(Math.max(Math.floor(number(item.count) || 0), 0), MAX_RECOMMENDATION_EXPORT);
      const tierRows = [];
      previousRows
        .filter((offer) => offer.tier === tier)
        .forEach((offer) => {
          const key = offerIdentityKey(offer);
          if (tierRows.length >= requested || selectedKeys.has(key) || isExcludedRecommendationOffer(offer)) return;
          tierRows.push(offer);
          selectedKeys.add(key);
        });

      tierCandidatePool(tier, context).forEach((offer) => {
        const key = offerIdentityKey(offer);
        if (tierRows.length >= requested || selectedKeys.has(key) || isExcludedRecommendationOffer(offer)) return;
        tierRows.push(offer);
        selectedKeys.add(key);
      });

      rows.push(...tierRows);
      if (tierRows.length < requested) {
        gaps.push({ tier, requested, available: tierRows.length, gap: requested - tierRows.length });
      }
    });

    const bundle = {
      plan: plan.map((item) => ({ tier: item.tier, count: item.count })),
      rows,
      gaps,
      context,
      requestedCount: bundleRequestedCount(plan),
      excludedKeys: Array.from(state.excludedRecommendationKeys)
    };
    state.activeRecommendationBundle = bundle;
    setContext(buildRecommendationContext(rows, {
      ...context,
      bundle: true,
      bundlePlan: bundle.plan,
      requestedCount: bundle.requestedCount,
      exportCount: rows.length,
      gaps
    }));
    return bundle;
  }

  function bundlePlanText(plan) {
    return plan.map((item) => `${item.tier}: ${number(item.count).toLocaleString()}`).join(", ");
  }

  function bundleCountsText(rows) {
    const counts = tierBundleCounts(rows);
    return Object.keys(counts)
      .sort((a, b) => tierPriority({ tier: a }, true, true) - tierPriority({ tier: b }, true, true))
      .map((tier) => `${tier}: ${counts[tier].toLocaleString()}`)
      .join(", ");
  }

  function bundleGapText(gaps) {
    if (!gaps || !gaps.length) return "";
    return gaps.map((gap) => `${gap.tier} requested ${gap.requested.toLocaleString()}, found ${gap.available.toLocaleString()}, short ${gap.gap.toLocaleString()}`).join("; ");
  }

  function renderRecommendationBundleHtml(bundle, options = {}) {
    const previewRows = bundle.rows.slice(0, recommendationPreviewCount(bundle.requestedCount, bundle.rows.length));
    const downloadId = registerRecommendationDownload(bundle.rows, {
      ...bundle.context,
      downloadType: "offers",
      filePrefix: "offer_recommendations",
      exportScope: "tier_mix",
      sheetName: "Offer Recommendations"
    }, bundle.requestedCount);
    const action = options.action || "Built a recommendation package";
    const gapText = bundleGapText(bundle.gaps);
    const details = [
      `Plan: ${bundlePlanText(bundle.plan)}`,
      `Current file: ${bundle.rows.length.toLocaleString()} offers (${bundleCountsText(bundle.rows) || "none"})`,
      gapText ? `Shortage: ${gapText}` : ""
    ].filter(Boolean).join(". ");
    const note = options.note ? `<p>${escapeHtml(options.note)}</p>` : "";
    return `<p><strong>${escapeHtml(action)}.</strong> ${escapeHtml(details)}.</p>` +
      note +
      `<div class="download-card">
        <div>
          <strong>Offer recommendation file</strong>
          <span>${escapeHtml(bundle.rows.length.toLocaleString())} offers in one Excel sheet. Excluded offers stay out for this chat session.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      resultTable(previewRows, compactColumns);
  }

  function recommendationBundleAnswer(prompt, plan) {
    const context = {
      prompt,
      includeTier4: true,
      includeBlack: true,
      metricFilters: extractMetricFilters(prompt),
      metricSort: extractMetricSortIntent(prompt)
    };
    const bundle = rebuildRecommendationBundle(plan, { context });
    return renderRecommendationBundleHtml(bundle);
  }

  function matchedOffersFromPrompt(prompt, pool) {
    const normalizedPrompt = normalize(prompt);
    const idMatches = new Set((String(prompt || "").match(/\b\d{5,8}(?:\.0)?\b/g) || []).map((id) => id.replace(/\.0$/, "")));
    const ignoredTokens = new Set(["do", "not", "try", "dont", "want", "exclude", "remove", "skip", "change", "replace", "swap", "tier", "offer", "offers", "recommendation", "recommendations", "with", "other", "one", "another", "from", "the", "and"]);
    const promptTokens = (String(prompt || "").toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((token) => token.length >= 3 && !ignoredTokens.has(token));
    const matches = [];
    const seen = new Set();
    [...pool]
      .sort((a, b) => normalize(b.brand).length - normalize(a.brand).length)
      .forEach((offer) => {
        const key = offerIdentityKey(offer);
        if (seen.has(key)) return;
        const brand = normalize(offer.brand);
        const id = String(offer.merchantId || "").trim();
        const brandTokenMatch = promptTokens.some((token) => brand.includes(token));
        if ((brand.length >= 3 && (normalizedPrompt.includes(brand) || brandTokenMatch)) || (id && idMatches.has(id))) {
          seen.add(key);
          matches.push(offer);
        }
      });
    return matches;
  }

  function isRecommendationExclusionPrompt(prompt) {
    return /\b(do\s*not\s*try|don't\s*try|dont\s*try|do\s*not\s*want|don't\s*want|dont\s*want|exclude|remove|skip|not\s*try)\b/i.test(prompt);
  }

  function isRecommendationReplacementPrompt(prompt) {
    return /\b(change|replace|swap|another|other\s+one)\b/i.test(prompt) && Boolean(state.activeRecommendationBundle);
  }

  function recommendationBundleExclusionAnswer(prompt) {
    const bundle = state.activeRecommendationBundle;
    if (!bundle) return "Create a recommendation package first, then tell me which offers to exclude.";
    let matches = matchedOffersFromPrompt(prompt, bundle.rows);
    if (!matches.length) matches = matchedOffersFromPrompt(prompt, offers);
    if (!matches.length) return "I could not match those offer names in the current data. Send the merchant names or IDs to exclude.";

    const beforeRows = bundle.rows;
    matches.forEach((offer) => state.excludedRecommendationKeys.add(offerIdentityKey(offer)));
    const nextBundle = rebuildRecommendationBundle(bundle.plan, { previousRows: beforeRows, context: bundle.context });
    const beforeKeys = new Set(beforeRows.map(offerIdentityKey));
    const afterKeys = new Set(nextBundle.rows.map(offerIdentityKey));
    const removed = beforeRows.filter((offer) => !afterKeys.has(offerIdentityKey(offer)));
    const added = nextBundle.rows.filter((offer) => !beforeKeys.has(offerIdentityKey(offer)));
    const removedText = removed.length ? `Removed: ${removed.map((offer) => offer.brand).join(", ")}` : `Excluded: ${matches.map((offer) => offer.brand).join(", ")}`;
    const addedText = added.length ? `Added replacements: ${added.map((offer) => offer.brand).join(", ")}` : "No replacement was available for one or more excluded offers";
    return renderRecommendationBundleHtml(nextBundle, {
      action: "Updated the recommendation package",
      note: `${removedText}. ${addedText}.`
    });
  }

  function recommendationBundleReplacementAnswer(prompt) {
    const bundle = state.activeRecommendationBundle;
    if (!bundle) return "Create a recommendation package first, then ask me to change one offer.";
    const promptedTier = tierFromPrompt(prompt);
    const pool = promptedTier ? bundle.rows.filter((offer) => offer.tier === promptedTier) : bundle.rows;
    if (!pool.length) return `There are no ${promptedTier || "matching"} offers in the current recommendation package.`;

    const namedMatches = matchedOffersFromPrompt(prompt, pool);
    const target = namedMatches[0] || pool[pool.length - 1];
    const beforeRows = bundle.rows;
    const beforeKeys = new Set(beforeRows.map(offerIdentityKey));
    state.excludedRecommendationKeys.add(offerIdentityKey(target));
    const nextBundle = rebuildRecommendationBundle(bundle.plan, { previousRows: beforeRows, context: bundle.context });
    const replacement = nextBundle.rows.find((offer) => offer.tier === target.tier && !beforeKeys.has(offerIdentityKey(offer)));
    const replacementText = replacement
      ? `Replaced ${target.brand} with ${replacement.brand} from ${target.tier}.`
      : `Removed ${target.brand} from ${target.tier}, but there was no unused replacement available.`;
    return renderRecommendationBundleHtml(nextBundle, {
      action: "Changed one recommendation",
      note: replacementText
    });
  }

  function metricSortDescription(metricSort) {
    if (!metricSort || !metricSort.field) return "";
    const direction = metricSort.direction === "asc" ? "lowest" : "highest";
    return `tier priority first, then ${metricSort.label} ${direction}`;
  }

  function recommendationHtml(rows, context = {}) {
    const language = responseLanguageFor(context.prompt || state.currentQuery);
    const copy = chatCopy(language);
    const localizedContext = { ...context, language };
    const requestedCount = number(context.requestedCount) || 5;
    const ranked = rankedRecommendations(rows, localizedContext);
    const exportRows = ranked.slice(0, requestedCount);
    const top = exportRows.slice(0, recommendationPreviewCount(requestedCount, exportRows.length));
    setContext(buildRecommendationContext(exportRows, { ...localizedContext, requestedCount, exportCount: exportRows.length }));
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
    const filterText = metricFilterText(context.metricFilters);
    const filterNote = filterText ? ` Filtered by ${filterText}.` : "";
    const previewTitle = language === "zh" ? copy.recommendationPreview : "Recommendation preview";
    const showingText = language === "zh"
      ? chatFormat(copy.showingTop, { count: top.length.toLocaleString() })
      : `showing the top ${top.length.toLocaleString()} here so the chat stays readable.`;
    let rankingText = language === "zh"
      ? `${exportRows.length.toLocaleString()} 个 offer，${copy.rankedBy}`
      : `${exportRows.length.toLocaleString()} offers ranked by revenue, orders, CVR, AOV, then EPC.${filterNote}`;
    const metricSortText = metricSortDescription(context.metricSort);
    if (metricSortText) {
      rankingText = `${exportRows.length.toLocaleString()} offers ranked by ${metricSortText}.${filterNote}`;
    }
    return `<p><strong>${escapeHtml(previewTitle)}${label}:</strong> ${escapeHtml(showingText)} ${escapeHtml(exportNote)}</p>` +
      `<div class="download-card">
        <div>
          <strong>${escapeHtml(language === "zh" ? copy.fullRecommendationFile : "Full recommendation file")}</strong>
          <span>${escapeHtml(rankingText)}</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">${escapeHtml(language === "zh" ? copy.downloadExcel : "Download Excel")}</button>
      </div>` +
      top.map((offer, index) => `<div class="recommendation-answer">
        <strong>${index + 1}. ${escapeHtml(offer.brand || "")}</strong> - ${escapeHtml(tierGroup(offer))}
        <ul>
          <li><strong>${escapeHtml(language === "zh" ? copy.merchantId : "Merchant ID")}:</strong> ${escapeHtml(offer.merchantId || (language === "zh" ? copy.notAvailable : "not available"))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.keyMetrics : "Key metrics")}:</strong> AOV ${shortMoney(offer.aov)}, EPC ${shortEpc(offer.epc)}, commission ${shortPct(offer.commissionRate)}, clicks ${number(offer.clicks).toLocaleString()}, orders ${number(offer.orders).toLocaleString()}, CVR ${shortPct(offer.conversionRate)}, revenue ${shortMoney(offer.salesAmount)}</li>
          ${tier2RecommendationDetailsHtml(offer, language)}
          <li><strong>${escapeHtml(language === "zh" ? copy.whyRecommended : "Why recommended")}:</strong> ${escapeHtml(whyRecommended(offer, localizedContext))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.bestTrafficAngle : "Best traffic angle")}:</strong> ${escapeHtml(bestAngle(offer, localizedContext))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.cautionNextStep : "Caution / next step")}:</strong> ${escapeHtml(caution(offer, language))}</li>
        </ul>
      </div>`).join("");
  }

  function paymentCycleOfferAnswer(prompt, filter) {
    const language = responseLanguageFor(prompt);
    const rows = offers
      .filter((offer) => paymentCycleFilterMatches(offer, filter))
      .sort((a, b) => number(a.paymentCycle) - number(b.paymentCycle) || tierPriority(a, true, true) - tierPriority(b, true, true) || number(b.orders) - number(a.orders));
    const requestedCount = requestedRecommendationCount(prompt, Math.min(rows.length, MAX_RECOMMENDATION_EXPORT));
    const exportRows = rows.slice(0, Math.min(requestedCount, MAX_RECOMMENDATION_EXPORT));
    const top = exportRows.slice(0, 5);
    const filterText = paymentCycleFilterText(filter, language);
    const scopeOperator = { "<": "below", "<=": "up-to", ">": "above", ">=": "at-least" }[filter.operator] || "cycle";
    const scope = `payment-cycle-${scopeOperator}-${filter.threshold}-days`;
    setContext(buildRecommendationContext(exportRows, {
      exportScope: scope,
      exportCount: exportRows.length,
      requestedCount,
      paymentCycleFilter: filter,
      includeTier4: true,
      includeBlack: true
    }));
    if (!top.length) {
      return language === "zh"
        ? `没有找到${escapeHtml(filterText)}的 offer。可以尝试放宽条件，比如 120天以下。`
        : `I found no offers with ${escapeHtml(filterText)}.`;
    }
    const downloadId = registerRecommendationDownload(exportRows, {
      exportScope: scope,
      paymentCycleFilter: filter,
      includeTier4: true,
      includeBlack: true
    }, requestedCount);
    const foundText = exportRows.length < rows.length
      ? `showing ${exportRows.length.toLocaleString()} of ${rows.length.toLocaleString()} matching offers`
      : `${exportRows.length.toLocaleString()} matching offers`;
    if (language === "zh") {
      const zhFoundText = exportRows.length < rows.length
        ? `导出 ${exportRows.length.toLocaleString()} 个，共 ${rows.length.toLocaleString()} 个匹配 offer`
        : `找到 ${exportRows.length.toLocaleString()} 个匹配 offer`;
      return `<p><strong>付款周期筛选预览：</strong>${escapeHtml(filterText)}，按付款周期从短到长排序；${escapeHtml(zhFoundText)}。聊天中先预览前 ${top.length.toLocaleString()} 个。</p>` +
        `<div class="download-card">
          <div>
            <strong>付款周期 offer 文件</strong>
            <span>${exportRows.length.toLocaleString()} 个 offer，单一 Excel 总表，按付款周期从短到长排序。</span>
          </div>
          <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">下载 Excel</button>
        </div>` +
        resultTable(top, paymentCycleOfferColumns, language);
    }
    return `<p><strong>Payment cycle preview:</strong> ${escapeHtml(filterText)}, sorted shortest first; ${escapeHtml(foundText)}. Showing the top ${top.length.toLocaleString()} here so the chat stays readable.</p>` +
      `<div class="download-card">
        <div>
          <strong>Full payment-cycle file</strong>
          <span>${exportRows.length.toLocaleString()} offers with ${escapeHtml(filterText)}, sorted from shortest payment cycle.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      resultTable(top, paymentCycleOfferColumns, language);
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
      const download = downloadCardHtml(rows, {
        downloadType: "payments",
        filePrefix: "payment_records",
        exportScope: title,
        sheetName: "Payments",
        downloadColumns: paymentExportColumns()
      }, {
        title: "Payment records file",
        description: `${rows.length.toLocaleString()} payment records for this merchant/month lookup.`
      });
      if (language === "zh") {
        return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(copy.paymentSummary)}: ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。${escapeHtml(copy.paymentCycle)}：${escapeHtml(cycleText)}。</p>` +
          download +
          resultTable(rows, paymentColumnsFor(language), language);
      }
      return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(t("payment.summary", "payment summary"))}: ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}. ${escapeHtml(t("payment.cycle", "payment cycle"))}: ${escapeHtml(cycleText)}.</p>` +
        download +
        resultTable(rows, paymentColumnsFor(language), language);
    }

    if (month) rows = rows.filter((record) => record.reportMonth === month);
    if (tier) rows = rows.filter((record) => record.tier === tier);
    if (/unpaid|issue|late|not paid|overdue|due/.test(lower) || /未付款|没付款|未支付|逾期|到期|需跟进/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Unpaid" || isPaymentOverdue(record));
    else if (/partial/.test(lower) || /部分付款|部分支付/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Partial");
    else if (/pending|not available yet|before due/.test(lower) || /待处理|未到期|还没到|等待/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Pending");
    else if (/already paid|\bpaid\b/.test(lower) || /已付款|已支付/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Paid");
    else rows = rows.filter((record) => record.paymentStatus !== "Paid" || /all|summary|overview/.test(lower) || /全部|所有|汇总|概览/.test(prompt));

    rows = sortPaymentRows(rows).slice(0, 60);
    setContext(buildPaymentContext(rows, prompt));
    const s = updatePaymentSummary(rows);
    const label = month ? `${month} payment records` : "Payment records";
    const download = downloadCardHtml(rows, {
      downloadType: "payments",
      filePrefix: "payment_records",
      exportScope: label,
      sheetName: "Payments",
      downloadColumns: paymentExportColumns()
    }, {
      title: "Payment records file",
      description: `${rows.length.toLocaleString()} payment records matching this request.`
    });
    if (language === "zh") {
      const title = month ? `${month} ${copy.paymentRecords}` : copy.paymentRecords;
      return `<p><strong>${escapeHtml(title)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。</p>` +
        download +
        resultTable(rows, paymentColumnsFor(language), language);
    }
    return `<p><strong>${escapeHtml(state.language === "zh" ? `${optionText(month || "") || t("payments.records", "Payment records")}` : label)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}.</p>` +
      download +
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
    const tierOfferPlan = parseTierOfferRequest(prompt);
    if (tierOfferPlan.length) return recommendationBundleAnswer(prompt, tierOfferPlan);
    if (isRecommendationExclusionPrompt(prompt)) return recommendationBundleExclusionAnswer(prompt);
    if (isRecommendationReplacementPrompt(prompt)) return recommendationBundleReplacementAnswer(prompt);
    const intent = detectQueryIntent(prompt);
    const asin = findByAsin(prompt);
    if (asin && intent === "asin") return asinAnswer(asin);

    const exact = findByMerchantId(prompt);
    if (exact) return merchantOverview(exact, "", language);

    const paymentCycleFilter = extractPaymentCycleFilter(prompt);
    if (paymentCycleFilter) return paymentCycleOfferAnswer(prompt, paymentCycleFilter);

    if (contextFollowup(lower)) {
      if (promptHasPaymentTerms(lower) || /付款|支付|未付款|已付款|周期|逾期|到期/.test(prompt)) {
        return paymentAnswer(`${state.lastOffer.brand} ${prompt}`);
      }
      if (/epc/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.epcIs)} ${epc(state.lastOffer.epc)}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> EPC is ${epc(state.lastOffer.epc)}.`;
      }
      if (/aov|客单价/.test(lower)) {
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
    const wantsTier4 = /tier 4|retest|第四层|第四级|四层|四级|重测|重新测试/i.test(prompt);
    const wantsBlack = /black|blocked|黑名单|黑色|屏蔽|暂停/i.test(prompt);
    const wantsRecommendation = intent === "recommendation";
    const wantsGoogle = /google|keyword|brand keyword|search/.test(lower) || /关键词|搜索|品牌词/.test(prompt);
    const metricFilters = extractMetricFilters(prompt);
    const metricSort = extractMetricSortIntent(prompt);

    if (intent === "payment") {
      return paymentAnswer(prompt);
    }

    if (wantsRecommendation) {
      let pool = category ? sortedForCategory(category, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt, tier }) : offers;
      if (tier) pool = pool.filter((offer) => offer.tier === tier);
      pool = applyMetricFilters(pool, metricFilters);
      return recommendationHtml(pool, { category, tier, google: wantsGoogle, includeTier4: wantsTier4, includeBlack: wantsBlack, metricFilters, metricSort, requestedCount: requestedRecommendationCount(prompt), prompt });
    }

    if (tier) {
      const rows = offers
        .filter((offer) => offer.tier === tier)
        .filter((offer) => wantsTier4 || offer.tier !== "Tier 4" || tier === "Tier 4")
        .filter((offer) => wantsBlack || offer.tier !== "BLACK TIER" || tier === "BLACK TIER")
        .sort((a, b) => compareRecommendationOffers(a, b, { includeTier4: true, includeBlack: true }));
      setContext(buildTierContext(tier, rows));
      const topRows = topRecommendations(rows, { tier, includeTier4: true, includeBlack: true });
      const columns = tier === "Tier 2" ? tier2CompactColumns : compactColumns;
      const title = language === "zh" ? `${escapeHtml(tier)} ${escapeHtml(copy.tierOverview)}` : `${escapeHtml(tier)} overview and top candidates:`;
      return title +
        downloadCardHtml(rows, {
          downloadType: "offers",
          filePrefix: "tier_offers",
          exportScope: tier,
          sheetName: tier
        }, {
          title: `${tier} file`,
          description: `${rows.length.toLocaleString()} ${tier} offers from the current offer data.`
        }) +
        resultTable(topRows, columns, language);
    }

    if (category) {
      const rows = sortedForCategory(category, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt });
      const previewRows = rows.slice(0, 25);
      setContext(buildCategoryContext(category, rows.slice(0, 80)));
      const title = language === "zh"
        ? `<strong>${escapeHtml(category)}</strong> ${escapeHtml(copy.categoryOffers)}`
        : `Relevant <strong>${escapeHtml(category)}</strong> offers, sorted by tier priority and performance:`;
      return title +
        downloadCardHtml(rows, {
          downloadType: "offers",
          filePrefix: "category_offers",
          exportScope: category,
          sheetName: "Category Offers"
        }, {
          title: `${category} file`,
          description: `${rows.length.toLocaleString()} matching category offers.`
        }) +
        resultTable(previewRows, compactColumns, language);
    }

    if (/high epc|high aov|low conversion|low cvr|tracking issue|has asin|discount/.test(lower) || /高\s*epc|高\s*aov|低转化|低转换|跟踪问题|追踪问题|有\s*asin|折扣|优惠/.test(prompt)) {
      const rows = offers
        .filter((offer) => !(/tracking issue/.test(lower) || /跟踪问题|追踪问题/.test(prompt)) || offer.trackingIssue)
        .filter((offer) => !(/has asin/.test(lower) || /有\s*asin/.test(prompt)) || offer.hasAsin)
        .filter((offer) => !(/discount/.test(lower) || /折扣|优惠/.test(prompt)) || offer.hasDiscount)
        .sort((a, b) => {
          if (/low conversion|low cvr/.test(lower) || /低转化|低转换/.test(prompt)) return number(a.conversionRate) - number(b.conversionRate);
          if (/high aov/.test(lower) || /高\s*aov/.test(prompt)) return number(b.aov) - number(a.aov);
          return number(b.epc) - number(a.epc);
        });
      const previewRows = rows.slice(0, 30);
      setContext(buildCategoryContext("filtered result", rows));
      return downloadCardHtml(rows, {
        downloadType: "offers",
        filePrefix: "filtered_offers",
        exportScope: lower.slice(0, 48) || "filtered_result",
        sheetName: "Filtered Offers"
      }, {
        title: "Filtered offers file",
        description: `${rows.length.toLocaleString()} matching offers for this filter.`
      }) +
      resultTable(previewRows, compactColumns, language);
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

  function dashboardOfferPreviewLimit() {
    return state.category === "all" ? 5 : 80;
  }

  function dashboardCategoryHeaderRow(group, previewCount) {
    const summary = group.summary;
    const remaining = Math.max(0, group.rows.length - previewCount);
    const remainingText = remaining ? ` · ${remaining.toLocaleString()} more` : "";
    return `<tr class="category-group-row">
      <td colspan="9">
        <div class="category-group-summary">
          <div>
            <strong>${escapeHtml(group.category)}</strong>
            <span>${group.rows.length.toLocaleString()} offers${escapeHtml(remainingText)}</span>
          </div>
          <dl>
            <div><dt>CVR</dt><dd>${shortPct(summary.avgCvr)}</dd></div>
            <div><dt>AOV</dt><dd>${shortMoney(summary.avgAov)}</dd></div>
            <div><dt>Revenue</dt><dd>${shortMoney(summary.totalRevenue)}</dd></div>
            <div><dt>Orders</dt><dd>${number(summary.totalOrders).toLocaleString()}</dd></div>
          </dl>
        </div>
      </td>
    </tr>`;
  }

  function dashboardOfferRow(offer) {
    const paidClass = hasPaymentRisk(offer) ? "unpaid" : hasPaidSignal(offer) ? "paid" : "neutral";
    return `<tr>
        <td><strong>${escapeHtml(offer.brand || "")}</strong><p>${escapeHtml(offer.merchantId || "")}</p><p>${escapeHtml(displayCategory(offer))}</p></td>
        <td><span class="badge tier">${escapeHtml(tierGroup(offer))}</span></td>
        <td>${escapeHtml(offer.network || "")}</td>
        <td>${escapeHtml(displayCategory(offer))}</td>
        <td>${shortEpc(offer.epc)}</td>
        <td>${shortMoney(offer.aov)}</td>
        <td>${shortPct(offer.conversionRate)}</td>
        <td>${number(offer.orders).toLocaleString()}</td>
        <td><span class="badge ${paidClass}">${escapeHtml(offer.paymentStatus || "not available")}</span></td>
      </tr>`;
  }

  function renderTable(rows) {
    const groups = dashboardCategoryGroups(rows);
    const previewLimit = dashboardOfferPreviewLimit();
    els.tableCount.textContent = `${rows.length.toLocaleString()} ${t("table.offerCount", "matching offers")} across ${groups.length.toLocaleString()} main categories`;
    els.table.innerHTML = groups.map((group) => {
      const previewRows = group.rows.slice(0, previewLimit);
      return dashboardCategoryHeaderRow(group, previewRows.length) +
        previewRows.map(dashboardOfferRow).join("");
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

  function safeFilePart(value, fallback = "export") {
    const text = String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return text || fallback;
  }

  function safeSheetName(value) {
    const name = String(value || "Export").replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
    return name || "Export";
  }

  function todayFileStamp() {
    return isoDate(PAYMENT_TODAY) || new Date().toISOString().slice(0, 10);
  }

  function registerRecommendationDownload(rows, context = {}, requestedCount = rows.length) {
    const id = `recommendation-${++state.downloadSequence}`;
    const today = todayFileStamp();
    const type = context.downloadType || "offers";
    const scope = context.exportScope || context.category || context.tier || "top";
    const prefix = context.filePrefix || (type === "payments" ? "payment_records" : type === "sheet" ? "sheet_records" : "offer_recommendations");
    const rowLabel = type === "payments" ? "records" : type === "sheet" ? "rows" : "offers";
    const columns = context.downloadColumns || (type === "payments" ? paymentExportColumns() : recommendationExportColumns());
    const sheetName = context.sheetName || (type === "payments" ? "Payments" : type === "sheet" ? "Sheet Records" : "Recommendations");
    state.recommendationDownloads[id] = {
      rows,
      context: { ...context, columns, sheetName },
      requestedCount,
      columns,
      sheetName,
      filename: `${prefix}_${safeFilePart(scope)}_${rows.length}_${rowLabel}_${today}.xlsx`
    };
    return id;
  }

  function downloadCardHtml(rows, context = {}, options = {}) {
    if (!rows || !rows.length) return "";
    const downloadId = registerRecommendationDownload(rows, context, context.requestedCount || rows.length);
    const title = options.title || "Download file";
    const description = options.description || `${rows.length.toLocaleString()} rows available for Excel download.`;
    const buttonLabel = options.buttonLabel || "Download Excel";
    return `<div class="download-card">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
      <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">${escapeHtml(buttonLabel)}</button>
    </div>`;
  }

  function recommendationExportColumns() {
    return [
      ["Rank", (offer, index) => index + 1],
      ["Brand", (offer) => offer.brand || ""],
      ["Merchant ID", (offer) => offer.merchantId || ""],
      ["Tier", (offer) => tierGroup(offer)],
      ["Network", (offer) => offer.network || ""],
      ["Category", (offer) => displayCategory(offer)],
      ["Main Category", (offer) => offer.mainCategory || ""],
      ["Subcategory", (offer) => offer.subCategory || ""],
      ["Main Category CN", (offer) => offer.mainCategoryCn || ""],
      ["Subcategory CN", (offer) => offer.subCategoryCn || ""],
      ["EPC", (offer) => number(offer.epc)],
      ["AOV", (offer) => number(offer.aov)],
      ["Conversion Rate", (offer) => number(offer.conversionRate)],
      ["Clicks", (offer) => number(offer.clicks)],
      ["DPV", (offer) => number(offer.dpv)],
      ["ATC", (offer) => number(offer.atc)],
      ["Orders", (offer) => number(offer.orders)],
      ["Revenue", (offer) => number(offer.salesAmount)],
      ["Commission", (offer) => number(offer.affCommission)],
      ["Commission Rate", (offer) => number(offer.commissionRate)],
      ["Payment Status", (offer) => offer.paymentStatus || ""],
      ["Payment Cycle", (offer) => offer.paymentCycle || ""],
      ["Recommended Link", (offer) => offer.recommendedLink || ""],
      ["Top ASINs", (offer) => Array.isArray(offer.topAsins) ? offer.topAsins.join(", ") : (offer.topAsins || offer.asinsText || "")],
      ["Publisher Count", (offer) => tier2PublisherCountText(offer, "en") || offer.publisherCount || ""],
      ["Publisher Success Rate", (offer) => tier2PublisherSuccessText(offer, "en") || ""],
      ["Tier 2 Optimization Idea", (offer) => tier2OptimizationIdea(offer, "en") || ""],
      ["Recommended Action", (offer, index, context) => recommendedAction(offer, context.language || state.language)],
      ["Why Recommended", (offer, index, context) => whyRecommended(offer, context)],
      ["Best Traffic Angle", (offer, index, context) => bestAngle(offer, context)],
      ["Caution", (offer, index, context) => caution(offer, context.language || state.language)]
    ];
  }

  function paymentExportColumns() {
    return [
      ["Merchant ID", (record) => record.merchantId || ""],
      ["Merchant", (record) => record.merchantName || ""],
      ["Tier", (record) => record.tier || "Unknown"],
      ["Network", (record) => record.network || ""],
      ["Category", (record) => displayCategory(record)],
      ["Main Category", (record) => record.mainCategory || ""],
      ["Subcategory", (record) => record.subCategory || ""],
      ["Month", (record) => `${optionText(record.reportMonth)} ${record.reportYear || ""}`.trim()],
      ["Status", (record) => statusText(record.paymentStatus || "Unknown")],
      ["Revenue Made", (record) => number(record.revenueMade)],
      ["Commission Made", (record) => number(record.commissionMade)],
      ["Paid Amount", (record) => number(record.paidAmount)],
      ["Remaining Amount", (record) => number(record.remainingAmount)],
      ["Payment Cycle Days", (record) => number(record.paymentCycle)],
      ["Expected Payment Date", (record) => record.expectedPaymentDate || record.paymentAvailabilityDate || ""],
      ["Last Checked", (record) => record.lastCheckedDate || ""],
      ["Notes", (record) => record.notes || ""]
    ];
  }

  function objectExportColumns(rows, preferredHeaders = []) {
    const headers = preferredHeaders.length
      ? preferredHeaders
      : Array.from(rows.reduce((set, row) => {
          Object.keys(row || {}).forEach((key) => set.add(key));
          return set;
        }, new Set()));
    return headers.map((header) => [header, (row) => row && row[header] != null ? row[header] : ""]);
  }

  function gridRowsForExport(grid) {
    const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const headers = Array.from({ length: maxCols }, (_, index) => columnLabel(index));
    const rows = grid.map((row) => headers.reduce((record, header, index) => {
      record[header] = row[index] || "";
      return record;
    }, {}));
    return { rows, headers };
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
    const columns = context.columns || recommendationExportColumns();
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

  function workbookXml(sheetName = "Recommendations") {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/>
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
      { name: "xl/workbook.xml", data: workbookXml(context.sheetName) },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml() },
      { name: "xl/styles.xml", data: stylesXml() },
      { name: "xl/worksheets/sheet1.xml", data: worksheetXml(rows, context) }
    ]);
  }

  function triggerWorkbookDownload(workbook, filename) {
    const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadRowsAsXlsx(rows, context = {}) {
    if (!rows || !rows.length) return;
    const type = context.downloadType || "sheet";
    const prefix = context.filePrefix || (type === "payments" ? "payment_records" : type === "offers" ? "offers" : "sheet_records");
    const scope = context.exportScope || context.sheetName || type;
    const rowLabel = type === "offers" ? "offers" : type === "payments" ? "records" : "rows";
    const filename = context.filename || `${prefix}_${safeFilePart(scope)}_${rows.length}_${rowLabel}_${todayFileStamp()}.xlsx`;
    const workbook = createRecommendationWorkbook(rows, {
      ...context,
      columns: context.downloadColumns || context.columns || (type === "payments" ? paymentExportColumns() : type === "offers" ? recommendationExportColumns() : objectExportColumns(rows)),
      sheetName: context.sheetName || "Export"
    });
    triggerWorkbookDownload(workbook, filename);
  }

  function downloadFilteredXlsx() {
    const rows = getFiltered();
    downloadRowsAsXlsx(rows, {
      downloadType: "offers",
      filePrefix: "filtered_offers",
      exportScope: "current_dashboard",
      sheetName: "Filtered Offers"
    });
  }

  function downloadPaymentsXlsx() {
    const rows = getFilteredPayments();
    downloadRowsAsXlsx(rows, {
      downloadType: "payments",
      filePrefix: "payment_records",
      exportScope: "current_filters",
      sheetName: "Payments",
      downloadColumns: paymentExportColumns()
    });
  }

  function downloadSheetTargetsXlsx() {
    const headers = ["Month", "Tier", "Brand Count", "Total Clicks", "Order Count", "Revenue", "Avg Conversion", "New Tier Entries", "Tier Exits", "Target"];
    const rows = sortReportRows(filteredTargetRecords(), state.targetSort, (row, key) => row[key]);
    downloadRowsAsXlsx(rows, {
      downloadType: "sheet",
      filePrefix: "monthly_targets",
      exportScope: state.targetFilters.month === "all" ? "all_months" : state.targetFilters.month,
      sheetName: "Monthly Targets",
      downloadColumns: objectExportColumns(rows, headers)
    });
  }

  function downloadTierSheetXlsx() {
    const sheet = sheetByName(state.selectedTierPage);
    if (!sheet) return;
    if (sheet.headers && sheet.headers.length) {
      const rows = sortReportRows(getFilteredTierSheetRows(sheet), state.tierSheetSort, (row, key) => row[key]);
      const headers = displayHeadersForSheet(sheet, sheet.headers);
      downloadRowsAsXlsx(rows, {
        downloadType: "sheet",
        filePrefix: "tier_records",
        exportScope: state.selectedTierPage,
        sheetName: state.selectedTierPage,
        downloadColumns: objectExportColumns(rows, headers)
      });
      return;
    }
    const gridExport = gridRowsForExport(sheet.grid || []);
    downloadRowsAsXlsx(gridExport.rows, {
      downloadType: "sheet",
      filePrefix: "tier_records",
      exportScope: state.selectedTierPage,
      sheetName: state.selectedTierPage,
      downloadColumns: objectExportColumns(gridExport.rows, gridExport.headers)
    });
  }

  function downloadRecommendationXlsx(downloadId) {
    const item = state.recommendationDownloads[downloadId];
    if (!item || !item.rows || !item.rows.length) return;
    const workbook = createRecommendationWorkbook(item.rows, {
      ...item.context,
      columns: item.columns || item.context.columns,
      sheetName: item.sheetName || item.context.sheetName
    });
    triggerWorkbookDownload(workbook, item.filename);
  }

  function paymentStatusClass(status) {
    const text = String(status || "").toLowerCase();
    if (text === "paid") return "paid";
    if (text === "overdue") return "overdue";
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
        <td><strong>${escapeHtml(record.merchantName || "")}</strong><p>${escapeHtml(displayCategory(record))}</p></td>
        <td>${escapeHtml(record.network || "")}</td>
        <td><span class="badge tier">${escapeHtml(record.tier || "Unknown")}</span></td>
        <td>${escapeHtml(`${optionText(record.reportMonth)} ${record.reportYear}`)}</td>
        <td><span class="badge ${paymentStatusClass(record.paymentStatus)}">${escapeHtml(statusText(record.paymentStatus || "Unknown"))}</span></td>
        <td>${shortMoney(record.revenueMade)}</td>
        <td>${shortMoney(record.commissionMade)}</td>
        <td>${escapeHtml(record.paymentCycle ? `${record.paymentCycle} days` : "-")}</td>
        <td>${escapeHtml(record.expectedPaymentDate || record.paymentAvailabilityDate || "-")}</td>
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
    const displayHeaders = displayHeadersForSheet(sheet, headers);
    const sourceRows = customRows || sheet.rows || [];
    const rows = headers.length
      ? sortReportRows(sourceRows, state.tierSheetSort, (row, key) => row[key])
      : sourceRows;
    const grid = sheet.grid || [];
    titleEl.textContent = `${sheet.name} ${t("sheet.targetRecords", "Sheet Records")}`;
    if (headers.length) {
      countEl.textContent = `${rows.length.toLocaleString()} rows / ${displayHeaders.length.toLocaleString()} columns`;
      headEl.innerHTML = `<tr>${displayHeaders.map((header) => sortableHeaderHtml(header, state.tierSheetSort, "tier")).join("")}</tr>`;
      rowsEl.innerHTML = rows.map((row) => (
        `<tr class="${escapeHtml(tierRowClass(sheet, row))}">${displayHeaders.map((header) => `<td>${sheetCellHtml(sheet, row, header)}</td>`).join("")}</tr>`
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

  function tier2PhaseKind(sheet, row) {
    if (!sheet || sheet.name !== "Tier 2") return "";
    const phase = String(row.Phase || "").trim().toLowerCase();
    if (phase.includes("growing")) return "green";
    if (phase.includes("stable")) return "yellow";
    if (phase.includes("declining")) return "red";
    return "";
  }

  function displayHeadersForSheet(sheet, headers) {
    if (!sheet || sheet.name !== "Tier 1") return headers || [];
    const desired = ["May Revenue", "June Revenue", "Completion Rate"];
    const output = [];
    (headers || []).forEach((header) => {
      if (desired.includes(header)) return;
      output.push(header);
      if (header === "Order count") {
        desired.forEach((extra) => {
          if ((headers || []).includes(extra)) output.push(extra);
        });
      }
    });
    return output;
  }

  function tierReasonText(row) {
    return String(row["Tier Reason"] || row.Reason || row.Recommendation || "").trim();
  }

  function tierRowHighlightKind(sheet, row) {
    if (!sheet) return "";
    const reason = tierReasonText(row).toLowerCase();
    const rank = parseSheetNumber(row["Original Rank"]);
    if (sheet.name === "Tier 1") {
      return rank >= 40 ? "green" : "";
    }
    if (sheet.name === "Tier 2") {
      return tier2PhaseKind(sheet, row);
    }
    if (sheet.name === "Tier 3") {
      if (/new june raw offer with orders|moved from tier 4/.test(reason)) return "green";
      if (/moved from tier 2|declined|declining/.test(reason)) return "red";
      return "";
    }
    if (sheet.name === "Tier 4") {
      if (/new june raw offer/.test(reason)) return "green";
      if (/moved to tier 4|moved\/kept in tier 4|0 orders|no june .*raw data/.test(reason)) return "red";
      return "";
    }
    return "";
  }

  function tierRowClass(sheet, row) {
    const kind = tierRowHighlightKind(sheet, row);
    return kind ? `tier-highlight-row tier-highlight-${kind}` : "";
  }

  function sheetCellHtml(sheet, row, header) {
    const value = formatSheetCell(header, row[header]);
    const kind = header === "Phase" ? tier2PhaseKind(sheet, row) : "";
    if (!kind || !value) return escapeHtml(value);
    return `<span class="phase-pill phase-${escapeHtml(kind)}">${escapeHtml(value)}</span>`;
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
    const rows = sortReportRows(filteredTargetRecords(), state.targetSort, (row, key) => row[key]);
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
    els.sheetGridHead.innerHTML = `<tr>${headers.map((header) => sortableHeaderHtml(header, state.targetSort, "target")).join("")}</tr>`;
    els.sheetGridRows.innerHTML = rows.map((row) => (
      `<tr>${headers.map((header) => `<td>${escapeHtml(formatSheetCell(header, row[header]))}</td>`).join("")}</tr>`
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
    fillSelect(els.category, uniqueCategoryValues());
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
    els.sheetGridHead.addEventListener("click", handleReportSortClick);
    els.tierSheetHead.addEventListener("click", handleReportSortClick);
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
    els.download.addEventListener("click", downloadFilteredXlsx);
    els.paymentDownload.addEventListener("click", downloadPaymentsXlsx);
    els.sheetDownload.addEventListener("click", downloadSheetTargetsXlsx);
    els.tierDownload.addEventListener("click", downloadTierSheetXlsx);
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

  if (window.__OFFER_INTELLIGENCE_TEST__) {
    window.OFFER_INTELLIGENCE_TEST_HOOKS = {
      categoryForPrompt,
      detectQueryIntent,
      cleanedMerchantLookupPhrase,
      hasStrongMerchantLookup,
      extractMetricFilters,
      extractMetricSortIntent,
      extractPaymentCycleFilter,
      paymentCycleFilterText,
      getPaymentRecords,
      withPendingPaymentPlaceholders,
      requestedRecommendationCount,
      parseTierOfferRequest,
      answerPrompt,
      currentRecommendationBundle: () => state.activeRecommendationBundle,
      excludedRecommendationKeys: () => Array.from(state.excludedRecommendationKeys),
      rankedRecommendations,
      displayCategory,
      dashboardCategoryGroups
    };
  } else {
    init();
  }
})();
