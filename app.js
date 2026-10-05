/* Resume Builder — render, edit-in-place, reorder, persist, export (PDF via print, DOCX via docx.js) */

const LS_KEY = "resume-builder-data-v1";
const HTTP_MODE = /^https?:$/.test(location.protocol);
const PARAMS = new URLSearchParams(location.search);

let data = null;

/* ---------------- persistence ----------------
   Primary store (when run via start.command / server.py): resume-data.json on disk.
   localStorage is kept as a mirror / fallback for file:// usage, where browsers
   may silently drop it — hence the warning banner in that mode. */

async function loadData() {
  if (HTTP_MODE) {
    try {
      const r = await fetch("resume-data.json", { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) { /* no saved file yet */ }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("Could not read saved data:", e); }
  return JSON.parse(JSON.stringify(window.RESUME_DATA));
}

// Fill in any keys added by newer versions of the app (saved blobs may predate them).
function migrate(d) {
  const def = window.RESUME_DATA;
  // Saves from before the Contact menu showed exactly these four; don't add new defaults to them.
  if (d.contactFields === undefined && d.contact) d.contactFields = ["email", "phone", "location", "linkedin"];
  for (const k of Object.keys(def)) if (d[k] === undefined) d[k] = JSON.parse(JSON.stringify(def[k]));
  for (const k of Object.keys(def.headings)) if (d.headings[k] === undefined) d.headings[k] = def.headings[k];
  d.settings = Object.assign({ ats: false }, d.settings);
  normalizeSections(d);
  normalizeContact(d);
  return d;
}

// Every known section must appear exactly once across left/right; unknown keys are dropped.
function normalizeSections(d) {
  const known = Object.keys(window.RESUME_DATA.headings);
  const seen = new Set();
  const order = d.sectionOrder && typeof d.sectionOrder === "object" ? d.sectionOrder : {};
  const clean = (list) => (Array.isArray(list) ? list : []).filter((k) => {
    if (!known.includes(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  d.sectionOrder = { left: clean(order.left), right: clean(order.right) };
  for (const k of known) if (!seen.has(k)) d.sectionOrder.right.push(k);
  d.hiddenSections = [...new Set(Array.isArray(d.hiddenSections) ? d.hiddenSections : [])].filter((k) => known.includes(k));
}

// contactFields lists the shown contact items in order: known keys, or custom keys that have a value slot.
function normalizeContact(d) {
  if (!d.contact || typeof d.contact !== "object") d.contact = {};
  const seen = new Set();
  d.contactFields = (Array.isArray(d.contactFields) ? d.contactFields : []).filter((k) => {
    if (seen.has(k) || !(CONTACT_FIELDS[k] || (isCustomContact(k) && k in d.contact))) return false;
    seen.add(k);
    return true;
  });
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

function saveNow() {
  clearTimeout(saveTimer);
  if (!data) return;
  const json = JSON.stringify(data);
  let lsOk = false;
  try { localStorage.setItem(LS_KEY, json); lsOk = true; } catch (e) { /* storage blocked/full */ }
  if (HTTP_MODE) {
    fetch("save", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true })
      .then((r) => flashStatus(r.ok ? "Saved to file ✓" : "FILE SAVE FAILED", !r.ok))
      .catch(() => flashStatus("FILE SAVE FAILED — is server.py still running?", true));
  } else {
    flashStatus(lsOk ? "Saved in browser" : "SAVE FAILED — use start.command", !lsOk);
  }
}

// Never let edits slip away: flush before printing, hiding, or leaving the page.
window.addEventListener("beforeprint", saveNow);
window.addEventListener("beforeunload", saveNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
});

let statusTimer = null;
function flashStatus(msg, isError = false) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.textContent = ""), isError ? 6000 : 1800);
}

/* ---------------- path helpers ---------------- */

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setByPath(obj, path, val) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.length ? getByPath(obj, parts.join(".")) : obj;
  if (parent != null) parent[last] = val;
}
function arrayAt(path) {
  const parts = path.split(".");
  const idx = Number(parts.pop());
  return { arr: getByPath(data, parts.join(".")), idx };
}

/* ---------------- sanitizing ---------------- */

// <a> is allowed too, but keeps only an href with a safe scheme, and never nests.
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "A"]);
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild;
  (function clean(node, inLink) {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 1) {
        const href = n.tagName === "A" && !inLink ? safeHref(n.getAttribute("href")) : "";
        clean(n, inLink || !!href);
        if (!ALLOWED_TAGS.has(n.tagName) || (n.tagName === "A" && !href)) {
          while (n.firstChild) node.insertBefore(n.firstChild, n);
          n.remove();
        } else {
          [...n.attributes].forEach((a) => n.removeAttribute(a.name));
          if (href) n.setAttribute("href", href);
        }
      } else if (n.nodeType !== 3) {
        n.remove();
      }
    });
  })(root, false);
  return root.innerHTML;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------------- links ---------------- */

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PHONE_RE = /^\+?[\d\s().-]{6,}$/;
const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/i;

function safeHref(href) {
  const h = String(href || "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(h) ? h : "";
}

// Turn what someone typed or pasted ("github.com/me", "me@x.com", "+1 555 0100") into a link; "" if it can't be one.
function normalizeUrl(input) {
  const t = String(input || "").trim();
  if (!t) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(t)) return t;
  if (EMAIL_RE.test(t)) return "mailto:" + t;
  if (PHONE_RE.test(t)) return "tel:" + t.replace(/[^\d+]/g, "");
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return "";  // another scheme (javascript:, ftp:, …)
  return "https://" + t.replace(/^\/+/, "");
}

// The link a contact item's plain text implies. kind: email | phone | url | text | auto (guess).
function linkFor(text, kind = "auto") {
  const t = text.trim();
  if (!t || kind === "text") return "";
  if (kind === "email" || (kind === "auto" && EMAIL_RE.test(t))) return EMAIL_RE.test(t) ? "mailto:" + t : "";
  if (kind === "phone" || (kind === "auto" && PHONE_RE.test(t))) {
    return t.replace(/\D/g, "").length >= 5 ? "tel:" + t.replace(/[^\d+]/g, "") : "";
  }
  return URL_RE.test(t) ? normalizeUrl(t) : "";
}

/* ---------------- icons ---------------- */

const ICONS = {
  email: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M6.6 10.8a15.9 15.9 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  location: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#0a66c2"/><path fill="#fff" d="M7.1 9.2H4.6V19h2.5V9.2zM5.8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM19.4 13.6c0-2.7-1.5-4.6-3.9-4.6-1.3 0-2.2.7-2.6 1.5V9.2h-2.5V19h2.5v-5.2c0-1.2.6-2.1 1.8-2.1 1.1 0 1.7.8 1.7 2.1V19h2.5v-5.4h.5z"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`
};

// Contact-bar glyphs: line icons for generic things, letter badges for brands (one consistent, recolour-free style).
const lineIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="#3d4145" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const badge = (t, size = t.length > 1 ? 11 : 14) =>
  `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#3d4145"/><text x="12" y="${12 + size * 0.36}" text-anchor="middle" font-family="Lato, Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff">${t}</text></svg>`;

