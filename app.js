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
  for (const k of Object.keys(def)) if (d[k] === undefined) d[k] = JSON.parse(JSON.stringify(def[k]));
  for (const k of Object.keys(def.headings)) if (d.headings[k] === undefined) d.headings[k] = def.headings[k];
  d.settings = Object.assign({ ats: false }, d.settings);
  normalizeSections(d);
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

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR"]);
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild;
  (function clean(node) {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 1) {
        clean(n);
        if (!ALLOWED_TAGS.has(n.tagName)) {
          while (n.firstChild) node.insertBefore(n.firstChild, n);
          n.remove();
        } else {
          [...n.attributes].forEach((a) => n.removeAttribute(a.name));
        }
      } else if (n.nodeType !== 3) {
        n.remove();
      }
    });
  })(root);
  return root.innerHTML;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------------- icons ---------------- */

const ICONS = {
  email: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M6.6 10.8a15.9 15.9 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>`,
  location: `<svg viewBox="0 0 24 24" fill="#3d4145"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#0a66c2"/><path fill="#fff" d="M7.1 9.2H4.6V19h2.5V9.2zM5.8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM19.4 13.6c0-2.7-1.5-4.6-3.9-4.6-1.3 0-2.2.7-2.6 1.5V9.2h-2.5V19h2.5v-5.2c0-1.2.6-2.1 1.8-2.1 1.1 0 1.7.8 1.7 2.1V19h2.5v-5.4h.5z"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>`
};

/* ---------------- building blocks ---------------- */

function isAts() {
  if (PARAMS.has("ats")) return PARAMS.get("ats") !== "0";
  return !!(data.settings && data.settings.ats);
}

function ed(path, cls = "", tag = "div") {
  const v = getByPath(data, path) ?? "";
  return `<${tag} class="${cls}" contenteditable="true" spellcheck="false" data-path="${path}">${v}</${tag}>`;
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

  const contactItems = [
    ["email", "contact.email"],
    ["phone", "contact.phone"],
    ["location", "contact.location"],
    ["linkedin", "contact.linkedin"]
  ]
    .map(([icon, path]) => `<span class="citem">${ats ? "" : ICONS[icon]}${ed(path, "", "span")}</span>`)
    .join(ats ? `<span class="csep">|</span>` : "");

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
  renderSectionsPanel();
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
  setByPath(data, el.dataset.path, sanitizeHtml(el.innerHTML));
  saveSoon();
});

// paste as plain text so outside formatting doesn't leak in
pageEl.addEventListener("paste", (e) => {
  if (!e.target.closest("[contenteditable]")) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

pageEl.addEventListener("click", (e) => {
  if (!data) return;

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

/* ---------------- toolbar ---------------- */

document.getElementById("btnArrange").addEventListener("click", () => {
  document.body.classList.toggle("arrange");
  updateToolbar();
});

const sectionsPanel = document.getElementById("sectionsPanel");

function setSectionsPanel(open) {
  sectionsPanel.hidden = !open;
  updateToolbar();
}

document.getElementById("btnSections").addEventListener("click", () => setSectionsPanel(sectionsPanel.hidden));

// Close on outside click / Esc. The panel stays open while working inside it.
// composedPath, not target.closest: panel clicks re-render it, detaching the target before this runs.
document.addEventListener("click", (e) => {
  if (!sectionsPanel.hidden && !e.composedPath().some((n) => n.id === "sectionsWrap")) setSectionsPanel(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sectionsPanel.hidden) setSectionsPanel(false);
});

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
    WidthType, BorderStyle, ShadingType, AlignmentType, VerticalAlign
  } = d;
  const ats = isAts();

  const NAVY = "2C3E50", INK = "1F2229", BODY = "3D4145", MUTED = "8A8F94";
  const FONT = "Lato";
  const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

  function runsFromHtml(html, base = {}) {
    const out = [];
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    (function walk(node, fmt) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          if (n.textContent) out.push(new TextRun({ text: n.textContent, font: FONT, size: 17, color: BODY, ...base, bold: base.bold || fmt.bold, italics: base.italics || fmt.italic }));
        } else if (n.nodeType === 1) {
          if (n.tagName === "BR") { out.push(new TextRun({ break: 1 })); return; }
          walk(n, {
            bold: fmt.bold || n.tagName === "B" || n.tagName === "STRONG",
            italic: fmt.italic || n.tagName === "I" || n.tagName === "EM"
          });
        }
      });
    })(doc.body.firstChild, {});
    return out;
  }

  const P = Paragraph, T = TextRun;
  const fullWidth = ats || !visibleSections("left").length || !visibleSections("right").length;
  const metaTab = fullWidth ? 10100 : 4800;
  const heading = (text) =>
    new P({
      children: [new T({ text: htmlToText(text), font: FONT, bold: true, size: 26, color: INK })],
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
        new T({ text: htmlToText(leftText), font: FONT, italics: true, size: 14, color: MUTED }),
        new T({ text: "\t" + htmlToText(rightText || ""), font: FONT, italics: true, size: 14, color: MUTED })
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
    children: [
      new T({ text: [data.contact.email, data.contact.phone, data.contact.location, data.contact.linkedin].map(htmlToText).join("    |    "), font: FONT, size: 17, color: INK })
    ],
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
        if (e.label) out.push(new P({ children: [new T({ text: htmlToText(e.label), font: FONT, italics: true, size: 14, color: MUTED })], spacing: { after: 40 } }));
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
        if (e.label) out.push(new P({ children: [new T({ text: htmlToText(e.label), font: FONT, italics: true, size: 14, color: MUTED })], spacing: { after: 40 } }));
        e.bullets.forEach((b) => out.push(bullet(b)));
      });
      return out;
    },
    skills() {
      const out = [heading(data.headings.skills)];
      const runs = [];
      data.skills.forEach((s, i) => {
        runs.push(new T({ text: ` ${htmlToText(s)} `, font: FONT, size: 17, color: "FFFFFF", shading: { type: ShadingType.CLEAR, fill: NAVY } }));
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
        new P({ children: [new T({ text: data.interests.map(htmlToText).join(ats ? ", " : "   |   "), font: FONT, size: 17, color: BODY })] })
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
