/* =========================================================
   记账   app.js
   纯前端 SPA，无依赖，数据存在 localStorage
   ========================================================= */
'use strict';

/* ─────────────────────── 常量 ─────────────────────── */

const STORE_KEY = 'moneybook_v1';
const WEEKDAYS  = ['周一','周二','周三','周四','周五','周六','周日'];

/* 分类色槽位（0-7）对应 --s1..--s8；-1 表示聚合桶「其他」，用中性灰。
   色板只有 8 个经过色盲校验的色相，所以默认分类正好占满 8 个槽位，
   保证环形图里不会出现两个同色的扇区。用户自己加的分类会复用槽位，
   此时靠图例里的图标 + 名称 + 金额区分（颜色从不单独承载信息）。 */
const EXPENSE_SEED = [
  ['餐饮','🍜',0], ['交通','🚌',1], ['购物','🛍️',2], ['日用','🧴',3],
  ['娱乐','🎮',4], ['通讯','📱',5], ['居住','🏠',6], ['医疗','💊',7],
];
const INCOME_SEED = [
  ['工资','💰',7], ['奖金','🏆',3], ['兼职','💼',2],
  ['红包','🧧',4], ['报销','🧾',6], ['理财','📈',5],
];
const ACCOUNT_SEED = [
  ['现金','💵'], ['微信','💬'], ['支付宝','🔷'],
  ['储蓄卡','🏦'], ['信用卡','💳'], ['其他','📁'],
];
const MEMBER_SEED = [
  { name:'我',  emoji:'😀', colorIdx:0 },
  { name:'TA',  emoji:'🐱', colorIdx:1 },
];
const EMOJI_LIST = [
  '🍜','🍚','🍔','☕️','🍎','🛒','🚌','🚕','🚇','⛽️','🛍️','👕','🧴','🏠','💡','💧',
  '🎮','🎬','🎵','📱','💊','🏥','🎁','🧧','📚','✏️','⚽','🏃','✈️','🏨','🐱','🍼',
  '💰','🏆','💼','🧾','📈','💵','💬','🔷','🏦','💳','📁','📦','⭐️','🌸','🔥','🎯',
];

/* ─────────────────────── 工具 ─────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let _uid = 0;
const uid = p => `${p}_${Date.now().toString(36)}${(_uid++).toString(36)}${Math.random().toString(36).slice(2,6)}`;
const pad2 = n => String(n).padStart(2, '0');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const monthOf  = ds => ds.slice(0, 7);
const thisMonth = () => todayStr().slice(0, 7);

function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
/** 金额千分位；dec=0 时四舍五入到整数 */
function fmt(n, dec = 2) {
  const neg = n < 0;
  const [i, f] = Math.abs(n).toFixed(dec).split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (dec > 0 ? `${ii}.${f}` : ii);
}
/** 坐标轴 / 小格子用的紧凑数字：1.2万 */
function fmtShort(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  const trim = v => v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e8) return s + trim(a / 1e8) + '亿';
  if (a >= 1e4) return s + trim(a / 1e4) + '万';
  if (a === 0) return '0';
  if (a < 10) return s + (Number.isInteger(a) ? a : trim(a));
  return s + Math.round(a);
}
/** 坐标轴刻度：整条轴统一单位，避免「5000」和「1万」并排出现 */
function tickFmt(v, yMax) {
  if (v === 0) return '0';
  const trim = x => x.toFixed(1).replace(/\.0$/, '');
  if (yMax >= 1e8) return trim(v / 1e8) + '亿';
  if (yMax >= 1e4) return trim(v / 1e4) + '万';
  return String(Math.round(v));
}
/** 取「好看」的坐标轴刻度 */
function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { max: 100, step: 25 };
  const raw = max / ticks;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = nf * base;
  return { max: step * ticks, step };
}
/** 给定底色，返回对比度更高的文字色 */
function inkOn(hex) {
  const c = hex.replace('#', '');
  const ch = i => parseInt(c.slice(i, i + 2), 16) / 255;
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#ffffff' : '#0b0b0b';
}

let _tokCache = null, _tokTheme = null;
function tok(name) {
  const t = resolvedTheme();
  if (_tokTheme !== t || !_tokCache) {
    _tokCache = {}; _tokTheme = t;
  }
  if (!(name in _tokCache)) {
    _tokCache[name] = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }
  return _tokCache[name];
}

/* ─────────────────────── 数据层 ─────────────────────── */

let DB = null;

function seed() {
  const cats = [];
  EXPENSE_SEED.forEach(([name, emoji, ci]) =>
    cats.push({ id: uid('c'), name, emoji, type: 'expense', colorIdx: ci }));
  INCOME_SEED.forEach(([name, emoji, ci]) =>
    cats.push({ id: uid('c'), name, emoji, type: 'income', colorIdx: ci }));
  cats.push({ id: 'cat_expense_other', name: '其他', emoji: '📦', type: 'expense', colorIdx: -1 });
  cats.push({ id: 'cat_income_other',  name: '其他', emoji: '📦', type: 'income',  colorIdx: -1 });

  const members = MEMBER_SEED.map(m => ({ id: uid('m'), ...m }));
  const accounts = ACCOUNT_SEED.map(([name, emoji]) => ({ id: uid('a'), name, emoji }));

  return {
    v: 1,
    settings: { theme: 'system', currentMember: members[0].id, range: 6 },
    members, accounts, categories: cats,
    records: [],
    budgets: {},
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      /* 首次运行：立刻落盘，保证成员/分类的 id 在刷新后保持稳定 */
      const d = seed();
      localStorage.setItem(STORE_KEY, JSON.stringify(d));
      return d;
    }
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.records)) return seed();
    d.settings  = Object.assign({ theme: 'system', range: 6 }, d.settings);
    d.members   = d.members?.length ? d.members : seed().members;
    d.accounts  = d.accounts?.length ? d.accounts : seed().accounts;
    d.categories= d.categories?.length ? d.categories : seed().categories;
    d.budgets   = d.budgets || {};
    return d;
  } catch (e) {
    console.warn('读取数据失败，使用初始数据', e);
    return seed();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(DB));
  } catch (e) {
    toast('保存失败：存储空间可能已满');
    console.error(e);
  }
}

/* ─────────────────────── 派生数据 ─────────────────────── */

const catById  = id => DB.categories.find(c => c.id === id);
const accById  = id => DB.accounts.find(a => a.id === id);
const memById  = id => DB.members.find(m => m.id === id);
const memByIdx = i  => DB.members[i] || DB.members[0];

function otherCat(type) {
  return DB.categories.find(c => c.id === `cat_${type}_other`)
      || DB.categories.find(c => c.type === type)
      || { id: '?', name: '未分类', emoji: '❔', type, colorIdx: -1 };
}
function catOf(rec) {
  const c = catById(rec.catId);
  return (c && c.type === rec.type) ? c : otherCat(rec.type);
}
function colorOf(cat) {
  if (!cat || cat.colorIdx < 0) return tok('--s-other') || '#898781';
  return tok(`--s${(cat.colorIdx % 8) + 1}`) || '#2a78d6';
}
function memColor(m) { return tok(`--s${((m?.colorIdx ?? 0) % 8) + 1}`); }

/* 使用者最多 8 个：正好占满 8 个色槽，任何两个人的颜色都不会撞。
 * 新增时优先挑一个还空着的槽位，而不是按人数顺序发。 */
const MAX_MEMBERS = 8;
function freeMemColor() {
  const used = new Set(DB.members.map(m => m.colorIdx));
  for (let i = 0; i < MAX_MEMBERS; i++) if (!used.has(i)) return i;
  return DB.members.length % MAX_MEMBERS;
}

function recordsOf(mk, filter) {
  return DB.records.filter(r =>
    r.date.startsWith(mk) && (filter === 'all' || r.memberId === filter));
}
const totalOf = (recs, type) =>
  recs.reduce((s, r) => (r.type === type ? s + r.amount : s), 0);

/** 分类聚合，降序 */
function groupByCat(recs, type) {
  const m = new Map();
  for (const r of recs) {
    if (r.type !== type) continue;
    const c = catOf(r);
    const e = m.get(c.id) || { cat: c, amount: 0, count: 0 };
    e.amount += r.amount; e.count++;
    m.set(c.id, e);
  }
  return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
}

/** 取最近 N 个月（含 anchor），升序 */
function lastMonths(anchor, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(anchor, -i));
  return out;
}

/** 预算沿用：找 <= monthKey 中最近设置过的那份 */
function budgetFor(mk) {
  const keys = Object.keys(DB.budgets).sort();
  let best = null;
  for (const k of keys) if (k <= mk) best = k;
  return best ? DB.budgets[best] : null;
}
function budgetOrigin(mk) {
  const keys = Object.keys(DB.budgets).sort();
  let best = null;
  for (const k of keys) if (k <= mk) best = k;
  return best;
}

/* ─────────────────────── 主题 ─────────────────────── */

function resolvedTheme() {
  const t = DB?.settings?.theme || 'system';
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  const t = DB.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const icon = $('#themeIcon');
  if (icon) icon.setAttribute('href', resolvedTheme() === 'dark' ? '#i-sun' : '#i-moon');
  _tokCache = null;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolvedTheme() === 'dark' ? '#0d0d0d' : '#f4f5f9');
}

