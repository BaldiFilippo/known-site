// Known admin. The page holds no secret: the project URL and its publishable key are public by design. Sign-in is a
// code by email (Supabase Auth, sign-ups off); every read and write goes through the `admin` Edge Function, which
// lets in only Filippo's account. Text from corrections (names, brands) is always set as text, never as HTML.
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

/** Builds an element: el("p", {class: "x"}, "text", child…). Strings become text nodes. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
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
  if (!token) throw new SignedOut();
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
  const button = e.submitter ?? $("email-form").querySelector("button");
  button.disabled = true;
  setStatus("Sending…");
  try {
    // create_user: false — sign-ups are off; an unknown address gets nothing.
    await auth(`otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email, create_user: false });
    store.set(EMAIL_KEY, email);
    $("email-form").hidden = true;
    $("code-form").hidden = false;
    $("code-sent").textContent = `An email is on its way to ${email}. Open its link on this device, or type the code if it shows one.`;
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

function show() {
  const signedIn = Boolean(session);
  $("signin").hidden = signedIn;
  $("app").hidden = !signedIn;
  $("signout").hidden = !signedIn;
  if (signedIn) loadCorrections();
}

const tabs = [$("tab-corrections"), $("tab-costs")];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (tab.id === "tab-costs" && !costsLoaded) loadCosts();
  if (tab.id === "tab-corrections") loadCorrections();
}
for (const t of tabs) {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    selectTab(next);
  });
}

function failed(container, err, retry) {
  if (err instanceof SignedOut) return;
  container.replaceChildren(el("p", { class: "error" }, err.message || "Something went wrong."),
    el("button", { type: "button", class: "ghost small", onclick: retry }, "Try again"));
}

// ---------- Corrections ----------

const KIND = { confirm: "Values match", label: "New values from a label photo", manual: "Values typed by hand" };
const STATE = {
  verified: "In catalog: verified", same_as_off: "In catalog: matches Open Food Facts",
  same_as_shops: "In catalog: matches the shops", to_recheck: "In catalog: to check", single_source: "In catalog: one source only",
};
const SOURCE = { open_food_facts: "Open Food Facts", catalog: "Known catalog" };
const NUTRIENTS = [["Calories", "kcal", "kcal"], ["Carbs", "carbs", "g"], ["Sugars", "sugars", "g"], ["Fibre", "fibre", "g"],
  ["Protein", "protein", "g"], ["Fat", "fat", "g"], ["Salt", "salt", "g"]];

function shown(x, unit) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (unit === "kcal" || n >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

function where(r) {
  if (r.kind === "confirm" && !r.catalog_state)
    return `From ${SOURCE[r.before_source] ?? "the app"}, confirmed on the pack · Not in catalog yet`;
  const place = r.catalog_state ? STATE[r.catalog_state] ?? "In catalog"
    : r.before_source === "open_food_facts" ? "Not in catalog, from Open Food Facts" : "Not in catalog";
  return `${KIND[r.kind] ?? r.kind} · ${place}`;
}

// Names: the correction's own, else Open Food Facts (kept in this browser), else the barcode.
const names = store.get(NAMES_KEY) ?? {};
async function lookUpNames(gtins) {
  const missing = gtins.filter((g) => !(g in names)).slice(0, 40);
  await Promise.all(missing.map(async (gtin) => {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,brands`);
      const p = (await res.json()).product ?? {};
      names[gtin] = p.product_name ? [p.product_name, (p.brands ?? "").split(",")[0].trim() || null] : null;
    } catch { /* offline: try again next time */ }
  }));
  if (missing.length) store.set(NAMES_KEY, names);
}
function nameOf(rows) {
  const own = rows.find((r) => r.name);
  if (own) return [own.name, own.brand];
  return names[rows[0].gtin] ?? ["Unknown product", null];
}

let pending = [];

async function loadCorrections() {
  const list = $("corr-list");
  if (!pending.length) list.replaceChildren(el("p", { class: "muted" }, "Loading…"));
  $("corr-summary").textContent = "";
  try {
    const { rows } = await api("corrections");
    await lookUpNames([...new Set(rows.filter((r) => !r.name).map((r) => r.gtin))]);
    pending = rows;
    renderCorrections();
  } catch (err) {
    failed(list, err, loadCorrections);
  }
  loadDecided();
}

