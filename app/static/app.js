const rowsEl = document.getElementById("rows");
const delayEl = document.getElementById("delay");
const spotEl = document.getElementById("spot");
const bannerEl = document.getElementById("banner");
const noteEl = document.getElementById("note");
const autoEl = document.getElementById("auto");

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let symbol = "NIFTY";
let timer = 0;
let requestId = 0;
let selectedCall = null;
let selectedPut = null;
let callSide = "short";
let putSide = "short";
let quoteName = "";
let quoteCurrency = "USD";
let freshness = { note: "", updated: "", nextAt: 0, live: false };

function fmtDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

function fmtStrike(value) {
  if (value == null) return "—";
  const digits = Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPx(value) {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtOi(value) {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

function cell(text, muted) {
  return `<td class="${muted ? "muted" : ""}">${text}</td>`;
}

function sideCells(ltp, oi, active) {
  return cell(fmtPx(ltp), !active || ltp == null) + cell(fmtOi(oi), !active || oi == null);
}

function dataRow(kind, row) {
  const callActive = kind !== "put";
  const putActive = kind !== "call";
  const ltp = row.ltp == null ? "" : row.ltp;
  const oi = row.oi == null ? "" : row.oi;
  return `<tr class="${kind}" data-kind="${kind}" data-strike="${row.strike}" data-expiry="${row.expiry}" data-dte="${row.dte}" data-ltp="${ltp}" data-oi="${oi}">
    <td>${fmtStrike(row.strike)}</td>
    <td>${fmtDate(row.expiry)}</td>
    <td>${row.dte}d</td>
    ${sideCells(callActive ? row.ltp : null, callActive ? row.oi : null, callActive)}
    ${sideCells(putActive ? row.ltp : null, putActive ? row.oi : null, putActive)}
  </tr>`;
}

function atmRow(atm) {
  const callLtp = atm.call.ltp == null ? "" : atm.call.ltp;
  const putLtp = atm.put.ltp == null ? "" : atm.put.ltp;
  const callOi = atm.call.oi == null ? "" : atm.call.oi;
  const putOi = atm.put.oi == null ? "" : atm.put.oi;
  return `<tr class="atm" id="atm-row" data-kind="atm" data-strike="${atm.strike}" data-expiry="${atm.expiry}" data-dte="${atm.dte}" data-call-ltp="${callLtp}" data-put-ltp="${putLtp}" data-call-oi="${callOi}" data-put-oi="${putOi}">
    <td>${fmtStrike(atm.strike)}<span class="strike-tag">ATM</span></td>
    <td>${fmtDate(atm.expiry)}</td>
    <td>${atm.dte}d</td>
    ${sideCells(atm.call.ltp, atm.call.oi, true)}
    ${sideCells(atm.put.ltp, atm.put.oi, true)}
  </tr>`;
}

function syncHeaderHeight() {
  document.documentElement.style.setProperty("--header-h", `${document.querySelector("header").offsetHeight}px`);
}

function centerAtm() {
  const row = document.getElementById("atm-row");
  if (!row) return;
  const header = document.querySelector("header").offsetHeight;
  const sheet = typeof payoffOverlap === "function" ? payoffOverlap() : 0;
  const rect = row.getBoundingClientRect();
  const room = window.innerHeight - header - sheet;
  const top = window.scrollY + rect.top - header - room / 2 + rect.height / 2;
  window.scrollTo(0, Math.max(0, top));
}

function render(data) {
  const calls = data.calls.slice().reverse();
  rowsEl.innerHTML = calls.map((row) => dataRow("call", row)).join("")
    + atmRow(data.atm)
    + data.puts.map((row) => dataRow("put", row)).join("");
  const money = data.currency === "INR" ? "₹" : "$";
  spotEl.textContent = `${data.name}  ${money}${fmtPx(data.spot)} spot  ·  ${data.asOf}  ·  strike step ${fmtStrike(data.strikeStep)}  ·  ${data.expiryRule}`;
  setFreshness(data);
  const bits = [];
  if (data.stale) bits.push("Showing the last good chain.");
  if (data.error) bits.push(data.error);
  bannerEl.hidden = bits.length === 0;
  bannerEl.textContent = bits.join(" ");
  const truncated = data.callsTruncated || data.putsTruncated;
  noteEl.hidden = !truncated;
  noteEl.textContent = truncated ? "Further expiries have no contract at this strike step." : "";
  quoteName = data.name || data.symbol || "";
  quoteCurrency = data.currency || "USD";
  markSelection();
  showPayoff();
  syncHeaderHeight();
}

function sameLeg(a, b) {
  return a && b && a.expiry === b.expiry && a.strike === b.strike;
}

function legFromRow(tr, right) {
  const strike = Number(tr.dataset.strike);
  const expiry = tr.dataset.expiry;
  const dte = Number(tr.dataset.dte);
  const rawLtp = tr.dataset.kind === "atm" ? (right === "C" ? tr.dataset.callLtp : tr.dataset.putLtp) : tr.dataset.ltp;
  const rawOi = tr.dataset.kind === "atm" ? (right === "C" ? tr.dataset.callOi : tr.dataset.putOi) : tr.dataset.oi;
  return {
    strike,
    expiry,
    dte,
    ltp: rawLtp === "" ? null : Number(rawLtp),
    oi: rawOi === "" ? null : Number(rawOi),
  };
}

function markSelection() {
  document.querySelectorAll("#rows td.is-on").forEach((cell) => cell.classList.remove("is-on"));
  document.querySelectorAll("#rows tr").forEach((tr) => {
    const kind = tr.dataset.kind;
    if ((kind === "call" || kind === "atm") && sameLeg(selectedCall, legFromRow(tr, "C"))) {
      tr.children[3].classList.add("is-on");
      tr.children[4].classList.add("is-on");
    }
    if ((kind === "put" || kind === "atm") && sameLeg(selectedPut, legFromRow(tr, "P"))) {
      tr.children[5].classList.add("is-on");
      tr.children[6].classList.add("is-on");
    }
  });
}

function showPayoff() {
  renderPayoffCard({
    call: selectedCall,
    put: selectedPut,
    callSide,
    putSide,
    currency: quoteCurrency,
    name: quoteName,
  });
}

function fmtUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function paintFreshness() {
  if (!freshness.note && !freshness.updated) return;
  if (!freshness.live) {
    delayEl.textContent = freshness.updated
      ? `${freshness.note} · last updated ${freshness.updated}`
      : freshness.note;
    return;
  }
  const remain = Math.max(0, freshness.nextAt - Date.now());
  const totalSeconds = Math.ceil(remain / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = String(totalSeconds % 60).padStart(2, "0");
  delayEl.textContent = `${freshness.note} · last updated ${freshness.updated} · next update in ${mins}m ${secs}s`;
}

function setFreshness(data) {
  freshness.note = data.delayNote || "";
  if (data.fetchedAt && data.refreshSeconds) {
    freshness.live = true;
    freshness.updated = fmtUpdated(data.fetchedAt);
    freshness.nextAt = Date.parse(data.fetchedAt) + data.refreshSeconds * 1000;
  } else {
    freshness.live = false;
    freshness.updated = data.asOf || "";
    freshness.nextAt = 0;
  }
  paintFreshness();
  scheduleRefresh();
}

function scheduleRefresh() {
  clearTimeout(timer);
  if (!autoEl.checked || !freshness.live) return;
  const wait = freshness.nextAt - Date.now();
  timer = setTimeout(() => load({ center: false, quiet: true }), Math.max(wait + 1000, 15000));
}

async function load({ center, quiet }) {
  const my = ++requestId;
  const current = symbol;
  if (!quiet) delayEl.textContent = `Loading ${current}…`;
  const scrollY = window.scrollY;
  try {
    const response = await fetch(`/api/ladder?symbol=${current}`);
    const payload = response.ok ? await response.json() : null;
    if (my !== requestId) return;
    if (!response.ok) {
      const detail = payload && payload.detail ? payload.detail : "Could not load the chain";
      throw new Error(detail);
    }
    render(payload);
    if (center) centerAtm();
    else window.scrollTo(0, scrollY);
  } catch (error) {
    if (my !== requestId) return;
    bannerEl.hidden = false;
    bannerEl.textContent = error.message || "Could not load the chain";
    if (!quiet) delayEl.textContent = "Load failed";
    scheduleRefresh();
  }
}

function armTimer() {
  if (!autoEl.checked) {
    clearTimeout(timer);
    freshness.live = false;
    paintFreshness();
    return;
  }
  load({ center: false, quiet: true });
}

document.querySelectorAll(".symbols button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.symbol === symbol) {
      centerAtm();
      return;
    }
    symbol = button.dataset.symbol;
    document.querySelectorAll(".symbols button").forEach((item) => {
      item.setAttribute("aria-selected", item === button ? "true" : "false");
    });
    load({ center: true });
  });
});