/* ─────────────────────── 全局 UI 状态 ─────────────────────── */

const state = {
  tab: 'list',
  month: thisMonth(),
  memberFilter: 'all',
  chartMode: 'chart',     // chart | cal
  range: 6,
  donutType: 'expense',
  donutSel: null,
  calDay: null,
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

const COLOR_CLASS = { ok: '', warn: '', over: '' };
function statusOf(used, total) {
  if (!total) return { key: 'ok', label: '未设置', tag: '' };
  const p = used / total;
  if (p > 1)   return { key: 'over', label: '超支',  tag: 'over' };
  if (p >= 0.8) return { key: 'warn', label: '注意', tag: 'warn' };
  return { key: 'ok', label: '正常', tag: 'ok' };
}

/* ═══════════════════════ 明细页 ═══════════════════════ */

function renderList() {
  const el = $('#view-list');
  const mk = state.month;
  const recs = recordsOf(mk, state.memberFilter);
  const exp = totalOf(recs, 'expense');
  const inc = totalOf(recs, 'income');
  const bal = inc - exp;

  const prev = shiftMonth(mk, -1);
  const prevExp = totalOf(recordsOf(prev, state.memberFilter), 'expense');
  let deltaHtml = '';
  if (prevExp > 0) {
    const d = (exp - prevExp) / prevExp * 100;
    const up = d > 0.05, down = d < -0.05;
    deltaHtml = `<span class="delta ${up ? 'up' : down ? 'down' : ''}">
      ${up ? '↑' : down ? '↓' : '—'} 较上月 ${Math.abs(d).toFixed(1)}%</span>`;
  }

  /* 成员筛选条 */
  const filters = [{ id: 'all', name: '全部' }].concat(
    DB.members.map(m => ({ id: m.id, name: m.name, emoji: m.emoji, color: memColor(m) })));
  const filterHtml = filters.map(f => `
    <button class="chip ${state.memberFilter === f.id ? 'active' : ''}" data-filter="${f.id}">
      ${f.emoji ? `<span class="dot" style="background:${f.color}"></span>` : ''}${esc(f.name)}
    </button>`).join('');

  /* 流水按日分组 */
  const byDay = new Map();
  for (const r of recs) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const days = Array.from(byDay.keys()).sort().reverse();

  let listHtml = '';
  if (!days.length) {
    listHtml = `<div class="card"><div class="empty">
      <span class="big">🧾</span>
      ${recs.length === 0 && DB.records.length === 0 ? '还没有任何记录' : '这个月还没有记录'}<br>
      点右下角 <b>＋</b> 记下第一笔
    </div></div>`;
  } else {
    for (const day of days) {
      const rs = byDay.get(day).sort((a, b) => (b.created || 0) - (a.created || 0));
      const de = totalOf(rs, 'expense'), di = totalOf(rs, 'income');
      const parts = [];
      if (de > 0) parts.push(`支 ${fmt(de)}`);
      if (di > 0) parts.push(`收 ${fmt(di)}`);
      listHtml += `<div class="day-group">
        <div class="day-head">
          <div class="day-date">${dayLabel(day)}<em>${wdOf(day)}</em></div>
          <div class="day-sum">${parts.join(' · ')}</div>
        </div>
        <div class="rows">${rs.map(rowHtml).join('')}</div>
      </div>`;
    }
  }

  el.innerHTML = `
    <div class="filter-row">${filterHtml}</div>

    <div class="summary">
      <div class="summary-hero-label">本月支出 ${deltaHtml}</div>
      <div class="summary-hero"><span class="cur">¥</span>${fmt(exp)}</div>
      <div class="summary-grid">
        <div class="summary-cell">
          <div class="k"><span class="dot" style="background:var(--income)"></span>收入</div>
          <div class="v income">${fmt(inc)}</div>
        </div>
        <div class="summary-cell">
          <div class="k">结余</div>
          <div class="v ${bal < 0 ? 'income' : ''}">${fmt(bal)}</div>
        </div>
      </div>
    </div>

    ${listHtml}
  `;
}

const dayLabel = ds => {
  const [y, m, d] = ds.split('-').map(Number);
  const t = todayStr();
  if (ds === t) return '今天';
  const yest = new Date(Date.now() - 864e5);
  if (ds === `${yest.getFullYear()}-${pad2(yest.getMonth() + 1)}-${pad2(yest.getDate())}`) return '昨天';
  const now = new Date();
  return (y === now.getFullYear() ? '' : y + '年') + `${m}月${d}日`;
};
const wdOf = ds => {
  const [y, m, d] = ds.split('-').map(Number);
  return WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
};

function rowHtml(r) {
  const c = catOf(r);
  const acc = accById(r.accId);
  const m = memById(r.memberId);
  const col = colorOf(c);
  const sign = r.type === 'expense' ? '-' : '+';
  const metaBits = [];
  if (acc) metaBits.push(esc(acc.name));
  metaBits.push(`<span class="mini-av" style="background:${memColor(m)};color:${inkOn(memColor(m))}">${esc(m?.emoji || '')}</span>`);

  return `<div class="row" data-id="${r.id}">
    <div class="row-icon" style="background:${col}1f;color:${col}">${esc(c.emoji)}</div>
    <div class="row-body">
      <div class="row-title">${esc(r.note || c.name)}</div>
      <div class="row-meta">
        ${r.note ? `<span>${esc(c.name)}</span><span class="sep">·</span>` : ''}
        <span>${metaBits.join('</span><span class="sep">·</span><span>')}</span>
      </div>
    </div>
    <div class="row-amt ${r.type}">${sign}${fmt(r.amount)}</div>
  </div>`;
}

/* ═══════════════════════ 图表页 ═══════════════════════ */

function renderChart() {
  const el = $('#view-chart');
  const modeSeg = `
    <div class="seg" style="margin-bottom:12px">
      <button data-chartmode="chart" class="${state.chartMode === 'chart' ? 'active' : ''}">图表</button>
      <button data-chartmode="cal"   class="${state.chartMode === 'cal' ? 'active' : ''}">日历</button>
    </div>`;

  const filters = [{ id: 'all', name: '全部' }].concat(
    DB.members.map(m => ({ id: m.id, name: m.name, emoji: m.emoji, color: memColor(m) })));
  const filterHtml = `<div class="filter-row">${filters.map(f => `
    <button class="chip ${state.memberFilter === f.id ? 'active' : ''}" data-filter="${f.id}">
      ${f.emoji ? `<span class="dot" style="background:${f.color}"></span>` : ''}${esc(f.name)}
    </button>`).join('')}</div>`;

  el.innerHTML = filterHtml + modeSeg +
    (state.chartMode === 'chart' ? chartPanels() : calPanels());

  if (state.chartMode === 'chart') {
    drawTrend();
    drawDonut();
    memberCompare();
  } else {
    drawCalendar();
  }
}

function chartPanels() {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">收支趋势</div>
          <div class="card-sub" id="trendSub"></div>
        </div>
        <div class="seg">
          <button data-range="6"  class="${state.range === 6 ? 'active' : ''}">近6月</button>
          <button data-range="12" class="${state.range === 12 ? 'active' : ''}">近12月</button>
        </div>
      </div>
      <div class="legend">
        <span class="legend-item"><i class="legend-key" style="background:var(--expense)"></i>支出</span>
        <span class="legend-item"><i class="legend-key" style="background:var(--income)"></i>收入</span>
      </div>
      <div class="chart-wrap" id="trendWrap"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">构成占比</div>
        <div class="seg">
          <button data-donut="expense" class="${state.donutType === 'expense' ? 'active' : ''}">支出</button>
          <button data-donut="income"  class="${state.donutType === 'income'  ? 'active' : ''}">收入</button>
        </div>
      </div>
      <div id="donutBox"></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">谁花得多</div>
        <div class="card-sub">${esc(monthTitle(state.month))}</div></div>
      <div id="memberBox"></div>
    </div>`;
}

function calPanels() {
  return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">${esc(monthTitle(state.month))}</div>
        <div class="card-sub">点某一天看当天流水</div>
      </div>
      <div id="calBox"></div>
    </div>
    <div id="calDayBox"></div>`;
}

const monthTitle = mk => {
  const [y, m] = mk.split('-').map(Number);
  return `${y}年${m}月`;
};

/* ---------- 柱状图 ---------- */
function drawTrend() {
  const wrap = $('#trendWrap');
  if (!wrap) return;
  const months = lastMonths(state.month, state.range);
  const data = months.map(mk => {
    const rs = recordsOf(mk, state.memberFilter);
    return { mk, expense: totalOf(rs, 'expense'), income: totalOf(rs, 'income') };
  });

  $('#trendSub').textContent = `${monthTitle(months[0])} — ${monthTitle(months[months.length - 1])}`;

  const maxV = Math.max(...data.map(d => Math.max(d.expense, d.income)), 1);
  const { max: yMax, step } = niceScale(maxV, 4);

  const W = 340, H = 186;
  const PT = 20, PR = 4, PB = 22, PL = 34;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = data.length;
  const groupW = plotW / n;
  const barW = Math.max(3, Math.min(24, (groupW * 0.7 - 2) / 2));
  const yOf = v => PT + plotH - (v / yMax) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近${n}个月收支趋势">`;

  /* 网格线 + y 轴刻度 */
  for (let i = 0; i <= 4; i++) {
    const v = step * i, y = yOf(v);
    svg += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"
      stroke="${tok('--line')}" stroke-width="1"/>`;
    svg += `<text x="${PL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end"
      font-size="9.5" fill="${tok('--ink-3')}" font-variant-numeric="tabular-nums">${tickFmt(v, yMax)}</text>`;
  }

  /* 柱子 */
  const colors = { expense: tok('--expense'), income: tok('--income') };
  data.forEach((d, i) => {
    const gx = PL + groupW * i;
    const cx = gx + groupW / 2;
    const x0 = cx - barW - 1;          // 1px 半间隙 ×2 = 2px 白色间隙
    const x1 = cx + 1;
    [['expense', x0], ['income', x1]].forEach(([k, x]) => {
      const v = d[k];
      if (v <= 0) return;
      const y = yOf(v), h = PT + plotH - y;
      svg += `<path d="${barPath(x, y, barW, h, Math.min(4, barW / 2))}" fill="${colors[k]}"/>`;
    });
  });

  /* 只给最高的那根柱子直接标注（避免每根都标） */
  let peak = null;
  data.forEach((d, i) => {
    ['expense', 'income'].forEach(k => {
      if (d[k] > 0 && (!peak || d[k] > peak.v)) peak = { v: d[k], i, k };
    });
  });
  if (peak && barW >= 9) {
    const gx = PL + groupW * peak.i;
    const x = gx + groupW / 2 + (peak.k === 'expense' ? -1 - barW / 2 : 1 + barW / 2);
    svg += `<text x="${x.toFixed(1)}" y="${(yOf(peak.v) - 5).toFixed(1)}" text-anchor="middle"
      font-size="9.5" font-weight="700" fill="${tok('--ink-2')}"
      font-variant-numeric="tabular-nums">${fmtShort(peak.v)}</text>`;
  }

  /* x 轴标签 */
  const every = n > 8 ? 2 : 1;
  data.forEach((d, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const cx = PL + groupW * (i + 0.5);
    const m = Number(d.mk.slice(5));
    svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9.5"
      fill="${tok('--ink-3')}">${m}月</text>`;
  });

  /* 命中区域（点击出 tooltip） */
  data.forEach((d, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${(PL + groupW * i).toFixed(1)}" y="${PT}"
      width="${groupW.toFixed(1)}" height="${plotH}" fill="transparent" style="cursor:pointer"/>`;
  });

  svg += `</svg><div class="tip" id="trendTip"></div>`;
  wrap.innerHTML = svg;

  const tip = $('#trendTip');
  const show = i => {
    const d = data[i];
    tip.innerHTML = `<div style="font-weight:700;margin-bottom:3px">${monthTitle(d.mk)}</div>
      <div class="t-row"><i class="t-key" style="background:${colors.expense}"></i>支出 <b>${fmt(d.expense)}</b></div>
      <div class="t-row"><i class="t-key" style="background:${colors.income}"></i>收入 <b>${fmt(d.income)}</b></div>`;
    /* 先落到最左量出真实宽度，再把提示框夹在图表范围内，避免贴边被裁 */
    tip.style.left = '0px';
    tip.style.top  = '2px';
    tip.classList.add('show');
    const cw = wrap.clientWidth;
    const scale = cw / W;
    const half = tip.offsetWidth / 2 + 4;
    const x = (PL + groupW * (i + 0.5)) * scale;
    tip.style.left = Math.min(Math.max(x, half), cw - half) + 'px';
  };
  $$('.hit', wrap).forEach(r => r.addEventListener('click', () => show(+r.dataset.i)));
  wrap.addEventListener('click', e => {
    if (!e.target.closest('.hit')) tip.classList.remove('show');
  });
  if (n) setTimeout(() => show(n - 1), 60);
}

function barPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  const b = y + h;
  if (r <= 0.2) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${b} L${x},${y + r} Q${x},${y} ${x + r},${y}
          L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${b} Z`;
}

/* ---------- 环形图 ---------- */
function drawDonut() {
  const box = $('#donutBox');
  if (!box) return;
  const recs = recordsOf(state.month, state.memberFilter);
  const groups = groupByCat(recs, state.donutType);
  const total = groups.reduce((s, g) => s + g.amount, 0);
  const label = state.donutType === 'expense' ? '支出' : '收入';

  if (!total) {
    box.innerHTML = `<div class="empty" style="padding:26px 10px">
      <span class="big">📊</span>${esc(monthTitle(state.month))} 还没有${label}记录</div>`;
    return;
  }

  /* 前 8 名 + 其他（配色槽位固定跟着分类走，不随排名变化） */
  const top = groups.slice(0, 8);
  const rest = groups.slice(8);
  const slices = top.map(g => ({ name: g.cat.name, emoji: g.cat.emoji, amount: g.amount, id: g.cat.id, color: colorOf(g.cat) }));
  if (rest.length) {
    slices.push({
      id: '__other__', name: `其他 ${rest.length} 项`, emoji: '📦',
      amount: rest.reduce((s, g) => s + g.amount, 0), color: tok('--s-other'),
    });
  }

  const SIZE = 200, CX = 100, CY = 100, R = 64, SW = 26;
  const C = 2 * Math.PI * R;
  const GAP = 2;                       // 2px 表面色间隙分隔相邻扇区
  let off = 0;

  let rings = '';
  slices.forEach(s => {
    const frac = s.amount / total;
    const len = Math.max(frac * C - GAP, 1.2);
    const dim = state.donutSel && state.donutSel !== s.id;
    rings += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
      stroke="${s.color}" stroke-width="${SW}"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-off).toFixed(2)}"
      opacity="${dim ? 0.28 : 1}"
      transform="rotate(-90 ${CX} ${CY})"
      data-slice="${s.id}" style="transition:opacity .2s"/>`;
    off += frac * C;
  });

  const sel = slices.find(s => s.id === state.donutSel);
  const centerAmt = sel ? sel.amount : total;
  const centerName = sel ? sel.name : `本月${label}`;

  box.innerHTML = `
    <div class="chart-wrap" style="display:flex;justify-content:center">
      <svg viewBox="0 0 ${SIZE} ${SIZE}" style="max-width:200px" role="img" aria-label="${label}构成占比">
        ${rings}
        <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-size="10.5" fill="${tok('--ink-3')}">${esc(centerName)}</text>
        <text x="${CX}" y="${CY + 16}" text-anchor="middle" font-size="19" font-weight="700"
          fill="${tok('--ink')}">${fmt(centerAmt, 0)}</text>
      </svg>
    </div>
    <div class="cat-list">
      ${slices.map(s => {
        const pct = s.amount / total * 100;
        return `<div class="cat-line ${state.donutSel && state.donutSel !== s.id ? 'dim' : ''}" data-cat="${s.id}">
          <i class="cat-swatch" style="background:${s.color}"></i>
          <span class="cat-emoji">${esc(s.emoji)}</span>
          <span class="cat-name">${esc(s.name)}</span>
          <span class="cat-pct">${pct.toFixed(1)}%</span>
          <span class="cat-amt">${fmt(s.amount)}</span>
        </div>`;
      }).join('')}
    </div>`;

  $$('[data-cat]', box).forEach(row => row.addEventListener('click', () => {
    const id = row.dataset.cat;
    state.donutSel = state.donutSel === id ? null : id;
    drawDonut();
  }));
}

/* ---------- 两人对比 ---------- */
function memberCompare() {
  const box = $('#memberBox');
  if (!box) return;
  if (DB.members.length < 1) { box.innerHTML = ''; return; }
  const recs = recordsOf(state.month, 'all');
  const rows = DB.members.map(m => {
    const rs = recs.filter(r => r.memberId === m.id);
    return { m, expense: totalOf(rs, 'expense'), income: totalOf(rs, 'income'), count: rs.length };
  });
  const maxE = Math.max(...rows.map(r => r.expense), 1);

  box.innerHTML = rows.map(r => `
    <div class="member-row">
      <div class="member-row-top">
        <span class="mini-av" style="width:22px;height:22px;font-size:12px;background:${memColor(r.m)};color:${inkOn(memColor(r.m))}">${esc(r.m.emoji)}</span>
        <span class="member-row-name">${esc(r.m.name)}</span>
        <span class="member-row-amt">${fmt(r.expense)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.expense / maxE * 100).toFixed(1)}%"></div></div>
      <div class="b-meta"><span>${r.count} 笔</span><span>收入 ${fmt(r.income)}</span></div>
    </div>`).join('');
}

/* ---------- 日历 ---------- */
function drawCalendar() {
  const box = $('#calBox');
  if (!box) return;
  const mk = state.month;
  const [y, m] = mk.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startWd = (first.getDay() + 6) % 7;          // 周一为一周之首
  const days = new Date(y, m, 0).getDate();

  const recs = recordsOf(mk, state.memberFilter);
  const dayExp = new Map(), dayInc = new Map();
  for (const r of recs) {
    const d = Number(r.date.slice(8));
    const map = r.type === 'expense' ? dayExp : dayInc;
    map.set(d, (map.get(d) || 0) + r.amount);
  }

  /* 热力分位（只看有支出的日子），一个蓝色单色阶 浅→深 = 少→多 */
  const vals = Array.from(dayExp.values()).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const band = v => v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4;

  const today = todayStr();
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += `<div class="cal-cell pad"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${mk}-${pad2(d)}`;
    const e = dayExp.get(d) || 0;
    const b = band(e);
    const cls = ['', 'h1', 'h2', 'h3', 'h4'][b];
    cells += `<div class="cal-cell ${cls}
        ${ds === today ? 'today' : ''} ${ds === state.calDay ? 'sel' : ''}" data-day="${ds}">
      <div class="cal-day">${d}</div>
      ${e > 0 ? `<div class="cal-amt">${fmtShort(e)}</div>` : ''}
    </div>`;
  }

  box.innerHTML = `
    <div class="cal-grid">
      ${['一','二','三','四','五','六','日'].map(w => `<div class="cal-wd">${w}</div>`).join('')}
      ${cells}
    </div>
    <div class="heat-legend">
      <span>支出少</span>
      <i class="h0"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i>
      <i style="background:var(--h3)"></i><i style="background:var(--h4)"></i>
      <span>多</span>
    </div>`;

  $$('[data-day]', box).forEach(c => c.addEventListener('click', () => {
    const ds = c.dataset.day;
    state.calDay = state.calDay === ds ? null : ds;
    drawCalendar();
    drawCalDay();
  }));
  drawCalDay();
}

function drawCalDay() {
  const box = $('#calDayBox');
  if (!box) return;
  if (!state.calDay) {
    box.innerHTML = '';
    return;
  }
  const rs = DB.records
    .filter(r => r.date === state.calDay && (state.memberFilter === 'all' || r.memberId === state.memberFilter))
    .sort((a, b) => (b.created || 0) - (a.created || 0));

  box.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="card-title">${dayLabel(state.calDay)}</div>
      <div class="card-sub">支 ${fmt(totalOf(rs, 'expense'))} · 收 ${fmt(totalOf(rs, 'income'))}</div>
    </div>
    ${rs.length
      ? `<div class="rows" style="box-shadow:none;margin:0 -16px -6px">${rs.map(rowHtml).join('')}</div>`
      : `<div class="empty" style="padding:20px 0">这天没有记录</div>`}
  </div>`;
}

/* ═══════════════════════ 预算页 ═══════════════════════ */

function renderBudget() {
  const el = $('#view-budget');
  const mk = state.month;
  const recs = recordsOf(mk, state.memberFilter);
  const used = totalOf(recs, 'expense');
  const bg = budgetFor(mk);
  const originKey = budgetOrigin(mk);

  const [y, m] = mk.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const now = new Date();
  const isCurMonth = mk === thisMonth();
  const daysLeft = isCurMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;

  let mainCard;
  if (!bg || !bg.total) {
    mainCard = `<div class="card">
      <div class="empty" style="padding:28px 10px">
        <span class="big">🎯</span>还没有设置预算<br>
        <span style="font-size:12px">设一个数，超支时这里会提醒你</span>
      </div>
      <button class="btn btn-primary" id="setBudgetBtn">设置本月预算</button>
    </div>`;
  } else {
    const st = statusOf(used, bg.total);
    const left = bg.total - used;
    const pct = Math.min(100, used / bg.total * 100);
    mainCard = `<div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(monthTitle(mk))} 总预算</div>
          <div class="card-sub">预算 ¥${fmt(bg.total)}${originKey && originKey !== mk ? ` · 沿用 ${monthTitle(originKey)}` : ''}</div>
        </div>
        <span class="status-tag ${st.tag}">${st.key === 'over' ? '⚠ ' : st.key === 'warn' ? '!' : '✓'} ${st.label}</span>
      </div>
      <div class="b-summary">
        <div>
          <div class="b-label">${left >= 0 ? '本月还剩' : '已超出'}</div>
          <div class="b-left"><span class="cur">¥</span>${fmt(Math.abs(left))}</div>
        </div>
        <div style="text-align:right">
          <div class="b-label">已用</div>
          <div style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums">
            ${fmt(used)} <span style="color:var(--ink-3);font-weight:500">/ ${fmt(bg.total)}</span></div>
        </div>
      </div>
      <div class="meter-wrap">
        <div class="meter ${st.key}"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="b-meta">
          <span>${(used / bg.total * 100).toFixed(1)}%</span>
          <span>${left >= 0 ? `日均可用 ¥${fmt(left / daysLeft)}（剩 ${daysLeft} 天）` : '建议调整预算或减少支出'}</span>
        </div>
      </div>
    </div>`;
  }

  /* 分类预算 */
  let catCard = '';
  const cats = bg ? Object.entries(bg.cats || {}) : [];
  if (cats.length) {
    catCard = `<div class="card">
      <div class="card-head"><div class="card-title">分类预算</div>
        <button class="chip" id="setBudgetBtn2">编辑</button></div>
      ${cats.map(([cid, amt]) => {
        if (!(amt > 0)) return '';
        const c = catById(cid);
        const spent = recs.filter(r => r.type === 'expense' && catOf(r).id === cid)
                          .reduce((s, r) => s + r.amount, 0);
        const st = statusOf(spent, amt);
        return `<div class="b-cat">
          <div class="b-cat-top">
            <span class="li-icon" style="background:${colorOf(c)}1f;color:${colorOf(c)}">${esc(c?.emoji || '❔')}</span>
            <span class="b-cat-name">${esc(c?.name || '已删除分类')}</span>
            <span class="status-tag ${st.tag}">${st.key === 'over' ? '⚠ 超支' : st.key === 'warn' ? '! 接近' : '✓ 正常'}</span>
          </div>
          <div class="meter ${st.key}"><i style="width:${Math.min(100, spent / amt * 100).toFixed(1)}%"></i></div>
          <div class="b-cat-num" style="margin-top:7px">
            已用 <b>${fmt(spent)}</b> / ${fmt(amt)}
            <span style="color:var(--ink-3)"> · 剩 ${fmt(Math.max(0, amt - spent))}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  } else if (bg && bg.total) {
    catCard = `<div class="card"><div class="empty" style="padding:20px 10px;font-size:12.5px">
      还没有分类预算<br>给「餐饮」「购物」单独设个上限更好控
    </div>
    <button class="btn btn-ghost" id="setBudgetBtn2" style="box-shadow:var(--shadow)">添加分类预算</button></div>`;
  }

  el.innerHTML = mainCard + catCard;
}

/* ═══════════════════════ 我的 ═══════════════════════ */

function renderMe() {
  const el = $('#view-me');
  const themeSeg = ['system', 'light', 'dark'];
  const themeName = { system: '跟随系统', light: '浅色', dark: '深色' };

  el.innerHTML = `
    <div class="section-label">使用者</div>
    <div class="list-block">
      ${DB.members.map(m => {
        const cur = DB.settings.currentMember === m.id;
        const col = memColor(m);
        return `<div class="li" data-switch="${m.id}">
          <span class="avatar-lg" style="background:${col};color:${inkOn(col)}">${esc(m.emoji)}</span>
          <div class="li-body">
            <div class="li-title">${esc(m.name)}</div>
            <div class="li-sub">${DB.records.filter(r => r.memberId === m.id).length} 笔记录</div>
          </div>
          ${cur ? '<span class="me-badge">当前</span>' : ''}
          <button class="modal-x" data-editmem="${m.id}">✎</button>
        </div>`;
      }).join('')}
      ${DB.members.length < MAX_MEMBERS ? `
      <div class="li" data-addmem="1">
        <span class="li-icon" style="background:transparent">＋</span>
        <div class="li-body"><div class="li-title">添加使用者</div>
          <div class="li-sub">还可以加 ${MAX_MEMBERS - DB.members.length} 个</div></div>
        <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </div>` : `
      <div class="li" style="opacity:.55">
        <span class="li-icon" style="background:transparent">＋</span>
        <div class="li-body"><div class="li-title">已达上限 ${MAX_MEMBERS} 个</div>
          <div class="li-sub">色板只有 8 个不撞色的槽位，再加就会出现两个人同色</div></div>
      </div>`}
    </div>
    <div class="card-sub" style="padding:0 4px 4px;font-size:11.5px">
      点一行切换「现在是谁在记账」，新记的账默认算在他头上；点 ✎ 改资料或删除。
    </div>

    <div class="section-label">分类</div>
    <div class="list-block">
      <div class="li" data-open="cats">
        <span class="li-icon">🏷️</span>
        <div class="li-body"><div class="li-title">分类管理</div>
          <div class="li-sub">支出 ${DB.categories.filter(c => c.type === 'expense').length} 个 · 收入 ${DB.categories.filter(c => c.type === 'income').length} 个</div></div>
        <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </div>
      <div class="li" data-open="accounts">
        <span class="li-icon">💳</span>
        <div class="li-body"><div class="li-title">账户管理</div>
          <div class="li-sub">${DB.accounts.length} 个账户</div></div>
        <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </div>
    </div>

    <div class="section-label">外观</div>
    <div class="list-block">
      <div class="opt-row">
        <div><div class="ol">主题</div><div class="os">深色模式下夜里记账不刺眼</div></div>
        <div class="seg">${themeSeg.map(t => `<button data-theme-set="${t}"
          class="${DB.settings.theme === t ? 'active' : ''}">${themeName[t]}</button>`).join('')}</div>
      </div>
    </div>

    <div class="section-label">数据</div>
    <div class="list-block">
      <div class="li" data-open="export">
        <span class="li-icon">📤</span>
        <div class="li-body"><div class="li-title">导出备份</div>
          <div class="li-sub">存成 JSON 文件，换手机时用</div></div>
        <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </div>
      <div class="li" data-open="import">
        <span class="li-icon">📥</span>
        <div class="li-body"><div class="li-title">导入备份</div>
          <div class="li-sub">会覆盖现在的数据</div></div>
        <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </div>
      <div class="li" data-open="wipe">
        <span class="li-icon danger">🗑️</span>
        <div class="li-body"><div class="li-title danger">清空全部数据</div>
          <div class="li-sub">共 ${DB.records.length} 笔记录，不可恢复</div></div>
      </div>
    </div>

    <div class="card-sub" style="text-align:center;padding:12px 0 4px;font-size:11px;line-height:1.8">
      数据只保存在这台手机上（localStorage）<br>不会上传到任何服务器
    </div>`;
}

/* ═══════════════════════ 记账面板 ═══════════════════════ */

const draft = {
  type: 'expense', amount: '0', note: '', catId: null,
  accId: null, memberId: null, date: todayStr(), editId: null,
};

function openSheet(rec) {
  Object.assign(draft, {
    type: rec?.type || (draft.type === 'income' ? 'income' : 'expense'),
    amount: rec ? String(rec.amount) : '0',
    note: rec?.note || '',
    catId: rec?.catId || null,
    accId: rec?.accId || draft.accId || DB.accounts[0]?.id,
    memberId: rec?.memberId || DB.settings.currentMember,
    date: rec?.date || todayStr(),
    editId: rec?.id || null,
  });
  if (!draft.accId) draft.accId = DB.accounts[0]?.id;
  if (!draft.catId) {
    const first = DB.categories.find(c => c.type === draft.type);
    draft.catId = first ? first.id : otherCat(draft.type).id;
  }
  renderSheet();
  const el = $('#sheet');
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function closeSheet() {
  const el = $('#sheet');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

function renderSheet() {
  const el = $('#sheet');
  const cats = DB.categories.filter(c => c.type === draft.type);
  const acc = accById(draft.accId);
  const mem = memById(draft.memberId) || DB.members[0];
  const amtDisplay = draft.amount.includes('.')
    ? draft.amount.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    : fmt(Number(draft.amount || 0)).replace(/\.00$/, '');

  el.innerHTML = `
    <div class="sheet-head">
      <div class="seg" style="font-size:13px">
        <button data-stype="expense" class="${draft.type === 'expense' ? 'active' : ''}">支出</button>
        <button data-stype="income"  class="${draft.type === 'income'  ? 'active' : ''}">收入</button>
      </div>
      <button class="sheet-close" id="sheetClose">✕</button>
    </div>

    <div class="sheet-top">
      <input class="note-input" id="noteInput" placeholder="点这里写备注…" maxlength="24" value="${esc(draft.note)}">
      <div class="amount-display"><span class="cur">¥</span><span class="num" id="amtText">${amtDisplay}</span></div>
    </div>

    <div class="cat-scroll">
      <div class="cat-grid">
        ${cats.map(c => {
          const col = colorOf(c);
          const sel = c.id === draft.catId;
          return `<button class="cat-cell ${sel ? 'sel' : ''}" data-cat-pick="${c.id}"
            style="--c:${col};--c-ink:${inkOn(col)}">
            <span class="ce">${esc(c.emoji)}</span><span class="cn">${esc(c.name)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>

    <div class="sheet-meta">
      <button class="meta-chip" id="pickDate">📅 <span>${esc(dateChipLabel(draft.date))}</span></button>
      <button class="meta-chip" id="pickAcc">${esc(acc?.emoji || '💳')} <span>${esc(acc?.name || '账户')}</span></button>
      <button class="meta-chip" id="pickMem">${esc(mem?.emoji || '')} <span>${esc(mem?.name || '')}</span></button>
    </div>

    <div class="keypad">
      <button class="key" data-k="1">1</button>
      <button class="key" data-k="2">2</button>
      <button class="key" data-k="3">3</button>
      <button class="key fn" id="keyDate"><b>${esc(dateChipShort(draft.date))}</b></button>
      <button class="key" data-k="4">4</button>
      <button class="key" data-k="5">5</button>
      <button class="key" data-k="6">6</button>
      <button class="key fn" id="keyAcc">${esc(acc?.name || '账户')}</button>
      <button class="key" data-k="7">7</button>
      <button class="key" data-k="8">8</button>
      <button class="key" data-k="9">9</button>
      <button class="key del" data-k="del">
        <svg viewBox="0 0 24 24"><path d="M21 5H9L3 12l6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/></svg>
      </button>
      <button class="key" data-k=".">.</button>
      <button class="key" data-k="0">0</button>
      <button class="key save wide" id="keySave">${draft.editId ? '保存修改' : '保存'}</button>
    </div>`;
}

const dateChipLabel = ds => ds === todayStr() ? '今天'
  : ds === shiftDay(todayStr(), -1) ? '昨天'
  : `${Number(ds.slice(5, 7))}月${Number(ds.slice(8))}日`;
const dateChipShort = ds => ds === todayStr() ? '今天'
  : ds === shiftDay(todayStr(), -1) ? '昨天'
  : `${Number(ds.slice(5, 7))}/${Number(ds.slice(8))}`;
function shiftDay(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function keypadInput(k) {
  let a = draft.amount;
  if (k === 'del') {
    a = a.length > 1 ? a.slice(0, -1) : '0';
    if (a === '' || a === '-') a = '0';
  } else if (k === '.') {
    if (!a.includes('.')) a = (a === '0' ? '0' : a) + '.';
  } else {
    const dec = a.split('.')[1];
    if (dec !== undefined && dec.length >= 2) return;      // 最多两位小数
    if (a === '0') a = k;
    else if (a.replace('.', '').length >= 10) return;
    else a += k;
  }
  draft.amount = a;
  const t = $('#amtText');
  if (t) {
    t.textContent = a.includes('.')
      ? a.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
      : fmt(Number(a)).replace(/\.00$/, '');
  }
}

function saveDraft() {
  const amount = Math.round(parseFloat(draft.amount) * 100) / 100;
  if (!(amount > 0)) { toast('请先输入金额'); return; }
  if (!draft.catId) { toast('请选一个分类'); return; }

  if (draft.editId) {
    const r = DB.records.find(x => x.id === draft.editId);
    if (r) Object.assign(r, {
      type: draft.type, amount, catId: draft.catId, accId: draft.accId,
      memberId: draft.memberId, note: draft.note.trim(), date: draft.date,
    });
    toast('已保存修改');
  } else {
    DB.records.push({
      id: uid('r'), type: draft.type, amount,
      catId: draft.catId, accId: draft.accId, memberId: draft.memberId,
      note: draft.note.trim(), date: draft.date, created: Date.now(),
    });
    toast(`记好了 · ${draft.type === 'expense' ? '支出' : '收入'} ¥${fmt(amount)}`);
  }
  save();
  closeSheet();
  if (!state.month.startsWith(draft.date.slice(0, 7))) state.month = draft.date.slice(0, 7);
  renderAll();
}

/* ═══════════════════════ 弹层 ═══════════════════════ */

let modalOnClose = null;
function openModal({ title, body, actions = [] , onClose }) {
  const root = $('#modalRoot');
  modalOnClose = onClose || null;
  root.innerHTML = `
    <div class="modal-mask" data-close="1"></div>
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">${esc(title)}</div>
        <button class="modal-x" data-close="1">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) =>
        `<button class="btn ${a.cls || 'btn-ghost'}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');

  $$('[data-close]', root).forEach(b => b.addEventListener('click', closeModal));
  $$('[data-act]', root).forEach(b => b.addEventListener('click', () => {
    actions[+b.dataset.act].onClick?.();
  }));
  return root;
}
function closeModal() {
  const root = $('#modalRoot');
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  modalOnClose?.();
  modalOnClose = null;
  setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 300);
}

/* ---------- 日期选择 ---------- */
function pickDate() {
  const quick = [
    ['今天', todayStr()], ['昨天', shiftDay(todayStr(), -1)], ['前天', shiftDay(todayStr(), -2)],
  ];
  openModal({
    title: '选择日期',
    body: `
      <div class="field">
        <div class="field-label">快速选择</div>
        <div class="pick-row">
          ${quick.map(([n, v]) => `<button class="pick ${draft.date === v ? 'sel' : ''}" data-quick="${v}"><span class="pe">📅</span>${n}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">指定日期</div>
        <input type="date" id="dateInput" value="${draft.date}" max="${todayStr()}">
      </div>`,
    actions: [{ label: '确定', cls: 'btn-primary', onClick: () => {
      const v = $('#dateInput')?.value;
      if (v) draft.date = v;
      closeModal(); renderSheet();
    } }],
  });
  $$('[data-quick]').forEach(b => b.addEventListener('click', () => {
    draft.date = b.dataset.quick;
    closeModal(); renderSheet();
  }));
}

/* ---------- 账户选择 ---------- */
function pickAccount() {
  openModal({
    title: '选择账户',
    body: `<div class="pick-grid">${DB.accounts.map(a => `
      <button class="pick ${a.id === draft.accId ? 'sel' : ''}" data-acc="${a.id}">
        <span class="pe">${esc(a.emoji)}</span>${esc(a.name)}
      </button>`).join('')}</div>`,
    actions: [{ label: '管理账户', onClick: () => { closeModal(); setTimeout(manageAccounts, 320); } }],
  });
  $$('[data-acc]').forEach(b => b.addEventListener('click', () => {
    draft.accId = b.dataset.acc;
    closeModal(); renderSheet();
  }));
}

/* ---------- 成员选择 ---------- */
function pickMember() {
  openModal({
    title: '这笔算谁的',
    body: `<div class="pick-row" style="flex-direction:column">
      ${DB.members.map(m => {
        const col = memColor(m);
        return `<button class="pick ${m.id === draft.memberId ? 'sel' : ''}" data-mem="${m.id}"
          style="width:100%;justify-content:flex-start">
          <span class="pe" style="width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:${col};color:${inkOn(col)}">${esc(m.emoji)}</span>
          ${esc(m.name)}
        </button>`;
      }).join('')}
    </div>`,
  });
  $$('[data-mem]').forEach(b => b.addEventListener('click', () => {
    draft.memberId = b.dataset.mem;
    closeModal(); renderSheet();
  }));
}

/* ---------- 单笔详情 / 编辑 / 删除 ---------- */
function openRecord(id) {
  const r = DB.records.find(x => x.id === id);
  if (!r) return;
  const c = catOf(r), acc = accById(r.accId), m = memById(r.memberId);
  const col = colorOf(c);
  openModal({
    title: '这笔账',
    body: `
      <div style="display:flex;align-items:center;gap:12px;padding:6px 0 18px">
        <span class="li-icon" style="width:48px;height:48px;font-size:24px;background:${col}1f">${esc(c.emoji)}</span>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:700">${esc(r.note || c.name)}</div>
          <div style="font-size:12px;color:var(--ink-3);margin-top:3px">
            ${esc(c.name)} · ${esc(acc?.name || '—')} · ${esc(m?.name || '—')}</div>
        </div>
        <div style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums"
          class="${r.type === 'income' ? 'row-amt income' : ''}">
          ${r.type === 'expense' ? '-' : '+'}${fmt(r.amount)}</div>
      </div>
      <div class="opt-row" style="border-radius:12px">
        <div class="ol">日期</div><div class="li-val">${esc(r.date)}（${wdOf(r.date)}）</div>
      </div>`,
    actions: [
      { label: '删除', cls: 'btn-danger', onClick: () => {
        closeModal();
        setTimeout(() => confirmDelete(r), 320);
      } },
      { label: '编辑', cls: 'btn-primary', onClick: () => {
        closeModal();
        setTimeout(() => openSheet(r), 320);
      } },
    ],
  });
}
function confirmDelete(r) {
  openModal({
    title: '删除这笔记录？',
    body: `<div class="empty" style="padding:16px 0 24px">${esc(r.note || catOf(r).name)} · ¥${fmt(r.amount)}<br>
      <span style="font-size:12px">删除后无法恢复</span></div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '删除', cls: 'btn-danger', onClick: () => {
        DB.records = DB.records.filter(x => x.id !== r.id);
        save(); closeModal(); renderAll(); toast('已删除');
      } },
    ],
  });
}

/* ═══════════════════════ 管理弹层 ═══════════════════════ */

function manageAccounts() {
  const body = () => `<div class="list-block" style="box-shadow:none">
    ${DB.accounts.map(a => `<div class="li" style="padding:11px 0">
      <span class="li-icon">${esc(a.emoji)}</span>
      <div class="li-body"><div class="li-title">${esc(a.name)}</div>
        <div class="li-sub">${DB.records.filter(r => r.accId === a.id).length} 笔</div></div>
      <button class="modal-x" data-acc-edit="${a.id}">✎</button>
      <button class="modal-x danger" data-acc-del="${a.id}">🗑</button>
    </div>`).join('')}
  </div>
  <button class="btn btn-ghost" id="accAdd" style="box-shadow:var(--shadow);margin-top:8px">＋ 添加账户</button>`;

  const bind = () => {
    $$('[data-acc-edit]').forEach(b => b.addEventListener('click', () => editAccount(b.dataset.accEdit)));
    $$('[data-acc-del]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.accDel;
      if (DB.accounts.length <= 1) return toast('至少保留一个账户');
      const used = DB.records.filter(r => r.accId === id).length;
      if (used) return toast(`还有 ${used} 笔记录在用这个账户`);
      DB.accounts = DB.accounts.filter(a => a.id !== id);
      save(); manageAccounts();
    }));
    $('#accAdd')?.addEventListener('click', () => editAccount(null));
  };
  openModal({ title: '账户管理', body: body(), onClose: () => { save(); renderAll(); } });
  bind();
}

function editAccount(id) {
  const a = id ? accById(id) : null;
  openModal({
    title: a ? '编辑账户' : '添加账户',
    body: `
      <div class="field"><div class="field-label">名称</div>
        <input type="text" id="accName" maxlength="8" value="${esc(a?.name || '')}" placeholder="例如：招行卡"></div>
      <div class="field"><div class="field-label">图标</div>
        <div class="emoji-grid" id="accEmoji">
          ${['💵','💬','🔷','🏦','💳','📁','🪙','📱','🏧','💰'].map(e =>
            `<button data-e="${e}" class="${(a?.emoji || '💳') === e ? 'sel' : ''}">${e}</button>`).join('')}
        </div></div>`,
    actions: [{ label: '保存', cls: 'btn-primary', onClick: () => {
      const name = $('#accName').value.trim();
      const emoji = $('#accEmoji .sel')?.dataset.e || '💳';
      if (!name) return toast('请输入名称');
      if (a) Object.assign(a, { name, emoji });
      else DB.accounts.push({ id: uid('a'), name, emoji });
      save(); closeModal();
    } }],
    onClose: () => manageAccounts(),   // 返回上一级
  });
  bindEmojiGrid();
}

function bindEmojiGrid() {
  $$('#accEmoji button, #catEmoji button, #memEmoji button').forEach(b =>
    b.addEventListener('click', () => {
      $$('button', b.parentElement).forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
    }));
}

function manageCats(type = 'expense') {
  const body = () => `
    <div class="seg" style="margin-bottom:14px" id="catSeg">
      <button data-ct="expense" class="${type === 'expense' ? 'active' : ''}">支出分类</button>
      <button data-ct="income"  class="${type === 'income'  ? 'active' : ''}">收入分类</button>
    </div>
    <div class="list-block" style="box-shadow:none">
      ${DB.categories.filter(c => c.type === type).map(c => `<div class="li" style="padding:11px 0">
        <span class="li-icon" style="background:${colorOf(c)}1f">${esc(c.emoji)}</span>
        <div class="li-body"><div class="li-title">${esc(c.name)}</div>
          <div class="li-sub">${DB.records.filter(r => catOf(r).id === c.id).length} 笔</div></div>
        <button class="modal-x" data-cat-edit="${c.id}">✎</button>
        ${c.colorIdx < 0 ? '' : `<button class="modal-x danger" data-cat-del="${c.id}">🗑</button>`}
      </div>`).join('')}
    </div>
    <button class="btn btn-ghost" id="catAdd" style="box-shadow:var(--shadow);margin-top:8px">＋ 添加分类</button>`;

  const bind = () => {
    $$('#catSeg button').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.ct; save(); refresh();
    }));
    $$('[data-cat-edit]').forEach(b => b.addEventListener('click', () => editCat(b.dataset.catEdit)));
    $$('[data-cat-del]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.catDel;
      const used = DB.records.filter(r => catOf(r).id === id).length;
      const doDel = () => {
        DB.categories = DB.categories.filter(c => c.id !== id);
        DB.records.forEach(r => { if (r.catId === id) r.catId = otherCat(r.type).id; });
        for (const k of Object.keys(DB.budgets)) delete DB.budgets[k].cats?.[id];
        save(); refresh();
      };
      if (used) {
        openModal({
          title: '这个分类还在用',
          body: `<div class="empty" style="padding:16px 0 22px">有 ${used} 笔记录属于「${esc(catById(id)?.name)}」<br>
            <span style="font-size:12px">删除后这些记录会移到「其他」</span></div>`,
          actions: [{ label: '取消', onClick: () => { closeModal(); manageCats(type); } },
                    { label: '删除并移动', cls: 'btn-danger', onClick: () => { closeModal(); doDel(); setTimeout(() => manageCats(type), 320); } }],
        });
      } else doDel();
    }));
    $('#catAdd')?.addEventListener('click', () => editCat(null, type));
  };
  const refresh = () => { openModal({ title: '分类管理', body: body(), onClose: () => { save(); renderAll(); } }); bind(); };

  openModal({ title: '分类管理', body: body(), onClose: () => { save(); renderAll(); } });
  bind();
}

function editCat(id, type = 'expense') {
  const c = id ? catById(id) : null;
  const t = c?.type || type;
  const usedIdx = new Set(DB.categories.filter(x => x.type === t).map(x => x.colorIdx));
  openModal({
    title: c ? '编辑分类' : '添加分类',
    body: `
      <div class="field"><div class="field-label">名称</div>
        <input type="text" id="catName" maxlength="6" value="${esc(c?.name || '')}" placeholder="例如：宠物"></div>
      <div class="field"><div class="field-label">图标</div>
        <div class="emoji-grid" id="catEmoji">
          ${EMOJI_LIST.map(e => `<button data-e="${e}" class="${(c?.emoji || '🏷️') === e ? 'sel' : ''}">${e}</button>`).join('')}
        </div></div>`,
    actions: [{ label: '保存', cls: 'btn-primary', onClick: () => {
      const name = $('#catName').value.trim();
      const emoji = $('#catEmoji .sel')?.dataset.e || '🏷️';
      if (!name) return toast('请输入名称');
      if (c) Object.assign(c, { name, emoji });
      else {
        let idx = 0;
        while (usedIdx.has(idx) && idx < 8) idx++;
        if (idx >= 8 || usedIdx.has(idx)) {          // 8 个槽位用完就复用，靠图例+名称区分
          idx = DB.categories.filter(x => x.type === t).length % 8;
        }
        DB.categories.push({ id: uid('c'), name, emoji, type: t, colorIdx: idx });
      }
      save(); closeModal();
    } }],
    onClose: () => manageCats(t),      // 返回上一级
  });
  bindEmojiGrid();
}

function editMember(id) {
  const isNew = !id;
  if (isNew && DB.members.length >= MAX_MEMBERS) {
    return toast(`最多 ${MAX_MEMBERS} 个使用者`);
  }
  const m = isNew ? { name: '', emoji: EMOJI_LIST[0], colorIdx: freeMemColor() } : memById(id);
  if (!m) return;
  /* 只剩一个人时不给删，否则账本就没有归属了 */
  const canDelete = !isNew && DB.members.length > 1;

  openModal({
    title: isNew ? '添加使用者' : '编辑使用者',
    body: `
      <div class="field"><div class="field-label">名字</div>
        <input type="text" id="memName" maxlength="6" value="${esc(m.name)}"
          placeholder="${isNew ? '例如 爸爸 / 老婆 / 室友' : ''}"></div>
      <div class="field"><div class="field-label">头像</div>
        <div class="emoji-grid" id="memEmoji">
          ${EMOJI_LIST.map(e => `<button data-e="${e}" class="${m.emoji === e ? 'sel' : ''}">${e}</button>`).join('')}
        </div></div>
      <div class="field"><div class="field-label">颜色</div>
        <div class="pick-row" id="memColor">
          ${[0,1,2,3,4,5,6,7].map(i => `<button class="pick ${m.colorIdx === i ? 'sel' : ''}" data-ci="${i}"
            style="background:${tok(`--s${i + 1}`)};color:${inkOn(tok(`--s${i + 1}`))};padding:9px 16px">●</button>`).join('')}
        </div></div>
      ${isNew ? '<div class="hint">添加后可以随时切换使用者，各自的账目互不混淆。</div>' : ''}`,
    actions: [
      ...(canDelete ? [{ label: '删除', cls: 'btn-danger', onClick: () => {
        closeModal();
        setTimeout(() => deleteMember(id), 320);
      } }] : []),
      { label: isNew ? '添加' : '保存', cls: 'btn-primary', onClick: () => {
        const name = $('#memName').value.trim();
        if (!name) return toast('请输入名字');
        const emoji = $('#memEmoji .sel')?.dataset.e || m.emoji;
        const colorIdx = Number($('#memColor .sel')?.dataset.ci ?? m.colorIdx);
        if (isNew) {
          const nm = { id: uid('m'), name, emoji, colorIdx };
          DB.members.push(nm);
          save(); closeModal(); renderAll();
          toast(`已添加「${name}」`);
        } else {
          Object.assign(m, { name, emoji, colorIdx });
          save(); closeModal(); renderAll(); toast('已保存');
        }
      } },
    ],
  });
  bindEmojiGrid();
  $$('#memColor .pick').forEach(b => b.addEventListener('click', () => {
    $$('#memColor .pick').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  }));
}

/* 删除使用者。名下有记录时必须先交代这些记录的去向 ——
 * 直接把人删掉会让那些记录变成「孤儿」，筛选和统计都会漏掉它们。 */
function deleteMember(id) {
  const m = memById(id);
  if (!m) return;
  if (DB.members.length <= 1) return toast('至少要保留一个使用者');

  const mine = DB.records.filter(r => r.memberId === id);
  const others = DB.members.filter(x => x.id !== id);

  const wipe = moveTo => {
    DB.records = moveTo
      ? DB.records.map(r => (r.memberId === id ? { ...r, memberId: moveTo } : r))
      : DB.records.filter(r => r.memberId !== id);
    DB.members = others;
    /* 删掉的正好是当前使用者 / 正在筛选的人，都要重新落位 */
    if (DB.settings.currentMember === id) DB.settings.currentMember = others[0].id;
    if (state.memberFilter === id) state.memberFilter = 'all';
    save(); closeModal(); renderAll();
    toast(moveTo ? `已删除「${m.name}」，记录已转走` : `已删除「${m.name}」`);
  };

  if (!mine.length) {
    openModal({
      title: `删除「${m.name}」？`,
      body: `<div class="empty" style="padding:14px 0 20px">还没有记过账<br>
        <span style="font-size:12px">删除后无法恢复</span></div>`,
      actions: [
        { label: '取消', onClick: closeModal },
        { label: '删除', cls: 'btn-danger', onClick: () => wipe(null) },
      ],
    });
    return;
  }

  openModal({
    title: `删除「${m.name}」？`,
    body: `
      <div class="hint"><b>${esc(m.name)}</b> 名下共有 <b>${mine.length}</b> 笔记录
        （合计 ¥${fmt(totalOf(mine, 'expense'))}），请选择怎么处理：</div>
      <div class="field" style="margin-top:14px"><div class="field-label">转给谁</div>
        <div class="pick-row" id="moveTo">
          ${others.map(o => `<button class="pick" data-move="${o.id}"
            style="padding:9px 14px">${esc(o.emoji)} ${esc(o.name)}</button>`).join('')}
        </div></div>
      <div class="hint">选一个人 → 这些记录全部归他；不选就和他一起删掉。</div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: `连同 ${mine.length} 笔一起删`, cls: 'btn-danger', onClick: () => wipe(null) },
      { label: '转给选中的人', cls: 'btn-primary', onClick: () => {
        const to = $('#moveTo .sel')?.dataset.move;
        if (!to) return toast('先选一个转给谁');
        wipe(to);
      } },
    ],
  });
  $$('#moveTo .pick').forEach(b => b.addEventListener('click', () => {
    $$('#moveTo .pick').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  }));
}

/* ---------- 预算编辑 ---------- */
function editBudget() {
  const mk = state.month;
  const bg = budgetFor(mk) || { total: 0, cats: {} };
  const expCats = DB.categories.filter(c => c.type === 'expense');
  openModal({
    title: `${monthTitle(mk)} 预算`,
    body: `
      <div class="field">
        <div class="field-label">本月总预算</div>
        <input type="number" id="bTotal" inputmode="decimal" min="0" step="100"
          value="${bg.total || ''}" placeholder="例如 5000">
      </div>
      <div class="field">
        <div class="field-label">分类预算（可留空）</div>
        ${expCats.map(c => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="font-size:17px;width:24px;text-align:center">${esc(c.emoji)}</span>
          <span style="flex:1;font-size:14px;font-weight:600">${esc(c.name)}</span>
          <input type="number" inputmode="decimal" min="0" step="50" data-bcat="${c.id}"
            value="${bg.cats?.[c.id] || ''}" placeholder="不限"
            style="width:110px;height:40px;border-radius:10px;background:var(--surface);border:1.5px solid transparent;padding:0 12px;font-size:14px;outline:none;text-align:right">
        </div>`).join('')}
        <div class="hint">留空 = 不限制。预算会自动沿用到之后的月份，除非某个月单独设置。</div>
      </div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '保存', cls: 'btn-primary', onClick: () => {
        const total = Math.max(0, parseFloat($('#bTotal').value) || 0);
        const cats = {};
        $$('[data-bcat]').forEach(i => {
          const v = parseFloat(i.value);
          if (v > 0) cats[i.dataset.bcat] = v;
        });
        if (!total && !Object.keys(cats).length) delete DB.budgets[mk];
        else DB.budgets[mk] = { total, cats };
        save(); closeModal(); renderAll(); toast('预算已保存');
      } },
    ],
  });
}