function renderCorrections() {
  const list = $("corr-list");
  const open = pending.filter((r) => !r.decided);
  const groups = new Map();
  for (const r of pending) groups.set(r.gtin, [...(groups.get(r.gtin) ?? []), r]);
  // Most reported products first (distinct devices), then the oldest.
  const ordered = [...groups.values()].sort((a, b) =>
    new Set(b.map((r) => r.reporter)).size - new Set(a.map((r) => r.reporter)).size ||
    String(a[0].received_on).localeCompare(String(b[0].received_on)));

  const decided = pending.length - open.length;
  $("corr-summary").textContent = open.length
    ? `${open.length} to review across ${new Set(open.map((r) => r.gtin)).size} products${decided ? ` · ${decided} decided now` : ""}`
    : decided ? `All done · ${decided} decided now` : "";

  const confirms = open.filter((r) => r.kind === "confirm" && !r.portion);
  const bulk = $("approve-confirms");
  bulk.hidden = confirms.length < 2;
  bulk.textContent = `Approve all ${confirms.length} plain confirmations`;
  bulk.onclick = () => decide(confirms, "accepted");

  if (!pending.length) return list.replaceChildren(el("p", { class: "empty" }, "Nothing waiting for review."));
  list.replaceChildren(...ordered.map((rows) => {
    const [name, brand] = nameOf(rows);
    const devices = new Set(rows.map((r) => r.reporter)).size;
    return el("section", { class: "group", "aria-label": name },
      el("h2", {}, name),
      el("p", { class: "sub" }, [brand, `EAN ${rows[0].gtin}`, `${devices} device${devices > 1 ? "s" : ""}`].filter(Boolean).join(" · ")),
      el("div", { class: "cards" }, rows.map(card)));
  }));
}

function card(r) {
  const before = r.before ?? {}, values = r.values ?? {}, unit = r.unit ?? "g";
  const confirm = r.kind === "confirm";
  let differ = 0;
  const lines = [];
  for (const [title, key, u] of NUTRIENTS) {
    const a = shown(before[key], u), b = shown(values[key], u);
    if (a === null && b === null) continue;
    const changed = !confirm && a !== null && b !== null && a !== b;
    if (changed) differ++;
    lines.push(el("tr", { class: changed ? "changed" : "same" }, el("th", { scope: "row" }, title),
      confirm ? null : el("td", {}, a ?? "–"), el("td", {}, el("span", {}, b ?? "–"))));
  }
  let chip = confirm ? "Confirmed" : differ ? `${differ} value${differ > 1 ? "s" : ""} differ` : "Identical";
  let portion = null;
  if (r.portion) {
    const word = r.portion_unit ?? "serving";
    chip += ` · new ${word}`;
    portion = el("p", { class: "portion" }, `One ${word}: `,
      r.portion_before ? [el("s", {}, `${shown(r.portion_before, unit)} ${unit}`), " → "] : null,
      el("b", {}, `${shown(r.portion, unit)} ${unit}`));
  }
  const meta = [r.received_on, r.country, r.app_version ? `v${r.app_version}` : null].filter(Boolean).join(" · ");
  return el("article", { class: `card${r.decided ? " decided" : ""}` },
    el("div", { class: "top" }, el("span", { class: `chip ${differ || portion ? "diff" : "ok"}` }, chip), el("span", { class: "date" }, meta)),
    el("p", { class: "what" }, where(r)),
    el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}), confirm ? el("th", {}, "Values") : [el("th", {}, "Before"), el("th", {}, "New")])),
      el("tbody", {}, lines)),
    el("p", { class: "per" }, `per 100 ${unit}`),
    portion,
    r.decided
      ? el("div", { class: `done ${r.decided}` }, el("span", {}, r.decided === "accepted" ? "Approved" : "Rejected"),
        el("button", { type: "button", class: "ghost small", onclick: () => decide([r], "new") }, "Undo"))
      : el("div", { class: "actions" },
        el("button", { type: "button", class: "approve", onclick: () => decide([r], "accepted") }, "Approve"),
        el("button", { type: "button", class: "reject", onclick: () => decide([r], "rejected") }, "Reject")));
}

async function decide(rows, review) {
  const ids = rows.map((r) => r.id);
  const previous = rows.map((r) => r.decided);
  // Shown at once; put back if the service says no.
  rows.forEach((r) => { r.decided = review === "new" ? undefined : review; });
  renderCorrections();
  try {
    await api("decide", { method: "POST", body: JSON.stringify({ ids, review }) });
    loadDecided();
  } catch (err) {
    rows.forEach((r, i) => { r.decided = previous[i]; });
    renderCorrections();
    if (!(err instanceof SignedOut)) $("corr-summary").textContent = `Not saved: ${err.message}`;
  }
}

async function loadDecided() {
  const list = $("decided-list");
  try {
    const { rows } = await api("decided?days=7");
    const recent = rows.filter((r) => !pending.some((p) => p.id === r.id));
    list.replaceChildren(...(recent.length ? recent.map((r) => el("div", { class: "line" },
      el("span", {}, `${r.review === "accepted" ? "Approved" : r.review === "rejected" ? "Rejected" : "Already fixed"} · ${r.name ?? names[r.gtin]?.[0] ?? `EAN ${r.gtin}`} · ${KIND[r.kind] ?? r.kind} · ${r.reviewed_on}`),
      el("button", { type: "button", class: "ghost small", onclick: async () => {
        try { await api("decide", { method: "POST", body: JSON.stringify({ ids: [r.id], review: "new" }) }); loadCorrections(); }
        catch (err) { failed(list, err, loadDecided); }
      } }, "Undo"))) : [el("p", { class: "muted" }, "Nothing decided in the last 7 days.")]));
  } catch (err) {
    failed(list, err, loadDecided);
  }
}

