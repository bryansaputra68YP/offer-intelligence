#!/usr/bin/env ruby

require "csv"
require "json"
require "fileutils"
require "time"
require "date"

brand_csv = ARGV[0] || "outputs/brand_epc_by_tier.csv"
backend_csv = ARGV[1] || "outputs/tier_1_2_3_backend_epc.csv"
not_paid_csv = ARGV[2] || "outputs/levanta_unpaid_invoice_items_march_april_2026.csv"
category_csv = ARGV[3] || "work/levanta_brand_categories_api.csv"
output_js = ARGV[4] || "outputs/offer_chatbot/chatbot_data.js"
sheet_block_dir = ARGV[5] || "work/backend_epc_sheet_blocks"
all_invoice_json = ARGV[6] || "outputs/levanta_invoice_items_march_april_2026.json"
feishu_category_csv = ARGV[7] || "work/feishu_merchant_categories.csv"

def num(value)
  text = value.to_s.strip
  return nil if text.empty?
  Float(text.gsub(/[$,%]/, "").gsub(",", ""))
rescue ArgumentError
  nil
end

def normalize_brand(value)
  value.to_s.downcase.gsub("&", "and").gsub(/[^a-z0-9]+/, "")
end

def merchant_key(value)
  value.to_s.strip.sub(/\.0\z/, "")
end

def round(value, places = 6)
  return nil if value.nil?
  value.round(places)
end

def split_asins(value)
  value.to_s
       .split(/[,\s，、]+/)
       .map { |asin| asin.strip.upcase }
       .select { |asin| asin.match?(/\AB[A-Z0-9]{9}\z/) }
       .uniq
end

def clean_text(value)
  text = value.to_s.strip
  text.empty? ? nil : text
end

def category_from_sheet_row(row)
  category_indexes = row.headers.each_index.select do |index|
    row.headers[index].to_s.strip.casecmp("Category").zero?
  end
  category_indexes.reverse_each do |index|
    category = clean_text(row.fields[index])
    return category if category
  end
  nil
end

MONTH_NUMBERS = {
  "January" => 1,
  "February" => 2,
  "March" => 3,
  "April" => 4,
  "May" => 5,
  "June" => 6,
  "July" => 7,
  "August" => 8,
  "September" => 9,
  "October" => 10,
  "November" => 11,
  "December" => 12
}

def tier_rank(tier)
  { "Tier 1" => 1, "Tier 2" => 2, "Tier 3" => 3, "Tier 4" => 4, "BLACK TIER" => 9 }.fetch(tier, 8)
end

def best_payment_offer(candidates)
  candidates.compact.min_by do |offer|
    [tier_rank(offer["tier"]), -num(offer["salesAmount"]).to_f, offer["brand"].to_s]
  end
end

def safe_brand_match?(offer_brand, merchant_name)
  return false if offer_brand.to_s.empty? || merchant_name.to_s.empty?
  return true if offer_brand == merchant_name

  shorter = [offer_brand.length, merchant_name.length].min
  longer = [offer_brand.length, merchant_name.length].max
  shorter >= 5 && shorter.to_f / longer >= 0.65 && (offer_brand.include?(merchant_name) || merchant_name.include?(offer_brand))
end

def offer_for_payment(brand_id, brand_name, offers_by_mid, offers_by_brand, offers)
  mid = merchant_key(brand_id)
  by_id = best_payment_offer(offers_by_mid[mid].to_a)
  return by_id if by_id

  normalized_brand = normalize_brand(brand_name)
  exact = best_payment_offer(offers_by_brand[normalized_brand].to_a)
  return exact if exact

  best_payment_offer(offers.select { |offer| safe_brand_match?(normalize_brand(offer["brand"]), normalized_brand) })
end

def payment_availability_date(year, month_name, payment_cycle = nil)
  month_number = MONTH_NUMBERS[month_name.to_s]
  return nil unless year && month_number
  if payment_cycle.to_f.positive?
    return (Date.new(year.to_i, month_number, 2) + payment_cycle.to_i).iso8601
  end
  ((Date.new(year.to_i, month_number, 1) >> 2) + 2).iso8601
end

def normalized_payment_cycle(payment_cycle, network)
  return 105 if network.to_s.strip.downcase == "wayward"
  cycle = payment_cycle.to_f
  cycle.positive? ? cycle.round : 60
