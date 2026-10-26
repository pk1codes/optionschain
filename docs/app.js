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
  return `<tr class="${kind}">
    <td>${fmtStrike(row.strike)}</td>
    <td>${fmtDate(row.expiry)}</td>
    <td>${row.dte}d</td>
    ${sideCells(callActive ? row.ltp : null, callActive ? row.oi : null, callActive)}
    ${sideCells(putActive ? row.ltp : null, putActive ? row.oi : null, putActive)}
  </tr>`;
}

function atmRow(atm) {
  return `<tr class="atm" id="atm-row">
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
  const rect = row.getBoundingClientRect();
  const room = window.innerHeight - header;
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
  delayEl.textContent = data.delayNote;
  const bits = [];
  if (data.stale) bits.push("Showing the last good chain.");
  if (data.error) bits.push(data.error);
  bannerEl.hidden = bits.length === 0;
  bannerEl.textContent = bits.join(" ");
  const truncated = data.callsTruncated || data.putsTruncated;
  noteEl.hidden = !truncated;
  noteEl.textContent = truncated ? "Further expiries have no contract at this strike step." : "";
  syncHeaderHeight();
}

async function load({ center }) {
  const my = ++requestId;
  const current = symbol;
  delayEl.textContent = `Loading ${current}…`;
  const scrollY = window.scrollY;
  try {
    const response = await fetch(`data/${current}.json`, { cache: "no-store" });
    if (my !== requestId) return;
    if (!response.ok) throw new Error("Could not load the chain");
    const payload = await response.json();
    render(payload);
    if (center) centerAtm();
    else window.scrollTo(0, scrollY);
  } catch (error) {
    if (my !== requestId) return;
    bannerEl.hidden = false;
    bannerEl.textContent = error.message || "Could not load the chain";
    delayEl.textContent = "Load failed";
  }
}

function armTimer() {
  clearInterval(timer);
  if (!autoEl.checked) return;
  timer = setInterval(() => load({ center: false }), 30000);
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

armTimer();
load({ center: true });