// ---------- Costs ----------

let costsLoaded = false;
let days = 30;
const KINDS = { line: "Typed or said food", voice: "Voice command", plate: "Plate or pack photo", label: "Label photo",
  lookup: "Product pick", piece: "Piece weight", unit: "Usual unit", link: "My Foods link", activity: "Activity",
  name: "Name translation", other: "Other" };
const usd = (cents) => cents === 0 ? "$0" : `$${(cents / 100).toFixed(cents >= 1000 ? 2 : cents >= 1 ? 3 : 4)}`;
const int = (n) => Number(n).toLocaleString("en-US");

for (const b of document.querySelectorAll(".seg button")) {
  b.addEventListener("click", () => {
    days = Number(b.dataset.days);
    for (const o of document.querySelectorAll(".seg button")) o.setAttribute("aria-pressed", o === b);
    loadCosts();
  });
}

async function loadCosts() {
  const body = $("costs-body");
  body.replaceChildren(el("p", { class: "muted" }, "Loading…"));
  try {
    const { rows, today } = await api(`costs?days=${days}`);
    costsLoaded = true;
    renderCosts(rows, today);
  } catch (err) {
    failed(body, err, loadCosts);
  }
}

function renderCosts(rows, today) {
  const body = $("costs-body");
  const all = rows;
  const sum = (list, key) => list.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const cents = sum(all, "cents"), requests = sum(all, "requests");
  const active = today?.devices ?? {};
  const users = (active.free ?? 0) + (active.pro ?? 0);

  // Every day of the period, empty ones too.
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) byDay.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  for (const r of all) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.cents));
  const series = [...byDay.entries()];
  const max = Math.max(...series.map(([, c]) => c), 0);

  const label = el("p", { class: "bar-label", "aria-live": "polite" }, "Tap a bar for the day.");
  const bars = series.map(([day, c]) => {
    const bar = el("button", { type: "button", class: "bar", "aria-label": `${day}: ${usd(c)}` });
    bar.style.height = `${max ? Math.max((c / max) * 100, c ? 2 : 0.5) : 0.5}%`;
    const say = () => { label.textContent = `${day} · ${usd(c)}`; };
    bar.addEventListener("click", say);
    bar.addEventListener("focus", say);
    bar.addEventListener("mouseenter", say);
    return bar;
  });

  // Per kind: requests, tokens, cost, per request, refunded.
  const kinds = new Map();
  for (const r of all) {
    const k = kinds.get(r.kind) ?? { requests: 0, input: 0, output: 0, cents: 0, refunded: 0 };
    k.requests += r.requests; k.input += Number(r.input_tokens); k.output += Number(r.output_tokens);
    k.cents += Number(r.cents); k.refunded += r.refunded;
    kinds.set(r.kind, k);
  }
  const kindRows = [...kinds.entries()].sort((a, b) => b[1].cents - a[1].cents);

  if (!rows.length) {
    body.replaceChildren(el("p", { class: "empty" }, `No AI requests in the last ${days} days.`));
    return;
  }
  body.replaceChildren(
    el("div", { class: "tiles" },
      tile(`Cost, ${days} days`, usd(cents)),
      tile("Requests", int(requests)),
      tile("Per request", requests ? usd(cents / requests) : "–"),
      tile("Devices today", users ? `${users}${active.pro ? ` (${active.pro} Pro)` : ""}` : "0")),
    el("h3", {}, "Per day"),
    el("p", { class: "muted" }, "All plans, builds from Xcode included."),
    el("div", { class: "chart", role: "group", "aria-label": `Cost per day, highest ${usd(max)}` }, bars),
    el("div", { class: "axis" }, el("span", {}, series[0][0]), el("span", {}, `max ${usd(max)}`), el("span", {}, series.at(-1)[0])),
    label,
    el("div", { class: "table-wrap" },
      el("table", { class: "costs-table" },
        el("thead", {}, el("tr", {}, ["Kind", "Requests", "Input tok", "Output tok", "Cost", "Per req", "Refunded"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, kindRows.map(([kind, k]) => el("tr", {},
          el("th", { scope: "row" }, KINDS[kind] ?? kind), el("td", {}, int(k.requests)), el("td", {}, int(k.input)),
          el("td", {}, int(k.output)), el("td", {}, usd(k.cents)), el("td", {}, k.requests ? usd(k.cents / k.requests) : "–"),
          el("td", {}, int(k.refunded))))))),
    el("p", { class: "muted" }, ["free", "pro", "dev"].map((plan) => { const list = rows.filter((r) => r.plan === plan); return `${plan === "dev" ? "Builds from Xcode" : plan === "pro" ? "Pro" : "Free"}: ${int(sum(list, "requests"))} requests, ${usd(sum(list, "cents"))}`; }).join(" · ")),
  );
}

function tile(title, value) {
  return el("div", { class: "tile" }, el("p", {}, title), el("strong", {}, value));
}

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