/* ---------- 导入导出 ---------- */
function exportData() {
  const json = JSON.stringify(DB, null, 2);
  const name = `记账备份_${todayStr()}.json`;
  let downloaded = false;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    downloaded = true;
  } catch (e) { console.warn(e); }

  openModal({
    title: '导出备份',
    body: `${downloaded ? '' : '<div class="hint" style="margin-bottom:10px">当前浏览器不支持直接下载，请手动复制下面的内容保存。</div>'}
      <div class="field"><div class="field-label">共 ${DB.records.length} 笔记录</div>
      <textarea id="expText" readonly>${esc(json)}</textarea>
      <div class="hint">${downloaded ? `已触发下载 <b>${esc(name)}</b>；也可以复制下面的文本保存。` : ''}</div></div>`,
    actions: [{ label: '复制', onClick: async () => {
      try { await navigator.clipboard.writeText(json); toast('已复制到剪贴板'); }
      catch { $('#expText')?.select(); toast('请长按文本框手动复制'); }
    } }],
  });
}

function importData() {
  openModal({
    title: '导入备份',
    body: `
      <div class="field"><div class="field-label">选择备份文件</div>
        <input type="file" id="impFile" accept=".json,application/json"
          style="height:auto;padding:12px;font-size:13px"></div>
      <div class="field"><div class="field-label">或粘贴备份内容</div>
        <textarea id="impText" placeholder='{"v":1,...}'></textarea></div>
      <div class="hint">导入会 <b>覆盖</b> 这台手机上现有的全部记录，建议先导出一份。</div>`,
    actions: [{ label: '开始导入', cls: 'btn-primary', onClick: () => {
      const txt = $('#impText').value.trim();
      if (!txt) return toast('请先选择文件或粘贴内容');
      applyImport(txt);
    } }],
  });
  $('#impFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => applyImport(String(fr.result));
    fr.readAsText(f);
  });
}