Object.assign(ICONS, {
  website: lineIcon(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>`),
  portfolio: lineIcon(`<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>`),
  blog: lineIcon(`<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>`),
  github: `<svg viewBox="0 0 16 16" fill="#3d4145"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`,
  gitlab: badge("GL"),
  stackoverflow: badge("SO"),
  kaggle: badge("k"),
  leetcode: badge("LC"),
  huggingface: badge("HF"),
  behance: badge("Bē"),
  dribbble: badge("Dr"),
  artstation: badge("AS"),
  youtube: `<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="5" fill="#3d4145"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>`,
  instagram: lineIcon(`<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".4"/>`),
  imdb: badge("IMDb", 7.5),
  orcid: badge("iD"),
  scholar: lineIcon(`<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v5"/>`),
  researchgate: badge("RG"),
  x: badge("X"),
  bluesky: badge("bs"),
  availability: lineIcon(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  workauth: lineIcon(`<path d="M6 3h9l4 4v14H6z"/><path d="M9 14l2 2 4-4"/>`),
  relocation: lineIcon(`<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>`),
  license: lineIcon(`<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.5 1.8-2.2 3-2.2s2.4.7 3 2.2M15 10h3M15 14h3"/>`),
  clearance: lineIcon(`<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>`),
  driving: lineIcon(`<path d="M3 13l2-6h14l2 6v5H3z"/><path d="M3 13h18"/><circle cx="7" cy="15.5" r=".6"/><circle cx="17" cy="15.5" r=".6"/>`),
  pronouns: lineIcon(`<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/>`),
  nationality: lineIcon(`<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`),
  dob: lineIcon(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  customLink: lineIcon(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  customText: lineIcon(`<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>`)
});

/* ---------------- contact fields ----------------
   data.contact holds the values (kept while a field is unticked); data.contactFields the shown keys, in order.
   kind decides the automatic link: email → mailto:, phone → tel:, url → https://, text → none.
   Custom items (custom1, custom2, …) guess their link from the text. */

const CONTACT_GROUPS = ["Basics", "Profiles & portfolio", "Code & data", "Creative & media", "Academic", "Social", "Other details"];
const CONTACT_FIELDS = {
  email:         { label: "Email", group: "Basics", kind: "email", ph: "you@example.com" },
  phone:         { label: "Phone", group: "Basics", kind: "phone", ph: "+1 555 0100" },
  location:      { label: "Location", group: "Basics", kind: "text", ph: "City, Country" },
  website:       { label: "Website", group: "Basics", kind: "url", ph: "yourname.com" },
  linkedin:      { label: "LinkedIn", group: "Profiles & portfolio", kind: "url", ph: "linkedin.com/in/username" },
  portfolio:     { label: "Portfolio", group: "Profiles & portfolio", kind: "url", ph: "yourportfolio.com" },
  blog:          { label: "Blog / Newsletter", group: "Profiles & portfolio", kind: "url", ph: "yourblog.com" },
  github:        { label: "GitHub", group: "Code & data", kind: "url", ph: "github.com/username" },
  gitlab:        { label: "GitLab", group: "Code & data", kind: "url", ph: "gitlab.com/username" },
  stackoverflow: { label: "Stack Overflow", group: "Code & data", kind: "url", ph: "stackoverflow.com/users/…" },
  kaggle:        { label: "Kaggle", group: "Code & data", kind: "url", ph: "kaggle.com/username" },
  leetcode:      { label: "LeetCode", group: "Code & data", kind: "url", ph: "leetcode.com/u/username" },
  huggingface:   { label: "Hugging Face", group: "Code & data", kind: "url", ph: "huggingface.co/username" },
  behance:       { label: "Behance", group: "Creative & media", kind: "url", ph: "behance.net/username" },
  dribbble:      { label: "Dribbble", group: "Creative & media", kind: "url", ph: "dribbble.com/username" },
  artstation:    { label: "ArtStation", group: "Creative & media", kind: "url", ph: "artstation.com/username" },
  youtube:       { label: "YouTube", group: "Creative & media", kind: "url", ph: "youtube.com/@channel" },
  imdb:          { label: "IMDb", group: "Creative & media", kind: "url", ph: "imdb.com/name/nm…" },
  orcid:         { label: "ORCID", group: "Academic", kind: "url", ph: "orcid.org/0000-0000-0000-0000" },
  scholar:       { label: "Google Scholar", group: "Academic", kind: "url", ph: "Google Scholar (select it to add the link)" },
  researchgate:  { label: "ResearchGate", group: "Academic", kind: "url", ph: "researchgate.net/profile/…" },
  x:             { label: "X / Twitter", group: "Social", kind: "url", ph: "x.com/username" },
  bluesky:       { label: "Bluesky", group: "Social", kind: "url", ph: "username.bsky.social" },
  instagram:     { label: "Instagram", group: "Social", kind: "url", ph: "instagram.com/username" },
  availability:  { label: "Availability / notice", group: "Other details", kind: "text", ph: "Available: immediately" },
  workauth:      { label: "Work authorization / visa", group: "Other details", kind: "text", ph: "Work authorization: US citizen" },
  relocation:    { label: "Relocation / remote", group: "Other details", kind: "text", ph: "Open to relocation" },
  license:       { label: "License / registration no.", group: "Other details", kind: "text", ph: "License: RN #123456" },
  clearance:     { label: "Security clearance", group: "Other details", kind: "text", ph: "Clearance: Secret" },
  driving:       { label: "Driving licence", group: "Other details", kind: "text", ph: "Driving licence: full (B)" },
  pronouns:      { label: "Pronouns", group: "Other details", kind: "text", ph: "they/them" },
  nationality:   { label: "Nationality", group: "Other details", kind: "text", ph: "Nationality: …" },
  dob:           { label: "Date of birth", group: "Other details", kind: "text", ph: "Date of birth: DD/MM/YYYY" }
};

function isCustomContact(key) {
  return /^custom\d+$/.test(key);
}
function contactField(key) {
  return CONTACT_FIELDS[key] || { label: "Custom item", group: "Custom", kind: "auto", ph: "Anything: a link, a handle, a detail" };
}
function contactLabel(key) {
  if (!isCustomContact(key)) return contactField(key).label;
  const t = htmlToText(data.contact[key] || "").trim();
  return t ? (t.length > 28 ? t.slice(0, 27) + "…" : t) : "Custom item";
}
// No automatic link when the text already carries its own (an inline link someone added).
function contactHref(key) {
  const v = data.contact[key] || "";
  return /<a\s/i.test(v) ? "" : linkFor(htmlToText(v), contactField(key).kind);
}
function contactIcon(key) {
  if (!isCustomContact(key)) return ICONS[key] || ICONS.customText;
  return contactHref(key) ? ICONS.customLink : ICONS.customText;
}

/* ---------------- building blocks ---------------- */

function isAts() {
  if (PARAMS.has("ats")) return PARAMS.get("ats") !== "0";
  return !!(data.settings && data.settings.ats);
}

// ph: a screen-only hint shown while the field is empty.
function ed(path, cls = "", tag = "div", ph = "") {
  const v = getByPath(data, path) ?? "";
  return `<${tag} class="${cls}" contenteditable="true" spellcheck="false" data-path="${path}"${ph ? ` data-ph="${esc(ph)}"` : ""}>${v}</${tag}>`;
}

// Control cluster: move up/down (or left/right) + optional delete.
// Lives INSIDE the item's box; shown on hover and always in Arrange mode.
function ctl(path, opts = {}) {
  const { horizontal = false, del = true } = opts;
  const up = horizontal ? "‹" : "↑";
  const down = horizontal ? "›" : "↓";
  const upTitle = horizontal ? "Move left" : "Move up";
  const downTitle = horizontal ? "Move right" : "Move down";
  return `<span class="ctl" contenteditable="false">
    <button class="mv" data-move="-1" data-path="${path}" title="${upTitle}" tabindex="-1">${up}</button>
    <button class="mv" data-move="1" data-path="${path}" title="${downTitle}" tabindex="-1">${down}</button>
    ${del ? `<button class="rm" data-del="${path}" title="Remove" tabindex="-1">×</button>` : ""}
  </span>`;
}

function linkIcon(path) {
  const url = getByPath(data, path) || "";
  return `<a class="linkicon ${url ? "" : "unset"}" data-urlpath="${path}" ${
    url ? `href="${esc(url)}" target="_blank"` : ""
  } title="${url ? esc(url) + " (alt-click to change)" : "Click to set link"}">${ICONS.external}</a>`;
}

function addBtn(kind, target, label) {
  return `<button class="add-btn" data-add="${kind}" data-target="${target}">${label}</button>`;
}

function bulletLi(path) {
  return `<li class="item">${ctl(path)}<span class="bmark" contenteditable="false">–</span>${ed(path, "btxt")}</li>`;
}

/* ---------------- section renderers ---------------- */

const SECTION_BODY = {
  experience() {
    return data.experience.map((e, i) => `
      <div class="entry item">
        ${ctl(`experience.${i}`)}
        ${ed(`experience.${i}.role`, "entry-title")}
        <div class="org-line">${ed(`experience.${i}.org`, "org", "span")}${linkIcon(`experience.${i}.url`)}</div>
        <div class="meta">${ed(`experience.${i}.dates`, "", "span")}${ed(`experience.${i}.location`, "", "span")}</div>
        ${ed(`experience.${i}.label`, "bullets-label")}
        <ul class="bullets">${e.bullets.map((b, j) => bulletLi(`experience.${i}.bullets.${j}`)).join("")}</ul>
        ${addBtn("bullet", `experience.${i}.bullets`, "+ bullet")}
      </div>`).join("") + addBtn("experience", "experience", "+ Add position");
  },

  education() {
    return data.education.map((e, i) => `
      <div class="entry item">
        ${ctl(`education.${i}`)}
        ${ed(`education.${i}.degree`, "entry-title")}
        <div class="org-line">${ed(`education.${i}.school`, "org", "span")}</div>
        <div class="meta">${ed(`education.${i}.dates`, "", "span")}${ed(`education.${i}.meta`, "", "span")}</div>
        ${ed(`education.${i}.label`, "bullets-label")}
        <ul class="bullets">${e.bullets.map((b, j) => bulletLi(`education.${i}.bullets.${j}`)).join("")}</ul>
        ${addBtn("bullet", `education.${i}.bullets`, "+ bullet")}
      </div>`).join("") + addBtn("education", "education", "+ Add education");
  },

  skills() {
    return `<div class="pill-wrap">${data.skills
      .map((s, i) => `<span class="pill item">${ctl(`skills.${i}`, { horizontal: true })}${ed(`skills.${i}`, "", "span")}</span>`)
      .join("")}</div>` + addBtn("skill", "skills", "+ skill");
  },

  projects() {
    return data.projects.map((p, i) => `
      <div class="project item">
        ${ctl(`projects.${i}`)}
        <div class="org-line">${ed(`projects.${i}.name`, "project-name", "span")}${linkIcon(`projects.${i}.url`)}</div>
        <ul class="bullets">${p.bullets.map((b, j) => bulletLi(`projects.${i}.bullets.${j}`)).join("")}</ul>
        ${addBtn("bullet", `projects.${i}.bullets`, "+ bullet")}
      </div>`).join("") + addBtn("project", "projects", "+ Add project");
  },

  achievements() {
    return data.achievements.map((a, i) => `
      <div class="achievement item">
        ${ctl(`achievements.${i}`)}
        ${ed(`achievements.${i}.title`, "achievement-title")}
        ${ed(`achievements.${i}.desc`, "achievement-desc")}
      </div>`).join("") + addBtn("achievement", "achievements", "+ Add achievement");
  },

  languages() {
    if (isAts()) {
      return data.languages.map((l, i) => `
        <div class="lang-line item">
          ${ctl(`languages.${i}`)}
          ${ed(`languages.${i}.name`, "lang-name", "span")}<span class="sep"> — </span>${ed(`languages.${i}.level`, "lang-level", "span")}
        </div>`).join("") + addBtn("language", "languages", "+ language");
    }
    return `<div class="lang-grid">${data.languages.map((l, i) => `
      <div class="lang item">
        ${ctl(`languages.${i}`)}
        ${ed(`languages.${i}.name`, "lang-name")}
        ${ed(`languages.${i}.level`, "lang-level")}
      </div>`).join("")}</div>` + addBtn("language", "languages", "+ language");
  },

  interests() {
    if (isAts()) {
      return `<div class="skills-line">${data.interests
        .map((s, i) => `<span class="inline-item item">${ctl(`interests.${i}`, { horizontal: true })}${ed(`interests.${i}`, "", "span")}</span>`)
        .join(`<span class="sep">, </span>`)}</div>` + addBtn("interest", "interests", "+ interest");
    }
    return `<div class="pill-wrap">${data.interests
      .map((s, i) => `<span class="pill outline item">${ctl(`interests.${i}`, { horizontal: true })}${ed(`interests.${i}`, "", "span")}</span>`)
      .join("")}</div>` + addBtn("interest", "interests", "+ interest");
  }
};

/* ---------------- section ops ----------------
   Hidden sections keep their slot in sectionOrder so re-showing restores them in place. */

function isHidden(key) {
  return data.hiddenSections.includes(key);
}
function setHidden(key, hidden) {
  data.hiddenSections = data.hiddenSections.filter((k) => k !== key);
  if (hidden) data.hiddenSections.push(key);
}
function colOf(key) {
  return data.sectionOrder.left.includes(key) ? "left" : "right";
}
function visibleSections(col) {
  return data.sectionOrder[col].filter((k) => SECTION_BODY[k] && !isHidden(k));
}

// Move a section one step up (-1) or down (1).
// skipHidden: step past hidden neighbours (on the page they're invisible, so swapping with one looks like a no-op).
// cross: at the end of a column, carry the section into the other one (left flows into right).
function moveSection(key, dir, { skipHidden = false, cross = false } = {}) {
  const col = colOf(key);
  const arr = data.sectionOrder[col];
  const i = arr.indexOf(key);
  let j = i + dir;
  while (skipHidden && j >= 0 && j < arr.length && isHidden(arr[j])) j += dir;
  if (j >= 0 && j < arr.length) {
    arr.splice(i, 1);
    arr.splice(j, 0, key);
    return true;
  }
  if (!cross) return false;
  if (dir === 1 && col === "left") {
    arr.splice(i, 1);
    data.sectionOrder.right.unshift(key);
    return true;
  }
  if (dir === -1 && col === "right") {
    arr.splice(i, 1);
    data.sectionOrder.left.push(key);
    return true;
  }
  return false;
}

// Send a section to the bottom of the other column.
function switchColumn(key) {
  const from = colOf(key);
  const to = from === "left" ? "right" : "left";
  data.sectionOrder[from] = data.sectionOrder[from].filter((k) => k !== key);
  data.sectionOrder[to].push(key);
}

function sectionLabel(key) {
  return htmlToText(data.headings[key] || key).trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Heading control: ↑ ↓ plus a column switch in the 2-col layout (in ATS, ↑ ↓ already cross the left/right boundary).
function sectionCtl(key, col) {
  const sw = isAts() ? "" : col === "left"
    ? `<button class="sec-sw" data-key="${key}" title="Move to right column" tabindex="-1">→</button>`
    : `<button class="sec-sw" data-key="${key}" title="Move to left column" tabindex="-1">←</button>`;
  return `<span class="ctl" contenteditable="false">
    <button class="sec-mv" data-move="-1" data-key="${key}" title="Move section up" tabindex="-1">↑</button>
    <button class="sec-mv" data-move="1" data-key="${key}" title="Move section down" tabindex="-1">↓</button>
    ${sw}
  </span>`;
}

function renderSection(key, col) {
  if (!SECTION_BODY[key]) return "";
  return `
    <div class="section">
      <div class="section-head item">
        ${sectionCtl(key, col)}
        ${ed(`headings.${key}`, "section-title", "h2")}
      </div>
      ${SECTION_BODY[key]()}
    </div>`;
}

/* ---------------- render ---------------- */

function render() {
  const ats = isAts();
  const page = document.getElementById("page");
  // The browser uses the title as the default "Save as PDF" file name.
  const person = htmlToText(data.name).trim();
  document.title = person ? `Resume Builder — ${person}` : "Resume Builder";
  page.classList.toggle("ats", ats);

  const photo = data.photo
    ? `<img src="${data.photo}" alt="">`
    : `<div class="photo-placeholder">Click to add photo</div>`;

  const headerPhoto = ats ? "" : `
    <div class="photo-wrap" id="photoWrap" title="Click to change photo">
      ${photo}
      <div class="photo-overlay">Change<br>photo</div>
    </div>`;

  // Each item is wrapped in its implied link (mailto:/tel:/https://) so it's clickable in the PDF.
  // A value that already holds an inline link gets a plain wrapper: <a> can't nest.
  // ATS "|" separators come from CSS, so empty items (hidden in print) don't leave stray ones.
  const contactItems = data.contactFields.map((k) => {
    const v = data.contact[k] || "";
    const href = contactHref(k);
    const wrap = /<a\s/i.test(v) ? "span" : "a";
    return `<span class="citem${htmlToText(v).trim() ? "" : " empty"}">${ats ? "" : contactIcon(k)}<${wrap} class="clink"${
      href ? ` href="${esc(href)}"` : ""}>${ed(`contact.${k}`, "", "span", contactField(k).ph)}</${wrap}></span>`;
  }).join("");

  const leftKeys = visibleSections("left");
  const rightKeys = visibleSections("right");
  const leftSections = leftKeys.map((k) => renderSection(k, "left")).join("");
  const rightSections = rightKeys.map((k) => renderSection(k, "right")).join("");

  // An empty column gives its width to the other instead of leaving a blank gutter.
  const oneSided = !leftKeys.length || !rightKeys.length;
  const columns = ats
    ? `<div class="col-single">${leftSections}${rightSections}</div>`
    : `<div class="columns${oneSided ? " single" : ""}">
        ${leftKeys.length ? `<div class="col-left">${leftSections}</div>` : ""}
        ${rightKeys.length ? `<div class="col-right">${rightSections}</div>` : ""}
      </div>`;

  page.innerHTML = `
    <div class="header">
      ${headerPhoto}
      <div class="header-text">
        ${ed("name", "name", "h1")}
        ${ed("title", "job-title")}
        ${ed("summary", "summary")}
      </div>
    </div>
    <div class="contact">${contactItems}</div>
    ${columns}`;

  updateToolbar();
}

function updateToolbar() {
  const ats = isAts();
  document.getElementById("btnLayout").textContent = ats ? "Layout: ATS (1 col)" : "Layout: Original (2 col)";
  document.getElementById("btnArrange").classList.toggle("active", document.body.classList.contains("arrange"));
  document.getElementById("btnSections").classList.toggle("active", !document.getElementById("sectionsPanel").hidden);
  document.getElementById("btnContact").classList.toggle("active", !document.getElementById("contactPanel").hidden);
  renderSectionsPanel();
  renderContactPanel();
  const note = document.getElementById("modeNote");
  if (HTTP_MODE) {
    note.textContent = "Auto-saving to resume-data.json";
    note.classList.remove("warn");
  } else {
    note.textContent = "⚠ Opened from disk — edits may not survive a browser restart. Double-click start.command for reliable file saving.";
    note.classList.add("warn");
  }
}

// Toolbar "Sections" panel: show/hide, reorder and switch columns for every section.
function renderSectionsPanel() {
  const ats = isAts();
  const group = (col) => {
    const keys = data.sectionOrder[col].filter((k) => SECTION_BODY[k]);
    const title = ats
      ? (col === "left" ? "Prints first" : "Prints second")
      : (col === "left" ? "Left column" : "Right column");
    const arrow = col === "left" ? "→" : "←";
    const swTitle = col === "left" ? (ats ? "Move to second half" : "Move to right column") : (ats ? "Move to first half" : "Move to left column");
    const rows = keys.map((k) => {
      const hidden = isHidden(k);
      return `
        <div class="sp-row${hidden ? " is-hidden" : ""}">
          <label><input type="checkbox" data-op="toggle" data-key="${k}" ${hidden ? "" : "checked"}> ${esc(sectionLabel(k))}</label>
          <button data-op="up" data-key="${k}" title="Move up">↑</button>
          <button data-op="down" data-key="${k}" title="Move down">↓</button>
          <button data-op="switch" data-key="${k}" title="${swTitle}">${arrow}</button>
        </div>`;
    }).join("");
    return `
      <div class="sp-group">
        <div class="sp-head">${title}</div>
        ${rows || `<div class="sp-empty">(empty) — move a section here</div>`}
      </div>`;
  };
  document.getElementById("sectionsPanel").innerHTML =
    group("left") + group("right") +
    (ats ? `<div class="sp-note">ATS layout is a single column: the first group prints above the second.</div>` : "") +
    `<div class="sp-note">Unchecked sections are hidden, not deleted — their content is kept.</div>`;
}

// Toolbar "Contact" panel: shown items in order (reorderable), then everything else by group, ready to tick.
function renderContactPanel() {
  const ico = (k) => `<span class="sp-ico">${contactIcon(k)}</span>`;
  const shown = data.contactFields.map((k) => `
    <div class="sp-row">
      <label><input type="checkbox" data-op="toggle" data-key="${k}" checked> ${ico(k)} ${esc(contactLabel(k))}</label>
      <button data-op="up" data-key="${k}" title="Move left">↑</button>
      <button data-op="down" data-key="${k}" title="Move right">↓</button>
    </div>`).join("");
  const off = (k) => `
    <div class="sp-row">
      <label><input type="checkbox" data-op="toggle" data-key="${k}"> ${ico(k)} ${esc(contactLabel(k))}</label>
      ${isCustomContact(k) ? `<button data-op="delete" data-key="${k}" title="Delete this custom item">×</button>` : ""}
    </div>`;
  const groups = [...CONTACT_GROUPS, "Custom"].map((g) => {
    const keys = g === "Custom"
      ? Object.keys(data.contact).filter((k) => isCustomContact(k) && !data.contactFields.includes(k))
      : Object.keys(CONTACT_FIELDS).filter((k) => CONTACT_FIELDS[k].group === g && !data.contactFields.includes(k));
    return keys.length ? `<div class="sp-sub">${g}</div><div class="sp-grid">${keys.map(off).join("")}</div>` : "";
  }).join("");
  document.getElementById("contactPanel").innerHTML = `
    <div class="sp-group">
      <div class="sp-head">Shown (in order)</div>
      ${shown || `<div class="sp-empty">(none) — tick something below</div>`}
    </div>
    <div class="sp-group">
      <div class="sp-head">Add more</div>
      ${groups}
      <button class="sp-add" data-op="custom">+ Custom item</button>
    </div>
    <div class="sp-note">Unticked items keep what you typed. Emails, phone numbers and web addresses become clickable links in the PDF and DOCX.</div>`;
}

/* ---------------- templates for "add" ---------------- */

const TEMPLATES = {
  bullet: () => "New bullet point",
  skill: () => "New Skill",
  interest: () => "New Interest",
  language: () => ({ name: "Language", level: "Proficiency" }),
  achievement: () => ({ title: "Achievement title (MM/YYYY)", desc: "Short description." }),
  project: () => ({ name: "Project name", url: "", bullets: ["What you built and what it does."] }),
  experience: () => ({
    role: "Job Title",
    org: "Company",
    url: "",
    dates: "MM/YYYY - MM/YYYY",
    location: "City, Country",
    label: "Responsibilities",
    bullets: ["What you did."]
  }),
  education: () => ({
    degree: "Degree - Major",
    school: "University",
    dates: "MM/YYYY - MM/YYYY",
    meta: "",
    label: "Achievements",
    bullets: ["Notable achievement."]
  })
};

/* ---------------- events ---------------- */

const pageEl = document.getElementById("page");

pageEl.addEventListener("input", (e) => {
  const el = e.target.closest("[contenteditable]");
  if (!el || !el.dataset.path || !data) return;
  // A cleared field often keeps a stray <br>; drop it so the :empty placeholder shows again.
  if (el.dataset.ph && !el.textContent.trim() && el.innerHTML) el.innerHTML = "";
  setByPath(data, el.dataset.path, sanitizeHtml(el.innerHTML));
  if (el.closest(".citem")) syncContactItem(el);
  saveSoon();
});

// Text edits don't re-render, so keep a contact item's empty state and implied link current as you type.
function syncContactItem(el) {
  const key = el.dataset.path.split(".")[1];
  el.closest(".citem").classList.toggle("empty", !el.textContent.trim());
  const wrap = el.closest(".clink");
  const href = contactHref(key);
  if (href) wrap.setAttribute("href", href);
  else wrap.removeAttribute("href");
}

// Paste as plain text so outside formatting doesn't leak in. Pasting a lone URL over selected text links it.
pageEl.addEventListener("paste", (e) => {
  if (!e.target.closest("[contenteditable]")) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  const t = text.trim();
  const ctx = selectionCtx();
  if (ctx && !ctx.collapsed && (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(t) || URL_RE.test(t) || EMAIL_RE.test(t))) {
    const url = normalizeUrl(t);
    if (url) {
      linkSelection(ctx, url);
      return;
    }
  }
  document.execCommand("insertText", false, text);
});

pageEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
    const ctx = selectionCtx();
    if (!ctx) return;
    e.preventDefault();
    if (ctx.collapsed && !ctx.anchor) flashStatus("Select the text you want to link first");
    else openLinkInput(ctx);
  }
});

pageEl.addEventListener("click", (e) => {
  if (!data) return;

  // Links in editable text don't navigate (a click is for placing the caret); Cmd/Ctrl-click opens them.
  const a = e.target.closest("a[href]");
  if (a && !a.classList.contains("linkicon")) {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) window.open(a.href, "_blank", "noopener");
    return;
  }

  const secMv = e.target.closest(".sec-mv");
  if (secMv) {
    // On the page hidden sections are invisible, so step past them; in ATS the page is one flow, so cross columns.
    if (moveSection(secMv.dataset.key, Number(secMv.dataset.move), { skipHidden: true, cross: isAts() })) {
      render();
      saveSoon();
    }
    return;
  }

  const secSw = e.target.closest(".sec-sw");
  if (secSw) {
    switchColumn(secSw.dataset.key);
    render();
    saveSoon();
    flashStatus(`${sectionLabel(secSw.dataset.key)} moved to ${colOf(secSw.dataset.key)} column`);
    return;
  }

  const mv = e.target.closest(".mv");
  if (mv) {
    const { arr, idx } = arrayAt(mv.dataset.path);
    const ni = idx + Number(mv.dataset.move);
    if (Array.isArray(arr) && ni >= 0 && ni < arr.length) {
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      render();
      saveSoon();
    }
    return;
  }

  const rm = e.target.closest(".rm");
  if (rm) {
    const { arr, idx } = arrayAt(rm.dataset.del);
    if (Array.isArray(arr)) {
      arr.splice(idx, 1);
      render();
      saveSoon();
    }
    return;
  }

  const add = e.target.closest(".add-btn");
  if (add) {
    const arr = getByPath(data, add.dataset.target);
    if (Array.isArray(arr)) {
      arr.push(TEMPLATES[add.dataset.add]());
      render();
      saveSoon();
    }
    return;
  }

  const link = e.target.closest(".linkicon");
  if (link) {
    const path = link.dataset.urlpath;
    const current = getByPath(data, path) || "";
    if (!current || e.altKey) {
      e.preventDefault();
      const url = prompt("Link URL (leave empty to remove):", current);
      if (url !== null) {
        setByPath(data, path, url.trim());
        render();
        saveSoon();
      }
    }
    return;
  }

  if (e.target.closest("#photoWrap")) {
    document.getElementById("photoInput").click();
  }
});

document.getElementById("photoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    data.photo = reader.result;
    render();
    saveNow();
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

/* ---------------- format bubble ----------------
   Selecting text pops up B / I / Link; with the caret in a link it offers open / edit / remove.
   Also: Cmd/Ctrl+K links the selection, pasting a URL over a selection links it, Cmd/Ctrl-click opens a link. */

const bubble = document.createElement("div");
bubble.id = "fmtBubble";
bubble.hidden = true;
document.body.appendChild(bubble);
let bubbleMode = null;  // "format" | "link" | "input"
let bubbleCtx = null;   // { host, range, anchor, collapsed }

// The current selection, if it sits inside exactly one bound editable on the page.
function selectionCtx() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const elNode = node.nodeType === 1 ? node : node.parentElement;
  const host = elNode && elNode.closest("#page [contenteditable][data-path]");
  if (!host) return null;
  const a = elNode.closest("a");
  return { host, range: range.cloneRange(), anchor: a && host.contains(a) ? a : null, collapsed: range.collapsed };
}

function hideBubble() {
  bubble.hidden = true;
  bubbleMode = bubbleCtx = null;
}

function showBubble(mode, ctx) {
  const same = mode === bubbleMode && bubbleCtx && ctx.anchor === bubbleCtx.anchor;
  bubbleMode = mode;
  bubbleCtx = ctx;
  if (!same) {
    const href = ctx.anchor ? ctx.anchor.getAttribute("href") : "";
    const shown = href.replace(/^(https?:\/\/|mailto:|tel:)/i, "").replace(/\/$/, "");
    bubble.innerHTML = mode === "format" ? `
      <button data-cmd="bold" title="Bold (Cmd/Ctrl+B)"><b>B</b></button>
      <button data-cmd="italic" title="Italic (Cmd/Ctrl+I)"><i>I</i></button>
      <span class="fb-sep"></span>
      <button data-cmd="link" title="Add a link (Cmd/Ctrl+K)">${ICONS.link} Link</button>`
    : mode === "link" ? `
      <a class="fb-url" href="${esc(href)}" target="_blank" rel="noopener" title="Open ${esc(href)} (or Cmd/Ctrl-click the text)">${ICONS.external} ${esc(shown)}</a>
      <span class="fb-sep"></span>
      <button data-cmd="edit" title="Change the link (Cmd/Ctrl+K)">Edit</button>
      <button data-cmd="unlink" title="Remove the link, keep the text">Remove</button>`
    : `
      <input class="fb-input" type="text" spellcheck="false" placeholder="Paste a link: web address, email or phone" value="${esc(href)}">
      <button data-cmd="apply" class="fb-primary" title="Apply (Enter)">Apply</button>
      ${ctx.anchor ? `<button data-cmd="unlink" title="Remove the link, keep the text">Remove</button>` : ""}`;
  }
  bubble.hidden = false;
  placeBubble(ctx);
}

// Above the selection (below it when the toolbar is in the way), clamped to the viewport.
function placeBubble(ctx) {
  let r = ctx.anchor ? ctx.anchor.getBoundingClientRect() : ctx.range.getBoundingClientRect();
  if (!r.width && !r.height) r = (ctx.anchor || ctx.host).getBoundingClientRect();
  const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const toolbarBottom = document.getElementById("toolbar").getBoundingClientRect().bottom;
  const top = r.top - h - 8 > toolbarBottom ? r.top - h - 8 : r.bottom + 8;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
  bubble.style.top = `${top + window.scrollY}px`;
  bubble.style.left = `${left + window.scrollX}px`;
}

document.addEventListener("selectionchange", () => {
  if (bubbleMode === "input") return;  // the URL box has focus; keep the saved selection
  const ctx = selectionCtx();
  if (!ctx || (!ctx.anchor && (ctx.collapsed || !ctx.range.toString().trim()))) return hideBubble();
  showBubble(ctx.anchor ? "link" : "format", ctx);
});

function openLinkInput(ctx) {
  showBubble("input", ctx);
  const input = bubble.querySelector(".fb-input");
  input.focus();
  input.select();
}

function restoreSelection(ctx) {
  ctx.host.focus();
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(ctx.range);
}

// Ends in the page's input listener, which sanitizes and saves the change.
function commitEdit(host) {
  host.dispatchEvent(new Event("input", { bubbles: true }));
}

function linkSelection(ctx, url) {
  restoreSelection(ctx);
  document.execCommand("createLink", false, url);  // undoable with Cmd/Ctrl+Z
}

function removeLink(ctx) {
  const a = ctx.anchor;
  const parent = a.parentNode;
  while (a.firstChild) parent.insertBefore(a.firstChild, a);
  a.remove();
  hideBubble();
  commitEdit(ctx.host);
}

function applyLink() {
  const ctx = bubbleCtx;
  const raw = bubble.querySelector(".fb-input").value;
  const url = normalizeUrl(raw);
  if (raw.trim() && !url) {
    flashStatus("Links must be a web address, email or phone number", true);
    return;
  }
  hideBubble();
  if (!url) {
    if (ctx.anchor) removeLink(ctx);
    else restoreSelection(ctx);
  } else if (ctx.anchor) {
    ctx.anchor.setAttribute("href", url);
    commitEdit(ctx.host);
    restoreSelection(ctx);
  } else {
    linkSelection(ctx, url);
  }
}

// Keep the page selection when pressing bubble buttons (but let the URL box take focus).
bubble.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".fb-input")) e.preventDefault();
});

