// Known admin. The page holds no secret: the project URL and its publishable key are public by design. Sign-in is a
// code by email (Supabase Auth, sign-ups off); every read and write goes through the `admin` Edge Function, which
// lets in only Filippo's account. Text from corrections (names, brands) is always set as text, never as HTML.
//
// Corrections: on a wide screen an inbox (queues, list, detail, keyboard); on a phone one at a time, swiped.
// Costs: a sentence first, then the worst cases, the days and where the money goes.
"use strict";

const SUPABASE = "https://lpajxlwmsgolxajndgdv.supabase.co";
const KEY = "sb_publishable_2l5PPuELTGwnNY8f4-EuPQ_HRIdjBCc";
const API = `${SUPABASE}/functions/v1/admin`;
const SESSION_KEY = "known-admin-session";
const EMAIL_KEY = "known-admin-email";
const NAMES_KEY = "known-admin-names";
// As in the `ai` function (FREE_DAILY_LIMIT) and the Pro price decided for launch.
const FREE_DAILY_LIMIT = 40;
const PRO_EUR_CENTS = 999;

const $ = (id) => document.getElementById(id);
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const wide = matchMedia("(min-width: 900px)");

/** Builds an element: el("p", {class: "x"}, "text", child…). Strings become text nodes. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** Replaces a node's children; lists are flattened, empty values left out. */
function put(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

// ---------- Session ----------

let session = store.get(SESSION_KEY);

async function auth(path, body, token) {
  const res = await fetch(`${SUPABASE}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `Error ${res.status}`);
  return data;
}

function keep(data) {
  session = { access: data.access_token, refresh: data.refresh_token, expires: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600) };
  store.set(SESSION_KEY, session);
}

let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires - 60 > Date.now() / 1000) return session.access;
  refreshing ??= auth("token?grant_type=refresh_token", { refresh_token: session.refresh })
    .then(keep)
    .catch(() => { session = null; store.remove(SESSION_KEY); })
    .finally(() => { refreshing = null; });
  await refreshing;
  return session?.access ?? null;
}

class SignedOut extends Error {}

async function api(path, options = {}) {
  const token = await accessToken();
  if (!token) { show(); throw new SignedOut(); }
  const res = await fetch(`${API}/${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}) },
  });
  if (res.status === 401) { signOut(); throw new SignedOut(); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error("This account is not the admin.");
  if (!res.ok) throw new Error(`The service answered ${res.status}${data.error ? ` (${data.error})` : ""}.`);
  return data;
}

function signOut() {
  const token = session?.access;
  session = null;
  store.remove(SESSION_KEY);
  if (token) auth("logout", {}, token).catch(() => {});
  show();
}

// ---------- Sign-in ----------

function setStatus(text, error = false) {
  $("signin-status").textContent = text;
  $("signin-status").classList.toggle("error", error);
}

