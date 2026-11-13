// Known admin. The page holds no secret: the project URL and its publishable key are public by design. Sign-in is a
// code by email (Supabase Auth, sign-ups off); every read and write goes through the `admin` Edge Function, which
// lets in only Filippo's account. Text from corrections (names, brands) is always set as text, never as HTML.
//
// Corrections: on a wide screen an inbox (queues, list, detail, keyboard); on a phone one at a time, swiped.
// Catalog: read-only, the products the app bundles with the approved corrections laid over them.
// Users: Apple's analytics (copied by the asc-sync function); Known itself sends none. Sessions and active devices are
// a sample (people who share analytics with developers) and are marked so.
// Costs: only what the server measures. The AI per paying subscriber, the subscribers, who is near a budget, then the
// days, where the money goes and, last, the test builds. Revenue is App Store Connect's, not shown here.
"use strict";

const SUPABASE = "https://lpajxlwmsgolxajndgdv.supabase.co";
const KEY = "sb_publishable_2l5PPuELTGwnNY8f4-EuPQ_HRIdjBCc";
const API = `${SUPABASE}/functions/v1/admin`;
const SESSION_KEY = "known-admin-session";
const EMAIL_KEY = "known-admin-email";
const NAMES_KEY = "known-admin-names";

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
  $("catalog").hidden = !signedIn || tab !== "catalog";
  $("costs").hidden = !signedIn || tab !== "costs";
  $("users").hidden = !signedIn || tab !== "users";
  if (signedIn && !loaded) loadCorrections();
}

const tabs = [$("tab-corrections"), $("tab-catalog"), $("tab-costs"), $("tab-users")];
function selectTab(button) {
  tab = button.id.slice(4);
  for (const t of tabs) {
    const on = t === button;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
  }
  show();
  if (tab === "costs" && !costsLoaded) loadCosts();
  if (tab === "catalog" && !catalog) loadCatalog();
  if (tab === "users" && !usersData) loadUsers();
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

/** Approvals reach the app on their own; only the copy bundled in a new build needs this, once per release. */
const syncReminder = () => el("p", { class: "reminder" },
  el("strong", {}, "Before an App Store build"),
  " run sync-approved.sh, so new installs start with your approvals.");

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
    el("p", { class: "progress" }, `${doneRows.filter((r) => r.review === "accepted").length} approved, ${doneRows.filter((r) => r.review === "rejected").length} rejected this week`),
    syncReminder());
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
    el("p", { class: "mini" }, `This week: ${doneRows.filter((r) => r.review === "accepted").length} approved, ${doneRows.filter((r) => r.review === "rejected").length} rejected`),
    syncReminder());
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

// ---------- Catalog (read-only) ----------

let catalog = null;          // products, sorted by name, each with _key (14-digit GTIN), _hay (lower-case text) and _o
let catLoading = false;
let catFilter = "all";
let catQuery = "";
let catSelected = null;      // _key
let catOpen = false;         // phone: the detail is open over the list
const CAT_LIMIT = 200;

const key14 = (gtin) => String(gtin).padStart(14, "0");
/** The barcode as printed: EAN-8 or EAN-13 (the catalog keeps 14 digits, zero-filled). */
const ean = (gtin) => { const g = String(gtin).replace(/^0+/, ""); return g.padStart(g.length <= 8 ? 8 : 13, "0"); };
const CAT_FILTERS = [
  { id: "all", title: "All", test: () => true },
  { id: "verified", title: "Verified", test: (p) => p.state === "verified" },
  { id: "same_as_off", title: "Matches Open Food Facts", test: (p) => p.state === "same_as_off" },
  { id: "single_source", title: "One source only", test: (p) => p.state === "single_source" },
  { id: "to_recheck", title: "To check", test: (p) => p.state === "to_recheck", badge: "y" },
  { id: "bad", title: "Doesn't add up", test: (p) => !catFacts(p).addsUp, badge: "r" },
  { id: "corrected", title: "Corrected", test: (p) => Boolean(p._o) },
];
const SRC = { producer: "Producer's site", label: "Pack label", store: "Shop's own brand", shop: "A shop's site" };