bubble.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (!btn || !bubbleCtx) return;
  const cmd = btn.dataset.cmd;
  if (cmd === "bold" || cmd === "italic") document.execCommand(cmd);
  else if (cmd === "link" || cmd === "edit") openLinkInput(bubbleCtx);
  else if (cmd === "apply") applyLink();
  else if (cmd === "unlink") removeLink(bubbleCtx);
});

bubble.addEventListener("keydown", (e) => {
  if (!e.target.closest(".fb-input")) return;
  if (e.key === "Enter") {
    e.preventDefault();
    applyLink();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    const ctx = bubbleCtx;
    hideBubble();
    restoreSelection(ctx);
  }
});

// Clicking anywhere else while typing a URL cancels it.
document.addEventListener("mousedown", (e) => {
  if (bubbleMode === "input" && !bubble.contains(e.target)) hideBubble();
});

/* ---------------- toolbar ---------------- */

document.getElementById("btnArrange").addEventListener("click", () => {
  document.body.classList.toggle("arrange");
  updateToolbar();
});

const sectionsPanel = document.getElementById("sectionsPanel");
const contactPanel = document.getElementById("contactPanel");
const DROP_PANELS = [sectionsPanel, contactPanel];

// Opening one dropdown closes the other.
function setPanel(panel, open) {
  DROP_PANELS.forEach((p) => (p.hidden = p === panel ? !open : true));
  updateToolbar();
}

