// FB Ads Helpers — đọc data từ fb-ads-data.json + Pancake DUY+PHUONG_NAM
// + product-costs.json để tính profit. Compact format → feed vào prompt.

// Sales staff routing FB Ads leads (filter Pancake source_groups)
export const FB_SALES_GROUPS = ["DUY", "PHUONG_NAM"];

// Active FB groups (chỉ 4 nhóm có order trong 90d):
export const FB_ACTIVE_GROUPS = ["MAY_DO", "CAMERA_VIDEO_CALL", "GHI_AM", "NOMA"];

// Group label (UI display)
export const FB_GROUP_LABELS = {
  ALL:               "Tất cả nhóm SP qua FB",
  MAY_DO:            "Máy dò (D-series)",
  CAMERA_VIDEO_CALL: "Camera video call (DA8.1)",
  GHI_AM:            "Máy ghi âm (DR1)",
  NOMA:              "NOMA (chăm sóc xe)",
};

// Classify product name → FB group (chỉ 4 nhóm active)
export function classifyFbProduct(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return "OTHER";
  if (/noma|a002|tẩy|chà kính|kính xe|chăm sóc xe/i.test(n)) return "NOMA";
  if (/^da\s*8\.1|da8\.1|da 8\.1|gọi.*2.*chiều|video.*call/i.test(n)) return "CAMERA_VIDEO_CALL";
  if (/^dr\s*\d|máy\s*ghi\s*âm|ghi âm/i.test(n)) return "GHI_AM";
  if (/^d\s*\d|máy\s*dò|may do|phát hiện thiết bị|dò\s*nghe lén/i.test(n)) return "MAY_DO";
  return "OTHER";
}

// ── COMPACT FB INSIGHTS ──────────────────────────────────────────────────
// fb-ads-data.json có 6 accounts. Aggregate insights theo group nếu có data.
// Trả về { has_data, accounts[], summary }
export function compactFbInsights(json, group = "ALL") {
  if (!json || !Array.isArray(json.accounts)) {
    return { has_data: false, _note: "fb-ads-data.json missing or wrong shape" };
  }
  const accounts = json.accounts.map(acc => ({
    id: acc.account_id,
    name: acc.account_name,
    spend: Number(acc.summary?.spend) || 0,
    impressions: Number(acc.summary?.impressions) || 0,
    clicks: Number(acc.summary?.clicks) || 0,
    leads: Number(acc.summary?.leads) || 0,
    campaigns_count: (acc.campaigns || []).length,
  }));
  const totalSpend = accounts.reduce((s, a) => s + a.spend, 0);
  const totalImp = accounts.reduce((s, a) => s + a.impressions, 0);
  const totalClicks = accounts.reduce((s, a) => s + a.clicks, 0);
  const totalLeads = accounts.reduce((s, a) => s + a.leads, 0);
  const ctr = totalImp > 0 ? totalClicks / totalImp : 0;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : null;
  return {
    has_data: totalSpend > 0 || totalLeads > 0,
    date_range: json.date_range,
    summary: {
      spend: totalSpend,
      impressions: totalImp,
      clicks: totalClicks,
      leads: totalLeads,
      ctr_pct: Math.round(ctr * 10000) / 100,
      cpl_vnd: cpl,
    },
    accounts: accounts.filter(a => a.spend > 0 || a.leads > 0).slice(0, 6),
    _note: totalSpend === 0 ? "fb-ads-data.json hiện đang rỗng - workflow auto-sync có thể bị lỗi token" : null,
  };
}

// ── FB ORDERS từ Pancake (DUY + PHUONG_NAM) ──────────────────────────────
// Aggregate per group, status delivered (đã giao thành công).
export function compactFbOrders(productRevenueJson, group = "ALL") {
  if (!productRevenueJson?.source_groups) return { has_data: false };
  const groupTotals = {};
  for (const g of FB_ACTIVE_GROUPS) {
    groupTotals[g] = { revenue: 0, orders: 0, top_products: [] };
  }
  for (const sg of FB_SALES_GROUPS) {
    const products = productRevenueJson.source_groups[sg]?.products;
    if (!products) continue;
    for (const [name, p] of Object.entries(products)) {
      const orders = Number(p.orders) || 0;
      const total = Number(p.total) || 0;
      if (orders <= 0) continue;
      const grp = classifyFbProduct(name);
      if (!FB_ACTIVE_GROUPS.includes(grp)) continue;
      groupTotals[grp].revenue += total;
      groupTotals[grp].orders += orders;
      groupTotals[grp].top_products.push({ product: name, orders, revenue: total, source: sg });
    }
  }
  // Filter by group
  const filterGroups = (group === "ALL") ? FB_ACTIVE_GROUPS : [group];
  const out = {};
  for (const g of filterGroups) {
    if (!groupTotals[g]) continue;
    const t = groupTotals[g];
    t.top_products.sort((a, b) => b.revenue - a.revenue);
    t.top_products = t.top_products.slice(0, 5);
    t.aov = t.orders > 0 ? Math.round(t.revenue / t.orders) : 0;
    out[g] = t;
  }
  return { has_data: Object.values(out).some(t => t.orders > 0), groups: out };
}