$("email").value = store.get(EMAIL_KEY) ?? "";

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return setStatus("Type a valid email.", true);
  const button = $("email-form").querySelector("button");
  button.disabled = true;
  setStatus("Sending…");
  try {
    // create_user: false — sign-ups are off; an unknown address gets nothing.
    await auth(`otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email, create_user: false });
    store.set(EMAIL_KEY, email);
    $("email-form").hidden = true;
    $("code-form").hidden = false;
    $("code-sent").textContent = `A code is on its way to ${email}.`;
    setStatus("");
    $("code").focus();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
  }
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("code").value.replace(/\D/g, "");
  if (token.length < 6) return setStatus("Type the code from the email.", true);
  const button = $("code-form").querySelector("button[type=submit]");
  button.disabled = true;
  setStatus("Signing in…");
  try {
    keep(await auth("verify", { type: "email", email: store.get(EMAIL_KEY) ?? $("email").value.trim(), token }));
    $("code").value = "";
    setStatus("");
    show();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
  }
});

$("other-email").addEventListener("click", () => {
  $("code-form").hidden = true;
  $("email-form").hidden = false;
  setStatus("");
  $("email").focus();
});

$("signout").addEventListener("click", signOut);

// ---------- Layout ----------

let tab = "corrections";
function show() {
  const signedIn = Boolean(session);
  $("signin").hidden = signedIn;
  $("tabs").hidden = !signedIn;
  $("signout").hidden = !signedIn;
  $("corrections").hidden = !signedIn || tab !== "corrections";
  $("costs").hidden = !signedIn || tab !== "costs";
  if (signedIn && !loaded) loadCorrections();
}

const tabs = [$("tab-corrections"), $("tab-costs")];
function selectTab(button) {
  tab = button.id === "tab-costs" ? "costs" : "corrections";
  for (const t of tabs) {
    const on = t === button;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
  }
  show();
  if (tab === "costs" && !costsLoaded) loadCosts();
}
for (const t of tabs) {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(tabs.indexOf(t) + 1) % tabs.length];
    next.focus();
    selectTab(next);
  });
}

function failed(container, err, retry) {
  if (err instanceof SignedOut) return;
  put(container, el("div", { class: "empty" }, el("p", { class: "error" }, err.message || "Something went wrong."),
    el("button", { type: "button", class: "ghost small", onclick: retry }, "Try again")));
}

let toastTimer;
let lastUndo = null; // the U key undoes the last decision
function toast(text, undo) {
  const t = $("toast");
  clearTimeout(toastTimer);
  if (undo) lastUndo = undo;
  put(t, el("span", {}, text), undo ? el("button", { type: "button", onclick: () => { t.hidden = true; undo(); } }, "Undo") : null);
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---------- Corrections: data ----------

const KIND = { confirm: "Values match", label: "Label photo", manual: "Typed by hand" };
const STATE = {
  verified: "Verified", same_as_off: "Matches Open Food Facts", same_as_shops: "Matches the shops",
  to_recheck: "To check", single_source: "One source only",
};
const SOURCE = { open_food_facts: "Open Food Facts", catalog: "Known catalog", none: "Nothing" };
const NUTRIENTS = [["Calories", "kcal", "kcal"], ["Carbs", "carbs", "g"], ["Sugars", "sugars", "g"], ["Fibre", "fibre", "g"],
  ["Protein", "protein", "g"], ["Fat", "fat", "g"], ["Salt", "salt", "g"]];

function shown(x, unit) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (unit === "kcal" || Math.abs(n) >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

/** What a correction is: values changed, whether its calories add up, which queue it belongs to. */
function facts(r) {
  if (r._facts) return r._facts;
  const v = r.values ?? {}, b = r.before ?? {};
  const changed = r.kind === "confirm" ? [] :
    NUTRIENTS.map(([, k]) => k).filter((k) => v[k] != null && b[k] != null && Math.abs(Number(v[k]) - Number(b[k])) > 0.05);
  const fromMacros = 4 * (v.carbs ?? 0) + 4 * (v.protein ?? 0) + 9 * (v.fat ?? 0) + 2 * (v.fibre ?? 0);
  const kcal = Number(v.kcal ?? 0);
  const addsUp = kcal < 20 ? Math.abs(fromMacros - kcal) < 15 : Math.abs(fromMacros - kcal) / kcal <= 0.15;
  // The value most to blame when it doesn't: the one whose own calories differ most from the gap.
  let culprit = null;
  if (!addsUp) {
    const gap = fromMacros - kcal, per = { carbs: 4, protein: 4, fat: 9 };
    culprit = Object.keys(per).filter((k) => v[k]).sort((a, c) => Math.abs(gap - per[a] * v[a]) - Math.abs(gap - per[c] * v[c]))[0] ?? null;
  }
  const easy = r.kind === "confirm" && !r.portion && addsUp;
  return (r._facts = { changed, fromMacros: Math.round(fromMacros), addsUp, culprit, easy });
}

const QUEUES = [
  { id: "look", title: "Needs a look", test: (r) => !facts(r).easy, badge: "y" },
  { id: "bad", title: "Doesn't add up", test: (r) => !facts(r).addsUp, badge: "r" },
  { id: "easy", title: "Quick confirmations", test: (r) => facts(r).easy },
  { id: "new", title: "New to the catalog", test: (r) => !r.catalog_state },
  { id: "all", title: "All", test: () => true },
];

let pending = [];        // review = 'new' when loaded; r.decided once decided here
let decided = [];        // decided in the last 7 days, from the service
let loaded = false;
let queue = "look";
let selected = null;     // id
let query = "";
let mobQueue = null;     // phone: null = overview, else the queue being reviewed

// Names: the correction's own, else Open Food Facts (kept in this browser), else the barcode.
const names = store.get(NAMES_KEY) ?? {};
async function lookUpNames(gtins) {
  const missing = gtins.filter((g) => !(g in names)).slice(0, 60);
  await Promise.all(missing.map(async (gtin) => {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,brands`);
      const p = (await res.json()).product ?? {};
      names[gtin] = p.product_name ? [p.product_name, (p.brands ?? "").split(",")[0].trim() || null] : null;
    } catch { /* offline: try again next time */ }
  }));
  if (missing.length) store.set(NAMES_KEY, names);
}
const nameOf = (r) => r.name ? [r.name, r.brand] : names[r.gtin] ?? [`EAN ${r.gtin}`, null];