function applyImport(txt) {
  let d;
  try { d = JSON.parse(txt); } catch { return toast('内容不是有效的 JSON'); }
  if (!d || !Array.isArray(d.records) || !Array.isArray(d.categories)) return toast('这不是本应用的备份文件');
  openModal({
    title: '确认导入',
    body: `<div class="empty" style="padding:14px 0 22px">
      备份里有 <b>${d.records.length}</b> 笔记录<br>
      现在这台手机上有 <b>${DB.records.length}</b> 笔<br>
      <span style="font-size:12px;color:var(--critical)">导入后现有数据会被覆盖</span></div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '覆盖导入', cls: 'btn-primary', onClick: () => {
        DB = d;
        DB.settings = Object.assign({ theme: 'system', range: 6 }, DB.settings);
        if (!memById(DB.settings.currentMember)) DB.settings.currentMember = DB.members[0].id;
        save(); applyTheme(); closeModal(); renderAll(); toast('导入成功');
      } },
    ],
  });
}

function wipeData() {
  openModal({
    title: '清空全部数据？',
    body: `<div class="empty" style="padding:14px 0 22px">
      ${DB.records.length} 笔记录、${DB.members.length} 个使用者、所有预算都会被删除<br>
      <span style="font-size:12px;color:var(--critical)">这个操作无法撤销</span></div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '我确定要清空', cls: 'btn-danger', onClick: () => {
        const theme = DB.settings.theme;
        DB = seed();
        DB.settings.theme = theme;
        save(); closeModal(); renderAll(); toast('已清空');
      } },
    ],
  });
}