// ── PROFIT CALC (combine orders + product-costs) ────────────────────────
// Profit = Revenue - COGS - FB Spend (40% rev) - VAT (10% rev) = Rev × 0.50 - COGS
const COST_RATIO_FB = 0.40;
const VAT_RATIO = 0.10;

export function computeFbProfit(productRevenueJson, productCostsJson, group = "ALL") {
  if (!productRevenueJson?.source_groups || !productCostsJson?.products) {
    return { has_data: false };
  }
  const costs = productCostsJson.products;
  const groupTotals = {};
  for (const g of FB_ACTIVE_GROUPS) {
    groupTotals[g] = { revenue: 0, orders: 0, cogs: 0 };
  }
  let totalMissingCost = 0;
  for (const sg of FB_SALES_GROUPS) {
    const products = productRevenueJson.source_groups[sg]?.products;
    if (!products) continue;
    for (const [name, p] of Object.entries(products)) {
      const orders = Number(p.orders) || 0;
      const total = Number(p.total) || 0;
      if (orders <= 0) continue;
      const grp = classifyFbProduct(name);
      if (!FB_ACTIVE_GROUPS.includes(grp)) continue;
      const costEntry = costs[name.toLowerCase()] ||
        Object.values(costs).find(c => c.ma_ten_goi?.toLowerCase() === name.toLowerCase());
      const unitCost = costEntry && costEntry.gia_nhap_vnd ? Number(costEntry.gia_nhap_vnd) : null;
      groupTotals[grp].revenue += total;
      groupTotals[grp].orders += orders;
      if (unitCost !== null) {
        groupTotals[grp].cogs += unitCost * orders;
      } else {
        totalMissingCost++;
      }
    }
  }
  const filterGroups = (group === "ALL") ? FB_ACTIVE_GROUPS : [group];
  const out = {};
  let agg = { revenue: 0, orders: 0, cogs: 0, fb_spend: 0, vat: 0, profit: 0 };
  for (const g of filterGroups) {
    const t = groupTotals[g];
    if (!t || t.orders === 0) continue;
    const fbSpend = t.revenue * COST_RATIO_FB;
    const vat = t.revenue * VAT_RATIO;
    const profit = t.revenue - t.cogs - fbSpend - vat;
    const margin = t.revenue > 0 ? profit / t.revenue : 0;
    out[g] = {
      revenue: Math.round(t.revenue),
      orders: t.orders,
      cogs: Math.round(t.cogs),
      fb_spend_estimated: Math.round(fbSpend),
      vat: Math.round(vat),
      profit: Math.round(profit),
      profit_per_order: t.orders > 0 ? Math.round(profit / t.orders) : 0,
      margin_pct: Math.round(margin * 1000) / 10,
      aov: t.orders > 0 ? Math.round(t.revenue / t.orders) : 0,
    };
    agg.revenue += t.revenue;
    agg.orders += t.orders;
    agg.cogs += t.cogs;
    agg.fb_spend += fbSpend;
    agg.vat += vat;
    agg.profit += profit;
  }
  return {
    has_data: agg.orders > 0,
    period_days: 90,
    groups: out,
    total: {
      revenue: Math.round(agg.revenue),
      orders: agg.orders,
      cogs: Math.round(agg.cogs),
      fb_spend_estimated: Math.round(agg.fb_spend),
      vat: Math.round(agg.vat),
      profit: Math.round(agg.profit),
      profit_per_order: agg.orders > 0 ? Math.round(agg.profit / agg.orders) : 0,
      margin_pct: agg.revenue > 0 ? Math.round((agg.profit / agg.revenue) * 1000) / 10 : 0,
    },
    products_missing_cost: totalMissingCost,
    formula_note: "Profit = Revenue - COGS - FB Spend (40%) - VAT (10%). Spend là ƯỚC LƯỢNG, sẽ replace bằng spend thật khi fb-ads-data.json có data.",
  };
}