const open = () => pending.filter((r) => !r.decided);
const inQueue = (id) => id === "done" ? decidedRows() : open().filter(QUEUES.find((q) => q.id === id).test);
function decidedRows() {
  const local = pending.filter((r) => r.decided).map((r) => ({ ...r, review: r.decided }));
  return [...local, ...decided.filter((d) => !pending.some((p) => p.id === d.id))];
}
function visible() {
  const q = query.trim().toLowerCase();
  const rows = inQueue(queue);
  if (!q) return rows;
  return rows.filter((r) => [...nameOf(r), r.gtin].some((s) => s && String(s).toLowerCase().includes(q)));
}

async function loadCorrections() {
  loaded = true;
  if (!pending.length) put($("list"), el("p", { class: "empty" }, "Loading…"));
  try {
    const [{ rows }, done] = await Promise.all([api("corrections"), api("decided?days=7").catch(() => ({ rows: [] }))]);
    decided = done.rows ?? [];
    await lookUpNames([...new Set([...rows, ...decided].filter((r) => !r.name).map((r) => r.gtin))]);
    // Most reported first (devices on the same product), then the oldest.
    const devices = new Map();
    for (const r of rows) devices.set(r.gtin, (devices.get(r.gtin) ?? new Set()).add(r.reporter));
    pending = rows.map((r) => ({ ...r, devices: devices.get(r.gtin).size }))
      .sort((a, b) => b.devices - a.devices || String(a.received_on).localeCompare(String(b.received_on)) || a.id - b.id);
    if (!inQueue(queue).length) queue = inQueue("bad").length ? "bad" : "look";
    render();
  } catch (err) {
    loaded = false;
    failed($("list"), err, loadCorrections);
    failed($("mob"), err, loadCorrections);
  }
}

async function decide(rows, review, note = null) {
  if (!rows.length) return;
  const before = rows.map((r) => r.decided);
  rows.forEach((r) => { r.decided = review === "new" ? undefined : review; });
  render();
  try {
    await api("decide", { method: "POST", body: JSON.stringify({ ids: rows.map((r) => r.id), review, note }) });
    if (review !== "new") {
      const word = review === "accepted" ? "Approved" : "Rejected";
      toast(rows.length > 1 ? `${word} ${rows.length}` : `${word} ${nameOf(rows[0])[0]}`, () => decide(rows, "new"));
    }
  } catch (err) {
    rows.forEach((r, i) => { r.decided = before[i]; });
    render();
    if (!(err instanceof SignedOut)) toast(`Not saved: ${err.message}`);
  }
}

/** Undo a decision that came from the service (decided before this visit). */
async function reopen(row) {
  try {
    await api("decide", { method: "POST", body: JSON.stringify({ ids: [row.id], review: "new" }) });
    decided = decided.filter((d) => d.id !== row.id);
    pending.push({ ...row, review: "new", decided: undefined, devices: 1 });
    render();
    toast(`${nameOf(row)[0]} is back to review`);
  } catch (err) {
    if (!(err instanceof SignedOut)) toast(`Not saved: ${err.message}`);
  }
}

// ---------- Corrections: one correction ----------

function chipOf(r) {
  if (r.review && r.review !== "new") return el("span", { class: "chip done" }, r.review === "accepted" ? "Approved" : r.review === "rejected" ? "Rejected" : "Already fixed");
  const f = facts(r);
  if (!f.addsUp) return el("span", { class: "chip r" }, "Doesn't add up");
  if (r.portion) return el("span", { class: "chip y" }, "New portion");
  if (r.kind === "confirm") return el("span", { class: "chip ok" }, "Confirmed");
  return f.changed.length ? el("span", { class: "chip y" }, `${f.changed.length} changed`) : el("span", { class: "chip" }, "Same values");
}