end

def explicit_payment_cycle_from(hash)
  %w[
    paymentCycle
    payment_cycle
    paymentCycleDays
    payment_cycle_days
    paymentTermDays
    payment_terms_days
    paymentTermsDays
    paymentDelayDays
    payoutDelayDays
    netDays
    net_days
  ].each do |key|
    cycle = num(hash[key])
    return cycle.round if cycle.to_f.positive?
  end
  nil
end

def infer_region_from_text(value)
  aliases = { "USA" => "US", "GB" => "UK" }
  value.to_s.split(/[\s_()\[\]-]+/).reverse_each do |part|
    clean = part.upcase.gsub(/[^A-Z]/, "")
    clean = aliases.fetch(clean, clean)
    return clean if %w[US UK DE FR CA AU].include?(clean)
  end
  nil
end

def normalize_region(value)
  raw = value.to_s.strip
  return nil if raw.empty?
  marketplace = raw
                .sub(%r{\Ahttps?://}i, "")
                .sub(/\Awww\./i, "")
                .split(/[\/?#]/)
                .first
                .to_s
                .downcase
  compact = marketplace.gsub(/[^a-z0-9.]+/, "")
  aliases = {
    "amazon.com" => "US",
    "com" => "US",
    "us" => "US",
    "usa" => "US",
    "unitedstates" => "US",
    "amazon.ca" => "CA",
    "ca" => "CA",
    "can" => "CA",
    "canada" => "CA",
    "amazon.co.uk" => "UK",
    "amazon.uk" => "UK",
    "co.uk" => "UK",
    "uk" => "UK",
    "gb" => "UK",
    "gbr" => "UK",
    "unitedkingdom" => "UK",
    "amazon.fr" => "FR",
    "fr" => "FR",
    "fra" => "FR",
    "france" => "FR",
    "amazon.de" => "DE",
    "de" => "DE",
    "deu" => "DE",
    "germany" => "DE",
    "deutschland" => "DE"
  }
  aliases.fetch(compact, raw.upcase)
end

def region_from_hash(hash, fallback_name = nil)
  region = clean_text(hash["region"]) ||
           clean_text(hash["marketplace"]) ||
           clean_text(hash["marketPlace"]) ||
           clean_text(hash["marketplaceCode"]) ||
           clean_text(hash["country"]) ||
           clean_text(hash["countryCode"]) ||
	   clean_text(hash["COUNTRY"]) ||
	   infer_region_from_text(fallback_name)
  normalize_region(region)
end

def levanta_network?(network)
  network.to_s.strip.downcase == "levanta"
end

def payment_month_key(year, month_name)
  month_number = MONTH_NUMBERS[month_name.to_s]
  return nil unless year && month_number
  format("%04d-%02d", year.to_i, month_number)
end

def payment_status(raw_status, expected_amount, paid_amount, availability_date, baseline_date = nil)
  raw = raw_status.to_s.downcase
  expected = expected_amount.to_f
  paid = paid_amount.to_f
  remaining = [expected - paid, 0].max
  cycle_due = availability_date ? Date.parse(availability_date) : nil
  baseline_due = baseline_date ? Date.parse(baseline_date) : cycle_due

  return "Paid" if raw == "paid" || (expected.positive? && paid >= expected - 0.01)
  return "Unknown" if raw.empty? && expected_amount.nil?
  return "Pending" if expected <= 0 && paid <= 0 && raw.include?("pending")
  return "Unknown" if expected <= 0 && paid <= 0
  return "Pending" if baseline_due && Date.today <= baseline_due
  return "Overdue" if cycle_due && Date.today > cycle_due && remaining > 0.01
  return "Partial" if paid.positive? && remaining > 0.01
  remaining > 0.01 || raw.include?("pending") || raw.include?("late") || raw.include?("unpaid") ? "Unpaid" : "Unknown"
rescue ArgumentError
  "Unknown"
end

def trackable_payment_record?(record)
  num(record["revenueMade"]).to_f.positive? || num(record["commissionMade"]).to_f.positive?
end

def compact_hash(hash)
  hash.each_with_object({}) do |(key, value), compacted|
    next if value.nil?
    next if value == false
    next if value == []
    next if value == ""
    next if value == "not_available"
    next if key == "allLevantaCategories"
    next if key == "backendMatchStatus"
    next if key == "paymentRawStatuses"
    next if key == "sourceSheet"
    next if key == "rowNumber"
    next if key == "originalRank"
    compacted[key] = value
  end
end

def payment_offer_for_brand(offers_by_brand, brand_name)
  candidates = offers_by_brand[normalize_brand(brand_name)].to_a
  return nil if candidates.empty?

  levanta_candidates = candidates.select { |offer| levanta_network?(offer["network"]) }
  candidates = levanta_candidates unless levanta_candidates.empty?
  candidates.min_by { |offer| [tier_rank(offer["tier"]), -num(offer["salesAmount"]).to_f] }
end

backend_by_mid = {}
if File.exist?(backend_csv)
  CSV.read(backend_csv, headers: true).each do |row|
    mid = merchant_key(row["merchant_id"])
    next if mid.empty?
    backend_by_mid[mid] = row
  end
end

not_paid_by_brand = {}
if File.exist?(not_paid_csv)
  CSV.read(not_paid_csv, headers: true).each do |row|
    name = row["Invoice Brand"] || row["April Invoice Brand"] || row["Report Brand"] || row["brand"]
    key = normalize_brand(name)
    next if key.empty?

    month = row["Invoice Month"] || row["invoice_month"] || "April"
    status = row["Payment Status"] || row["payment_status"] || row["April Payment Status"] || "Not Paid"
    sales = num(row["Sales"] || row["sales"] || row["April Sales"])
    commission = num(row["Total Commission Owed"] || row["total_commission"] || row["April Commission Owed"] || row["commission"])
    cpc_commission = num(row["CPC Commission"] || row["cpc_commission"])

    current = not_paid_by_brand[key] ||= {
      "months" => [],
      "statuses" => [],
      "sales" => 0.0,
      "commissionOwed" => 0.0,
      "cpcCommissionOwed" => 0.0
    }
    current["months"] << month.to_s
    current["statuses"] << status.to_s
    current["sales"] += sales || 0
    current["commissionOwed"] += commission || 0
    current["cpcCommissionOwed"] += cpc_commission || 0
  end
end

not_paid_by_brand.each_value do |info|
  info["months"] = info["months"].uniq
  info["statuses"] = info["statuses"].uniq
  month_label = info["months"].join(" + ")
  info["label"] = "#{month_label} Not Paid"
end

invoice_status_by_brand = {}
invoice_rows = []
if File.exist?(all_invoice_json)
  invoice_rows = JSON.parse(File.read(all_invoice_json))
  invoice_rows.each do |row|
    brand = row["brand"].is_a?(Hash) ? row["brand"]["name"] : row["brand"]
    key = normalize_brand(brand)
    next if key.empty?

    current = invoice_status_by_brand[key] ||= {
      "months" => [],
      "paidMonths" => [],
      "unpaidMonths" => [],
      "statuses" => []
    }
    month = row["invoice_month"] || row["month"]
    status = row["raw_status"] || row["status"]
    current["months"] << month.to_s if month
    current["paidMonths"] << month.to_s if status.to_s.downcase == "paid" && month
    current["unpaidMonths"] << month.to_s if status.to_s.downcase != "paid" && month
    current["statuses"] << status.to_s if status
  end
end

invoice_status_by_brand.each_value do |info|
  info["months"] = info["months"].uniq
  info["paidMonths"] = info["paidMonths"].uniq
  info["unpaidMonths"] = info["unpaidMonths"].uniq
  info["statuses"] = info["statuses"].uniq
end

levanta_category_by_brand = {}
if File.exist?(category_csv)
  CSV.read(category_csv, headers: true).each do |row|
    category = row["top_category"].to_s.strip
    brand = row["brand_name"].to_s.strip
    next if brand.empty? || category.empty?
    levanta_category_by_brand[normalize_brand(brand)] = {
      "topCategory" => category,
      "categories" => row["categories"].to_s,
      "productCount" => num(row["product_count"])
    }
  end
end

feishu_category_by_mid = {}
feishu_category_by_brand = {}
if File.exist?(feishu_category_csv)
  CSV.read(feishu_category_csv, headers: true).each do |row|
    merchant_id = merchant_key(row["merchantId"])
    merchant_name = clean_text(row["merchantName"])
    info = {
      "merchantId" => merchant_id,
      "merchantName" => merchant_name,
      "network" => clean_text(row["network"]),
      "mainCategory" => clean_text(row["mainCategory"]),
      "subCategory" => clean_text(row["subCategory"]),
      "mainCategoryCn" => clean_text(row["mainCategoryCn"]),
      "subCategoryCn" => clean_text(row["subCategoryCn"]),
      "mainCategoryBsr" => clean_text(row["mainCategoryBsr"]),
      "subcategoryBsr" => clean_text(row["subcategoryBsr"]),
      "asin" => clean_text(row["asin"])
    }
    next if merchant_id.empty? && merchant_name.to_s.empty?
    next if info["mainCategory"].to_s.empty? && info["subCategory"].to_s.empty?

    feishu_category_by_mid[merchant_id] = info unless merchant_id.empty?
    feishu_category_by_brand[normalize_brand(merchant_name)] = info unless merchant_name.to_s.empty?
  end
end

sheet_blocks_by_tier_row = {}
block_start_rows = { "Tier 1" => 10, "Tier 2" => 13, "Tier 3" => 10, "Tier 4" => 10 }
block_start_rows.each do |tier, header_row|
  file = File.join(sheet_block_dir, "#{tier.downcase.gsub(/\s+/, "_")}_sheet_block.tsv")
  next unless File.exist?(file)

  CSV.read(file, headers: true, col_sep: "\t").each_with_index do |row, index|
    row_number = header_row + 1 + index
    sheet_blocks_by_tier_row[[tier, row_number]] = row.to_h.merge("Sheet Category" => category_from_sheet_row(row))
  end
end

offers = CSV.read(brand_csv, headers: true).map do |row|
  mid = merchant_key(row["merchant_id"])
  backend = backend_by_mid[mid]
  lev_cat = levanta_category_by_brand[normalize_brand(row["brand"])]
  feishu_cat = feishu_category_by_mid[mid] || feishu_category_by_brand[normalize_brand(row["brand"])]
  sheet_block = sheet_blocks_by_tier_row[[row["tier"], row["row_number"].to_i]] || {}

  network = backend && backend["backend_network"].to_s.strip != "" ? backend["backend_network"] : row["network_or_agency"]
  paid = levanta_network?(network) ? not_paid_by_brand[normalize_brand(row["brand"])] : nil
  invoice_status = levanta_network?(network) ? invoice_status_by_brand[normalize_brand(row["brand"])] : nil
  sheet_category = clean_text(sheet_block["Sheet Category"]) || clean_text(sheet_block["Category"]) || clean_text(row["category"])
  feishu_main_category = feishu_cat&.fetch("mainCategory", nil)
  feishu_sub_category = feishu_cat&.fetch("subCategory", nil)
  category = sheet_category || feishu_main_category || lev_cat&.fetch("topCategory", nil) || feishu_sub_category
  category = "Uncategorized" if category.empty?
  main_category = category == "Uncategorized" ? nil : category
  category_path = [main_category, feishu_sub_category].compact.reject(&:empty?).uniq.join(" > ")
  category_path = nil if category_path.empty?

  clicks = num(backend && backend["backend_clicks"]) || num(row["clicks"])
  orders = num(backend && backend["backend_order_count"]) || num(row["orders"])
  sales = num(backend && backend["backend_sales_amount"]) || num(row["revenue"])
  epc = num(backend && backend["backend_epc"]) || num(row["epc"])
  aov = num(backend && backend["backend_aov"]) || num(row["aov"])
  cvr = num(backend && backend["backend_conversion_rate"]) || num(row["conversion_rate"])
  commission_rate = num(backend && backend["backend_commission_rate"])
  aff_commission = num(backend && backend["backend_aff_commission"])
  asins = split_asins(row["asins"])
  tier_reason = clean_text(row["tier_reason_or_black_reason"]) || clean_text(sheet_block["Tier Reason"])
  recommendation = clean_text(row["recommendation"]) || clean_text(sheet_block["Recommendation"])
  recommended_link = clean_text(sheet_block["Recommended Link"])
  phase = clean_text(sheet_block["Phase"])
  sheet_payment_cycle = num(sheet_block["Payment Cycle"])
  payment_cycle_source = sheet_payment_cycle.to_f.positive? ? "google_sheet" : "network_default"
  payment_cycle = normalized_payment_cycle(sheet_payment_cycle, network)
  region = region_from_hash(row, row["brand"]) || region_from_hash(sheet_block, row["brand"])
  success_rate = num(sheet_block["Success Rate"])
  success_rate_june = num(sheet_block["Success Rate June"])
  publisher_count = clean_text(sheet_block["Publisher Count"])
  publisher_count_june = clean_text(sheet_block["Publisher Count June"])
  best_sub_category_bsr = clean_text(row["best_sub_category_bsr"]) || clean_text(sheet_block["Best Sub Category BSR"])

  payment_state =
    if paid
      "unpaid"
    elsif invoice_status && !invoice_status["paidMonths"].empty?
      "paid"
    elsif invoice_status
      "invoice_unknown"
    else
      "not_available"
    end
  payment_status =
    if paid
      paid["label"]
    elsif payment_state == "paid"
      "Paid in #{invoice_status["paidMonths"].join(" + ")}"
    else
      "No payment issue found"
    end

  {
    "id" => [row["tier"], mid, row["brand"]].join("::"),
    "tier" => row["tier"],
    "sourceSheet" => row["source_sheet"],
    "rowNumber" => num(row["row_number"])&.to_i,
    "originalRank" => num(row["original_rank"]),
    "merchantId" => mid,
    "brand" => row["brand"],
    "network" => network.to_s.strip.empty? ? "Unknown" : network,
    "region" => region,
    "category" => category,
    "sheetCategory" => sheet_category,
    "categoryPath" => category_path,
    "mainCategory" => main_category,
    "subCategory" => feishu_sub_category,
    "feishuMainCategory" => feishu_main_category,
    "feishuSubCategory" => feishu_sub_category,
    "mainCategoryCn" => feishu_cat&.fetch("mainCategoryCn", nil),
    "subCategoryCn" => feishu_cat&.fetch("subCategoryCn", nil),
    "mainCategoryBsr" => feishu_cat&.fetch("mainCategoryBsr", nil),
    "subcategoryBsr" => feishu_cat&.fetch("subcategoryBsr", nil),
    "feishuCategoryMerchantName" => feishu_cat&.fetch("merchantName", nil),
    "feishuCategoryAsin" => feishu_cat&.fetch("asin", nil),
    "categorySource" => sheet_category ? "Google Sheet" : (feishu_cat ? "Feishu" : (lev_cat ? "Levanta" : "Source")),
    "levantaCategory" => lev_cat&.fetch("topCategory", nil),
    "allLevantaCategories" => lev_cat&.fetch("categories", nil),
    "clicks" => round(clicks, 0),
    "orders" => round(orders, 0),
    "salesAmount" => round(sales, 2),
    "epc" => round(epc, 6),
    "aov" => round(aov, 6),
    "conversionRate" => round(cvr, 6),
    "commissionRate" => round(commission_rate, 6),
    "affCommission" => round(aff_commission, 2),
    "dpv" => num(row["dpv"])&.round,
    "dpvPerClick" => round(num(row["dpv_per_click"]), 6),
    "atc" => num(row["atc"])&.round,
    "atcPerClick" => round(num(row["atc_per_click"]), 6),
    "backendMatchStatus" => backend ? backend["backend_match_status"] : "No backend match",
    "topAsins" => asins,
    "asinsText" => clean_text(row["asins"]),
    "hasAsin" => !asins.empty?,
    "mayRevenue" => round(num(row["may_revenue"]), 2),
    "juneRevenue" => round(num(row["june_revenue"]), 2),
    "completionRate" => round(num(row["completion_rate"]) || num(sheet_block["Completion Rate"]), 6),
    "timeline" => clean_text(row["timeline"]),
    "phase" => phase,
    "paymentCycle" => payment_cycle,
    "paymentCycleSource" => payment_cycle_source,
    "publisherCount" => publisher_count,
    "successRate" => round(success_rate, 6),
    "publisherCountJune" => publisher_count_june,
    "successRateJune" => round(success_rate_june, 6),
    "recommendedLink" => recommended_link,
    "linkStatus" => recommended_link,
    "bestSubCategoryBsr" => best_sub_category_bsr,
    "discountInfo" => nil,
    "hasDiscount" => false,
    "dealInfo" => nil,
    "cpc" => nil,
    "trackingIssue" => [tier_reason, recommendation].compact.join(" ").downcase.include?("tracking"),
    "paymentRisk" => !!paid,
    "paymentState" => payment_state,
    "paymentStatus" => payment_status,
    "invoiceMonths" => invoice_status ? invoice_status["months"] : [],
    "paidInvoiceMonths" => invoice_status ? invoice_status["paidMonths"] : [],
    "paymentRiskMonths" => paid ? paid["months"] : [],
    "unpaidSales" => paid ? round(paid["sales"], 2) : nil,
    "unpaidCommissionOwed" => paid ? round(paid["commissionOwed"], 2) : nil,
    "unpaidCpcCommissionOwed" => paid ? round(paid["cpcCommissionOwed"], 2) : nil,
    "paymentRawStatuses" => paid ? paid["statuses"] : [],
    "aprilSales" => paid && paid["sales"],
    "aprilCommissionOwed" => paid && paid["commissionOwed"],
    "reason" => tier_reason,
    "recommendation" => recommendation
  }
end.map { |offer| compact_hash(offer) }

offers_by_mid = offers.group_by { |offer| merchant_key(offer["merchantId"]) }
offers_by_brand = offers.group_by { |offer| normalize_brand(offer["brand"]) }
payment_records = invoice_rows.map do |row|
  brand_name = row["brand"].is_a?(Hash) ? row["brand"]["name"] : row["brand"]
  matched_offer = offer_for_payment(row["brand_id"], brand_name, offers_by_mid, offers_by_brand, offers)
  report_month = row["invoice_month"] || row["month"]
  report_year = row["invoice_year"] || 2026
  levanta_brand_id = row["brand_id"].to_s.strip
  payment_merchant_id = matched_offer&.fetch("merchantId", nil) || levanta_brand_id
  sales = num(row["sales"])
  commission = num(row["total_commission"] || row["commission"])
  expected = commission
  raw_status = row["raw_status"] || row["payment_status"]
  source_cycle = matched_offer&.fetch("paymentCycleSource", nil) == "google_sheet" ? matched_offer&.fetch("paymentCycle", nil) : explicit_payment_cycle_from(row)
  payment_cycle = normalized_payment_cycle(source_cycle, matched_offer&.fetch("network", nil) || "Levanta")
  availability = payment_availability_date(report_year, report_month, payment_cycle)
  baseline_availability = payment_availability_date(report_year, report_month, 60)
  paid_amount = raw_status.to_s.downcase == "paid" ? expected : 0.0
  remaining = expected && paid_amount ? [expected - paid_amount, 0].max : nil
  status = payment_status(raw_status, expected, paid_amount, availability, baseline_availability)
  notes =
    if status == "Pending"
      "Payment is still inside the 60-day network baseline."
    elsif status == "Unpaid"
      "Payment has passed the 60-day baseline but is not past the #{payment_cycle}-day payment cycle."
    elsif status == "Overdue"
      "Payment is past the #{payment_cycle}-day payment cycle and needs follow-up."
    elsif status == "Paid"
      "Payment confirmed by Levanta invoice data."
    elsif status == "Partial"
      "Partial payment recorded; follow up remaining amount."
    else
      "Payment status is missing or cannot be confirmed."
    end

  compact_hash({
    "id" => [payment_merchant_id, payment_month_key(report_year, report_month), normalize_brand(brand_name)].join("::"),
    "merchantId" => payment_merchant_id,
    "levantaBrandId" => levanta_brand_id,
    "merchantName" => brand_name,
    "network" => matched_offer&.fetch("network", nil) || "Levanta",
    "region" => region_from_hash(row, matched_offer&.fetch("brand", nil) || brand_name),
    "tier" => matched_offer&.fetch("tier", nil) || "Unknown",
    "category" => matched_offer&.fetch("category", nil) || "Uncategorized",
    "categoryPath" => matched_offer&.fetch("categoryPath", nil),
    "mainCategory" => matched_offer&.fetch("mainCategory", nil),
    "subCategory" => matched_offer&.fetch("subCategory", nil),
    "mainCategoryCn" => matched_offer&.fetch("mainCategoryCn", nil),
    "subCategoryCn" => matched_offer&.fetch("subCategoryCn", nil),
    "reportMonth" => report_month,
    "reportYear" => report_year.to_i,
    "reportMonthKey" => payment_month_key(report_year, report_month),
    "revenueMade" => round(sales, 2),
    "commissionMade" => round(commission, 2),
    "expectedPaymentAmount" => round(expected, 2),
    "paidAmount" => round(paid_amount, 2),
    "remainingAmount" => round(remaining, 2),
    "paymentCycle" => payment_cycle,
    "paymentAvailabilityDate" => availability,
    "expectedPaymentDate" => availability,
    "paymentStatus" => status,
    "rawStatus" => raw_status,
    "lastCheckedDate" => Date.today.iso8601,
    "notes" => notes
  })
end
payment_records = payment_records.select do |record|
  trackable_payment_record?(record)
end

payment_summary = {
  "recordCount" => payment_records.length,
  "totalRevenueMade" => round(payment_records.sum { |record| num(record["revenueMade"]).to_f }, 2),
  "totalCommissionMade" => round(payment_records.sum { |record| num(record["commissionMade"]).to_f }, 2),
  "totalPaidAmount" => round(payment_records.sum { |record| num(record["paidAmount"]).to_f }, 2),
  "totalUnpaidAmount" => round(payment_records.select { |record| record["paymentStatus"] == "Unpaid" }.sum { |record| num(record["remainingAmount"]).to_f }, 2),
  "totalPendingAmount" => round(payment_records.select { |record| record["paymentStatus"] == "Pending" }.sum { |record| num(record["remainingAmount"]).to_f }, 2),
  "totalOverdueAmount" => round(payment_records.select { |record| record["paymentStatus"] == "Overdue" }.sum { |record| num(record["remainingAmount"]).to_f }, 2),
  "unpaidMerchantCount" => payment_records.select { |record| record["paymentStatus"] == "Unpaid" }.map { |record| record["merchantId"] }.uniq.length,
  "pendingMerchantCount" => payment_records.select { |record| record["paymentStatus"] == "Pending" }.map { |record| record["merchantId"] }.uniq.length,
  "paidMerchantCount" => payment_records.select { |record| record["paymentStatus"] == "Paid" }.map { |record| record["merchantId"] }.uniq.length,
  "overdueMerchantCount" => payment_records.select { |record| record["paymentStatus"] == "Overdue" }.map { |record| record["merchantId"] }.uniq.length
}

tiers = offers.group_by { |offer| offer["tier"] }.transform_values(&:length)
networks = offers.group_by { |offer| offer["network"] }.transform_values(&:length)
categories = offers.group_by { |offer| offer["category"] }.transform_values(&:length)

summary = {
  "offerCount" => offers.length,
  "generatedAt" => Time.now.utc.iso8601,
  "tiers" => tiers,
  "networks" => networks.sort_by { |_k, v| -v }.to_h,
  "categories" => categories.sort_by { |_k, v| -v }.first(40).to_h,
  "notPaidCount" => offers.count { |offer| offer["paymentRisk"] },
  "notPaidMonths" => offers.flat_map { |offer| offer["paymentRiskMonths"] }.compact.uniq,
  "backendMatchedCount" => offers.count { |offer| backend_by_mid.key?(offer["merchantId"]) },
  "sheetCategorizedCount" => offers.count { |offer| offer["sheetCategory"] },
  "levantaCategorizedCount" => offers.count { |offer| offer["levantaCategory"] },
  "feishuCategorizedCount" => offers.count { |offer| offer["feishuMainCategory"] || offer["feishuSubCategory"] },
  "paymentSummary" => payment_summary
}

payload = {
  "summary" => summary,
  "sources" => {
    "tiers" => File.basename(brand_csv),
    "backendEpc" => File.basename(backend_csv),
    "payments" => File.basename(not_paid_csv),
    "levantaCategories" => File.exist?(category_csv) ? File.basename(category_csv) : nil,
    "feishuCategories" => File.exist?(feishu_category_csv) ? File.basename(feishu_category_csv) : nil
  },
  "offers" => offers,
  "paymentRecords" => payment_records
}

FileUtils.mkdir_p(File.dirname(output_js))
File.write(output_js, "window.CHATBOT_DATA=#{JSON.generate(payload)};\n")
puts JSON.generate(summary)