// ── TIME RANGE PRESETS ──────────────────────────────────────────────────
// VN timezone (UTC+7). Trả về { start, end, label } theo preset.
export function resolveTimeRange(preset, customStart = null, customEnd = null) {
  const tzOffsetMs = 7 * 3600 * 1000;
  const nowVN = new Date(Date.now() + tzOffsetMs);
  const todayVN = nowVN.toISOString().slice(0, 10);

  function fmt(d) { return d.toISOString().slice(0, 10); }
  function addDays(date, n) { return new Date(date.getTime() + n * 86400000); }

  const today = new Date(todayVN + "T00:00:00Z");
  const dayOfWeek = (today.getUTCDay() + 6) % 7;  // 0=Mon, 6=Sun

  switch (preset) {
    case "today":
      return { start: todayVN, end: todayVN, label: "Hôm nay" };
    case "yesterday": {
      const y = fmt(addDays(today, -1));
      return { start: y, end: y, label: "Hôm qua" };
    }
    case "this_week": {
      const monday = fmt(addDays(today, -dayOfWeek));
      return { start: monday, end: todayVN, label: "Tuần này" };
    }
    case "last_week": {
      const lastMon = fmt(addDays(today, -dayOfWeek - 7));
      const lastSun = fmt(addDays(today, -dayOfWeek - 1));
      return { start: lastMon, end: lastSun, label: "Tuần trước" };
    }
    case "this_month": {
      const start = todayVN.slice(0, 7) + "-01";
      return { start, end: todayVN, label: "Tháng này" };
    }
    case "last_month": {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth(); // 0-indexed
      const lastM = m === 0 ? 12 : m;
      const lastY = m === 0 ? y - 1 : y;
      const start = `${lastY}-${String(lastM).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate();
      const end = `${lastY}-${String(lastM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { start, end, label: "Tháng trước" };
    }
    case "last_7d":
      return { start: fmt(addDays(today, -6)), end: todayVN, label: "7 ngày qua" };
    case "last_30d":
      return { start: fmt(addDays(today, -29)), end: todayVN, label: "30 ngày qua" };
    case "last_90d":
      return { start: fmt(addDays(today, -89)), end: todayVN, label: "90 ngày qua" };
    case "custom": {
      if (!customStart || !customEnd) return null;
      return { start: customStart, end: customEnd, label: "Tùy chỉnh", custom: true };
    }
    default:
      return { start: fmt(addDays(today, -29)), end: todayVN, label: "30 ngày qua (default)" };
  }
}

// Filter orders/revenue by date range — works with Pancake source_groups.products[*].orders_by_date
export function compactFbOrdersInRange(productRevenueJson, group, timeRange) {
  if (!productRevenueJson?.source_groups || !timeRange) return { has_data: false };
  const { start, end } = timeRange;
  const groupTotals = {};
  for (const g of FB_ACTIVE_GROUPS) {
    groupTotals[g] = { revenue: 0, orders: 0, top_products: [] };
  }
  for (const sg of FB_SALES_GROUPS) {
    const products = productRevenueJson.source_groups[sg]?.products;
    if (!products) continue;
    for (const [name, p] of Object.entries(products)) {
      const grp = classifyFbProduct(name);
      if (!FB_ACTIVE_GROUPS.includes(grp)) continue;
      const ordersByDate = p.orders_by_date || {};
      const revByDate = p.by_date || {};
      let prodOrders = 0, prodRev = 0;
      for (const [date, ord] of Object.entries(ordersByDate)) {
        if (date >= start && date <= end) {
          prodOrders += Number(ord) || 0;
          prodRev += Number(revByDate[date]) || 0;
        }
      }
      if (prodOrders > 0) {
        groupTotals[grp].revenue += prodRev;
        groupTotals[grp].orders += prodOrders;
        groupTotals[grp].top_products.push({ product: name, orders: prodOrders, revenue: prodRev, source: sg });
      }
    }
  }
  const filterGroups = (group === "ALL") ? FB_ACTIVE_GROUPS : [group];
  const out = {};
  for (const g of filterGroups) {
    const t = groupTotals[g];
    if (!t) continue;
    t.top_products.sort((a, b) => b.revenue - a.revenue);
    t.top_products = t.top_products.slice(0, 5);
    t.aov = t.orders > 0 ? Math.round(t.revenue / t.orders) : 0;
    out[g] = t;
  }
  return {
    has_data: Object.values(out).some(t => t.orders > 0),
    time_range: timeRange,
    groups: out,
  };
}

// Compute profit (using product-costs) within time range
export function computeFbProfitInRange(productRevenueJson, productCostsJson, group, timeRange) {
  if (!productRevenueJson?.source_groups || !productCostsJson?.products || !timeRange) {
    return { has_data: false };
  }
  const { start, end } = timeRange;
  const costs = productCostsJson.products;
  const groupTotals = {};
  for (const g of FB_ACTIVE_GROUPS) groupTotals[g] = { revenue: 0, orders: 0, cogs: 0 };

  for (const sg of FB_SALES_GROUPS) {
    const products = productRevenueJson.source_groups[sg]?.products;
    if (!products) continue;
    for (const [name, p] of Object.entries(products)) {
      const grp = classifyFbProduct(name);
      if (!FB_ACTIVE_GROUPS.includes(grp)) continue;
      const ordersByDate = p.orders_by_date || {};
      const revByDate = p.by_date || {};
      const costEntry = costs[name.toLowerCase()] ||
        Object.values(costs).find(c => c.ma_ten_goi?.toLowerCase() === name.toLowerCase());
      const unitCost = costEntry?.gia_nhap_vnd ? Number(costEntry.gia_nhap_vnd) : 0;
      for (const [date, ord] of Object.entries(ordersByDate)) {
        if (date < start || date > end) continue;
        const orders = Number(ord) || 0;
        const rev = Number(revByDate[date]) || 0;
        groupTotals[grp].revenue += rev;
        groupTotals[grp].orders += orders;
        groupTotals[grp].cogs += unitCost * orders;
      }
    }
  }

  const filterGroups = (group === "ALL") ? FB_ACTIVE_GROUPS : [group];
  const out = {};
  let agg = { revenue: 0, orders: 0, cogs: 0, fb_spend: 0, vat: 0, profit: 0 };
  for (const g of filterGroups) {
    const t = groupTotals[g];
    if (!t || t.orders === 0) continue;
    const fbSpend = t.revenue * 0.40;
    const vat = t.revenue * 0.10;
    const profit = t.revenue - t.cogs - fbSpend - vat;
    out[g] = {
      revenue: Math.round(t.revenue),
      orders: t.orders,
      cogs: Math.round(t.cogs),
      fb_spend_estimated: Math.round(fbSpend),
      vat: Math.round(vat),
      profit: Math.round(profit),
      profit_per_order: t.orders > 0 ? Math.round(profit / t.orders) : 0,
      margin_pct: t.revenue > 0 ? Math.round((profit / t.revenue) * 1000) / 10 : 0,
      aov: t.orders > 0 ? Math.round(t.revenue / t.orders) : 0,
    };
    agg.revenue += t.revenue; agg.orders += t.orders; agg.cogs += t.cogs;
    agg.fb_spend += fbSpend; agg.vat += vat; agg.profit += profit;
  }
  return {
    has_data: agg.orders > 0,
    time_range: timeRange,
    groups: out,
    total: {
      revenue: Math.round(agg.revenue),
      orders: agg.orders,
      cogs: Math.round(agg.cogs),
      fb_spend_estimated: Math.round(agg.fb_spend),
      vat: Math.round(agg.vat),
      profit: Math.round(agg.profit),
      profit_per_order: agg.orders > 0 ? Math.round(agg.profit / agg.orders) : 0,
      margin_pct: agg.revenue > 0 ? Math.round((agg.profit / agg.revenue) * 1000) / 10 : 0,
    },
  };
}

// ── ACCOUNT + CAMPAIGN aggregation từ fb-ads-data.json ──────────────────
// Trả về list account với spend, leads, campaigns count cho timeRange
export function compactFbAccounts(fbAdsJson, timeRange) {
  if (!fbAdsJson?.accounts) return { has_data: false, accounts: [] };
  // fb-ads-data.json hiện chứa aggregated 90d cho mỗi account.
  // Khi schema có per-day data → filter theo timeRange.
  // Hiện tại: trả về toàn bộ với note.
  const accounts = fbAdsJson.accounts.map(acc => ({
    id: acc.account_id,
    name: acc.account_name,
    spend: Number(acc.summary?.spend) || 0,
    impressions: Number(acc.summary?.impressions) || 0,
    clicks: Number(acc.summary?.clicks) || 0,
    leads: Number(acc.summary?.leads) || 0,
    campaigns_count: (acc.campaigns || []).length,
  }));
  return {
    has_data: accounts.some(a => a.spend > 0 || a.leads > 0),
    accounts,
    time_range_note: timeRange ? `${timeRange.label} (${timeRange.start} → ${timeRange.end})` : null,
    data_warning: !accounts.some(a => a.spend > 0)
      ? "fb-ads-data.json đang rỗng — kiểm tra workflow fetch-fb-ads (FB token có thể expired)"
      : null,
  };
}

// Trả về list campaigns của 1 account với spend/leads/CPL trong timeRange
export function compactFbCampaigns(fbAdsJson, accountId, timeRange) {
  if (!fbAdsJson?.accounts) return { has_data: false, campaigns: [] };
  const account = fbAdsJson.accounts.find(a => a.account_id === accountId);
  if (!account) return { has_data: false, campaigns: [], error: "Account not found" };
  const campaigns = (account.campaigns || []).map(c => ({
    id: c.campaign_id,
    name: c.campaign_name,
    spend: Number(c.spend) || 0,
    impressions: Number(c.impressions) || 0,
    clicks: Number(c.clicks) || 0,
    leads: Number(c.leads) || 0,
    ctr: Number(c.ctr) || 0,
    cpc: Number(c.cpc) || 0,
    cpl: c.leads > 0 ? Math.round(c.spend / c.leads) : null,
    status: c.status || "unknown",
  }));
  campaigns.sort((a, b) => b.spend - a.spend);
  return {
    has_data: campaigns.length > 0,
    account: { id: account.account_id, name: account.account_name },
    campaigns,
    time_range: timeRange,
  };
}

// ── DAILY TREND (lead per day for trend analysis) ────────────────────────
export function compactFbDailyTrend(productRevenueJson, days = 30) {
  if (!productRevenueJson?.source_groups) return { has_data: false };
  const dailyOrders = {};   // date → total orders FB
  const dailyRevenue = {};  // date → total revenue FB
  for (const sg of FB_SALES_GROUPS) {
    const products = productRevenueJson.source_groups[sg]?.products;
    if (!products) continue;
    for (const [name, p] of Object.entries(products)) {
      const grp = classifyFbProduct(name);
      if (!FB_ACTIVE_GROUPS.includes(grp)) continue;
      const ordersByDate = p.orders_by_date || {};
      const revByDate = p.by_date || {};
      for (const [date, ord] of Object.entries(ordersByDate)) {
        dailyOrders[date] = (dailyOrders[date] || 0) + Number(ord);
      }
      for (const [date, rev] of Object.entries(revByDate)) {
        dailyRevenue[date] = (dailyRevenue[date] || 0) + Number(rev);
      }
    }
  }
  const sortedDates = Object.keys(dailyOrders).sort().slice(-days);
  const series = sortedDates.map(d => ({
    date: d,
    orders: dailyOrders[d] || 0,
    revenue: Math.round(dailyRevenue[d] || 0),
  }));
  // 7-day avg + week-over-week
  const last7 = series.slice(-7);
  const prev7 = series.slice(-14, -7);
  const last7Orders = last7.reduce((s, x) => s + x.orders, 0);
  const prev7Orders = prev7.reduce((s, x) => s + x.orders, 0);
  const last7Rev = last7.reduce((s, x) => s + x.revenue, 0);
  const prev7Rev = prev7.reduce((s, x) => s + x.revenue, 0);
  const wowOrders = prev7Orders > 0 ? (last7Orders - prev7Orders) / prev7Orders : 0;
  const wowRevenue = prev7Rev > 0 ? (last7Rev - prev7Rev) / prev7Rev : 0;
  return {
    has_data: series.length > 0,
    days: series.length,
    series_last_30d: series,
    last_7d: { orders: last7Orders, revenue: last7Rev },
    prev_7d: { orders: prev7Orders, revenue: prev7Rev },
    wow_orders_pct: Math.round(wowOrders * 1000) / 10,
    wow_revenue_pct: Math.round(wowRevenue * 1000) / 10,
  };
}
