/**
 * Pep Tracker — interactive web prototype
 *
 * U-100 syringe formula (documented for the calculator):
 *   units = (dose_mg / concentration_mg_per_ml) * 100
 *
 * Example: 0.25 mg at 5 mg/mL → (0.25 / 5) * 100 = 5 units
 * Educational personal tracker framing only — not medical advice.
 *
 * Name typeahead uses a background suggestion list (~40); no visible catalog screen.
 * Custom names remain fully supported on Save.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "madrat-pet-tracker-v4";
  const REMINDER_KEY = "madrat-pet-tracker-reminder-v1";

  // --- helpers ---

  // Background name suggestions only — never rendered as a catalog screen.
  const PEPTIDE_NAME_CATALOG = [
    "Retatrutide",
    "Semaglutide",
    "Tirzepatide",
    "Liraglutide",
    "BPC-157",
    "TB-500",
    "CJC-1295",
    "Ipamorelin",
    "CJC/Ipamorelin",
    "Tesamorelin",
    "Sermorelin",
    "GHRP-2",
    "GHRP-6",
    "MK-677 (Ibutamoren)",
    "Melanotan II",
    "PT-141 (Bremelanotide)",
    "GHK-Cu",
    "Epitalon",
    "Thymosin Alpha-1",
    "LL-37",
    "AOD-9604",
    "Frag 176-191",
    "IGF-1 LR3",
    "Oxytocin",
    "Selank",
    "Semax",
    "NAD+",
    "5-Amino-1MQ",
    "SLU-PP-332",
    "SS-31 (Elamipretide)",
    "MotS-c",
    "Cerebrolysin",
    "Testosterone",
    "HGH (Somatropin)",
    "Enclomiphene",
    "Gonadorelin",
    "HCG",
    "Kisspeptin-10",
    "DSIP",
    "Bromantane",
  ];

  /** Case-insensitive: starts-with first, then contains. */
  function peptideNameSuggestions(query, limit) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const cap = typeof limit === "number" ? limit : 8;
    const starts = [];
    const contains = [];
    for (const name of PEPTIDE_NAME_CATALOG) {
      const n = name.toLowerCase();
      if (n.startsWith(q)) starts.push(name);
      else if (n.includes(q)) contains.push(name);
    }
    return starts.concat(contains).slice(0, cap);
  }


  /**
   * Convert dose (mg) to U-100 syringe units given concentration (mg/mL).
   * units = dose_mg / concentration_mg_per_ml * 100
   */
  function calcUnits(doseMg, concentrationMgPerMl) {
    if (!concentrationMgPerMl || concentrationMgPerMl <= 0) return 0;
    return (doseMg / concentrationMgPerMl) * 100;
  }

  function effectiveConc(p) {
    const bac = Number(p.bacWaterMl);
    const vial = Number(p.vialSizeMg);
    if (bac > 0 && vial > 0) return vial / bac;
    return Number(p.concentrationMgPerMl) || 0;
  }


  function formatUnits(u) {
    const n = Math.round(u * 100) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "") || String(n);
  }

  function formatNum(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : String(v);
  }

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function parseISODate(s) {
    if (!s || typeof s !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function todayISO() {
    return dateKey(startOfDay(new Date()));
  }

  function uid() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function unitMultiplier(unit) {
    return unit === "weeks" ? 7 : 1;
  }

  function cycleOnDays(p) {
    return Math.max(0, Number(p.cycleOnValue) || 0) * unitMultiplier(p.cycleOnUnit);
  }

  function cycleOffDays(p) {
    return Math.max(0, Number(p.cycleOffValue) || 0) * unitMultiplier(p.cycleOffUnit);
  }

  function hasActiveCycle(p) {
    const onDays = cycleOnDays(p);
    const period = onDays + cycleOffDays(p);
    return onDays > 0 && period > 0;
  }

  function cycleSummary(p) {
    if (!hasActiveCycle(p)) return "";
    const onV = Number(p.cycleOnValue) || 0;
    const offV = Number(p.cycleOffValue) || 0;
    const onU = p.cycleOnUnit === "weeks" ? (onV === 1 ? "week" : "weeks") : (onV === 1 ? "day" : "days");
    const offU = p.cycleOffUnit === "weeks" ? (offV === 1 ? "week" : "weeks") : (offV === 1 ? "day" : "days");
    return `${onV} ${onU} on / ${offV} ${offU} off`;
  }

  /** On-phase (or no cycle). Before start → false when cycle active. */
  function isInOnPhase(p, date) {
    if (!hasActiveCycle(p)) return true;
    const start = parseISODate(p.cycleStartDate) || startOfDay(new Date());
    const day = startOfDay(date);
    const dayIndex = Math.floor((day - start) / 86400000);
    if (dayIndex < 0) return false;
    const onDays = cycleOnDays(p);
    const period = onDays + cycleOffDays(p);
    let pos = dayIndex % period;
    if (pos < 0) pos += period;
    return pos < onDays;
  }

  function isOffCycle(p, date) {
    const dow = date.getDay();
    if (!(p.daysOfWeek || []).includes(dow)) return false;
    if (!hasActiveCycle(p)) return false;
    return !isInOnPhase(p, date);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.peptides) && parsed.completed) {
          return parsed;
        }
      }
    } catch (_) { /* ignore */ }
    return {
      peptides: [],
      completed: {}, // { "YYYY-MM-DD": { peptideId: true } }
    };
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadReminder() {
    try {
      const raw = localStorage.getItem(REMINDER_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return { enabled: false, time: "08:00" };
  }

  function saveReminder(r) {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(r));
  }

  /** Due when weekday matches AND on-phase (or no cycle). */
  function peptidesDueOn(state, date) {
    const dow = date.getDay();
    return state.peptides.filter((p) => {
      if (!(p.daysOfWeek || []).includes(dow)) return false;
      return isInOnPhase(p, date);
    });
  }

  /** Weekday matches (due or off-cycle) — for week detail listing. */
  function peptidesScheduledOn(state, date) {
    const dow = date.getDay();
    return state.peptides.filter((p) => (p.daysOfWeek || []).includes(dow));
  }

  function isCompleted(state, date, peptideId) {
    const key = dateKey(date);
    return !!(state.completed[key] && state.completed[key][peptideId]);
  }

  function setCompleted(state, date, peptideId, done) {
    const key = dateKey(date);
    if (!state.completed[key]) state.completed[key] = {};
    if (done) state.completed[key][peptideId] = true;
    else delete state.completed[key][peptideId];
    saveState(state);
  }

  // --- UI ---

  let state = loadState();
  let selectedWeekDay = startOfDay(new Date());
  let addFormOpen = false;

  function setStatusTime() {
    const el = document.getElementById("status-time");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function switchTab(tab) {
    document.querySelectorAll(".screen").forEach((s) => {
      s.classList.toggle("active", s.dataset.tab === tab);
    });
    document.querySelectorAll(".tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (tab === "today") renderToday();
    if (tab === "peptides") renderPeptides();
    if (tab === "week") renderWeek();
    if (tab === "reminders") renderReminders();
  }

  function renderToday() {
    const today = startOfDay(new Date());
    document.getElementById("today-date").textContent = today.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const due = peptidesDueOn(state, today);
    const doneCount = due.filter((p) => isCompleted(state, today, p.id)).length;
    document.getElementById("today-summary").textContent =
      state.peptides.length === 0
        ? "No peptides yet — add one in the Peptides tab."
        : due.length === 0
          ? "No doses scheduled for today."
          : `${doneCount} of ${due.length} marked done`;

    const list = document.getElementById("today-list");
    const empty = document.getElementById("today-empty");
    list.innerHTML = "";

    if (due.length === 0) {
      empty.hidden = false;
      empty.textContent =
        state.peptides.length === 0
          ? "No peptides yet — tap Peptides, then Add peptide."
          : "Nothing due today. Nice.";
      return;
    }
    empty.hidden = true;

    due.forEach((p) => {
      const done = isCompleted(state, today, p.id);
      const units = calcUnits(p.doseMg, effectiveConc(p));
      const card = document.createElement("div");
      card.className = "card dose-card" + (done ? " done" : "");
      card.innerHTML = `
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="dose-meta">
            ${formatNum(p.doseMg)} mg · ${formatNum(effectiveConc(p))} mg/mL<br/>
            ${escapeHtml(p.frequency || "")}
          </div>
          <span class="units-pill">${formatUnits(units)} units</span>
        </div>
        <button type="button" class="btn-done ${done ? "marked" : ""}" data-id="${p.id}">
          ${done ? "Done ✓" : "Mark done"}
        </button>
      `;
      card.querySelector("button").addEventListener("click", () => {
        setCompleted(state, today, p.id, !isCompleted(state, today, p.id));
        renderToday();
      });
      list.appendChild(card);
    });
  }

  function renderPeptides() {
    const list = document.getElementById("peptides-list");
    const formWrap = document.getElementById("add-peptide-form");
    const empty = document.getElementById("peptides-empty");
    const addBtn = document.getElementById("btn-add-peptide");

    if (formWrap) formWrap.hidden = !addFormOpen;
    if (addBtn) addBtn.textContent = addFormOpen ? "Cancel" : "Add peptide";

    list.innerHTML = "";

    if (state.peptides.length === 0 && !addFormOpen) {
      if (empty) empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }

    state.peptides.forEach((p) => {
      const conc = effectiveConc(p);
      const units = calcUnits(p.doseMg, conc);
      const summary = cycleSummary(p);
      const card = document.createElement("div");
      card.className = "card peptide-card";
      card.dataset.id = p.id;
      card.innerHTML = `
        <div class="peptide-head">
          <div>
            <h3>${escapeHtml(p.name)}</h3>
            <p class="freq-note">${escapeHtml(p.frequency || "")}</p>
            ${summary ? `<p class="cycle-note">${escapeHtml(summary)}</p>` : ""}
          </div>
          <span class="chev">›</span>
        </div>
        <div class="peptide-stats">
          <div class="stat"><label>Dose</label><strong class="stat-dose">${formatNum(p.doseMg)} mg</strong></div>
          <div class="stat"><label>BAC</label><strong class="stat-bac">${formatNum(p.bacWaterMl || 0)} mL</strong></div>
          <div class="stat"><label>Vial</label><strong class="stat-vial">${formatNum(p.vialSizeMg || 0)} mg</strong></div>
        </div>
        <div class="peptide-stats" style="margin-top:6px">
          <div class="stat"><label>Conc.</label><strong class="stat-conc">${formatNum(conc)} mg/mL</strong></div>
          <div class="stat"><label>Units</label><strong class="stat-units">${formatUnits(units)} U</strong></div>
        </div>
        <div class="calc-panel">
          <h4>Live calculator (U-100)</h4>
          <div class="calc-row">
            <div>
              <label>Dose (mg)</label>
              <input type="number" step="0.01" min="0" inputmode="decimal" class="calc-dose" value="${p.doseMg}" />
            </div>
            <div>
              <label>BAC water (mL)</label>
              <input type="number" step="0.1" min="0.01" inputmode="decimal" class="calc-bac" value="${p.bacWaterMl || 0}" />
            </div>
          </div>
          <div class="calc-row" style="margin-top:8px">
            <div>
              <label>Vial size (mg)</label>
              <input type="number" step="0.1" min="0.01" inputmode="decimal" class="calc-vial" value="${p.vialSizeMg || 0}" />
            </div>
          </div>
          <div class="calc-result">
            <div class="units-big calc-out">${formatUnits(units)}</div>
            <div class="units-label">syringe units</div>
            <p class="formula-note">conc = vial ÷ BAC · units = dose ÷ conc × 100</p>
          </div>
          <h4 style="margin-top:14px">Cycles</h4>
          <div class="cycle-row">
            <div class="cycle-pair">
              <label>Cycles On</label>
              <div class="cycle-inputs">
                <input type="number" min="0" step="1" inputmode="numeric" class="calc-cycle-on" value="${Number(p.cycleOnValue) || 0}" />
                <select class="calc-cycle-on-unit cycle-unit">
                  <option value="days"${p.cycleOnUnit !== "weeks" ? " selected" : ""}>Days</option>
                  <option value="weeks"${p.cycleOnUnit === "weeks" ? " selected" : ""}>Weeks</option>
                </select>
              </div>
            </div>
            <div class="cycle-pair">
              <label>Cycles Off</label>
              <div class="cycle-inputs">
                <input type="number" min="0" step="1" inputmode="numeric" class="calc-cycle-off" value="${Number(p.cycleOffValue) || 0}" />
                <select class="calc-cycle-off-unit cycle-unit">
                  <option value="days"${p.cycleOffUnit !== "weeks" ? " selected" : ""}>Days</option>
                  <option value="weeks"${p.cycleOffUnit === "weeks" ? " selected" : ""}>Weeks</option>
                </select>
              </div>
            </div>
          </div>
          <div style="margin-top:8px">
            <label>Cycle Start</label>
            <input type="date" class="calc-cycle-start field-input" value="${escapeHtml(p.cycleStartDate || todayISO())}" />
          </div>
          <p class="cycle-note calc-cycle-summary" style="margin-top:6px">${escapeHtml(summary)}</p>
          <button type="button" class="btn-delete">Delete peptide</button>
        </div>
      `;

      card.querySelector(".peptide-head").addEventListener("click", (e) => {
        e.preventDefault();
        card.classList.toggle("open");
      });

      const doseIn = card.querySelector(".calc-dose");
      const bacIn = card.querySelector(".calc-bac");
      const vialIn = card.querySelector(".calc-vial");
      const out = card.querySelector(".calc-out");
      const statDose = card.querySelector(".stat-dose");
      const statBac = card.querySelector(".stat-bac");
      const statVial = card.querySelector(".stat-vial");
      const statConc = card.querySelector(".stat-conc");
      const statUnits = card.querySelector(".stat-units");
      const cycleOnIn = card.querySelector(".calc-cycle-on");
      const cycleOnUnit = card.querySelector(".calc-cycle-on-unit");
      const cycleOffIn = card.querySelector(".calc-cycle-off");
      const cycleOffUnit = card.querySelector(".calc-cycle-off-unit");
      const cycleStartIn = card.querySelector(".calc-cycle-start");
      const cycleSumEl = card.querySelector(".calc-cycle-summary");
      const headCycleNote = card.querySelector(".cycle-note:not(.calc-cycle-summary)");

      function updateCalcAndSave() {
        const dose = Number.isFinite(parseFloat(doseIn.value)) && parseFloat(doseIn.value) >= 0 ? parseFloat(doseIn.value) : 0;
        const bac = Number.isFinite(parseFloat(bacIn.value)) && parseFloat(bacIn.value) > 0 ? parseFloat(bacIn.value) : 0;
        const vial = Number.isFinite(parseFloat(vialIn.value)) && parseFloat(vialIn.value) > 0 ? parseFloat(vialIn.value) : 0;
        p.doseMg = dose;
        p.bacWaterMl = bac;
        p.vialSizeMg = vial;
        if (bac > 0 && vial > 0) p.concentrationMgPerMl = vial / bac;
        const conc = effectiveConc(p);
        const u = calcUnits(dose, conc);
        out.textContent = formatUnits(u);
        if (statDose) statDose.textContent = formatNum(p.doseMg) + " mg";
        if (statBac) statBac.textContent = formatNum(p.bacWaterMl || 0) + " mL";
        if (statVial) statVial.textContent = formatNum(p.vialSizeMg || 0) + " mg";
        if (statConc) statConc.textContent = formatNum(conc) + " mg/mL";
        if (statUnits) statUnits.textContent = formatUnits(u) + " U";
        saveState(state);
      }

      function updateCycleAndSave() {
        const onV = parseInt(cycleOnIn.value, 10);
        const offV = parseInt(cycleOffIn.value, 10);
        p.cycleOnValue = Number.isFinite(onV) && onV >= 0 ? onV : 0;
        p.cycleOffValue = Number.isFinite(offV) && offV >= 0 ? offV : 0;
        p.cycleOnUnit = cycleOnUnit.value === "weeks" ? "weeks" : "days";
        p.cycleOffUnit = cycleOffUnit.value === "weeks" ? "weeks" : "days";
        const startVal = cycleStartIn.value || todayISO();
        p.cycleStartDate = startVal;
        const sum = cycleSummary(p);
        if (cycleSumEl) cycleSumEl.textContent = sum;
        if (headCycleNote) headCycleNote.textContent = sum;
        else if (sum) {
          const freq = card.querySelector(".freq-note");
          if (freq && !card.querySelector(".peptide-head .cycle-note")) {
            const note = document.createElement("p");
            note.className = "cycle-note";
            note.textContent = sum;
            freq.after(note);
          }
        }
        saveState(state);
      }

      doseIn.addEventListener("input", updateCalcAndSave);
      bacIn.addEventListener("input", updateCalcAndSave);
      vialIn.addEventListener("input", updateCalcAndSave);
      cycleOnIn.addEventListener("input", updateCycleAndSave);
      cycleOffIn.addEventListener("input", updateCycleAndSave);
      cycleOnUnit.addEventListener("change", updateCycleAndSave);
      cycleOffUnit.addEventListener("change", updateCycleAndSave);
      cycleStartIn.addEventListener("change", updateCycleAndSave);

      // Prevent card toggle when interacting with inputs
      card.querySelector(".calc-panel").addEventListener("click", (e) => e.stopPropagation());

      card.querySelector(".btn-delete").addEventListener("click", () => {
        if (!confirm(`Delete ${p.name}?`)) return;
        state.peptides = state.peptides.filter((x) => x.id !== p.id);
        saveState(state);
        renderPeptides();
      });

      list.appendChild(card);
    });
  }


  function wireNameTypeahead() {
    const nameIn = document.getElementById("new-name");
    const list = document.getElementById("name-suggestions");
    if (!nameIn || !list) return;

    let activeIndex = -1;

    function hide() {
      list.hidden = true;
      list.innerHTML = "";
      activeIndex = -1;
    }

    function render(matches) {
      list.innerHTML = "";
      activeIndex = -1;
      if (!matches.length) {
        hide();
        return;
      }
      matches.forEach((name, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = name;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault(); // keep focus; avoid blur-before-click
          nameIn.value = name;
          hide();
          nameIn.focus();
        });
        list.appendChild(li);
      });
      list.hidden = false;
    }

    function refresh() {
      render(peptideNameSuggestions(nameIn.value));
    }

    nameIn.addEventListener("input", refresh);
    nameIn.addEventListener("focus", refresh);
    nameIn.addEventListener("blur", () => {
      // Delay so mousedown on suggestion can fire first
      setTimeout(hide, 120);
    });
    nameIn.addEventListener("keydown", (e) => {
      const items = list.querySelectorAll("li");
      if (list.hidden || !items.length) {
        if (e.key === "Escape") hide();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        nameIn.value = items[activeIndex].textContent;
        hide();
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      } else {
        return;
      }
      items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
    });

    // Expose hide for form open/close
    wireNameTypeahead.hide = hide;
  }

  function wireAddPeptide() {
    const addBtn = document.getElementById("btn-add-peptide");
    const form = document.getElementById("add-peptide-form");
    const saveBtn = document.getElementById("btn-save-peptide");
    if (!addBtn || !form || !saveBtn) return;

    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addFormOpen = !addFormOpen;
      if (addFormOpen) {
        form.hidden = false;
        const nameIn = document.getElementById("new-name");
        if (nameIn) {
          nameIn.value = "";
          nameIn.focus();
        }
        if (wireNameTypeahead.hide) wireNameTypeahead.hide();
        document.getElementById("new-dose").value = "0.25";
        document.getElementById("new-bac").value = "2";
        document.getElementById("new-vial").value = "10";
        document.getElementById("new-freq").value = "";
        document.querySelectorAll(".day-toggle").forEach((cb) => {
          cb.checked = true;
        });
        document.getElementById("new-cycle-on").value = "0";
        document.getElementById("new-cycle-off").value = "0";
        document.getElementById("new-cycle-on-unit").value = "weeks";
        document.getElementById("new-cycle-off-unit").value = "weeks";
        document.getElementById("new-cycle-start").value = todayISO();
        updateAddPreview();
      } else {
        form.hidden = true;
      }
      addBtn.textContent = addFormOpen ? "Cancel" : "Add peptide";
      const empty = document.getElementById("peptides-empty");
      if (empty) empty.hidden = addFormOpen || state.peptides.length > 0;
    });

    function updateAddPreview() {
      const d = parseFloat(document.getElementById("new-dose").value) || 0;
      const bac = parseFloat(document.getElementById("new-bac").value) || 0;
      const vial = parseFloat(document.getElementById("new-vial").value) || 0;
      const c = bac > 0 ? vial / bac : 0;
      const concEl = document.getElementById("new-conc-display");
      if (concEl) concEl.textContent = (c > 0 ? formatNum(c) : "—") + " mg/mL";
      const el = document.getElementById("new-units-preview");
      if (el) el.textContent = formatUnits(calcUnits(d, c));
    }
    document.getElementById("new-dose").addEventListener("input", updateAddPreview);
    document.getElementById("new-bac").addEventListener("input", updateAddPreview);
    document.getElementById("new-vial").addEventListener("input", updateAddPreview);

    // Default cycle start on first paint
    const startEl = document.getElementById("new-cycle-start");
    if (startEl && !startEl.value) startEl.value = todayISO();

    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const name = (document.getElementById("new-name").value || "").trim();
      if (!name) {
        document.getElementById("new-name").focus();
        return;
      }
      const doseMg = parseFloat(document.getElementById("new-dose").value);
      const bacWaterMl = parseFloat(document.getElementById("new-bac").value);
      const vialSizeMg = parseFloat(document.getElementById("new-vial").value);
      const frequency = (document.getElementById("new-freq").value || "").trim();
      const daysOfWeek = [];
      document.querySelectorAll(".day-toggle").forEach((cb) => {
        if (cb.checked) daysOfWeek.push(Number(cb.value));
      });
      const bac = Number.isFinite(bacWaterMl) && bacWaterMl > 0 ? bacWaterMl : 0;
      const vial = Number.isFinite(vialSizeMg) && vialSizeMg > 0 ? vialSizeMg : 0;
      const concentrationMgPerMl = bac > 0 && vial > 0 ? vial / bac : 1;
      const onRaw = parseInt(document.getElementById("new-cycle-on").value, 10);
      const offRaw = parseInt(document.getElementById("new-cycle-off").value, 10);
      const onUnit = document.getElementById("new-cycle-on-unit").value === "weeks" ? "weeks" : "days";
      const offUnit = document.getElementById("new-cycle-off-unit").value === "weeks" ? "weeks" : "days";
      const cycleStart = document.getElementById("new-cycle-start").value || todayISO();
      const peptide = {
        id: uid(),
        name,
        doseMg: Number.isFinite(doseMg) && doseMg >= 0 ? doseMg : 0,
        bacWaterMl: bac,
        vialSizeMg: vial,
        concentrationMgPerMl,
        frequency: frequency || "Every day",
        daysOfWeek: daysOfWeek.length ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
        cycleOnValue: Number.isFinite(onRaw) && onRaw >= 0 ? onRaw : 0,
        cycleOnUnit: onUnit,
        cycleOffValue: Number.isFinite(offRaw) && offRaw >= 0 ? offRaw : 0,
        cycleOffUnit: offUnit,
        cycleStartDate: cycleStart,
      };
      state.peptides.push(peptide);
      saveState(state);
      addFormOpen = false;
      form.hidden = true;
      addBtn.textContent = "Add peptide";
      renderPeptides();
    });
  }

  function renderWeek() {
    const strip = document.getElementById("week-strip");
    strip.innerHTML = "";
    const today = startOfDay(new Date());
    const days = [];
    for (let i = -3; i <= 3; i++) days.push(addDays(today, i));

    days.forEach((d) => {
      const due = peptidesDueOn(state, d);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      if (dateKey(d) === dateKey(today)) cell.classList.add("today");
      if (dateKey(d) === dateKey(selectedWeekDay)) cell.classList.add("selected");

      const dotsHtml = due
        .map((p) => {
          const done = isCompleted(state, d, p.id);
          const past = d < today && !done;
          const cls = done ? "done" : past ? "missed" : "";
          return `<span class="dot ${cls}" title="${escapeHtml(p.name)}"></span>`;
        })
        .join("");

      cell.innerHTML = `
        <div class="dow">${d.toLocaleDateString([], { weekday: "narrow" })}</div>
        <div class="dom">${d.getDate()}</div>
        <div class="dots">${dotsHtml || "<span style='height:6px'></span>"}</div>
      `;
      cell.addEventListener("click", () => {
        selectedWeekDay = d;
        renderWeek();
      });
      strip.appendChild(cell);
    });

    const title = document.getElementById("week-detail-title");
    const detailList = document.getElementById("week-detail-list");
    const sel = selectedWeekDay;
    title.textContent = sel.toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    const scheduled = peptidesScheduledOn(state, sel);
    if (scheduled.length === 0) {
      detailList.innerHTML = `<p class="muted" style="font-size:14px;color:var(--muted)">${
        state.peptides.length === 0
          ? "No peptides yet — add one in the Peptides tab."
          : "No doses on this day."
      }</p>`;
      return;
    }

    detailList.innerHTML = scheduled
      .map((p) => {
        const units = calcUnits(p.doseMg, effectiveConc(p));
        let badge = "due";
        let label = "Due";
        if (isOffCycle(p, sel)) {
          badge = "offcycle";
          label = "Off cycle / not needed";
        } else {
          const done = isCompleted(state, sel, p.id);
          if (done) {
            badge = "done";
            label = "Done";
          } else if (sel < today) {
            badge = "off";
            label = "Missed";
          }
        }
        return `
          <div class="week-item">
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${formatNum(p.doseMg)} mg · ${formatUnits(units)} U</div>
            </div>
            <span class="badge ${badge}">${label}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderReminders() {
    const r = loadReminder();
    const enabled = document.getElementById("reminder-enabled");
    const time = document.getElementById("reminder-time");
    const preview = document.getElementById("reminder-preview");
    enabled.checked = !!r.enabled;
    time.value = r.time || "08:00";
    preview.classList.toggle("on", !!r.enabled);
  }

  function wireReminders() {
    const enabled = document.getElementById("reminder-enabled");
    const time = document.getElementById("reminder-time");
    const saved = document.getElementById("reminder-saved");
    const preview = document.getElementById("reminder-preview");

    function persist() {
      saveReminder({ enabled: enabled.checked, time: time.value || "08:00" });
      preview.classList.toggle("on", enabled.checked);
      saved.hidden = false;
      clearTimeout(persist._t);
      persist._t = setTimeout(() => {
        saved.hidden = true;
      }, 1600);
    }
    enabled.addEventListener("change", persist);
    time.addEventListener("change", persist);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // tabs — use pointerdown + click for better mobile reliability
  document.querySelectorAll(".tab").forEach((btn) => {
    const go = (e) => {
      e.preventDefault();
      switchTab(btn.dataset.tab);
    };
    btn.addEventListener("click", go);
  });

  setStatusTime();
  setInterval(setStatusTime, 30000);
  wireReminders();
  wireNameTypeahead();
  wireAddPeptide();
  renderToday();
  renderReminders();
})();