document.getElementById("btnSections").addEventListener("click", () => setPanel(sectionsPanel, sectionsPanel.hidden));
document.getElementById("btnContact").addEventListener("click", () => setPanel(contactPanel, contactPanel.hidden));

// Close on outside click / Esc. A panel stays open while working inside it.
// composedPath, not target.closest: panel clicks re-render it, detaching the target before this runs.
document.addEventListener("click", (e) => {
  const open = DROP_PANELS.find((p) => !p.hidden);
  if (open && !e.composedPath().includes(open.parentElement)) setPanel(open, false);
});
document.addEventListener("keydown", (e) => {
  const open = DROP_PANELS.find((p) => !p.hidden);
  if (e.key === "Escape" && open) setPanel(open, false);
});

contactPanel.addEventListener("change", (e) => {
  const box = e.target.closest('input[data-op="toggle"]');
  if (!box || !data) return;
  const key = box.dataset.key;
  data.contactFields = data.contactFields.filter((k) => k !== key);
  if (box.checked) {
    if (data.contact[key] === undefined) data.contact[key] = "";
    data.contactFields.push(key);
  }
  render();
  saveSoon();
  flashStatus(`${contactLabel(key)} ${box.checked ? "added" : "removed"}`);
  if (box.checked) focusEmptyContact(key);
});

