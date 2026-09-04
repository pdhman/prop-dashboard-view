/* 대시보드 렌더러 — index.html(로컬)과 view/index.html(웹, 암호화)이 공유한다.
   window.renderDashboard(D, opts) 로 호출. D는 PROP_DATA 형식. */
window.renderDashboard = function (D, opts) {
  "use strict";
  opts = opts || {};
  var days = D.days;
  var today = days[days.length - 1];
  var prev = days.length > 1 ? days[days.length - 2] : null;

  // ── 시간가중수익률(TWR) NAV 지수 ────────────────────────────
  // 외부 입출금(total.flow — 입금 +, 출금 −)의 효과를 제거한 순수 운용 성과 지수.
  // 기본은 입출금이 "당일 말"에 발생한 것으로 보고 분자에서 뺀다:
  //     r = (당일 평가금액 − 입출금) / 전일 평가금액 − 1,   nav = ∏(1+r)
  // 입금이 장중 내내 계좌에 있었다면 total.flowAtStart = true 로 두고 분모에 넣는다:
  //     r = 당일 평가금액 / (전일 평가금액 + 입출금) − 1
  //   이 경우 놀고 있던 현금이 분모에 포함돼 그날 등락이 희석된다(현금 비중 효과가 정직하게 반영됨).
  // 그냥 평가금액/원금 으로 계산하면 입금이 수익으로 잡혀 크게 왜곡된다.
  // flow 가 하나도 없으면 nav 는 평가금액/초기자본 과 정확히 같아진다(기존 결과 보존).
  (function buildNav() {
    var nav = 1, prevValue = null;
    days.forEach(function (d) {
      var t = d.total || {};
      var v = t.value != null ? t.value : null;
      if (v != null) {
        if (prevValue != null && prevValue > 0) {
          var f = t.flow || 0;
          nav *= t.flowAtStart ? v / (prevValue + f) : (v - f) / prevValue;
        }
        prevValue = v;
        d._nav = nav;
      } else if (t.cumRet != null) {
        nav = 1 + t.cumRet / 100;     // 평가금액이 없는 요약 기록일
        d._nav = nav;
      } else {
        d._nav = null;
      }
    });
  })();
  function cumRetOf(d) { return d && d._nav != null ? (d._nav - 1) * 100 : null; }

  // 누적 입출금과 투입원금
  var totalFlow = days.reduce(function (a, d) { return a + ((d.total && d.total.flow) || 0); }, 0);
  var principal = (D.meta.capital || 0) + totalFlow;

  // 저장된 cumRet 이 TWR 계산과 어긋나면 알린다 (data.js 를 손으로 고쳤을 때의 안전장치)
  days.forEach(function (d) {
    var stored = d.total && d.total.cumRet, calc = cumRetOf(d);
    if (stored != null && calc != null && Math.abs(stored - calc) > 0.02) {
      console.warn("[prop-dashboard] " + d.date + " cumRet 불일치: 기록 " +
        stored.toFixed(2) + "% vs TWR " + calc.toFixed(2) + "% — data.js 를 확인하세요");
    }
  });
  // 계좌가 하나면 합산 라인이 중복이므로 생략하고, 그 계좌가 대표색(슬롯 1)을 쓴다
  var MULTI = today.portfolios.length > 1;
  var PF_COLORS = MULTI ? ["var(--s2)", "var(--s3)"] : ["var(--s1)"];
  var TOTAL_COLOR = "var(--s1)";
  var BM_COLOR = "var(--muted)";

  function bmRet(d) { return (d.bmIndex / D.meta.bmStart - 1) * 100; }

  // ── 포맷터 ─────────────────────────────
  function comma(n) { return Math.round(n).toLocaleString("ko-KR"); }
  function fmtWon(n) { return comma(n) + "원"; }
  function fmtCompact(n) {
    var sign = n < 0 ? "-" : "", a = Math.abs(n);
    if (a >= 1e8) { var v = a / 1e8; return sign + (v >= 100 ? comma(v) : v.toFixed(2)) + "억"; }
    if (a >= 1e4) return sign + comma(a / 1e4) + "만";
    return sign + comma(a);
  }
  function fmtPct(v, dp, unit) {
    if (v == null) return "–";
    return (v > 0 ? "+" : "") + v.toFixed(dp == null ? 2 : dp) + (unit || "%");
  }
  function pnClass(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
  function fmtDate(iso, withDay) {
    var d = new Date(iso + "T00:00:00");
    var s = (d.getMonth() + 1) + "/" + d.getDate();
    if (withDay) s += " (" + "일월화수목금토"[d.getDay()] + ")";
    return s;
  }

  // ── DOM/SVG 헬퍼 ───────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function niceTicks(min, max, count) {
    count = count || 5;
    var span = max - min || 1;
    var step0 = span / count;
    var mag = Math.pow(10, Math.floor(Math.log10(step0)));
    var norm = step0 / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step)
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    return ticks;
  }
  // 가로 막대: 베이스라인 쪽 직각, 데이터 끝 4px 라운드
  function barPath(x0, x1, y, h) {
    var r = Math.min(4, Math.abs(x1 - x0), h / 2);
    if (x1 >= x0) {
      return "M" + x0 + " " + y +
        "L" + (x1 - r) + " " + y + "Q" + x1 + " " + y + " " + x1 + " " + (y + r) +
        "L" + x1 + " " + (y + h - r) + "Q" + x1 + " " + (y + h) + " " + (x1 - r) + " " + (y + h) +
        "L" + x0 + " " + (y + h) + "Z";
    }
    return "M" + x0 + " " + y +
      "L" + (x1 + r) + " " + y + "Q" + x1 + " " + y + " " + x1 + " " + (y + r) +
      "L" + x1 + " " + (y + h - r) + "Q" + x1 + " " + (y + h) + " " + (x1 + r) + " " + (y + h) +
      "L" + x0 + " " + (y + h) + "Z";
  }

  // ── 툴팁 ───────────────────────────────
  var tip = document.getElementById("tip");
  function tipShow(x, y, build) {
    tip.textContent = "";
    build(tip);
    tip.style.display = "block";
    var r = tip.getBoundingClientRect();
    var px = x + 14, py = y + 12;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 14;
    if (py + r.height > window.innerHeight - 8) py = y - r.height - 12;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
  }
  function tipHide() { tip.style.display = "none"; }
  function tipRow(parent, color, valText, nameText) {
    var row = el("div", "tipRow");
    var key = el("span", "tipKey");
    key.style.background = color;
    row.appendChild(key);
    row.appendChild(el("span", "tipVal", valText));
    if (nameText) row.appendChild(el("span", "tipName", nameText));
    parent.appendChild(row);
    return row;
  }

  // ── 헤더 ───────────────────────────────
  (function () {
    var start = new Date(D.meta.startDate + "T00:00:00");
    var cur = new Date(today.date + "T00:00:00");
    var dayN = Math.round((cur - start) / 864e5) + 1;
    document.getElementById("headSub").textContent =
      today.date.replace(/-/g, ".") + " (" + "일월화수목금토"[cur.getDay()] + ") 기준 · 운용 시작 " +
      D.meta.startDate.replace(/-/g, ".") + " (" + dayN + "일차)";
    var foot = document.getElementById("footNote");
    if (foot) {
      foot.textContent = (opts.footNote || "데이터: data.js") + " · " +
        D.meta.bmName + " 시작지수 " + D.meta.bmStart.toLocaleString("ko-KR");
    }
  })();

  // ── 테마 토글 ──────────────────────────
  (function () {
    var btn = document.getElementById("themeBtn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    var saved = null;
    try { saved = localStorage.getItem("prop-theme"); } catch (e) {}
    if (saved) document.documentElement.dataset.theme = saved;
    btn.addEventListener("click", function () {
      var dark = document.documentElement.dataset.theme === "dark" ||
        (!document.documentElement.dataset.theme &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("prop-theme", next); } catch (e) {}
    });
  })();

  // ── 이미지 저장 버튼 ───────────────────
  (function () {
    var btn = document.getElementById("pngBtn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "저장 중…";
      window.exportDashboardPNG(function (err) {
        btn.disabled = false;
        btn.textContent = err ? "저장 실패" : label;
        if (err) {
          console.error(err);
          setTimeout(function () { btn.textContent = label; }, 2500);
        }
      });
    });
  })();

  // ── KPI 타일 ───────────────────────────
  (function () {
    var wrap = document.getElementById("kpis");
    wrap.textContent = "";
    function tile(o) {
      var t = el("div", "tile");
      t.appendChild(el("div", "label", o.label));
      var v = el("div", "value" + (o.cls ? " " + o.cls : ""), o.value);
      t.appendChild(v);
      if (o.delta) t.appendChild(el("div", "delta " + (o.deltaCls || ""), o.delta));
      if (o.sub) t.appendChild(el("div", "sub", o.sub));
      wrap.appendChild(t);
    }
    var t = today.total;
    var bmC = bmRet(today);
    var bmD = prev ? bmC - bmRet(prev) : null;
    var cumRet = cumRetOf(today);                      // TWR 기준 기간 수익률
    var prevCum = cumRetOf(prev);
    var retD = prevCum != null ? cumRet - prevCum : null;
    var excess = cumRet - bmC;

    // ── 연율화 지표 준비 ───────────────────
    // NAV(=평가금액/초기자본) 시계열로 일간 수익률을 만들고 변동성·샤프·CAGR을 계산한다.
    // 평가금액이 없는 요약 기록일은 누적 수익률로 대신한다(둘 다 비율이라 비교 가능).
    // MDD·변동성·샤프는 모두 TWR NAV 지수 위에서 계산한다.
    // 평가금액을 그대로 쓰면 입출금이 수익/손실로 잡혀 오염된다.
    function navRatio(d) { return d._nav != null ? d._nav : null; }
    var TRADING_DAYS = 252;
    var MIN_OBS = 5;   // 표본이 이보다 적으면 연율화가 무의미하므로 표시하지 않는다
    var risk = (function () {
      var nav = [], dates = [];
      days.forEach(function (d) {
        var v = navRatio(d);
        if (v != null) { nav.push(v); dates.push(d.date); }
      });
      var rets = [];
      for (var i = 1; i < nav.length; i++) rets.push(nav[i] / nav[i - 1] - 1);
      if (rets.length < MIN_OBS) return { n: rets.length, ok: false };

      var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
      var sq = rets.reduce(function (a, r) { return a + (r - mean) * (r - mean); }, 0);
      var sd = Math.sqrt(sq / (rets.length - 1));               // 표본 표준편차
      var vol = sd * Math.sqrt(TRADING_DAYS) * 100;             // 연환산 변동성 (%)
      var retA = mean * TRADING_DAYS * 100;                     // 산술 연환산 수익률 (%)
      var rf = D.meta.riskFreeRate != null ? D.meta.riskFreeRate : 0;
      var sharpe = vol > 0 ? (retA - rf) / vol : null;

      // CAGR 은 기하평균 — 달력일 기준으로 연환산한다
      var d0 = new Date(dates[0] + "T00:00:00");
      var d1 = new Date(dates[dates.length - 1] + "T00:00:00");
      var cal = Math.round((d1 - d0) / 864e5);
      var totalRet = nav[nav.length - 1] / nav[0] - 1;
      var cagr = cal > 0 ? (Math.pow(1 + totalRet, 365 / cal) - 1) * 100 : null;

      return { ok: true, n: rets.length, vol: vol, retA: retA, sharpe: sharpe, cagr: cagr, rf: rf, cal: cal };
    })();

    tile({ label: "총 평가금액", value: fmtCompact(t.value), sub: fmtWon(t.value) });

    // 총 손익은 계좌 전체(평가금액 − 초기자본) 기준.
    // 실현+평가 합과 달리 매매 비용까지 반영되므로 기간 수익률과 정확히 일치한다.
    // (실현/평가 내역은 아래 포트폴리오 구성 카드에서 따로 보여준다)
    // 원금 = 초기자본 + 누적 입출금. 입금이 있으면 그만큼 원금이 늘어난다.
    var totalPnl = D.meta.capital != null ? t.value - principal : (t.realized || 0) + t.pnl;
    tile({
      label: "총 손익",
      value: fmtCompact(totalPnl),
      cls: pnClass(totalPnl),
      sub: D.meta.capital == null ? fmtWon(totalPnl)
        : totalFlow
          ? "원금 " + fmtCompact(principal) + "원 대비 (입출금 " + fmtCompact(totalFlow) + " 포함)"
          : "초기자본 " + fmtCompact(D.meta.capital) + "원 대비"
    });
    tile({
      label: "기간 수익률", value: fmtPct(cumRet), cls: pnClass(cumRet),
      delta: retD == null ? null : (retD >= 0 ? "▲ " : "▼ ") + Math.abs(retD).toFixed(2) + "%p 전일 대비",
      deltaCls: pnClass(retD),
      sub: risk.ok && risk.cagr != null
        ? "연환산(CAGR) " + fmtPct(risk.cagr, 1) + (totalFlow ? " · 시간가중(TWR)" : "")
        : (totalFlow ? "시간가중(TWR) 기준" : null)
    });
    tile({
      label: D.meta.bmName + " 기간 수익률", value: fmtPct(bmC), cls: pnClass(bmC),
      delta: bmD == null ? null : (bmD >= 0 ? "▲ " : "▼ ") + Math.abs(bmD).toFixed(2) + "%p 금일",
      deltaCls: pnClass(bmD),
      sub: "지수 " + today.bmIndex.toLocaleString("ko-KR")
    });
    tile({ label: "BM 대비 초과수익", value: fmtPct(excess, 2, "%p"), cls: pnClass(excess), sub: "기간 수익률 − " + D.meta.bmName });

    // ── 연환산 변동성 ──
    tile({
      label: "연환산 변동성",
      value: risk.ok ? risk.vol.toFixed(1) + "%" : "–",
      sub: risk.ok
        ? "일간 " + risk.n + "일 · " + TRADING_DAYS + "일 환산"
        : "관측 " + risk.n + "일 (" + MIN_OBS + "일 이상 필요)"
    });

    // ── 샤프지수 ──
    // (산술 연환산 수익률 − 무위험수익률) / 연환산 변동성
    tile({
      label: "샤프지수",
      value: risk.ok && risk.sharpe != null ? (risk.sharpe >= 0 ? "+" : "") + risk.sharpe.toFixed(2) : "–",
      cls: risk.ok && risk.sharpe != null ? pnClass(risk.sharpe) : "",
      sub: risk.ok ? "무위험 " + risk.rf.toFixed(1) + "% 가정 · 연환산 " + fmtPct(risk.retA, 1) : null
    });

    // ── 최대 낙폭 (MDD) ──
    // 고점 대비 최대 하락폭. 외부 입출금이 없어 평가금액 자체가 NAV 역할을 한다.
    function maxDrawdown(valueOf) {
      var peak = null, peakDate = null, worst = 0, atPeak = null, atTrough = null;
      days.forEach(function (d) {
        var v = valueOf(d);
        if (v == null) return;
        if (peak == null || v > peak) { peak = v; peakDate = d.date; }
        var dd = (v / peak - 1) * 100;
        if (dd < worst) { worst = dd; atPeak = peakDate; atTrough = d.date; }
      });
      return { value: worst, peakDate: atPeak, troughDate: atTrough };
    }
    var mdd = maxDrawdown(navRatio);
    var bmMdd = maxDrawdown(function (d) { return d.bmIndex != null ? d.bmIndex : null; });
    var mddSub = D.meta.bmName + " " + fmtPct(bmMdd.value);
    if (mdd.peakDate) mddSub += " · 고점 " + fmtDate(mdd.peakDate);
    tile({
      label: "최대 낙폭 (MDD)",
      value: fmtPct(mdd.value),
      cls: mdd.value < 0 ? "neg" : "",
      sub: mddSub
    });
  })();

  // ── 추이 라인 차트 ─────────────────────
  var trendSeries = (function () {
    var s = [];
    if (MULTI) s.push({ name: "합산", color: TOTAL_COLOR, get: cumRetOf });
    today.portfolios.forEach(function (p, i) {
      s.push({
        name: p.name, color: PF_COLORS[i % PF_COLORS.length],
        // 계좌가 하나면 그 계좌가 곧 전체이므로 TWR 지수를 그대로 쓴다.
        // 계좌가 여럿이면 계좌별 입출금을 알 수 없어 저장된 cumRet 을 쓴다.
        get: MULTI ? function (d) {
          var m = (d.portfolios || []).filter(function (q) { return q.name === p.name; })[0];
          return m ? m.cumRet : null;
        } : cumRetOf
      });
    });
    s.push({ name: D.meta.bmName, color: BM_COLOR, get: bmRet });
    return s;
  })();

  (function legend() {
    var lg = document.getElementById("trendLegend");
    lg.textContent = "";
    trendSeries.forEach(function (s) {
      var it = el("span", "item");
      var k = el("span", "key");
      k.style.background = s.color;
      it.appendChild(k);
      it.appendChild(document.createTextNode(s.name));
      lg.appendChild(it);
    });
  })();

  function renderTrend() {
    var host = document.getElementById("trendChart");
    host.textContent = "";
    var W = host.clientWidth || 900, H = 300;

    // 끝 라벨 폭을 실측해 오른쪽 여백을 정한다 (좁은 화면에서는 값만 표시)
    var compact = W < 560;
    var endLabelFor = function (s, v) { return compact ? fmtPct(v, 1) : s.name + " " + fmtPct(v, 1); };
    var meas = document.createElement("canvas").getContext("2d");
    meas.font = "600 11.5px system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif";
    var mR = 48;
    trendSeries.forEach(function (s) {
      var endV = null;
      days.forEach(function (d) {
        var v = s.get(d);
        if (v != null) endV = v;
      });
      if (endV == null) return;
      var w = meas.measureText(endLabelFor(s, endV)).width;
      mR = Math.max(mR, Math.ceil(w) + 22);
    });

    var mL = 42, mT = 14, mB = 30;
    var pw = W - mL - mR, ph = H - mT - mB;

    var vals = [0];
    days.forEach(function (d) {
      trendSeries.forEach(function (s) {
        var v = s.get(d);
        if (v != null) vals.push(v);
      });
    });
    var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
    var pad = (vMax - vMin || 1) * 0.08;
    vMin -= pad; vMax += pad;
    var y = function (v) { return mT + ph - (v - vMin) / (vMax - vMin) * ph; };
    var n = days.length;
    var x = function (i) { return n === 1 ? mL + pw / 2 : mL + i / (n - 1) * pw; };

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H });

    niceTicks(vMin, vMax).forEach(function (tv) {
      root.appendChild(svg("line", {
        x1: mL, x2: mL + pw, y1: y(tv), y2: y(tv),
        stroke: tv === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1
      }));
      var lbl = svg("text", { x: mL - 8, y: y(tv) + 3.5, "text-anchor": "end", "class": "tickLabel" });
      lbl.textContent = tv + "%";
      root.appendChild(lbl);
    });

    var maxXT = 8, stepXT = Math.max(1, Math.ceil(n / maxXT));
    days.forEach(function (d, i) {
      if (i % stepXT !== 0 && i !== n - 1) return;
      var lbl = svg("text", { x: x(i), y: H - 9, "text-anchor": "middle", "class": "tickLabel" });
      lbl.textContent = fmtDate(d.date);
      root.appendChild(lbl);
    });

    trendSeries.forEach(function (s) {
      var pts = [];
      days.forEach(function (d, i) {
        var v = s.get(d);
        if (v != null) pts.push([x(i), y(v), v, i]);
      });
      s._pts = pts;
      if (!pts.length) return;
      var path = pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join("");
      root.appendChild(svg("path", {
        d: path, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linecap": "round", "stroke-linejoin": "round"
      }));
      var last = pts[pts.length - 1];
      root.appendChild(svg("circle", {
        cx: last[0], cy: last[1], r: 4.5, fill: s.color,
        stroke: "var(--surface)", "stroke-width": 2
      }));
      s._endY = last[1];
      s._endV = last[2];
    });

    // 끝 라벨 (겹침 방지: 위→아래 정렬 후 16px 간격 확보)
    var labs = trendSeries.filter(function (s) { return s._pts && s._pts.length; })
      .map(function (s) { return { s: s, y: s._endY }; })
      .sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < labs.length; i++)
      if (labs[i].y - labs[i - 1].y < 16) labs[i].y = labs[i - 1].y + 16;
    labs.forEach(function (L) {
      var t = svg("text", { x: mL + pw + 14, y: L.y + 3.5, "class": "endLabel" });
      t.textContent = endLabelFor(L.s, L.s._endV);
      root.appendChild(t);
      root.appendChild(svg("line", {
        x1: mL + pw + 5, x2: mL + pw + 11,
        y1: L.s._endY, y2: L.y, stroke: L.s.color, "stroke-width": 2, "stroke-linecap": "round"
      }));
    });

    // 크로스헤어 + 통합 툴팁
    var cross = svg("line", { y1: mT, y2: mT + ph, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
    root.appendChild(cross);
    var hoverDots = trendSeries.map(function (s) {
      var c = svg("circle", { r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
      root.appendChild(c);
      return c;
    });
    var overlay = svg("rect", { x: mL, y: mT, width: pw, height: ph, fill: "transparent" });
    overlay.addEventListener("pointermove", function (ev) {
      var box = root.getBoundingClientRect();
      var px = (ev.clientX - box.left) * (W / box.width);
      var idx = 0, best = Infinity;
      for (var i = 0; i < n; i++) {
        var dd = Math.abs(x(i) - px);
        if (dd < best) { best = dd; idx = i; }
      }
      cross.setAttribute("x1", x(idx));
      cross.setAttribute("x2", x(idx));
      cross.setAttribute("visibility", "visible");
      var d = days[idx];
      var rows = [];
      trendSeries.forEach(function (s, si) {
        var v = s.get(d);
        if (v == null) { hoverDots[si].setAttribute("visibility", "hidden"); return; }
        hoverDots[si].setAttribute("cx", x(idx));
        hoverDots[si].setAttribute("cy", y(v));
        hoverDots[si].setAttribute("visibility", "visible");
        rows.push({ color: s.color, v: v, name: s.name });
      });
      rows.sort(function (a, b) { return b.v - a.v; });
      tipShow(ev.clientX, ev.clientY, function (tp) {
        tp.appendChild(el("div", "tipTitle", fmtDate(d.date, true)));
        rows.forEach(function (r) { tipRow(tp, r.color, fmtPct(r.v), r.name); });
      });
    });
    overlay.addEventListener("pointerleave", function () {
      cross.setAttribute("visibility", "hidden");
      hoverDots.forEach(function (c) { c.setAttribute("visibility", "hidden"); });
      tipHide();
    });
    root.appendChild(overlay);
    host.appendChild(root);
  }

  // ── 일별 기록 표 (추이 차트의 표 뷰) ──
  (function () {
    var host = document.getElementById("trendTable");
    host.textContent = "";
    var tb = el("table");
    var thead = el("thead"), trh = el("tr");
    ["날짜"].concat(trendSeries.map(function (s) { return s.name; })).forEach(function (h) {
      trh.appendChild(el("th", null, h));
    });
    thead.appendChild(trh);
    tb.appendChild(thead);
    var tbody = el("tbody");
    days.forEach(function (d) {
      var tr = el("tr");
      tr.appendChild(el("td", null, d.date));
      trendSeries.forEach(function (s) {
        var v = s.get(d);
        tr.appendChild(el("td", v == null ? "" : pnClass(v), v == null ? "–" : fmtPct(v)));
      });
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    host.appendChild(tb);
  })();

  // ── 종목별 가로 다이버징 바 차트 ───────
  function renderBars(hostId, rows, opt) {
    var host = document.getElementById(hostId);
    host.textContent = "";
    var W = host.clientWidth || 500;
    var rowH = 30, barH = 16, labelW = 124, axisH = 24;
    var H = rows.length * rowH + axisH;
    var vMin = Math.min(0), vMax = Math.max(0);
    rows.forEach(function (r) {
      vMin = Math.min(vMin, r.value);
      vMax = Math.max(vMax, r.value);
    });
    if (vMin === 0 && vMax === 0) vMax = 1;
    var resL = vMin < 0 ? 52 : 10, resR = vMax > 0 ? 52 : 10;
    var xL = labelW + 6, xR = W - 6;
    var k = (xR - resR - (xL + resL)) / (vMax - vMin);
    var xv = function (v) { return xL + resL + (v - vMin) * k; };
    var x0 = xv(0);

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H });

    niceTicks(vMin, vMax, 5).forEach(function (tv) {
      if (tv === 0) return;
      root.appendChild(svg("line", { x1: xv(tv), x2: xv(tv), y1: 0, y2: H - axisH, stroke: "var(--grid)", "stroke-width": 1 }));
      var lbl = svg("text", { x: xv(tv), y: H - 8, "text-anchor": "middle", "class": "tickLabel" });
      lbl.textContent = tv + (opt.tickUnit || "");
      root.appendChild(lbl);
    });
    root.appendChild(svg("line", { x1: x0, x2: x0, y1: 0, y2: H - axisH, stroke: "var(--axis)", "stroke-width": 1 }));
    var zl = svg("text", { x: x0, y: H - 8, "text-anchor": "middle", "class": "tickLabel" });
    zl.textContent = "0";
    root.appendChild(zl);

    rows.forEach(function (r, i) {
      var yTop = i * rowH, yBar = yTop + (rowH - barH) / 2;
      var g = svg("g", { "class": "hitRow", tabindex: 0, role: "img" });
      g.setAttribute("aria-label", r.label + " " + opt.fmt(r.value));

      var wash = svg("rect", { x: 0, y: yTop, width: W, height: rowH, fill: "transparent", "class": "rowWash", rx: 6 });
      g.appendChild(wash);

      g.appendChild(svg("circle", { cx: 8, cy: yTop + rowH / 2, r: 4, fill: PF_COLORS[r.pf % PF_COLORS.length] }));
      var name = svg("text", { x: 17, y: yTop + rowH / 2 + 4, "class": "rowLabel" });
      name.textContent = r.label;
      g.appendChild(name);

      var bar = svg("path", {
        d: barPath(x0, xv(r.value), yBar, barH),
        fill: r.value >= 0 ? "var(--up)" : "var(--down)"
      });
      g.appendChild(bar);

      var vt = svg("text", {
        x: r.value >= 0 ? xv(r.value) + 6 : xv(r.value) - 6,
        y: yBar + barH / 2 + 3.5,
        "text-anchor": r.value >= 0 ? "start" : "end",
        "class": "valLabel"
      });
      vt.textContent = opt.fmt(r.value);
      g.appendChild(vt);

      function showTip(cx, cy) {
        tipShow(cx, cy, function (tp) {
          tp.appendChild(el("div", "tipTitle", r.label + " · " + today.portfolios[r.pf].name));
          r.tipRows.forEach(function (tr2) {
            var row = el("div", "tipRow");
            var key = el("span", "tipKey");
            key.style.background = tr2[2] || "var(--axis)";
            row.appendChild(key);
            row.appendChild(el("span", "tipVal", tr2[1]));
            row.appendChild(el("span", "tipName", tr2[0]));
            tp.appendChild(row);
          });
        });
      }
      g.addEventListener("pointermove", function (ev) {
        bar.setAttribute("opacity", "0.82");
        wash.setAttribute("fill", "var(--wash)");
        showTip(ev.clientX, ev.clientY);
      });
      g.addEventListener("pointerleave", function () {
        bar.removeAttribute("opacity");
        wash.setAttribute("fill", "transparent");
        tipHide();
      });
      g.addEventListener("focus", function () {
        var box = root.getBoundingClientRect();
        showTip(box.left + xv(r.value) * (box.width / W), box.top + (yTop + rowH / 2) * (box.height / H));
      });
      g.addEventListener("blur", tipHide);
      root.appendChild(g);
    });
    host.appendChild(root);
  }

  function stockRows(valueOf) {
    var rows = [];
    today.portfolios.forEach(function (p, pi) {
      (p.holdings || []).forEach(function (h) {
        var chg = h.prevRet != null ? h.ret - h.prevRet : null;
        rows.push({
          label: h.name, pf: pi, value: valueOf(h, chg), hasPrev: chg != null,
          tipRows: [
            ["누적 수익률", fmtPct(h.ret), h.ret >= 0 ? "var(--up)" : "var(--down)"],
            ["전일 대비", chg == null ? "–" : fmtPct(chg, 2, "%p"), chg >= 0 ? "var(--up)" : "var(--down)"],
            ["평가손익", fmtCompact(h.pnl) + "원", h.pnl >= 0 ? "var(--up)" : "var(--down)"],
            ["평가금액", fmtCompact(h.value) + "원", "var(--axis)"]
          ]
        });
      });
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    return rows;
  }
  function renderRet() {
    renderBars("retChart", stockRows(function (h) { return h.ret; }), {
      fmt: function (v) { return fmtPct(v, 1); }, tickUnit: ""
    });
  }
  function renderChg() {
    // 전일 기록이 없는 종목(당일 신규 매수)은 0.00%p 로 오해되지 않도록 제외한다
    var rows = stockRows(function (h, chg) { return chg == null ? 0 : chg; })
      .filter(function (r) { return r.hasPrev; });
    var host = document.getElementById("chgChart");
    if (!rows.length) {
      host.textContent = "";
      var msg = el("p", null, "전일 기록이 쌓이면 여기에 종목별 등락이 표시됩니다.");
      msg.style.cssText = "color:var(--muted);font-size:12.5px;padding:28px 4px;";
      host.appendChild(msg);
      return;
    }
    renderBars("chgChart", rows, {
      fmt: function (v) { return fmtPct(v, 2, "%p"); }, tickUnit: ""
    });
    var skipped = stockRows(function () { return 0; }).filter(function (r) { return !r.hasPrev; });
    if (skipped.length) {
      var note = el("p", null, "신규 편입 제외: " + skipped.map(function (r) { return r.label; }).join(", "));
      note.style.cssText = "color:var(--muted);font-size:11.5px;margin-top:6px;";
      host.appendChild(note);
    }
  }

  // 포트폴리오 범례 (두 바 차트 공용)
  document.querySelectorAll(".pfLegend").forEach(function (lg) {
    lg.textContent = "";
    today.portfolios.forEach(function (p, i) {
      var it = el("span", "item");
      var dot = el("span", "dot");
      dot.style.background = PF_COLORS[i % PF_COLORS.length];
      it.appendChild(dot);
      it.appendChild(document.createTextNode(p.name));
      lg.appendChild(it);
    });
  });

  // ── 포트폴리오 구성 카드 ───────────────
  (function () {
    var wrap = document.getElementById("compRowWrap");
    wrap.textContent = "";
    today.portfolios.forEach(function (p, pi) {
      var card = el("section", "card");
      var head = el("div", "cardHead");
      var hl = el("div");
      hl.appendChild(el("h2", null, p.name + " 구성"));
      var sub = el("p", "sub");
      sub.appendChild(document.createTextNode("평가금액 " + fmtCompact(p.value) + "원 · 평가손익 "));
      sub.appendChild(el("span", pnClass(p.pnl), fmtCompact(p.pnl) + "원"));
      if (p.realized) {
        sub.appendChild(document.createTextNode(" · 실현 "));
        sub.appendChild(el("span", pnClass(p.realized), fmtCompact(p.realized) + "원"));
      }
      var pCum = MULTI ? p.cumRet : cumRetOf(today);
      sub.appendChild(document.createTextNode(" · 누적 "));
      sub.appendChild(el("span", pnClass(pCum), fmtPct(pCum)));
      hl.appendChild(sub);
      head.appendChild(hl);
      card.appendChild(head);

      var items = (p.holdings || []).map(function (h) {
        return { name: h.name, value: h.value, isCash: false };
      });
      if (p.cash != null) items.push({ name: "현금", value: p.cash, isCash: true });
      var maxV = Math.max.apply(null, items.map(function (it) { return it.value; }));

      items.forEach(function (it) {
        var row = el("div", "compRow");
        row.appendChild(el("div", "name", it.name));
        var track = el("div", "track");
        var bar = el("div", "bar");
        bar.style.width = Math.max(0.5, it.value / maxV * 100) + "%";
        bar.style.background = it.isCash ? "var(--axis)" : PF_COLORS[pi % PF_COLORS.length];
        track.appendChild(bar);
        row.appendChild(track);
        var num = el("div", "num");
        num.appendChild(document.createTextNode(fmtCompact(it.value)));
        num.appendChild(el("span", "share", " · " + (it.value / p.value * 100).toFixed(1) + "%"));
        row.appendChild(num);
        row.addEventListener("pointermove", function (ev) {
          tipShow(ev.clientX, ev.clientY, function (tp) {
            tp.appendChild(el("div", "tipTitle", it.name + " · " + p.name));
            tipRow(tp, it.isCash ? "var(--axis)" : PF_COLORS[pi % PF_COLORS.length], fmtWon(it.value), "평가금액");
            tipRow(tp, "var(--axis)", (it.value / p.value * 100).toFixed(2) + "%", "비중");
          });
        });
        row.addEventListener("pointerleave", tipHide);
        card.appendChild(row);
      });
      wrap.appendChild(card);
    });
  })();

  // ── 보유 상세 테이블 ───────────────────
  (function () {
    var wrap = document.getElementById("tables");
    wrap.textContent = "";
    today.portfolios.forEach(function (p, pi) {
      var card = el("section", "card tableCard");
      var head = el("div", "cardHead");
      var hl = el("div");
      var h2 = el("h2");
      var dot = el("span");
      dot.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:" + PF_COLORS[pi % PF_COLORS.length];
      h2.appendChild(dot);
      h2.appendChild(document.createTextNode(p.name + " 보유 상세"));
      hl.appendChild(h2);
      head.appendChild(hl);
      card.appendChild(head);

      var tb = el("table");
      var thead = el("thead"), trh = el("tr");
      ["종목명", "잔고", "평균단가", "현재가", "평가금액", "평가손익", "수익률", "전일 대비"].forEach(function (h) {
        trh.appendChild(el("th", null, h));
      });
      thead.appendChild(trh);
      tb.appendChild(thead);

      var tbody = el("tbody");
      (p.holdings || []).forEach(function (h) {
        var chg = h.prevRet != null ? h.ret - h.prevRet : null;
        var tr = el("tr");
        tr.appendChild(el("td", null, h.name));
        tr.appendChild(el("td", null, comma(h.qty)));
        tr.appendChild(el("td", null, comma(h.avg)));
        tr.appendChild(el("td", null, comma(h.price)));
        tr.appendChild(el("td", null, comma(h.value)));
        tr.appendChild(el("td", pnClass(h.pnl), comma(h.pnl)));
        tr.appendChild(el("td", pnClass(h.ret), fmtPct(h.ret)));
        tr.appendChild(el("td", chg == null ? "" : pnClass(chg), chg == null ? "–" : fmtPct(chg, 2, "%p")));
        tbody.appendChild(tr);
      });
      if (p.cash != null) {
        var trc = el("tr");
        trc.appendChild(el("td", null, "현금"));
        for (var i = 0; i < 3; i++) trc.appendChild(el("td"));
        trc.appendChild(el("td", null, comma(p.cash)));
        for (var j = 0; j < 3; j++) trc.appendChild(el("td"));
        tbody.appendChild(trc);
      }
      tb.appendChild(tbody);

      var tfoot = el("tfoot"), trf = el("tr");
      trf.appendChild(el("td", null, "합계"));
      for (var m = 0; m < 3; m++) trf.appendChild(el("td"));
      trf.appendChild(el("td", null, comma(p.value)));
      trf.appendChild(el("td", pnClass(p.pnl), comma(p.pnl)));
      var pCum = MULTI ? p.cumRet : cumRetOf(today);
      trf.appendChild(el("td", pnClass(pCum), fmtPct(pCum)));
      var pPrev = null;
      if (prev) {
        if (!MULTI) pPrev = cumRetOf(prev);
        else {
          var mth = (prev.portfolios || []).filter(function (q) { return q.name === p.name; })[0];
          if (mth) pPrev = mth.cumRet;
        }
      }
      var pChg = pPrev != null ? pCum - pPrev : null;
      trf.appendChild(el("td", pChg == null ? "" : pnClass(pChg), pChg == null ? "–" : fmtPct(pChg, 2, "%p")));
      tfoot.appendChild(trf);
      tb.appendChild(tfoot);

      card.appendChild(tb);
      wrap.appendChild(card);
    });
  })();

  // ── 렌더 + 리사이즈 ────────────────────
  function renderAll() { renderTrend(); renderRet(); renderChg(); }
  window.__propRerender = renderAll;   // 이미지 내보내기에서 폭을 바꾼 뒤 다시 그릴 때 쓴다
  window.__propData = D;
  renderAll();
  if (!window.__propResizeBound) {
    window.__propResizeBound = true;
    var rT;
    window.addEventListener("resize", function () {
      clearTimeout(rT);
      rT = setTimeout(renderAll, 150);
    });
  }
};

/* ── 보고서 PNG 내보내기 ───────────────────────────────────────
   외부 라이브러리 없이 SVG <foreignObject> 에 현재 DOM 을 담아 canvas 로 굽는다.
   내보내기 전에 폭을 1180px 로 고정하고 차트를 다시 그려, 창 크기와 무관하게
   항상 같은 모양의 보고서 이미지가 나오게 한다. */
window.exportDashboardPNG = function (onDone) {
  "use strict";
  var WIDTH = 1180, SCALE = 2;

  function fail(e) {
    if (onDone) onDone(e || new Error("이미지를 만들지 못했습니다."));
  }

  // 문서에 적용된 CSS 를 모두 모은다 (link 로 불러온 dashboard.css 포함)
  function collectCSS() {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) out.push(rules[j].cssText);
    }
    return out.join("\n");
  }

  var wrap = document.querySelector(".wrap");
  if (!wrap) return fail(new Error(".wrap 을 찾을 수 없습니다."));

  var css = collectCSS();
  if (!css) return fail(new Error("스타일을 읽지 못했습니다 (file:// 로 열면 제한될 수 있습니다)."));

  // :root 에 걸린 CSS 변수는 foreignObject 안에서 매칭되지 않으므로
  // 현재 값으로 해석해 래퍼에 인라인으로 심는다.
  var names = {};
  css.replace(/(--[\w-]+)\s*:/g, function (m, n) { names[n] = 1; return m; });
  var rootStyle = getComputedStyle(document.documentElement);
  var vars = Object.keys(names).map(function (n) {
    return n + ":" + rootStyle.getPropertyValue(n).trim();
  }).filter(function (s) { return s.indexOf(":") < s.length - 1; }).join(";");

  var bodyStyle = getComputedStyle(document.body);
  var pageBg = bodyStyle.backgroundColor || "#ffffff";

  // 폭 고정 후 차트 재렌더
  var prevWidth = wrap.style.width, prevMax = wrap.style.maxWidth;
  wrap.style.width = WIDTH + "px";
  wrap.style.maxWidth = "none";
  if (typeof window.__propRerender === "function") window.__propRerender();

  function restore() {
    wrap.style.width = prevWidth;
    wrap.style.maxWidth = prevMax;
    if (typeof window.__propRerender === "function") window.__propRerender();
  }

  // 레이아웃이 잡힌 뒤 캡처
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var w, h, svgStr;
      try {
        var clone = wrap.cloneNode(true);
        // 버튼·링크 등 조작 UI 는 보고서에 불필요하므로 제거
        Array.prototype.forEach.call(clone.querySelectorAll("[data-noexport]"), function (el) {
          el.parentNode.removeChild(el);
        });
        // 접힌 <details> 는 펼쳐서 일별 기록 표까지 담는다
        Array.prototype.forEach.call(clone.querySelectorAll("details"), function (d) {
          d.setAttribute("open", "open");
        });

        h = Math.ceil(wrap.getBoundingClientRect().height);
        w = WIDTH;

        var holder = document.createElement("div");
        holder.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        holder.setAttribute(
          "style",
          vars + ";width:" + w + "px;background:" + pageBg +
          ";color:" + bodyStyle.color +
          ";font-family:" + bodyStyle.fontFamily +
          ";font-size:" + bodyStyle.fontSize +
          ";line-height:" + bodyStyle.lineHeight + ";"
        );
        var styleEl = document.createElement("style");
        styleEl.textContent = css;
        holder.appendChild(styleEl);
        holder.appendChild(clone);

        var inner = new XMLSerializer().serializeToString(holder);
        svgStr =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
          '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
          inner + "</foreignObject></svg>";
      } catch (e) {
        restore();
        return fail(e);
      }

      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = w * SCALE;
          canvas.height = h * SCALE;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = pageBg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            restore();
            if (!blob) return fail(new Error("이미지 변환에 실패했습니다."));
            var D = window.__propData;
            var date = D && D.days && D.days.length ? D.days[D.days.length - 1].date : "";
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "Prop_대시보드_" + date + ".png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
            if (onDone) onDone(null);
          }, "image/png");
        } catch (e) {
          restore();
          fail(e);
        }
      };
      img.onerror = function () {
        restore();
        fail(new Error("이미지를 그리지 못했습니다."));
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    });
  });
};