/** The catalog file (gzip, from a short-lived link) plus the approved corrections, joined by GTIN. */
async function loadCatalog() {
  if (catLoading) return;
  catLoading = true;
  put($("cat-list"), el("p", { class: "empty" }, "Loading the catalog…"));
  put($("cat-detail"));
  try {
    const { url, overrides } = await api("catalog");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The catalog file answered ${res.status}.`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const file = JSON.parse(new TextDecoder().decode(bytes));
    const byKey = new Map();
    for (const p of file.products ?? []) byKey.set(key14(p.gtin), { ...p, _key: key14(p.gtin) });
    for (const o of overrides ?? []) {
      const k = key14(o.gtin);
      const p = byKey.get(k);
      if (p) p._o = o;
      else if (o.values && o.name && ["kcal", "carbs", "protein", "fat"].every((n) => o.values[n] != null)) {
        // Not in the bundled file: the app adds it as verified from the correction.
        byKey.set(k, { gtin: k, name: o.name, brand: o.brand, basis: o.unit ?? "g", state: "verified", _added: true, _key: k, _o: o,
          v: [o.values.kcal, o.values.carbs, o.values.protein, o.values.fat] });
      }
    }
    catalog = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
    for (const p of catalog) p._hay = [p.name, p.brand, p.maker, p.gtin, ean(p.gtin)].filter(Boolean).join(" ").toLowerCase();
    catalog.version = file.version;
    renderCatalog();
  } catch (err) {
    failed($("cat-list"), err, loadCatalog);
  } finally {
    catLoading = false;
  }
}

/** The values the app uses (per 100): the catalog's, or the approved correction's when it has values. */
function catValues(p) {
  const x = p.x ?? {};
  const base = { kcal: p.v?.[0], carbs: p.v?.[1], protein: p.v?.[2], fat: p.v?.[3], kj: x.kj, sugars: x.sugars, fibre: x.fiber, sat: x.sat, salt: x.salt, polyols: x.polyols };
  const o = p._o?.values;
  return { base, now: o ? { ...base, ...o } : null };
}

function catFacts(p) {
  if (p._facts) return p._facts;
  const { base, now } = catValues(p);
  const v = now ?? base;
  const fromMacros = 4 * (v.carbs ?? 0) + 4 * (v.protein ?? 0) + 9 * (v.fat ?? 0) + 2 * (v.fibre ?? 0);
  const kcal = Number(v.kcal ?? 0);
  const addsUp = kcal < 20 ? Math.abs(fromMacros - kcal) < 15 : Math.abs(fromMacros - kcal) / kcal <= 0.15;
  return (p._facts = { addsUp, fromMacros: Math.round(fromMacros), kcal });
}

function catVisible() {
  const f = CAT_FILTERS.find((x) => x.id === catFilter);
  const words = catQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.filter((p) => f.test(p) && words.every((w) => p._hay.includes(w)));
}

function catChips(p) {
  const state = p.state === "verified" ? el("span", { class: "chip ok" }, STATE.verified)
    : el("span", { class: `chip ${p.state === "to_recheck" ? "y" : ""}` }, STATE[p.state] ?? p.state);
  return [p._o && p._o.kind === "confirm" && !p._o.values ? el("span", { class: "chip ok" }, "Verified by a correction") : state,
    p._o && (p._o.values || p._o.portion) ? el("span", { class: "chip" }, p._added ? "Added by a correction" : "Corrected") : null,
    catFacts(p).addsUp ? null : el("span", { class: "chip r" }, "Doesn't add up")];
}

function renderCatalog() {
  if (!catalog) return;
  const filters = $("cat-filters");
  put(filters, ...CAT_FILTERS.map((f) => {
    const n = catalog.filter(f.test).length;
    return el("button", { type: "button", class: "q", "aria-current": catFilter === f.id ? "true" : "false",
      onclick: () => { catFilter = f.id; catSelected = null; catOpen = false; renderCatalog(); } },
    el("span", {}, f.title), el("span", { class: `badge ${n && f.badge ? f.badge : ""}` }, int(n)));
  }), el("p", { class: "progress" }, `Catalog of ${catalog.version?.slice(0, 10) ?? "–"}. Read-only: ask Claude for changes.`));
  renderCatList();
  renderCatDetail();
}

function renderCatList() {
  const rows = catVisible();
  if (catSelected === null || !rows.some((p) => p._key === catSelected)) catSelected = rows[0]?._key ?? null;
  $("cdesk").classList.toggle("open", catOpen);
  if (!rows.length) { put($("cat-list"), el("p", { class: "empty" }, catQuery ? "Nothing matches." : "No products here.")); return; }
  const shownRows = rows.slice(0, CAT_LIMIT);
  put($("cat-list"), el("p", { class: "count" }, rows.length > CAT_LIMIT ? `First ${CAT_LIMIT} of ${int(rows.length)}: search to narrow them.` : `${int(rows.length)} products`),
    ...shownRows.map((p) => el("button", { type: "button", class: "it", "aria-current": p._key === catSelected ? "true" : "false",
      onclick: () => { catSelected = p._key; catOpen = true; renderCatList(); renderCatDetail(); if (!wide.matches) scrollTo({ top: 0 }); } },
    el("b", {}, p.name), el("span", { class: "br" }, [p.brand, `EAN ${ean(p.gtin)}`].filter(Boolean).join(" · ")),
    el("span", { class: "m" }, el("span", { class: "chips" }, catChips(p))))));
  if (wide.matches) $("cat-list").querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
}

function renderCatDetail() {
  const p = catalog?.find((x) => x._key === catSelected);
  if (!p) { put($("cat-detail")); return; }
  const { base, now } = catValues(p);
  const f = catFacts(p);
  const unit = p.basis ?? "g", o = p._o;
  const alt = p.alt ? { kcal: p.alt[0], carbs: p.alt[1], protein: p.alt[2], fat: p.alt[3] } : null;
  const ROWS = [["Calories", "kcal", "kcal"], ["kJ", "kj", "kcal"], ["Carbs", "carbs", "g"], ["Sugars", "sugars", "g"], ["Polyols", "polyols", "g"],
    ["Fibre", "fibre", "g"], ["Protein", "protein", "g"], ["Fat", "fat", "g"], ["Saturated fat", "sat", "g"], ["Salt", "salt", "g"]];
  const lines = ROWS.filter(([, k]) => base[k] != null || now?.[k] != null).map(([title, k, u]) => {
    const changed = now && !p._added && now[k] != null && base[k] != null && Math.abs(Number(now[k]) - Number(base[k])) > 0.05;
    return el("tr", { class: changed ? "ch" : "" }, el("th", { scope: "row" }, title),
      p._added ? null : el("td", {}, shown(base[k], u) ?? "–"),
      alt ? el("td", {}, shown(alt[k], u) ?? "") : null,
      now ? el("td", {}, changed ? el("span", {}, shown(now[k], u)) : shown(now[k], u) ?? "–") : null);
  });
  const what = !o ? null : o.kind === "confirm" && !o.values
    ? `Confirmed on ${o.approved ?? "–"}: the pack matches these values, so the app shows it as verified.`
    : p._added ? `Not in the bundled catalog: added from a correction approved on ${o.approved ?? "–"}.`
    : o.values ? `Corrected on ${o.approved ?? "–"} (${KIND[o.kind]?.toLowerCase() ?? o.kind}): the app uses the “App now” column.` : `Portion set on ${o.approved ?? "–"}.`;
  const weight = (n, w = unit) => n ? `${shown(n, w)} ${w}` : null;
  const facts = [
    ["State", `${STATE[p.state] ?? p.state}${o?.kind === "confirm" && !o.values && p.state !== "verified" ? ", verified by a correction" : ""}`], ["Read from", SRC[p.src] ?? p.src], ["Read on", p.read], ["Country", p.country ?? (p._added ? null : "IT")],
    ["Pack", weight(p.qty, p.unit ?? unit)], ["Serving", weight(p.serving)], ["One piece", weight(p.piece)], ["Pieces", p.pieces ? String(p.pieces) : null],
    o?.portion ? [`One ${o.portion_unit ?? "serving"} (correction)`, weight(o.portion)] : null,
    ["Maker", p.maker], ["Line", [p.line, p.variant].filter(Boolean).join(" · ") || null], ["Prepared", p.prep === "prepared" ? "Values as prepared" : null],
    ["Changed in", p.cv?.slice(0, 10)],
  ].filter((x) => x && x[1]);
  put($("cat-detail"),
    wide.matches ? null : el("button", { type: "button", class: "link back", onclick: () => { catOpen = false; renderCatList(); } }, "‹ Products"),
    el("div", { class: "pt" }, el("span", { class: "chips" }, catChips(p)), el("h2", {}, p.name.replace(/ (\S+)$/, "\u00a0$1")),
      el("p", {}, [p.brand, `EAN ${ean(p.gtin)}`].filter(Boolean).join(" · "), " · ",
        el("a", { href: `https://world.openfoodfacts.org/product/${encodeURIComponent(ean(p.gtin))}`, target: "_blank", rel: "noopener noreferrer" }, "Open Food Facts ↗"))),
    what ? el("p", { class: "note" }, what) : null,
    f.addsUp ? null : el("p", { class: "warn" }, el("b", {}, "Calories don't add up. "), `Carbs, protein, fat and fibre give ${f.fromMacros} kcal, the values say ${shown(f.kcal, "kcal")}.`),
    el("div", { class: "cols" },
      el("div", {}, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, `Per 100 ${unit}`), p._added ? null : el("th", {}, "Catalog"),
        alt ? el("th", {}, p.alt_src === "off" ? "Open Food Facts" : p.alt_src === "shop" ? "A shop's site" : "Other source") : null, now ? el("th", {}, "App now") : null)),
      el("tbody", {}, lines))),
      el("div", { class: "facts" }, facts.map(([k, v]) => el("div", {}, el("span", {}, k), v)))));
}

