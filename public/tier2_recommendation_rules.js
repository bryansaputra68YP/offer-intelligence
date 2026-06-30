(function () {
  const DEFAULTS = {
    lowSuccessRate: 0.4,
    minPublisherPool: 20,
    targetPublisherMin: 20,
    targetPublisherMax: 30
  };

  function asNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value).trim();
    if (!text) return null;
    const cleaned = text.replace(/,/g, "").replace(/%$/, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return text.endsWith("%") ? n / 100 : n;
  }

  function parseRate(value) {
    const n = asNumber(value);
    if (n === null) return null;
    if (n > 1 && n <= 100) return n / 100;
    if (n >= 0 && n <= 1) return n;
    return null;
  }

  function parsePublisherCount(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const match = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (!match) return null;

    const convertingPublishers = Number(match[1]);
    const totalPublishers = Number(match[2]);
    if (
      !Number.isFinite(convertingPublishers) ||
      !Number.isFinite(totalPublishers) ||
      totalPublishers <= 0 ||
      convertingPublishers < 0 ||
      convertingPublishers > totalPublishers
    ) {
      return null;
    }

    return {
      convertingPublishers,
      totalPublishers,
      successRate: convertingPublishers / totalPublishers,
      label: `${convertingPublishers}/${totalPublishers}`
    };
  }

  function formatPercent(rate) {
    const n = parseRate(rate);
    if (n === null) return "";
    return `${(n * 100).toFixed(1)}%`;
  }

  function publisherMetrics(offer = {}) {
    const current = parsePublisherCount(offer.publisherCount);
    const june = parsePublisherCount(offer.publisherCountJune);
    const explicitRate = parseRate(offer.successRate);
    const successRate = explicitRate !== null ? explicitRate : current ? current.successRate : null;

    return {
      current,
      june,
      successRate,
      publisherCountText: current ? current.label : String(offer.publisherCount || "").trim(),
      successRateText: formatPercent(successRate)
    };
  }

  function metricSummary(metrics, language) {
    const current = metrics.current;
    if (!current) {
      return language === "zh"
        ? "当前 publisher 数量不可用"
        : "Current publisher count is not available";
    }
    return language === "zh"
      ? `${current.totalPublishers} 个 publisher 中有 ${current.convertingPublishers} 个产生订单`
      : `${current.convertingPublishers} of ${current.totalPublishers} publishers are producing orders`;
  }

  function textPack(code, metrics, language, options) {
    const pool = `${options.targetPublisherMin}-${options.targetPublisherMax}`;
    const summary = metricSummary(metrics, language);
    const success = metrics.successRateText || (language === "zh" ? "成功率不可用" : "success rate unavailable");

    const en = {
      green_under_sample: {
        label: "Controlled publisher fill",
        action: `Add a small number of similar high-fit publishers until the test pool reaches ${pool}.`,
        idea: `${summary}; keep the green offer optimized, but fill the sample carefully to ${pool} publishers before broader scaling.`,
        caution: "Do not open broad recruitment; add only similar publishers that match the current converters."
      },
      under_sample: {
        label: "Publisher test expansion",
        action: `Expand the test pool toward ${pool} publishers.`,
        idea: `${summary}; the publisher pool is still below the ${pool} target, so add more qualified publishers to validate sales and order potential.`,
        caution: "Keep additions controlled until the publisher pool reaches a reliable sample size."
      },
      low_success_replace: {
        label: "Publisher replacement",
        action: "Replace or rotate underperforming publishers to raise success rate.",
        idea: `${summary} with ${success}; the pool is already large enough, but success rate is low, so replace weaker publishers in the 20-30 person test pool with better-fit ones.`,
        caution: "Avoid adding more of the same traffic; improve the mix before scaling volume."
      },
      green_optimize: {
        label: "Optimization only",
        action: "Optimize current converting publishers; do not bring more publishers to this green offer.",
        idea: `${summary} with ${success}; green means keep the publishers that already work, scale those winners, and focus on optimization instead of adding more publishers.`,
        caution: "Do not recruit new publishers for green offers; protect and scale the working publisher mix."
      },
      red_recovery: {
        label: "Red recovery test",
        action: "Add fresh test publishers to recover sales/orders and prevent Tier 3 risk.",
        idea: `${summary} with ${success}; red means the offer is declining and could fall to Tier 3, so bring in more qualified publishers to increase sales and orders.`,
        caution: "Monitor closely for Tier 3 movement if the added publisher tests do not lift sales/orders."
      },
      maintain_optimize: {
        label: "Keep optimizing",
        action: "Keep optimizing the current publisher mix.",
        idea: `${summary} with ${success}; maintain the current pool while improving publisher quality and offer execution.`,
        caution: "Watch success rate before making a larger publisher push."
      }
    };

    const zh = {
      green_under_sample: {
        label: "小范围补量",
        action: `小范围补到 ${pool} 个 publisher 测试池`,
        idea: `${summary}；绿色 offer 仍以优化为主，但样本不足时可以谨慎补到 ${pool} 个 publisher。`,
        caution: "不要大规模新增 publisher，只补充与当前有效 publisher 相似的高匹配流量。"
      },
      under_sample: {
        label: "扩大测试池",
        action: `补量到 ${pool} 个 publisher 测试池`,
        idea: `${summary}；publisher 样本低于目标区间，需要增加合格 publisher 来验证销售潜力。`,
        caution: "补量要保持可控，先把测试池做到可靠样本再继续放大。"
      },
      low_success_replace: {
        label: "替换低效 publisher",
        action: "替换或轮换低效 publisher，提高成功率",
        idea: `${summary}，成功率 ${success}；publisher 数量已经够，但成功率偏低，应该替换低效 publisher。`,
        caution: "不要继续加入同类型低效流量，先优化 publisher 组合再扩大。"
      },
      green_optimize: {
        label: "只优化",
        action: "优化现有有效 publisher，不大规模新增",
        idea: `${summary}，成功率 ${success}；绿色 offer 应保留已经有效的 publisher，并通过优化放大。`,
        caution: "不要引入大批新 publisher，优先保护当前已经跑通的 publisher 组合。"
      },
      red_recovery: {
        label: "红色恢复测试",
        action: "新增测试 publisher，拉升 sales/orders，防止跌到 Tier 3",
        idea: `${summary}，成功率 ${success}；该 offer 在下滑或观察中，需要刷新 publisher 测试池来拉动订单。`,
        caution: "如果新增测试不能拉升 sales/orders，需要警惕继续跌到 Tier 3。"
      },
      maintain_optimize: {
        label: "持续优化",
        action: "继续优化当前 publisher 组合",
        idea: `${summary}，成功率 ${success}；保持当前测试池，同时提升 publisher 质量和 offer 执行。`,
        caution: "继续观察成功率，再决定是否扩大 publisher 测试。"
      }
    };

    return (language === "zh" ? zh : en)[code];
  }

  function strategyForOffer(offer = {}, context = {}) {
    if (offer.tier !== "Tier 2") return null;

    const options = {
      ...DEFAULTS,
      ...context
    };
    const metrics = publisherMetrics(offer);
    const total = metrics.current ? metrics.current.totalPublishers : null;
    const rate = metrics.successRate;
    const language = context.language === "zh" ? "zh" : "en";
    const tierGroup = String(context.tierGroup || "");
    const highlightStatus = String(context.highlightStatus || "");
    const phase = String(offer.phase || "");
    const redSignal = /red|watch/i.test(`${tierGroup} ${highlightStatus}`) || /declin/i.test(phase);
    const greenSignal = /green/i.test(highlightStatus) || /grow/i.test(phase);

    let code = "maintain_optimize";
    if (redSignal) {
      code = "red_recovery";
    } else if (greenSignal) {
      code = "green_optimize";
    } else if (total !== null && total < options.minPublisherPool) {
      code = "under_sample";
    } else if (total !== null && rate !== null && total >= options.minPublisherPool && rate < options.lowSuccessRate) {
      code = "low_success_replace";
    }

    const copy = textPack(code, metrics, language, options);
    return {
      applicable: true,
      code,
      ...copy,
      metrics,
      publisherCountText: metrics.publisherCountText,
      successRateText: metrics.successRateText,
      lowSuccessRate: options.lowSuccessRate,
      minPublisherPool: options.minPublisherPool,
      targetPublisherMin: options.targetPublisherMin,
      targetPublisherMax: options.targetPublisherMax
    };
  }

  window.TIER2_RECOMMENDATION_RULES = {
    DEFAULTS,
    parsePublisherCount,
    parseRate,
    formatPercent,
    publisherMetrics,
    strategyForOffer
  };
})();