document.getElementById("refresh").addEventListener("click", () => load({ center: false }));
document.getElementById("center").addEventListener("click", centerAtm);
autoEl.addEventListener("change", armTimer);
window.addEventListener("resize", () => {
  syncHeaderHeight();
  centerAtm();
});

rowsEl.addEventListener("click", (event) => {
  const tr = event.target.closest("tr");
  if (!tr || !rowsEl.contains(tr)) return;
  const cell = event.target.closest("td");
  const index = cell ? [...tr.children].indexOf(cell) : 0;
  const kind = tr.dataset.kind;
  const right = kind === "call" ? "C" : kind === "put" ? "P" : index >= 5 ? "P" : "C";
  const leg = legFromRow(tr, right);
  if (right === "C") selectedCall = sameLeg(selectedCall, leg) ? null : leg;
  else selectedPut = sameLeg(selectedPut, leg) ? null : leg;
  markSelection();
  showPayoff();
});

payoffHandlers.onSide = (name, value) => {
  if (name === "call-side") callSide = value;
  if (name === "put-side") putSide = value;
  showPayoff();
};

payoffHandlers.onClear = () => {
  selectedCall = null;
  selectedPut = null;
  markSelection();
  showPayoff();
};

setInterval(paintFreshness, 1000);
load({ center: true });