contactPanel.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-op]");
  if (!btn || !data) return;
  const key = btn.dataset.key;
  const list = data.contactFields;
  if (btn.dataset.op === "up" || btn.dataset.op === "down") {
    const i = list.indexOf(key);
    const j = i + (btn.dataset.op === "up" ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  } else if (btn.dataset.op === "delete") {
    delete data.contact[key];
  } else if (btn.dataset.op === "custom") {
    let n = 1;
    while (`custom${n}` in data.contact) n++;
    data.contact[`custom${n}`] = "";
    list.push(`custom${n}`);
    render();
    saveSoon();
    focusEmptyContact(`custom${n}`);
    return;
  }
  render();
  saveSoon();
});

// A freshly ticked item is usually empty: put the caret in it so typing fills it straight away.
function focusEmptyContact(key) {
  const el = pageEl.querySelector(`[data-path="contact.${key}"]`);
  if (el && !el.textContent.trim()) el.focus();
}

sectionsPanel.addEventListener("change", (e) => {
  const box = e.target.closest('input[data-op="toggle"]');
  if (!box || !data) return;
  const key = box.dataset.key;
  setHidden(key, !box.checked);
  render();
  saveSoon();
  flashStatus(`${sectionLabel(key)} ${box.checked ? "shown" : "hidden"}`);
});