function body(r) {
  const f = facts(r);
  const [name, brand] = nameOf(r);
  const unit = r.unit ?? "g", v = r.values ?? {}, b = r.before ?? {};
  const confirm = r.kind === "confirm";
  const lines = NUTRIENTS.filter(([, k]) => v[k] != null || b[k] != null).map(([title, k, u]) => {
    const was = shown(b[k], u), now = shown(v[k], u);
    const changed = f.changed.includes(k);
    const delta = changed ? Number(v[k]) - Number(b[k]) : null;
    return el("tr", { class: k === f.culprit ? "bad" : changed ? "ch" : "" },
      el("th", { scope: "row" }, title),
      confirm ? null : el("td", {}, was ?? "–"),
      el("td", {}, el("span", {}, now ?? "–")),
      confirm ? null : el("td", { class: "d" }, delta === null ? "" : `${delta > 0 ? "+" : ""}${shown(delta, u)}`));
  });
  const where = r.catalog_state ? `In catalog · ${STATE[r.catalog_state] ?? r.catalog_state}` : "Not in catalog";
  return [
    el("div", { class: "pt" }, chipOf(r), el("h2", {}, name),
      el("p", {}, [brand, name.startsWith("EAN ") ? null : `EAN ${r.gtin}`, r.devices > 1 ? `${r.devices} devices` : null, r.received_on].filter(Boolean).join(" · "), " · ",
        el("a", { href: `https://world.openfoodfacts.org/product/${encodeURIComponent(r.gtin)}`, target: "_blank", rel: "noopener noreferrer" }, "Open Food Facts ↗"))),
    f.addsUp ? null : el("p", { class: "warn" }, el("b", {}, "Calories don't add up. "),
      `Carbs, protein and fat give ${f.fromMacros} kcal, the values say ${shown(v.kcal, "kcal")}.`,
      f.culprit ? ` ${f.culprit[0].toUpperCase()}${f.culprit.slice(1)} ${shown(v[f.culprit], "g")} g looks wrong.` : ""),
    el("div", { class: "cols" },
      el("div", {},
        el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, `Per 100 ${unit}`), confirm ? el("th", {}, "Values") : [el("th", {}, "Before"), el("th", {}, "New"), el("th", {}, "Change")])),
          el("tbody", {}, lines)),
        r.portion ? el("p", { class: "portion" }, `One ${r.portion_unit ?? "serving"}: `,
          r.portion_before ? [el("s", {}, `${shown(r.portion_before, unit)} ${unit}`), " → "] : null,
          el("b", {}, `${shown(r.portion, unit)} ${unit}`)) : null),
      el("div", { class: "facts" },
        el("div", {}, el("span", {}, "How"), KIND[r.kind] ?? r.kind),
        el("div", {}, el("span", {}, "Before came from"), SOURCE[r.before_source] ?? "–"),
        el("div", {}, el("span", {}, "Catalog"), where),
        el("div", {}, el("span", {}, "Country"), r.country ?? "–"),
        el("div", {}, el("span", {}, "App"), r.app_version ?? "–"),
        r.review_note ? el("div", {}, el("span", {}, "Note"), r.review_note) : null)),
  ];
}

// ---------- Corrections: desktop inbox ----------

function render() {
  const n = open().length;
  $("tab-count").textContent = n ? String(n) : "";
  renderQueues();
  renderList();
  renderDetail();
  renderMobile();
}

function renderQueues() {
  const doneRows = decidedRows();
  const button = (id, title, count, badge) => el("button", {
    type: "button", class: "q", "aria-current": queue === id ? "true" : "false",
    onclick: () => { queue = id; selected = null; render(); },
  }, el("span", {}, title), el("span", { class: `badge ${count && badge ? badge : ""}` }, String(count)));
  put($("queues"), 
    ...QUEUES.map((q) => button(q.id, q.title, inQueue(q.id).length, q.badge)),
    el("h4", {}, "Decided"),
    button("done", "Last 7 days", doneRows.length),
    el("p", { class: "progress" }, `${doneRows.filter((r) => r.review === "accepted").length} approved, ${doneRows.filter((r) => r.review === "rejected").length} rejected this week`));
}

function renderList() {
  const rows = visible();
  if (selected === null || !rows.some((r) => r.id === selected)) selected = rows[0]?.id ?? null;
  if (!rows.length) {
    put($("list"), el("p", { class: "empty" }, query ? "Nothing matches." : queue === "done" ? "Nothing decided this week." : "Nothing here. Well done."));
    return;
  }
  put($("list"), ...rows.map((r) => {
    const [name, brand] = nameOf(r);
    return el("button", { type: "button", class: "it", "aria-current": r.id === selected ? "true" : "false", "data-id": r.id,
      onclick: () => { selected = r.id; renderList(); renderDetail(); } },
    el("b", {}, name), el("span", { class: "br" }, brand ?? (r.name || names[r.gtin] ? `EAN ${r.gtin}` : "No name yet")),
    el("span", { class: "m" }, chipOf(r), el("span", {}, String(r.received_on ?? "").slice(5))));
  }));
  $("list").querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
}