$("cat-search").addEventListener("input", (e) => { catQuery = e.target.value; catSelected = null; if (catalog) { renderCatList(); renderCatDetail(); } });
wide.addEventListener("change", () => { if (catalog) renderCatalog(); });

document.addEventListener("keydown", (e) => {
  if (!wide.matches || tab !== "catalog" || !catalog || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea")) { if (e.key === "Escape") e.target.blur(); return; }
  const key = e.key.toLowerCase();
  if (key === "/") { e.preventDefault(); $("cat-search").focus(); return; }
  const step = key === "j" || e.key === "ArrowDown" ? 1 : key === "k" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const rows = catVisible().slice(0, CAT_LIMIT);
  const i = rows.findIndex((p) => p._key === catSelected);
  const next = rows[Math.min(Math.max(i + step, 0), rows.length - 1)];
  if (next) { catSelected = next._key; renderCatList(); renderCatDetail(); }
});

// ---------- Costs ----------

let costsLoaded = false;
let costRows = [];
let costDevices = null;
let days = 30;
let plan = "real";
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
    const data = await api(`costs?days=${days}`);
    costRows = data.rows ?? [];
    costDevices = data.devices ?? null;
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

  if (!costRows.length) {
    put($("costs-body"), el("p", { class: "empty" }, `No AI requests ${period}.`));
    return;
  }

  // Only what the server measures: the AI's cost, the subscriptions running now, who is near a budget.
  const dv = costDevices;
  const planCents = (p) => sum(real.filter((r) => r.plan === p), "cents");
  const subs = dv?.subscriptions ?? { paying: 0, trials: 0, sandbox: 0 };
  const paidCents = planCents("pro") + planCents("trial"), freeCents = planCents("free");
  const perSubscriber = subs.paying ? (paidCents / days) * 30 / subs.paying : null;

  const who = plan === "real" ? "Real users' AI cost" : plan === "dev" ? "Your test builds cost" : "The AI cost";
  const h1 = el("h1", {}, `${who} ${money(total)} ${period}. `,
    plan === "dev" ? null : el("em", {}, perSubscriber === null ? "No paying subscriber yet." : `${money(perSubscriber)} a month per paying subscriber.`));
  const lead = plan === "dev"
    ? el("p", { class: "lead" }, "Builds run from Xcode with the development token: your own testing.")
    : el("p", { class: "lead" }, "Revenue is in ", el("a", { href: "https://appstoreconnect.apple.com/trends", target: "_blank", rel: "noopener" }, "App Store Connect › Trends"),
      ": this page shows only what the AI costs.");

  const nearPro = dv?.pro.nearCap ?? 0, nearTrial = dv?.trial.nearCap ?? 0;
  const tiles = plan === "dev" ? null : el("div", { class: "tiles" },
    tile("AI per paying subscriber", perSubscriber === null ? "—" : money(perSubscriber),
      perSubscriber === null
        ? `No paying subscription yet. Pro and trials' AI: ${money(paidCents)} ${period}. Pro costs 9,99 € a month.`
        : `a month: Pro and trials' AI (${money(paidCents)} ${period}) over ${int(subs.paying)} paying. Pro costs 9,99 € a month.`),
    tile("Subscribers now", int(subs.paying),
      `paying. ${int(subs.trials)} ${subs.trials === 1 ? "trial" : "trials"} running.${subs.sandbox ? ` ${int(subs.sandbox)} Sandbox (TestFlight, free) not counted.` : ""}`),
    tile("Near their budget", int(nearPro + nearTrial),
      dv ? `above 80%. Pro: ${int(nearPro)} of ${int(dv.pro.devices)} ${dv.pro.devices === 1 ? "device" : "devices"} this month, the most ${money(dv.pro.maxCents)} of ${money(dv.pro.capCents)}. ` +
        `Trials: ${int(nearTrial)}, the most ${money(dv.trial.maxCents)} of ${money(dv.trial.capCents)}.` : "",
      nearPro + nearTrial ? "bad" : null));

  const freeWarning = plan !== "dev" && freeCents > 0
    ? el("p", { class: "warn" }, `Free devices spent ${money(freeCents)} ${period}: the free AI is still on (FREE_AI). From launch it is off and this should be $0.`)
    : null;

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

  const tests = plan === "real" && devCents
    ? el("p", { class: "fine tests" }, `Your test builds also cost ${money(devCents)} ${period} (${Math.round((devCents / all) * 100)}% of all). `,
      el("button", { type: "button", class: "link", onclick: () => document.querySelector('#costs [data-plan="dev"]').click() }, "Show them"))
    : null;

  put($("costs-body"),
    h1, lead, freeWarning, tiles,
    el("h2", {}, "Day by day"),
    el("p", { class: "sub" }, "What each day cost."),
    plan === "all" ? el("div", { class: "legend" }, el("span", {}, el("i", { class: "lg-real" }), "Real users"), el("span", {}, el("i", { class: "lg-dev" }), "Test builds")) : null,
    el("div", { class: "chart" }, yax, plot), xax, detail,
    el("h2", {}, "Where the money goes"),
    el("p", { class: "sub" }, "Share of the spend, and what one request of each kind costs."),
    kindRows.length ? kindRows : el("p", { class: "empty" }, "Nothing spent."),
    tests,
    el("details", {}, el("summary", {}, "Tokens and refunds"),
      el("div", { class: "table-wrap" }, el("table", { class: "tok" },
        el("thead", {}, el("tr", {}, ["Kind", "Requests", "Input tokens", "Output tokens", "Refunded"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, [...kinds.entries()].sort((a, b) => b[1].cents - a[1].cents).map(([kind, k]) => el("tr", {},
          el("th", { scope: "row" }, KINDS[kind] ?? kind), el("td", {}, int(k.requests)), el("td", {}, int(k.input)),
          el("td", {}, int(k.output)), el("td", {}, int(k.refunded)))))))),
  );
}

/** A round step for the y axis: about 3 lines, in 1, 2 or 5 times a power of ten (cents). */
// ---------- Users ----------

let usersData = null;
let udays = 30;
const pct = (a, b) => (b ? `${a / b >= 0.1 ? Math.round((a / b) * 100) : ((a / b) * 100).toFixed(1)}%` : "—");
const countryName = (() => {
  let names = null;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old browser */ }
  return (code) => { try { return (names && /^[A-Z]{2}$/.test(code) && names.of(code)) || code; } catch { return code; } };
})();

for (const b of document.querySelectorAll("#users [data-udays]")) {
  b.addEventListener("click", () => {
    udays = Number(b.dataset.udays);
    for (const o of document.querySelectorAll("#users [data-udays]")) o.setAttribute("aria-pressed", o === b);
    loadUsers();
  });
}

async function loadUsers() {
  put($("users-body"), el("p", { class: "empty" }, "Loading…"));
  try {
    usersData = await api(`users?days=${udays}`);
    renderUsers();
  } catch (err) {
    usersData = null;
    failed($("users-body"), err, loadUsers);
  }
}

function renderUsers() {
  const rows = usersData.rows ?? [];
  const subs = usersData.subscriptions ?? { paying: 0, trials: 0 };
  const synced = usersData.synced;
  const dayOf = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  const from = dayOf(udays - 1), prevFrom = dayOf(2 * udays - 1);
  const cur = rows.filter((r) => r.day >= from), prev = rows.filter((r) => r.day >= prevFrom && r.day < from);
  const total = (list, metric, dim = "") => list.reduce((n, r) => n + (r.metric === metric && r.dim === dim ? Number(r.value) : 0), 0);
  const through = rows.reduce((m, r) => (r.day > m ? r.day : m), "");
  const period = udays === 365 ? "in the last year" : udays === 7 ? "this week" : `in ${udays} days`;

  put($("users-synced"), through
    ? `Apple's data up to ${shortDay(through)}${synced?.copied_at ? ` · copied ${new Date(synced.copied_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`
    : "");

  if (!rows.length) {
    put($("users-body"),
      el("h1", {}, `${int(subs.paying)} paying for Pro now. `, el("em", {}, `${int(subs.trials)} ${subs.trials === 1 ? "trial" : "trials"} running.`)),
      el("p", { class: "empty" }, synced
        ? `Apple has no numbers for Known ${period} yet.`
        : "No numbers from Apple yet. Its reports start a day or two after the first downloads and are copied here every 3 hours."));
    return;
  }

  const n = (metric, list = cur) => total(list, metric);
  const downloads = n("downloads"), prevDownloads = n("downloads", prev);
  const trials = n("sub_trial_start"), converted = n("sub_trial_converted"), direct = n("sub_subscribe");
  const steps = [
    { label: "Saw Known on the Store", note: "impressions, unique devices a day", value: n("impressions"), verb: "opened the page" },
    { label: "Opened the product page", value: n("page_views"), verb: "downloaded" },
    { label: "Downloaded", note: "first downloads only", value: downloads, verb: "started a trial" },
    { label: "Started a trial", value: trials, verb: "became Pro (trials ending in the period)" },
    { label: "Became Pro", note: "from a trial or straight", value: converted + direct },
  ];
  const top = Math.max(...steps.map((s) => s.value), 1);
  const ratios = steps.slice(0, -1).map((s, i) => ({ from: s, to: steps[i + 1], r: s.value ? steps[i + 1].value / s.value : null }));
  const weakest = ratios.filter((x) => x.r !== null && x.from.value >= 10).sort((a, b) => a.r - b.r)[0];

  const h1 = el("h1", {}, `${int(downloads)} ${downloads === 1 ? "person" : "people"} downloaded Known ${period}. `,
    el("em", {}, `${int(trials)} started a trial, ${int(subs.paying)} pay for Pro now.`));
  const lead = steps[0].value
    ? el("p", { class: "lead" }, "From the Store to Pro, ", el("b", {}, pct(converted + direct, steps[0].value)),
      " of the people who saw Known paid for it.",
      weakest ? [" The weakest step is ", el("b", {}, `${weakest.from.label.toLowerCase()} → ${weakest.to.label.toLowerCase()}`), "."] : null)
    : null;

  const change = prevDownloads ? Math.round(((downloads - prevDownloads) / prevDownloads) * 100) : null;
  const activeDays = new Set(cur.filter((r) => r.metric === "active_devices").map((r) => r.day)).size;
  const activeAvg = activeDays ? Math.round(n("active_devices") / activeDays) : null;
  const deletions = n("deletions");
  const tiles = el("div", { class: "tiles four" },
    tile("Downloads", int(downloads),
      `${change === null ? "nothing to compare with yet" : `${change >= 0 ? "+" : ""}${change}% on the ${udays === 365 ? "year" : `${udays} days`} before`} · ${int(n("redownloads"))} re-downloads apart`),
    sampleTile("Active devices a day", activeAvg === null ? "—" : int(activeAvg), "average, among people who share analytics"),
    tile("Paying Pro", int(subs.paying), `now · ${int(subs.trials)} in trial`),
    tile("Uninstalls", int(deletions), downloads ? `${pct(deletions, downloads)} of downloads` : `${period}`));

  const funnel = el("div", { class: "fun" }, steps.map((s, i) => {
    const bar = el("i"); bar.style.width = `${(s.value / top) * 100}%`;
    return [
      el("div", { class: "fs" }, el("span", { class: "l" }, s.label, s.note ? el("small", {}, s.note) : null),
        el("span", { class: "fb" }, bar), el("span", { class: "n" }, int(s.value))),
      i < ratios.length ? el("div", { class: "fd" }, el("b", {}, ratios[i].r === null ? "—" : pct(ratios[i].to.value, s.value)), ` ${s.verb}`) : null,
    ];
  }));

  const series = (metric) => {
    const out = [];
    for (let i = udays - 1; i >= 0; i--) { const day = dayOf(i); out.push({ day, v: total(cur.filter((r) => r.day === day), metric) }); }
    return out;
  };
  const dlSeries = series("downloads");
  const dlDetail = (s) => `${shortDay(s.day)}: ${int(s.v)} ${s.v === 1 ? "download" : "downloads"} · ${int(total(cur.filter((r) => r.day === s.day), "redownloads"))} re-downloads · ${int(total(cur.filter((r) => r.day === s.day), "sub_trial_start"))} trials`;
  const actSeries = series("active_devices");
  const sessions = n("sessions");

  const shareRows = (metric, limit, name, asCount) => {
    const by = new Map();
    for (const r of cur) if (r.metric === metric) by.set(r.dim, (by.get(r.dim) ?? 0) + Number(r.value));
    const list = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const sum = [...by.values()].reduce((a, b) => a + b, 0), most = list[0]?.[1] ?? 0;
    if (!list.length) return el("p", { class: "empty" }, "No downloads in the period.");
    return list.map(([dim, v]) => {
      const bar = el("i"); bar.style.width = `${most ? (v / most) * 100 : 0}%`;
      return el("div", { class: "lr" }, el("span", {}, name(dim)), el("span", { class: "kb" }, bar), el("span", { class: "kc" }, asCount ? int(v) : pct(v, sum)));
    });
  };

  put($("users-body"),
    h1, lead, tiles,
    el("h2", {}, "From the Store to Pro"),
    el("p", { class: "sub" }, "Each step out of the one above."),
    funnel,
    el("h2", {}, "Downloads a day"),
    el("p", { class: "sub" }, "First downloads. Tap a day for its numbers."),
    barChart(dlSeries, dlDetail),
    el("h2", {}, "Active devices a day ", el("span", { class: "src sample" }, "sample")),
    el("p", { class: "sub" }, "Devices that opened Known that day, among people who share analytics with developers."),
    barChart(actSeries, (s) => `${shortDay(s.day)}: ${int(s.v)} active ${s.v === 1 ? "device" : "devices"}`,
      activeDays && n("active_devices") ? `${(sessions / n("active_devices")).toFixed(1)} sessions per active device a day, on average.` : null),
    el("div", { class: "two" },
      el("section", {}, el("h2", {}, "Where downloads come from"), el("p", { class: "sub" }, "Share of first downloads."),
        shareRows("downloads_source", 6, (d) => d, false)),
      el("section", {}, el("h2", {}, "Countries"), el("p", { class: "sub" }, "First downloads, top 5."),
        shareRows("downloads_country", 5, countryName, true))),
    el("h2", {}, "Subscriptions"),
    el("p", { class: "sub" }, "From Apple's subscription events: all of them, not a sample."),
    el("div", { class: "tiles four" },
      tile("Trials started", int(trials), downloads ? `${pct(trials, downloads)} of downloads` : period),
      tile("Trial → Pro", trials ? pct(converted, trials) : "—", `${int(converted)} converted ${period}, out of ${int(trials)} trials started`),
      tile("Cancelled", int(n("sub_cancel")), `${period} · ${int(direct)} subscribed without a trial`),
      tile("Refunds", int(n("sub_refund")), period)),
    el("div", { class: "note" },
      el("p", {}, el("b", {}, "Where the numbers come from. "),
        "Store, downloads, countries and subscriptions: App Store Connect, complete, 1–2 days late. Numbers marked ",
        el("span", { class: "src sample" }, "sample"),
        " count only people who chose to share analytics with developers in their iPhone settings, so they are lower than the real total. Apple hides very small counts. Pro and trials “now”: Known's own server."),
      el("p", {}, "Known itself sends no analytics: the privacy policy stays as it is.")));
}

function sampleTile(title, value, text) {
  return el("div", { class: "tile" }, el("p", {}, title, " ", el("span", { class: "src sample" }, "sample")), el("strong", {}, value), el("small", {}, text));
}

function shortDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/** A bar a day; tapping, hovering or focusing a day says its numbers. */
function barChart(series, say, foot = null) {
  const max = Math.max(...series.map((s) => s.v), 0);
  const step = niceStep(max), top = Math.max(step * Math.ceil(max / step), step);
  const detail = el("p", { class: "day-detail", "aria-live": "polite" }, foot ?? "Tap a bar for the day.");
  const gap = series.length <= 14 ? "10px" : series.length <= 31 ? "3px" : "1px";
  const plot = el("div", { class: "plot" });
  plot.style.setProperty("--gap", gap);
  for (let t = step; t <= top; t += step) { const g = el("i", { class: "grid" }); g.style.bottom = `${(t / top) * 100}%`; plot.append(g); }
  for (const s of series) {
    const stk = el("span", { class: "stk" }, el("i", { class: "real" }));
    stk.firstChild.style.flex = "1";
    stk.style.height = `${(s.v / top) * 100}%`;
    if (s.v) stk.style.minHeight = "2px";
    const tell = () => { detail.textContent = say(s); };
    plot.append(el("button", { type: "button", class: "col", "aria-label": say(s), onclick: tell, onfocus: tell, onmouseenter: tell }, stk));
  }
  const yax = el("div", { class: "yax" });
  for (let t = 0; t <= top; t += step) { const s = el("span", {}, int(t)); s.style.bottom = `${(t / top) * 100}%`; yax.append(s); }
  const xax = el("div", { class: "xax ends" }, [0, Math.floor((series.length - 1) / 2), series.length - 1].map((i) => el("span", {}, shortDay(series[i].day))));
  return [el("div", { class: "chart" }, yax, plot), xax, detail];
}

function niceStep(max) {
  if (max <= 0) return 1;
  const raw = max / 3, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}

function tile(title, value, text, tone = null) {
  return el("div", { class: tone ? `tile ${tone}` : "tile" }, el("p", {}, title), el("strong", {}, value), el("small", {}, text));
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