/* ═══════════════════════ 渲染调度 ═══════════════════════ */

function renderAll() {
  $('#monthLabel').textContent = monthTitle(state.month);

  const m = memById(DB.settings.currentMember) || DB.members[0];
  $('#memberEmoji').textContent = m.emoji;
  $('#memberEmoji').style.background = memColor(m) + '26';
  $('#memberName').textContent = m.name;

  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${state.tab}`)?.classList.add('active');
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));

  if (state.tab === 'list')   renderList();
  if (state.tab === 'chart')  renderChart();
  if (state.tab === 'budget') renderBudget();
  if (state.tab === 'me')     renderMe();
}

/* ═══════════════════════ 事件绑定 ═══════════════════════ */

function switchTab(tab) {
  state.tab = tab;
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchMember(id) {
  if (!memById(id)) return;
  DB.settings.currentMember = id;
  save();
  const m = memById(id);
  $('#memberEmoji').textContent = m.emoji;
  $('#memberEmoji').style.background = memColor(m) + '26';
  $('#memberName').textContent = m.name;
  toast(`现在是「${m.name}」在记账`);
  if (state.tab === 'me') renderMe();
}

function init() {
  DB = load();
  state.range = DB.settings.range || 6;
  applyTheme();

  /* 底部导航 */
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.tab);
  });

  /* 顶栏 */
  $('#prevMonth').addEventListener('click', () => {
    state.month = shiftMonth(state.month, -1); state.calDay = null; renderAll();
  });
  $('#nextMonth').addEventListener('click', () => {
    state.month = shiftMonth(state.month, 1); state.calDay = null; renderAll();
  });
  $('#monthLabel').addEventListener('click', () => {
    if (state.month !== thisMonth()) { state.month = thisMonth(); state.calDay = null; renderAll(); toast('回到本月'); }
  });
  $('#memberBtn').addEventListener('click', pickCurrentMember);
  $('#themeBtn').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const i = order.indexOf(DB.settings.theme);
    DB.settings.theme = order[(i + 1) % 3];
    save(); applyTheme(); renderAll();
    toast({ system: '跟随系统', light: '浅色模式', dark: '深色模式' }[DB.settings.theme]);
  });

  /* 底栏中间的「记一笔」 */
  $('#addBtn').addEventListener('click', () => openSheet(null));

  /* 主区域事件委托 */
  document.addEventListener('click', e => {
    const t = e.target;

    const filter = t.closest('[data-filter]');
    if (filter) { state.memberFilter = filter.dataset.filter; state.donutSel = null; renderAll(); return; }

    const row = t.closest('.row[data-id]');
    if (row && !t.closest('.sheet')) { openRecord(row.dataset.id); return; }

    const cm = t.closest('[data-chartmode]');
    if (cm) { state.chartMode = cm.dataset.chartmode; renderChart(); return; }

    const rg = t.closest('[data-range]');
    if (rg) { state.range = +rg.dataset.range; DB.settings.range = state.range; save(); renderChart(); return; }

    const dn = t.closest('[data-donut]');
    if (dn) { state.donutType = dn.dataset.donut; state.donutSel = null; renderChart(); return; }

    if (t.closest('#setBudgetBtn') || t.closest('#setBudgetBtn2')) { editBudget(); return; }

    /* 记账面板 */
    const st = t.closest('[data-stype]');
    if (st) {
      draft.type = st.dataset.stype;
      if (!DB.categories.some(c => c.id === draft.catId && c.type === draft.type)) {
        draft.catId = DB.categories.find(c => c.type === draft.type)?.id;
      }
      renderSheet(); return;
    }
    const cp = t.closest('[data-cat-pick]');
    if (cp) { draft.catId = cp.dataset.catPick; renderSheet(); return; }
    const k = t.closest('[data-k]');
    if (k) { keypadInput(k.dataset.k); return; }

    if (t.closest('#sheetClose')) { closeSheet(); return; }
    if (t.closest('#keyDate') || t.closest('#pickDate')) { pickDate(); return; }
    if (t.closest('#keyAcc')  || t.closest('#pickAcc'))  { pickAccount(); return; }
    if (t.closest('#pickMem')) { pickMember(); return; }
    if (t.closest('#keySave')) { saveDraft(); return; }

    /* 我的 */
    const sw = t.closest('[data-switch]');
    if (sw && !t.closest('[data-editmem]')) { switchMember(sw.dataset.switch); return; }
    const em = t.closest('[data-editmem]');
    if (em) { e.stopPropagation(); editMember(em.dataset.editmem); return; }

    if (t.closest('[data-addmem]')) { editMember(null); return; }

    const th = t.closest('[data-theme-set]');
    if (th) { DB.settings.theme = th.dataset.themeSet; save(); applyTheme(); renderMe(); return; }

    const op = t.closest('[data-open]');
    if (op) {
      const v = op.dataset.open;
      if (v === 'cats') manageCats();
      if (v === 'accounts') manageAccounts();
      if (v === 'export') exportData();
      if (v === 'import') importData();
      if (v === 'wipe') wipeData();
      return;
    }
  });

  /* 记账面板：备注输入 */
  document.addEventListener('input', e => {
    if (e.target.id === 'noteInput') draft.note = e.target.value;
  });

  /* Esc 关闭 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#modalRoot').classList.contains('open')) closeModal();
    else if ($('#sheet').classList.contains('open')) closeSheet();
  });

  /* 顶栏滚动描边 */
  window.addEventListener('scroll', () => {
    $('.topbar').classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  /* 系统主题变化 */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (DB.settings.theme === 'system') { applyTheme(); renderAll(); }
  });

  renderAll();
}

function pickCurrentMember() {
  const cur = DB.settings.currentMember;
  openModal({
    title: '现在是谁在记账',
    body: `<div class="pick-row" style="flex-direction:column">
      ${DB.members.map(m => {
        const col = memColor(m);
        return `<button class="pick ${m.id === cur ? 'sel' : ''}" data-setmem="${m.id}"
          style="width:100%;justify-content:flex-start">
          <span class="pe" style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${col};color:${inkOn(col)}">${esc(m.emoji)}</span>
          ${esc(m.name)}${m.id === cur ? ' · 当前' : ''}
        </button>`;
      }).join('')}
    </div>`,
    actions: [{ label: '编辑资料', onClick: () => {
      closeModal(); setTimeout(() => editMember(cur), 320);
    } }],
  });
  $$('[data-setmem]').forEach(b => b.addEventListener('click', () => {
    switchMember(b.dataset.setmem); closeModal();
  }));
}

/* 离线支持：注册 service worker，之后断网也能打开。
 * file:// 下浏览器不允许注册，所以先判断协议，失败也不影响使用。 */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线能力降级，不影响记账 */ });
}

/* 启动 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); registerSW(); });
} else { init(); registerSW(); }