sectionsPanel.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-op]");
  if (!btn || !data) return;
  const key = btn.dataset.key;
  const op = btn.dataset.op;
  // The panel lists hidden rows too, so step one row at a time; the groups chain left → right.
  const changed = op === "switch"
    ? (switchColumn(key), true)
    : moveSection(key, op === "up" ? -1 : 1, { cross: true });
  if (changed) {
    render();
    saveSoon();
  }
});

document.getElementById("btnLayout").addEventListener("click", () => {
  data.settings.ats = !isAts();
  render();
  saveNow();
});

document.getElementById("btnPrint").addEventListener("click", () => {
  saveNow();
  window.print();
});

document.getElementById("btnJson").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "resume.json");
});

document.getElementById("btnImport").addEventListener("click", () => document.getElementById("jsonInput").click());
document.getElementById("jsonInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      data = migrate(JSON.parse(reader.result));
      render();
      saveNow();
      flashStatus("Imported");
    } catch (err) {
      alert("Could not parse that JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("btnReset").addEventListener("click", () => {
  if (!confirm("Discard all edits and restore the original resume content?")) return;
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  data = migrate(JSON.parse(JSON.stringify(window.RESUME_DATA)));
  render();
  saveNow();
  flashStatus("Reset");
});

document.getElementById("btnDocx").addEventListener("click", () => {
  exportDocx().catch((err) => {
    console.error(err);
    alert("DOCX export failed: " + err.message);
  });
});

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- DOCX export ---------------- */

