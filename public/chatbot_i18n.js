(function () {
  const MONTHS_ZH = {
    "一月": "January",
    "1月": "January",
    "二月": "February",
    "2月": "February",
    "三月": "March",
    "3月": "March",
    "四月": "April",
    "4月": "April",
    "五月": "May",
    "5月": "May",
    "六月": "June",
    "6月": "June",
    "七月": "July",
    "7月": "July",
    "八月": "August",
    "8月": "August",
    "九月": "September",
    "9月": "September",
    "十月": "October",
    "10月": "October",
    "十一月": "November",
    "11月": "November",
    "十二月": "December",
    "12月": "December"
  };

  const CATEGORY_ALIASES_ZH = {
    beauty: ["美妆", "美容", "个护", "护肤", "护发", "彩妆", "美妆个护"],
    home: ["家居", "厨房", "家具", "床品", "办公"],
    pet: ["宠物", "狗", "猫", "宠物用品"],
    electronics: ["电子", "数码", "科技", "相机", "音频", "耳机"],
    supplement: ["保健", "健康", "维生素", "营养", "营养品", "膳食补充剂"],
    baby: ["母婴", "婴儿", "儿童", "孩子"],
    outdoors: ["户外", "运动", "庭院", "花园", "园艺"],
    automotive: ["汽车", "车载", "车辆"],
    tools: ["工具", "家装", "五金"]
  };

  const COPY = {
    zh: {
      recommendationPreview: "推荐预览",
      recommendationEmpty: "当前筛选条件下没有找到符合这次推荐请求的 offer。",
      showingTop: "这里先展示前 {count} 个，方便在聊天里阅读。",
      exportComplete: "Excel 下载文件包含本次请求的全部 {count} 个 offer。",
      exportPartial: "当前只找到 {count} 个符合条件的 offer。",
      fullRecommendationFile: "完整推荐文件",
      rankedBy: "按 tier、EPC、CVR、收入、ATC、DPV 和付款风险排序。",
      downloadExcel: "下载 Excel",
      merchantId: "Merchant ID",
      keyMetrics: "关键指标",
      whyRecommended: "推荐原因",
      bestTrafficAngle: "最佳流量角度",
      cautionNextStep: "注意事项 / 下一步",
      paymentSummary: "付款概览",
      paymentRecords: "付款记录",
      recordsAcross: "条记录，覆盖",
      merchants: "个商家",
      unpaid: "未付款",
      pending: "待处理",
      overdue: "逾期",
      paymentCycle: "付款周期",
      notAvailable: "当前数据不可用",
      noMatches: "没有找到匹配记录。",
      notFoundPrefix: "没有找到",
      tryLookup: "请尝试 Merchant ID、ASIN 或品类。",
      closeMatches: "我找到了多个相近商家，你想看哪一个？",
      asinBelongsTo: "这个 ASIN 属于：",
      asinNotFound: "当前数据中没有找到这个 ASIN。",
      productAsinInfo: "产品 / ASIN 信息",
      merchantOverview: "商家概览",
      recommendedTrafficAngle: "推荐流量角度",
      tierOverview: "概览和优先候选：",
      categoryOffers: "相关 offer，已按 tier 优先级和表现排序：",
      help: "你可以查询商家名称、Merchant ID、ASIN、品类、付款状态，或让我推荐 offer。",
      epcIs: "的 EPC 是",
      aovIs: "的 AOV 是",
      orderCountIs: "的订单数是"
    },
    en: {}
  };

  const LABELS_ZH = {
    Merchant: "商家",
    "Merchant ID": "商家 ID",
    "Merchant name": "商家名称",
    Tier: "分层",
    Highlight: "重点",
    Category: "品类",
    Network: "网络",
    Month: "月份",
    Status: "状态",
    AOV: "AOV",
    EPC: "EPC",
    CVR: "CVR",
    Orders: "订单",
    Revenue: "收入",
    "Revenue made": "产生收入",
    Commission: "佣金",
    "Commission made": "产生佣金",
    Payment: "付款",
    Cycle: "周期",
    Available: "可检查日期",
    Notes: "备注",
    Action: "动作",
    Clicks: "点击",
    DPV: "DPV",
    ATC: "ATC",
    "Order count": "订单数",
    "Conversion rate": "转化率",
    "Commission rate": "佣金率",
    "Discount/deal info": "折扣 / Deal 信息",
    "Top ASINs": "Top ASIN",
    "Payment status": "付款状态",
    "Payment cycle": "付款周期",
    "Link status": "链接状态",
    "Recommended action": "建议动作",
    "Notes / recommendation": "备注 / 推荐"
  };

  function hasChinese(value) {
    return /[\u4e00-\u9fff]/.test(String(value || ""));
  }

  function responseLanguage(prompt, currentLanguage = "en") {
    return hasChinese(prompt) || currentLanguage === "zh" ? "zh" : "en";
  }

  function detectIntent(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/\bB[A-Z0-9]{9}\b/i.test(text)) return "asin";
    if (/\b\d{5,8}(?:\.0)?\b/.test(text)) return "merchant";
    if (/付款|未付款|没付款|已付款|逾期|到期|周期|佣金|欠款|待处理|部分付款|付款状态|付款风险/.test(text)) return "payment";
    if (/推荐|推|重点|最好|最佳|优先|选品|候选|前\s*\d+|给我\s*\d+/.test(text)) return "recommendation";
    if (/黑名单|黑层|black\s*tier|tier\s*[1-4]|[一二三四]级|第[一二三四]层/.test(text)) return "tier";
    if (categoryForPrompt(text, [])) return "category";
    return null;
  }

  function tierFromPrompt(prompt) {
    const text = String(prompt || "");
    if (/黑名单|黑层|black\s*tier|blocked/i.test(text)) return "BLACK TIER";
    const en = text.match(/tier\s*([1-4])/i);
    if (en) return `Tier ${en[1]}`;
    const zh = text.match(/(?:第)?([一二三四1234])(?:层|级)/);
    if (!zh) return null;
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, "1": 1, "2": 2, "3": 3, "4": 4 };
    return `Tier ${map[zh[1]]}`;
  }

  function monthNameFromText(prompt) {
    const text = String(prompt || "");
    for (const [key, value] of Object.entries(MONTHS_ZH)) {
      if (text.includes(key)) return value;
    }
    return null;
  }

  function categoryForPrompt(prompt, knownCategories = []) {
    const text = String(prompt || "").toLowerCase();
    for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES_ZH)) {
      if (aliases.some((alias) => text.includes(alias))) return canonical;
    }
    return knownCategories.find((category) => {
      const lower = String(category || "").toLowerCase();
      if (!lower || lower === "uncategorized") return false;
      return text.includes(lower);
    }) || null;
  }

  function requestedRecommendationCount(prompt, fallback = 5, max = 1000) {
    const text = String(prompt || "");
    const match = text.match(/(?:推荐|推|给我|列出|导出)?\s*(\d{1,4})\s*(?:个|条)?\s*(?:offer|品牌|商家|推荐)?/i);
    if (!match) return fallback;
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) return fallback;
    return Math.min(Math.max(Math.floor(count), 1), max);
  }

  function format(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  }

  function copy(language) {
    return COPY[language] || COPY.en;
  }

  function label(text, language) {
    if (language !== "zh") return text;
    return LABELS_ZH[text] || text;
  }

  window.CHATBOT_I18N = {
    hasChinese,
    responseLanguage,
    detectIntent,
    tierFromPrompt,
    monthNameFromText,
    categoryForPrompt,
    requestedRecommendationCount,
    copy,
    format,
    label
  };
})();