function renderDetail() {
  const r = visible().find((x) => x.id === selected);
  if (!r) { put($("detail"), ); return; }
  if (queue === "done") {
    put($("detail"), ...body(r), el("div", { class: "decided-note" },
      el("span", {}, `${r.review === "accepted" ? "Approved" : "Rejected"} on ${r.reviewed_on ?? "today"}.`),
      el("button", { type: "button", class: "ghost small", onclick: () => (r.decided ? decide([pending.find((p) => p.id === r.id)], "new") : reopen(r)) }, "Undo")));
    return;
  }
  const note = el("input", { type: "text", placeholder: "Note (optional)", "aria-label": "Note", maxlength: "500" });
  put($("detail"), ...body(r),
    el("div", { class: "act" },
      el("button", { type: "button", class: "approve", onclick: () => act("accepted", note.value) }, "Approve"),
      el("button", { type: "button", onclick: () => act("rejected", note.value) }, "Reject"),
      note,
      el("button", { type: "button", class: "ghost", onclick: () => move(1) }, "Skip")),
    queue === "easy" && inQueue("easy").length > 1
      ? el("div", { class: "act" }, el("button", { type: "button", class: "ghost small", onclick: approveAllEasy }, `Approve all ${inQueue("easy").length} quick confirmations`))
      : null,
    el("p", { class: "hint" }, ...[["A", "approve"], ["R", "reject"], ["J K", "next / previous"], ["U", "undo"]]
      .map(([k, t]) => el("span", {}, ...k.split(" ").map((x) => el("span", { class: "kbd" }, x)), ` ${t}`))));
}

function act(review, note) {
  const rows = visible();
  const i = rows.findIndex((r) => r.id === selected);
  if (i < 0) return;
  selected = rows[i + 1]?.id ?? rows[i - 1]?.id ?? null;
  decide([rows[i]], review, note?.trim() || null);
}

function move(step) {
  const rows = visible();
  const i = rows.findIndex((r) => r.id === selected);
  const next = rows[Math.min(Math.max(i + step, 0), rows.length - 1)];
  if (next) { selected = next.id; renderList(); renderDetail(); }
}

function approveAllEasy() {
  const rows = inQueue("easy");
  if (rows.length && confirm(`Approve all ${rows.length} quick confirmations? The values stay as they are; the products become verified.`)) decide(rows, "accepted");
}

$("search").addEventListener("input", (e) => { query = e.target.value; selected = null; renderList(); renderDetail(); });