function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

async function exportDocx() {
  saveNow();
  const blob = await buildDocxBlob();
  const fname = htmlToText(data.name).trim().replace(/\s+/g, "_") || "Resume";
  downloadBlob(blob, `${fname}.docx`);
  flashStatus("DOCX downloaded");
}

async function buildDocxBlob() {
  const d = window.docx;
  if (!d) throw new Error("The DOCX library (vendor/docx.umd.js) didn't load.");
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, ShadingType, AlignmentType, VerticalAlign, ExternalHyperlink
  } = d;
  const ats = isAts();

  const NAVY = "2C3E50", INK = "1F2229", BODY = "3D4145", MUTED = "8A8F94";
  const FONT = "Lato";
  const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

  // Inline <a href> becomes a real Word hyperlink, underlined like on the page.
  function runsFromHtml(html, base = {}) {
    const top = [];
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    (function walk(node, fmt, out) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          if (n.textContent) out.push(new TextRun({
            text: n.textContent, font: FONT, size: 17, color: BODY, ...base,
            bold: base.bold || fmt.bold, italics: base.italics || fmt.italic,
            ...(fmt.underline ? { underline: {} } : {})
          }));
        } else if (n.nodeType === 1) {
          if (n.tagName === "BR") { out.push(new TextRun({ break: 1 })); return; }
          const href = n.tagName === "A" && !fmt.link ? safeHref(n.getAttribute("href")) : "";
          const inner = {
            bold: fmt.bold || n.tagName === "B" || n.tagName === "STRONG",
            italic: fmt.italic || n.tagName === "I" || n.tagName === "EM",
            underline: fmt.underline || n.tagName === "U" || !!href,
            link: fmt.link || !!href
          };
          if (href) {
            const runs = [];
            walk(n, inner, runs);
            if (runs.length) out.push(new ExternalHyperlink({ link: href, children: runs }));
          } else {
            walk(n, inner, out);
          }
        }
      });
    })(doc.body.firstChild, {}, top);
    return top;
  }

  const P = Paragraph, T = TextRun;
  const fullWidth = ats || !visibleSections("left").length || !visibleSections("right").length;
  const metaTab = fullWidth ? 10100 : 4800;
  const heading = (text) =>
    new P({
      children: runsFromHtml(text, { bold: true, size: 26, color: INK }),
      spacing: { before: 260, after: 120 }
    });
  const bullet = (html, size = 17) =>
    new P({
      children: [new T({ text: "–  ", font: FONT, size, color: BODY }), ...runsFromHtml(html, { size })],
      indent: { left: 240, hanging: 240 },
      spacing: { after: 70 }
    });
  const metaLine = (leftText, rightText) =>
    new P({
      tabStops: [{ type: d.TabStopType.RIGHT, position: metaTab }],
      children: [
        ...runsFromHtml(leftText, { italics: true, size: 14, color: MUTED }),
        new T({ text: "\t", font: FONT, italics: true, size: 14, color: MUTED }),
        ...runsFromHtml(rightText || "", { italics: true, size: 14, color: MUTED })
      ],
      spacing: { after: 40 }
    });

  /* header */
  const headerChildren = [
    new P({ children: [new T({ text: htmlToText(data.name), font: FONT, size: 46, color: INK })], spacing: { after: 40 } }),
    new P({ children: [new T({ text: htmlToText(data.title), font: FONT, size: 23, color: "6D7278" })], spacing: { after: 100 } }),
    new P({ children: runsFromHtml(data.summary), alignment: AlignmentType.JUSTIFIED, spacing: { after: 60 } })
  ];

  let headerBlock = headerChildren;
  if (!ats && data.photo && data.photo.startsWith("data:image")) {
    try {
      const b64 = data.photo.split(",")[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      headerBlock = [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorders,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorders,
                  width: { size: 15, type: WidthType.PERCENTAGE },
                  verticalAlign: VerticalAlign.TOP,
                  children: [new P({ children: [new ImageRun({ data: bytes, transformation: { width: 88, height: 88 } })] })]
                }),
                new TableCell({
                  borders: noBorders,
                  width: { size: 85, type: WidthType.PERCENTAGE },
                  children: headerChildren
                })
              ]
            })
          ]
        })
      ];
    } catch (e) {
      console.warn("Photo skipped in DOCX:", e);
    }
  }

  const contact = new P({
    alignment: AlignmentType.CENTER,
    border: {
      top: { style: BorderStyle.SINGLE, size: 18, color: "000000", space: 4 },
      bottom: { style: BorderStyle.SINGLE, size: 18, color: "000000", space: 4 }
    },
    // Same rules as the page: empty items are skipped, linkable ones become hyperlinks.
    children: data.contactFields.filter((k) => htmlToText(data.contact[k] || "").trim()).flatMap((k, i) => {
      const runs = runsFromHtml(data.contact[k], { size: 17, color: INK });
      const href = contactHref(k);
      return [
        ...(i ? [new T({ text: "    |    ", font: FONT, size: 17, color: INK })] : []),
        ...(href ? [new ExternalHyperlink({ link: href, children: runs })] : runs)
      ];
    }),
    spacing: { before: 120, after: 220 }
  });

  /* sections */
  const SEC = {
    experience() {
      const out = [heading(data.headings.experience)];
      data.experience.forEach((e) => {
        out.push(new P({ children: runsFromHtml(e.role, { bold: true, size: 21, color: INK }), spacing: { before: 100 } }));
        out.push(new P({ children: runsFromHtml(e.org, { size: 21, color: "33373C" }), spacing: { after: 30 } }));
        out.push(metaLine(e.dates, e.location));
        if (e.label) out.push(new P({ children: runsFromHtml(e.label, { italics: true, size: 14, color: MUTED }), spacing: { after: 40 } }));
        e.bullets.forEach((b) => out.push(bullet(b)));
      });
      return out;
    },
    education() {
      const out = [heading(data.headings.education)];
      data.education.forEach((e) => {
        out.push(new P({ children: runsFromHtml(e.degree, { bold: true, size: 21, color: INK }), spacing: { before: 100 } }));
        out.push(new P({ children: runsFromHtml(e.school, { size: 21, color: "33373C" }), spacing: { after: 30 } }));
        out.push(metaLine(e.dates, e.meta));
        if (e.label) out.push(new P({ children: runsFromHtml(e.label, { italics: true, size: 14, color: MUTED }), spacing: { after: 40 } }));
        e.bullets.forEach((b) => out.push(bullet(b)));
      });
      return out;
    },
    skills() {
      const out = [heading(data.headings.skills)];
      const runs = [];
      data.skills.forEach((s, i) => {
        const pill = { size: 17, color: "FFFFFF", shading: { type: ShadingType.CLEAR, fill: NAVY } };
        runs.push(new T({ text: " ", font: FONT, ...pill }), ...runsFromHtml(s, pill), new T({ text: " ", font: FONT, ...pill }));
        if (i < data.skills.length - 1) runs.push(new T({ text: "  ", font: FONT, size: 17 }));
      });
      out.push(new P({ children: runs, spacing: { after: 120, line: 340 } }));
      return out;
    },
    projects() {
      const out = [heading(data.headings.projects)];
      data.projects.forEach((p) => {
        out.push(new P({ children: runsFromHtml(p.name, { size: 19, color: INK }), spacing: { before: 80, after: 40 } }));
        p.bullets.forEach((b) => out.push(bullet(b, ats ? 17 : 15)));
      });
      return out;
    },
    achievements() {
      const out = [heading(data.headings.achievements)];
      data.achievements.forEach((a) => {
        out.push(new P({ children: runsFromHtml(a.title, { size: 19, color: INK }), spacing: { before: 60, after: 20 } }));
        out.push(new P({ children: runsFromHtml(a.desc, { italics: true, size: 15, color: MUTED }), spacing: { after: 80 } }));
      });
      return out;
    },
    languages() {
      const out = [heading(data.headings.languages)];
      data.languages.forEach((l) => {
        if (ats) {
          out.push(new P({
            children: [
              ...runsFromHtml(l.name, { size: 19, color: INK }),
              new T({ text: " — ", font: FONT, size: 15, color: MUTED }),
              ...runsFromHtml(l.level, { italics: true, size: 15, color: MUTED })
            ],
            spacing: { after: 50 }
          }));
        } else {
          out.push(new P({ children: runsFromHtml(l.name, { size: 19, color: INK }), spacing: { after: 10 } }));
          out.push(new P({ children: runsFromHtml(l.level, { italics: true, size: 15, color: MUTED }), spacing: { after: 70 } }));
        }
      });
      return out;
    },
    interests() {
      return [
        heading(data.headings.interests),
        new P({ children: data.interests.flatMap((s, i) => [
          ...(i ? [new T({ text: ats ? ", " : "   |   ", font: FONT, size: 17, color: BODY })] : []),
          ...runsFromHtml(s)
        ]) })
      ];
    }
  };

  const shown = (col) => data.sectionOrder[col].filter((k) => SEC[k] && !isHidden(k));
  const left = shown("left").flatMap((k) => SEC[k]());
  const right = shown("right").flatMap((k) => SEC[k]());

  let body;
  if (fullWidth) {
    // Single flow, no layout tables — the structure ATS parsers handle best.
    // Also used when one column is empty, so Word doesn't get a blank cell.
    body = [...left, ...right];
  } else {
    body = [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        columnWidths: [5200, 4300],
        rows: [
          new TableRow({
            children: [
              new TableCell({ borders: noBorders, margins: { right: 240 }, verticalAlign: VerticalAlign.TOP, children: left }),
              new TableCell({ borders: noBorders, margins: { left: 240 }, verticalAlign: VerticalAlign.TOP, children: right })
            ]
          })
        ]
      })
    ];
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 17, color: BODY } } } },
    sections: [{
      properties: { page: { margin: { top: 500, bottom: 500, left: 560, right: 560 } } },
      children: [...headerBlock, contact, ...body]
    }]
  });

  return Packer.toBlob(doc);
}

/* ---------------- go ---------------- */

async function init() {
  data = migrate(await loadData());
  if (PARAMS.has("arrange")) document.body.classList.add("arrange");
  render();

  // headless smoke test: ?docxtest dumps the generated .docx as base64 into the DOM
  if (PARAMS.has("docxtest")) {
    buildDocxBlob()
      .then(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const pre = document.createElement("pre");
        pre.id = "docxout";
        pre.textContent = btoa(s);
        document.body.appendChild(pre);
      })
      .catch((e) => {
        const pre = document.createElement("pre");
        pre.id = "docxerr";
        pre.textContent = String(e.stack || e);
        document.body.appendChild(pre);
      });
  }
}

init();
