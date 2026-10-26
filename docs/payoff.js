/* Expiration payoff for one call and one put. Prices are premium points, not contract multipliers. */

let payoffHandlers = { onSide() {}, onClear() {} };

function payoffOverlap() {
  const el = document.getElementById("payoff");
  if (!el) return 0;
  return Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
}

function legValue(side, right, strike, premium, spot) {
  const intrinsic = right === "C" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  return side === "short" ? premium - intrinsic : intrinsic - premium;
}

function money(value, currency) {
  const sym = currency === "INR" ? "₹" : "$";
  const sign = value < 0 ? "-" : "";
  return `${sign}${sym}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function underlying(value) {
  const digits = Math.abs(value) >= 50 ? 0 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function precise(value) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function prettyDate(iso) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

function structureName(call, put, callSide, putSide) {
  if (call.strike === put.strike) return callSide === "short" && putSide === "short" ? "Short Straddle" : callSide === "long" && putSide === "long" ? "Long Straddle" : "Call and Put";
  const ordered = put.strike < call.strike;
  if (callSide === "short" && putSide === "short") return ordered ? "Short Strangle" : "Short Combination";
  if (callSide === "long" && putSide === "long") return ordered ? "Long Strangle" : "Long Combination";
  return "Call and Put";
}

function sampleSpots(lo, hi, extra) {
  const grid = [];
  for (let i = 0; i <= 200; i += 1) grid.push(lo + (hi - lo) * i / 200);
  extra.forEach((spot) => {
    if (spot >= lo && spot <= hi) grid.push(spot);
  });
  grid.sort((a, b) => a - b);
  return grid.filter((spot, index) => index === 0 || spot - grid[index - 1] > 1e-6);
}

function zeroCrossings(spots, values) {
  const zeros = [];
  for (let i = 1; i < spots.length; i += 1) {
    const y0 = values[i - 1];
    const y1 = values[i];
    if (y0 === 0) zeros.push(spots[i - 1]);
    else if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
      const t = y0 / (y0 - y1);
      zeros.push(spots[i - 1] + t * (spots[i] - spots[i - 1]));
    }
  }
  return zeros;
}

function buildCurve(call, put, callSide, putSide) {
  const combinedAt = (spot) => (
    legValue(callSide, "C", call.strike, call.ltp, spot)
    + legValue(putSide, "P", put.strike, put.ltp, spot)
  );
  const span = Math.max(Math.abs(call.strike - put.strike), (call.ltp + put.ltp) * 2.6, 1);
  let lo = Math.min(call.strike, put.strike) - span;
  let hi = Math.max(call.strike, put.strike) + span;
  if (lo < 0) lo = 0;
  const probe = sampleSpots(lo, hi, [call.strike, put.strike]);
  const breakEvens = zeroCrossings(probe, probe.map(combinedAt)).filter((spot, index, all) => (
    index === 0 || Math.abs(spot - all[index - 1]) > Math.max(span * 0.01, 0.01)
  ));
  if (breakEvens.length) {
    lo = Math.max(0, Math.min(lo, ...breakEvens) - span * 0.35);
    hi = Math.max(hi, ...breakEvens) + span * 0.35;
  }
  const spots = sampleSpots(lo, hi, [call.strike, put.strike, ...breakEvens]);
  const callLine = spots.map((spot) => legValue(callSide, "C", call.strike, call.ltp, spot));
  const putLine = spots.map((spot) => legValue(putSide, "P", put.strike, put.ltp, spot));
  const both = spots.map(combinedAt);
  const upside = callSide === "long" ? 1 : -1;
  return {
    lo,
    hi,
    spots,
    callLine,
    putLine,
    both,
    breakEvens,
    upside,
    peak: Math.max(...both),
    trough: Math.min(...both),
  };
}

function renderPayoffCard(state) {
  const root = document.getElementById("payoff");
  if (!root) return;
  const { call, put, callSide, putSide, currency, name } = state;
  if (!call && !put) {
    root.className = "payoff is-idle";
    root.innerHTML = "<p>Click a call and a put to chart the payoff. On the at-the-money row, click the call price or the put price.</p>";
    return;
  }
  if (!call || !put) {
    const have = call ? `Call ${underlying(call.strike)}` : `Put ${underlying(put.strike)}`;
    const need = call ? "a put" : "a call";
    root.className = "payoff is-idle";
    root.innerHTML = `<p>${have} is selected. Click ${need} to draw the payoff.</p><button type="button" id="clear-payoff">Clear</button>`;
    return;
  }
  if (call.ltp == null || put.ltp == null) {
    root.className = "payoff is-idle";
    root.innerHTML = "<p>One of the selected contracts has no last price, so the payoff cannot be drawn.</p><button type=\"button\" id=\"clear-payoff\">Clear</button>";
    return;
  }

  const curve = buildCurve(call, put, callSide, putSide);
  const title = `${name || "Options"} ${structureName(call, put, callSide, putSide)} Payoff at Expiration`;
  const dte = call.dte === put.dte ? `(${call.dte} DTE)` : `(call ${call.dte} DTE, put ${put.dte} DTE)`;
  const maxProfit = curve.upside > 0 ? "Unlimited" : money(curve.peak, currency);
  const maxLoss = curve.upside < 0 ? "Unlimited" : money(curve.trough, currency);
  const lower = curve.breakEvens[0];
  const upper = curve.breakEvens[curve.breakEvens.length - 1];
  const beText = curve.breakEvens.length === 0
    ? "No break-even in range"
    : curve.breakEvens.length === 1
      ? `Break-even ${precise(lower)}`
      : `Lower break-even ${precise(lower)} · Upper break-even ${precise(upper)}`;
  const expiryNote = call.expiry === put.expiry
    ? ""
    : "These contracts expire on different dates. The chart assumes the underlying is at the same price at each expiry.";

  root.className = "payoff is-open";
  root.innerHTML = `
    <div class="payoff-head">
      <div>
        <h2>${title} ${dte}</h2>
        <p class="payoff-legs">${sideLabel(putSide)} ${underlying(put.strike)} put · ${prettyDate(put.expiry)} · ${money(put.ltp, currency)}
          · ${sideLabel(callSide)} ${underlying(call.strike)} call · ${prettyDate(call.expiry)} · ${money(call.ltp, currency)}</p>
        <p class="payoff-stats">${curve.upside > 0 ? "Max profit" : "Max credit / max profit"} ${maxProfit} · Max loss ${maxLoss} · ${beText}</p>
        ${expiryNote ? `<p class="payoff-warn">${expiryNote}</p>` : ""}
      </div>
      <div class="payoff-controls">
        <label>Call
          <select name="call-side">
            <option value="short"${callSide === "short" ? " selected" : ""}>Short</option>
            <option value="long"${callSide === "long" ? " selected" : ""}>Long</option>
          </select>
        </label>
        <label>Put
          <select name="put-side">
            <option value="short"${putSide === "short" ? " selected" : ""}>Short</option>
            <option value="long"${putSide === "long" ? " selected" : ""}>Long</option>
          </select>
        </label>
        <button type="button" id="clear-payoff">Clear</button>
      </div>
    </div>
    <div class="payoff-legend">
      <span><i class="swatch combined"></i> Combined position</span>
      <span><i class="swatch put"></i> ${sideLabel(putSide)} ${underlying(put.strike)} put</span>
      <span><i class="swatch call"></i> ${sideLabel(callSide)} ${underlying(call.strike)} call</span>
    </div>
    ${chartSvg(curve, call, put, callSide, putSide, currency)}
  `;
}

function sideLabel(side) {
  return side === "short" ? "Short" : "Long";
}

function chartSvg(curve, call, put, callSide, putSide, currency) {
  const width = 920;
  const height = 340;
  const plot = { x: 78, y: 28, w: 820, h: 230 };
  const magnitude = Math.max(Math.abs(curve.peak), 1);
  const yMax = Math.max(curve.peak, 0) + magnitude * 0.32;
  const yMin = -magnitude * 0.72;
  const xOf = (spot) => plot.x + (spot - curve.lo) / (curve.hi - curve.lo) * plot.w;
  const yOf = (value) => plot.y + (yMax - value) / (yMax - yMin) * plot.h;
  const path = (values) => values.map((value, i) => `${i ? "L" : "M"}${xOf(curve.spots[i]).toFixed(1)},${yOf(value).toFixed(1)}`).join(" ");
  const zeroY = yOf(0);
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yMax - yMin) * i / ticks);
  const strikeMarks = [
    { spot: put.strike, label: `${underlying(put.strike)} Strike (Put)` },
    { spot: call.strike, label: `${underlying(call.strike)} Strike (Call)` },
  ];
  const beLabels = curve.breakEvens.map((spot, index) => ({
    spot,
    label: curve.breakEvens.length > 1 && index === 0
      ? `Lower break-even ${precise(spot)}`
      : curve.breakEvens.length > 1
        ? `Upper break-even ${precise(spot)}`
        : `Break-even ${precise(spot)}`,
  }));
  const profitTop = Math.min(zeroY, plot.y);
  const profitHeight = Math.max(0, zeroY - plot.y);
  const lossTop = Math.max(zeroY, plot.y);
  const lossHeight = Math.max(0, plot.y + plot.h - lossTop);
  const midSpot = curve.breakEvens.length > 1
    ? (curve.breakEvens[0] + curve.breakEvens[curve.breakEvens.length - 1]) / 2
    : (Math.min(call.strike, put.strike) + Math.max(call.strike, put.strike)) / 2;
  const peakY = yOf(curve.peak);
  const plateauWidth = Math.abs(xOf(call.strike) - xOf(put.strike));
  const zoneLabel = plateauWidth > 180 && zeroY - peakY > 36
    ? `<text class="zone" x="${xOf(midSpot).toFixed(1)}" y="${(peakY + zeroY) / 2}" text-anchor="middle">PROFIT ZONE</text>`
    : "";
  const lossLabel = lossHeight > 48
    ? `<text class="zone loss" x="${xOf(midSpot).toFixed(1)}" y="${(zeroY + plot.y + plot.h) / 2}" text-anchor="middle">LOSS ZONE</text>`
    : "";
  const maxTag = curve.upside > 0
    ? ""
    : `<text class="tag" x="${xOf(midSpot).toFixed(1)}" y="${Math.max(plot.y + 14, peakY - 10)}" text-anchor="middle">Max profit ${money(curve.peak, currency)}</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Payoff chart. ${beLabels.map((item) => item.label).join(". ")}">
    <rect class="zone-profit" x="${plot.x}" y="${profitTop}" width="${plot.w}" height="${profitHeight}"></rect>
    <rect class="zone-loss" x="${plot.x}" y="${lossTop}" width="${plot.w}" height="${lossHeight}"></rect>
    ${zoneLabel}${lossLabel}${maxTag}
    <line class="zero" x1="${plot.x}" y1="${zeroY}" x2="${plot.x + plot.w}" y2="${zeroY}"></line>
    ${yTicks.map((tick) => `<g>
      <line class="grid" x1="${plot.x}" y1="${yOf(tick)}" x2="${plot.x + plot.w}" y2="${yOf(tick)}"></line>
      <text class="tick" x="${plot.x - 8}" y="${yOf(tick) + 4}" text-anchor="end">${money(tick, currency)}</text>
    </g>`).join("")}
    ${strikeMarks.map((mark) => `<line class="strike" x1="${xOf(mark.spot)}" y1="${plot.y}" x2="${xOf(mark.spot)}" y2="${plot.y + plot.h}"></line>`).join("")}
    <g clip-path="url(#payoff-clip)">
      <path class="leg put" d="${path(curve.putLine)}"></path>
      <path class="leg call" d="${path(curve.callLine)}"></path>
      <path class="leg combined" d="${path(curve.both)}"></path>
    </g>
    ${beLabels.map((item, index) => {
      const placeLeft = curve.breakEvens.length > 1 && index === 0;
      return `<g>
      <circle class="be" cx="${xOf(item.spot)}" cy="${zeroY}" r="4"></circle>
      <text class="be-label" x="${xOf(item.spot) + (placeLeft ? -8 : 8)}" y="${zeroY - 12}" text-anchor="${placeLeft ? "end" : "start"}">${item.label}</text>
    </g>`;
    }).join("")}
    ${strikeMarks.map((mark) => `<text class="strike-label" x="${xOf(mark.spot)}" y="${plot.y + plot.h + 22}" text-anchor="middle">${mark.label}</text>`).join("")}
    <text class="axis-name" x="${plot.x + plot.w / 2}" y="${height - 8}" text-anchor="middle">Underlying price</text>
    <text class="axis-name" transform="translate(16 ${plot.y + plot.h / 2}) rotate(-90)" text-anchor="middle">Profit / loss</text>
    <defs><clipPath id="payoff-clip"><rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}"></rect></clipPath></defs>
  </svg>`;
}

document.getElementById("payoff").addEventListener("change", (event) => {
  if (event.target.name === "call-side" || event.target.name === "put-side") {
    payoffHandlers.onSide(event.target.name, event.target.value);
  }
});

document.getElementById("payoff").addEventListener("click", (event) => {
  if (event.target.id === "clear-payoff") payoffHandlers.onClear();
});