document.addEventListener("keydown", (e) => {
  if (!wide.matches || tab !== "corrections" || !session || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
  else if (key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (key === "a" && queue !== "done") act("accepted", $("detail").querySelector("input")?.value);
  else if (key === "r" && queue !== "done") act("rejected", $("detail").querySelector("input")?.value);
  else if (key === "u" && lastUndo) { const u = lastUndo; lastUndo = null; $("toast").hidden = true; u(); }
  else if (key === "/") { e.preventDefault(); $("search").focus(); }
});

// ---------- Corrections: phone ----------

function renderMobile() {
  const mob = $("mob");
  if (mobQueue) return renderReview();
  const bad = inQueue("bad"), easy = inQueue("easy"), others = open().filter((r) => !facts(r).easy && facts(r).addsUp);
  const doneRows = decidedRows();
  const step = (title, count, badge, text, ...buttons) => count ? el("section", { class: "step" },
    el("h3", {}, el("span", {}, title), el("span", { class: `badge ${badge}` }, String(count))), el("p", {}, text), el("div", { class: "row" }, buttons)) : null;
  const n = open().length;
  put(mob, 
    el("h1", {}, n ? `${n} to review` : "All done"),
    el("p", { class: "lead" }, n ? "Easiest first. Swipe right to approve, left to reject." : "Nothing waiting for review."),
    step("Values don't add up", bad.length, "r", "Calories don't match carbs, protein and fat: probably a typo.",
      el("button", { type: "button", class: "approve", onclick: () => startReview("bad") }, "Look at them")),
    step("Quick confirmations", easy.length, "", "Someone checked the pack and the values were right. Approving makes them verified.",
      el("button", { type: "button", class: "approve", onclick: approveAllEasy }, `Approve all ${easy.length}`),
      el("button", { type: "button", onclick: () => startReview("easy") }, "One by one")),
    step("New values", others.length, "y", "Label photos and typed values that differ from what the app had.",
      el("button", { type: "button", class: "approve", onclick: () => startReview("others") }, "Start")),
    el("p", { class: "mini" }, `This week: ${doneRows.filter((r) => r.review === "accepted").length} approved, ${doneRows.filter((r) => r.review === "rejected").length} rejected`));
}

const MOB_QUEUES = {
  bad: { title: "Doesn't add up", rows: () => inQueue("bad") },
  easy: { title: "Quick confirmations", rows: () => inQueue("easy") },
  others: { title: "New values", rows: () => open().filter((r) => !facts(r).easy && facts(r).addsUp) },
};
let reviewTotal = 0;
function startReview(id) {
  mobQueue = id;
  reviewTotal = MOB_QUEUES[id].rows().length;
  renderMobile();
  scrollTo({ top: 0 });
}

function renderReview() {
  const q = MOB_QUEUES[mobQueue];
  const rows = q.rows();
  const back = el("button", { type: "button", class: "link", onclick: () => { mobQueue = null; renderMobile(); } }, "‹ Back");
  if (!rows.length) {
    put($("mob"), el("div", { class: "rv-head" }, back, el("span", {}, q.title)),
      el("p", { class: "empty" }, "This queue is done."), el("button", { type: "button", class: "primary", onclick: () => { mobQueue = null; renderMobile(); } }, "Back to the overview"));
    return;
  }
  const r = rows[0];
  const done = Math.max(reviewTotal - rows.length, 0);
  const fill = el("i");
  fill.style.width = `${reviewTotal ? (done / reviewTotal) * 100 : 0}%`;
  const yes = el("span", { class: "stamp yes", "aria-hidden": "true" }, "Approve");
  const no = el("span", { class: "stamp no", "aria-hidden": "true" }, "Reject");
  const card = el("article", { class: "card" }, yes, no, ...body(r));
  const wrap = el("div", { class: "swipe" }, card);
  swipeable(wrap, card, yes, no, (dir) => decide([r], dir > 0 ? "accepted" : "rejected"));
  put($("mob"), 
    el("div", { class: "rv-head" }, back, el("span", {}, `${q.title} · ${done + 1} of ${reviewTotal}`)),
    el("div", { class: "pbar" }, fill),
    wrap,
    el("div", { class: "dock" },
      el("button", { type: "button", onclick: () => fling(card, -1, () => decide([r], "rejected")) }, "Reject"),
      el("button", { type: "button", class: "approve", onclick: () => fling(card, 1, () => decide([r], "accepted")) }, "Approve")),
    el("p", { class: "swipe-hint" }, "Swipe right to approve, left to reject"));
}

/** Drag the card sideways; past a third of its width it goes, otherwise it springs back. */
function swipeable(area, card, yes, no, done) {
  let x0 = null, y0 = 0, dx = 0, horizontal = null;
  area.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("a, button")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; horizontal = null;
    card.style.transition = "none";
  });
  area.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (horizontal === null && Math.hypot(dx, dy) > 8) {
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) area.setPointerCapture(e.pointerId);
    }
    if (!horizontal) return;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    yes.style.opacity = String(Math.min(Math.max(dx / 100, 0), 1));
    no.style.opacity = String(Math.min(Math.max(-dx / 100, 0), 1));
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    if (horizontal && Math.abs(dx) > card.offsetWidth / 3) return fling(card, Math.sign(dx), () => done(Math.sign(dx)));
    card.style.transition = reduceMotion.matches ? "none" : "transform .2s ease";
    card.style.transform = "";
    yes.style.opacity = no.style.opacity = "0";
  };
  area.addEventListener("pointerup", end);
  area.addEventListener("pointercancel", end);
}

function fling(card, dir, then) {
  if (reduceMotion.matches) return then();
  card.style.transition = "transform .22s ease-in, opacity .22s ease-in";
  card.style.transform = `translateX(${dir * innerWidth}px) rotate(${dir * 12}deg)`;
  card.style.opacity = "0";
  setTimeout(then, 200);
}

wide.addEventListener("change", render);

// ---------- Costs ----------

let costsLoaded = false;
let costRows = [];
let days = 7;
let plan = "all";
const KINDS = { line: "Typed or said food", voice: "Voice command", plate: "Plate or pack photo", label: "Label photo",
  lookup: "Product pick", piece: "Piece weight", unit: "Usual unit", link: "My Foods link", activity: "Activity",
  name: "Name translation", other: "Other" };
const money = (cents) => cents === 0 ? "$0" : cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents >= 1 ? cents.toFixed(1) : cents.toFixed(2)}¢`;
const int = (n) => Number(n).toLocaleString("en-US");
const romeDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(t);
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

for (const b of document.querySelectorAll("#costs [data-days]")) {
  b.addEventListener("click", () => {
    days = Number(b.dataset.days);
    for (const o of document.querySelectorAll("#costs [data-days]")) o.setAttribute("aria-pressed", o === b);
    loadCosts();
  });
}
for (const b of document.querySelectorAll("#costs [data-plan]")) {
  b.addEventListener("click", () => {
    plan = b.dataset.plan;
    for (const o of document.querySelectorAll("#costs [data-plan]")) o.setAttribute("aria-pressed", o === b);
    renderCosts();
  });
}

async function loadCosts() {
  put($("costs-body"), el("p", { class: "empty" }, "Loading…"));
  try {
    costRows = (await api(`costs?days=${days}`)).rows ?? [];
    costsLoaded = true;
    renderCosts();
  } catch (err) {
    failed($("costs-body"), err, loadCosts);
  }
}

function renderCosts() {
  const sum = (list, key) => list.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const real = costRows.filter((r) => r.plan !== "dev"), dev = costRows.filter((r) => r.plan === "dev");
  const rows = plan === "real" ? real : plan === "dev" ? dev : costRows;
  const total = sum(rows, "cents"), realCents = sum(real, "cents"), devCents = sum(dev, "cents"), all = realCents + devCents;
  const proCents = sum(real.filter((r) => r.plan === "pro"), "cents");
  const period = days === 7 ? "this week" : `in the last ${days} days`;

  // What one request of each kind costs, over every plan (the price doesn't depend on who asks).
  const kinds = new Map();
  for (const r of costRows) {
    const k = kinds.get(r.kind) ?? { requests: 0, cents: 0, input: 0, output: 0, refunded: 0, shown: 0 };
    k.requests += r.requests; k.cents += Number(r.cents); k.input += Number(r.input_tokens); k.output += Number(r.output_tokens); k.refunded += r.refunded;
    kinds.set(r.kind, k);
  }
  for (const r of rows) kinds.get(r.kind).shown += Number(r.cents);
  const each = (k) => k && k.requests ? k.cents / k.requests : 0;
  const dearest = [...kinds.entries()].filter(([, k]) => k.requests >= 5).sort((a, b) => each(b[1]) - each(a[1]))[0];

  if (!costRows.length) {
    put($("costs-body"), el("p", { class: "empty" }, `No AI requests ${period}.`));
    return;
  }

  // The sentence first.
  const who = plan === "real" ? "Real users cost" : plan === "dev" ? "Your test builds cost" : "The AI cost";
  const h1 = el("h1", {}, `${who} ${money(total)} ${period}. `,
    plan === "all" && all && devCents / all > 0.5 ? el("em", {}, "Most of it was you testing.") : null);
  const lead = el("p", { class: "lead" },
    "Builds from Xcode: ", el("b", {}, money(devCents)), all ? ` (${Math.round((devCents / all) * 100)}%)` : "", ". Real users: ", el("b", {}, money(realCents)),
    proCents ? `, of which Pro ${money(proCents)}.` : real.length ? ", all on the free plan." : ".");

  const tiles = dearest ? el("div", { class: "tiles" },
    tile("A free user, on their busiest day", `≤ ${money(FREE_DAILY_LIMIT * each(dearest[1]))}`,
      `${FREE_DAILY_LIMIT} requests a day, all ${KINDS[dearest[0]]?.toLowerCase() ?? dearest[0]}s at ${money(each(dearest[1]))} each: the worst case.`),
    tile("Dearest request", money(each(dearest[1])),
      `One ${KINDS[dearest[0]]?.toLowerCase() ?? dearest[0]}.${kinds.get("line") ? ` A typed food costs ${money(each(kinds.get("line")))}.` : ""}`),
    tile("Pro pays 9,99 € a month", `${int(Math.floor(PRO_EUR_CENTS / each(dearest[1])))}`,
      `${KINDS[dearest[0]]?.toLowerCase() ?? dearest[0]}s a month before a Pro user costs more than they pay (dollars ≈ euros).`)) : null;

  // Day by day: every day of the period, stacked real users over test builds.
  const series = [];
  for (let i = days - 1; i >= 0; i--) series.push({ day: romeDay(new Date(Date.now() - i * 86_400_000)), real: 0, dev: 0 });
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const r of costRows) { const s = byDay.get(r.day); if (s) s[r.plan === "dev" ? "dev" : "real"] += Number(r.cents); }
  const valueOf = (s) => (plan === "real" ? s.real : plan === "dev" ? s.dev : s.real + s.dev);
  const max = Math.max(...series.map(valueOf), 0);
  const step = niceStep(max);
  const top = Math.max(step * Math.ceil(max / step), step);
  const detail = el("p", { class: "day-detail", "aria-live": "polite" }, "Tap a bar for the day.");
  const label = (s) => { const d = new Date(`${s.day}T12:00:00Z`); return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}`; };
  const every = days <= 14 ? 1 : 7;
  const plot = el("div", { class: "plot" });
  plot.style.setProperty("--gap", days <= 14 ? "10px" : days <= 30 ? "4px" : "2px");
  for (let t = step; t <= top; t += step) { const g = el("i", { class: "grid" }); g.style.bottom = `${(t / top) * 100}%`; plot.append(g); }
  for (const s of series) {
    const v = valueOf(s);
    const stk = el("span", { class: "stk" });
    stk.style.height = `${top ? (v / top) * 100 : 0}%`;
    const showDev = plan !== "real" && s.dev, showReal = plan !== "dev" && s.real;
    if (showDev) { const i = el("i", { class: "dev" }); i.style.flex = String(s.dev); stk.append(i); }
    if (showReal) { const i = el("i", { class: "real" }); i.style.flex = String(s.real); stk.append(i); }
    if (v) stk.style.minHeight = "2px";
    const say = () => { detail.textContent = `${label(s)}: ${money(v)}${plan === "all" && v ? ` · real users ${money(s.real)}, test builds ${money(s.dev)}` : ""}`; };
    plot.append(el("button", { type: "button", class: "col", "aria-label": `${label(s)}: ${money(v)}`, onclick: say, onfocus: say, onmouseenter: say },
      days <= 14 && v ? el("span", { class: "val" }, money(v)) : null, stk));
  }
  const yax = el("div", { class: "yax" });
  for (let t = 0; t <= top; t += step) { const s = el("span", {}, t ? money(t) : "0"); s.style.bottom = `${(t / top) * 100}%`; yax.append(s); }
  const xax = el("div", { class: "xax" }, series.map((s, i) => el("span", {}, i % every === 0 ? label(s) : "")));
  xax.style.setProperty("--gap", plot.style.getPropertyValue("--gap"));

  // Where the money goes, within the plan shown.
  const share = [...kinds.entries()].filter(([, k]) => k.shown > 0).sort((a, b) => b[1].shown - a[1].shown);
  const biggest = share[0]?.[1].shown ?? 0;
  const kindRows = share.map(([kind, k]) => {
    const bar = el("i"); bar.style.width = `${biggest ? (k.shown / biggest) * 100 : 0}%`;
    return el("div", { class: "kr" }, el("span", {}, KINDS[kind] ?? kind), el("span", { class: "kb" }, bar),
      el("span", { class: "kp" }, `${total ? Math.round((k.shown / total) * 100) : 0}%`), el("span", { class: "kc" }, money(k.shown)),
      el("span", { class: "ke" }, `${money(each(k))} each`));
  });

  put($("costs-body"), 
    h1, lead, tiles,
    el("h2", {}, "Day by day"),
    el("p", { class: "sub" }, "What each day cost."),
    plan === "all" ? el("div", { class: "legend" }, el("span", {}, el("i", { class: "lg-real" }), "Real users"), el("span", {}, el("i", { class: "lg-dev" }), "Test builds")) : null,
    el("div", { class: "chart" }, yax, plot), xax, detail,
    el("h2", {}, "Where the money goes"),
    el("p", { class: "sub" }, "Share of the spend, and what one request of each kind costs."),
    kindRows.length ? kindRows : el("p", { class: "empty" }, "Nothing spent."),
    el("details", {}, el("summary", {}, "Tokens and refunds"),
      el("div", { class: "table-wrap" }, el("table", { class: "tok" },
        el("thead", {}, el("tr", {}, ["Kind", "Requests", "Input tokens", "Output tokens", "Refunded"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, [...kinds.entries()].sort((a, b) => b[1].cents - a[1].cents).map(([kind, k]) => el("tr", {},
          el("th", { scope: "row" }, KINDS[kind] ?? kind), el("td", {}, int(k.requests)), el("td", {}, int(k.input)),
          el("td", {}, int(k.output)), el("td", {}, int(k.refunded)))))))),
  );
}

/** A round step for the y axis: about 3 lines, in 1, 2 or 5 times a power of ten (cents). */
function niceStep(max) {
  if (max <= 0) return 1;
  const raw = max / 3, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}

function tile(title, value, text) {
  return el("div", { class: "tile" }, el("p", {}, title), el("strong", {}, value), el("small", {}, text));
}

// ---------- Start ----------

// The email's link comes back here with the session in the hash (or an error): kept, then wiped from the address bar.
(function fromLink() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has("access_token") && !hash.has("error")) return;
  history.replaceState(null, "", location.pathname);
  if (hash.has("access_token")) keep({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"),
    expires_at: Number(hash.get("expires_at")) || undefined, expires_in: Number(hash.get("expires_in")) || undefined });
  else setStatus(hash.get("error_description") ?? "The link didn't work: ask for a new one.", true);
})();

show();
