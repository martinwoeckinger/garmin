/* Gesundheits-Dashboard: Garmin (Missing MCP) + Hevy, Daten aus Supabase. */
(() => {
  "use strict";
  const CFG = window.DASHBOARD_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------------------------------------------------------- Datum
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
  const today = () => isoDate(new Date());
  const weekStart = (s) => { const d = parseDate(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDate(d); };
  const monthStart = (s) => s.slice(0, 7) + "-01";
  const addMonths = (s, n) => { const d = parseDate(monthStart(s)); d.setMonth(d.getMonth() + n); return isoDate(d); };
  const daysInMonth = (s) => { const d = parseDate(monthStart(s)); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
  const range = (start, end) => { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; };
  const isoWeek = (s) => {
    const d = parseDate(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  };
  const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const fmtDate = (s, opts = { weekday: "short", day: "numeric", month: "long", year: "numeric" }) => parseDate(s).toLocaleDateString("de-AT", opts);
  const fmtShort = (s) => `${DOW[(parseDate(s).getDay() + 6) % 7]} ${s.slice(8)}.${s.slice(5, 7)}.`;
  const fmtDM = (s) => `${s.slice(8)}.${s.slice(5, 7)}.`;
  const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: CFG.timezone }) : "–";
  const localDate = (ts) => { const d = new Date(ts); const p = new Intl.DateTimeFormat("en-CA", { timeZone: CFG.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); return p; };

  // ---------------------------------------------------------------- Zahlen
  const n0 = (v) => v == null ? "–" : Math.round(v).toLocaleString("de-AT");
  const n1 = (v) => v == null ? "–" : Number(v).toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n2 = (v) => v == null ? "–" : Number(v).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hm = (sec) => sec == null ? "–" : `${Math.floor(sec / 3600)}:${pad(Math.round((sec % 3600) / 60))} h`;
  const mins = (sec) => sec == null ? "–" : `${Math.round(sec / 60)} min`;
  const avg = (arr) => { const v = arr.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const sum = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const pct = (a, b) => (a == null || !b) ? null : (a / b) * 100;
  const e1rm = (w, r) => (w == null || !r) ? null : r === 1 ? w : w * (1 + r / 30);

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const C = () => ({ s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"), s4: cssVar("--s4"), s5: cssVar("--s5"), s6: cssVar("--s6"), s7: cssVar("--s7"), s8: cssVar("--s8"),
    grid: cssVar("--grid"), axis: cssVar("--axis"), muted: cssVar("--muted"), ink2: cssVar("--ink-2"), surface: cssVar("--surface"),
    seq: [cssVar("--seq-1"), cssVar("--seq-2"), cssVar("--seq-3"), cssVar("--seq-4"), cssVar("--seq-5")], good: cssVar("--good"), warn: cssVar("--warn"), critical: cssVar("--critical") });

  const STATUS_DE = { BALANCED: "ausgeglichen", UNBALANCED: "unausgeglichen", LOW: "niedrig", POOR: "schlecht", EXCELLENT: "exzellent", GOOD: "gut", FAIR: "mäßig",
    HIGH: "hoch", MODERATE: "moderat", VERY_HIGH: "sehr hoch", VERY_GOOD: "sehr gut", PRIME: "optimal", DETRAINING: "Formverlust", MAINTAINING: "Erhalt", PRODUCTIVE: "produktiv",
    PEAKING: "Höchstform", OVERREACHING: "Überlastung", UNPRODUCTIVE: "unproduktiv", RECOVERY: "Erholung", NO_STATUS: "kein Status", OPTIMAL: "optimal", STRAINED: "angespannt", NONE: "–" };
  const tr = (s) => s == null ? "–" : (STATUS_DE[s] || String(s).toLowerCase().replace(/_/g, " "));
  const ACT_DE = { walking: "Gehen", running: "Laufen", hiking: "Wandern", road_biking: "Rennrad", cycling: "Radfahren", strength_training: "Krafttraining", indoor_cycling: "Indoor-Rad",
    swimming: "Schwimmen", lap_swimming: "Schwimmen", yoga: "Yoga", other: "Sonstiges", trail_running: "Trailrunning", mountain_biking: "MTB", treadmill_running: "Laufband", elliptical: "Crosstrainer",
    indoor_cardio: "Indoor-Cardio", fitness_equipment: "Fitnessgerät", e_bike_fitness: "E-Bike", gravel_cycling: "Gravel", cardio: "Cardio" };
  const actName = (t) => ACT_DE[t] || (t || "").replace(/_/g, " ");

  // ---------------------------------------------------------------- Daten
  const D = { daily: new Map(), days: [], activities: [], intensity: [], workouts: [], sets: [], lastSync: null };

  async function fetchAll(table, select, order) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      let q = sb.from(table).select(select).range(from, from + size - 1);
      if (order) q = q.order(order.col, { ascending: order.asc !== false });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  async function loadData() {
    const [daily, acts, intensity, workouts, sets, sync] = await Promise.all([
      fetchAll("garmin_daily", "*", { col: "date" }),
      fetchAll("garmin_activities", "id,date,start_time,name,type,event_type,duration_s,distance_m,calories,avg_hr,max_hr,steps,elevation_gain_m,elevation_loss_m", { col: "start_time" }),
      fetchAll("garmin_weekly_intensity", "*", { col: "week_start" }),
      fetchAll("hevy_workouts", "id,title,routine_id,start_time,end_time,date,duration_s,exercise_count,set_count,working_set_count,volume_kg,total_reps", { col: "start_time" }),
      fetchAll("hevy_sets", "workout_id,exercise_index,set_index,exercise_title,set_type,weight_kg,reps,distance_m,duration_s,rpe,start_time", { col: "start_time" }),
      sb.from("sync_runs").select("ran_at").order("ran_at", { ascending: false }).limit(1),
    ]);
    D.daily = new Map(daily.map((r) => [r.date, r]));
    D.days = daily.map((r) => r.date);
    D.activities = acts; D.intensity = intensity; D.workouts = workouts; D.sets = sets;
    D.lastSync = sync.data && sync.data[0] ? sync.data[0].ran_at : null;
    const byW = new Map();
    for (const s of sets) { if (!byW.has(s.workout_id)) byW.set(s.workout_id, []); byW.get(s.workout_id).push(s); }
    for (const w of workouts) w.sets = (byW.get(w.id) || []).sort((a, b) => a.exercise_index - b.exercise_index || a.set_index - b.set_index);
  }

  const day = (d) => D.daily.get(d) || {};
  const rows = (dates) => dates.map((d) => D.daily.get(d)).filter(Boolean);
  const actsBetween = (a, b) => D.activities.filter((x) => x.date >= a && x.date <= b);
  const workoutsBetween = (a, b) => D.workouts.filter((x) => x.date >= a && x.date <= b);

  // ---------------------------------------------------------------- Charts
  const charts = [];
  function destroyCharts() { while (charts.length) charts.pop().destroy(); }
  function makeChart(canvas, config) {
    const c = C();
    Chart.defaults.color = c.ink2; Chart.defaults.borderColor = c.grid; Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif"; Chart.defaults.font.size = 11; Chart.defaults.locale = "de-AT";
    config.options = config.options || {};
    config.options.maintainAspectRatio = false; config.options.responsive = true;
    config.options.interaction = config.options.interaction || { mode: "index", intersect: false };
    config.options.plugins = Object.assign({ legend: { display: (config.data.datasets || []).filter((d) => !d.hideLegend).length > 1, labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: { backgroundColor: c.surface, titleColor: c.ink2, bodyColor: cssVar("--ink"), borderColor: c.axis, borderWidth: 1, padding: 8 } }, config.options.plugins || {});
    const scales = config.options.scales || {};
    for (const k of Object.keys(scales)) { scales[k].grid = Object.assign({ color: c.grid, drawTicks: false }, scales[k].grid || {}); scales[k].border = Object.assign({ color: c.axis }, scales[k].border || {}); scales[k].ticks = Object.assign({ color: c.muted, maxRotation: 0, autoSkipPadding: 12 }, scales[k].ticks || {}); }
    if (scales.x) scales.x.grid.display = scales.x.grid.display ?? false;
    config.options.scales = scales;
    for (const ds of config.data.datasets) {
      if (config.type === "line" || ds.type === "line") { ds.borderWidth = ds.borderWidth ?? 2; ds.pointRadius = ds.pointRadius ?? 0; ds.pointHoverRadius = 4; ds.tension = ds.tension ?? 0.25; ds.spanGaps = ds.spanGaps ?? true; }
      if (config.type === "bar" && ds.type !== "line") { ds.borderRadius = ds.borderRadius ?? 4; ds.borderSkipped = ds.borderSkipped ?? "start"; ds.maxBarThickness = ds.maxBarThickness ?? 28; }
    }
    const ch = new Chart(canvas, config); charts.push(ch); return ch;
  }
  function chartCard(title, { height = "", subtitle = "", footer = null } = {}, build) {
    const canvas = el("canvas");
    const card = el("div", { class: "card" }, el("h3", {}, title, subtitle ? el("span", { class: "muted" }, subtitle) : null), el("div", { class: `chart ${height}` }, canvas));
    if (footer) card.append(footer);
    queueMicrotask(() => build(canvas));
    return card;
  }
  const line = (labels, datasets, opts = {}) => (canvas) => makeChart(canvas, { type: "line", data: { labels, datasets }, options: { scales: { x: {}, y: Object.assign({ beginAtZero: false }, opts.y || {}) }, plugins: opts.plugins || {} } });
  const bars = (labels, datasets, opts = {}) => (canvas) => makeChart(canvas, { type: "bar", data: { labels, datasets }, options: { scales: { x: Object.assign({ stacked: !!opts.stacked }, opts.x || {}), y: Object.assign({ beginAtZero: true, stacked: !!opts.stacked }, opts.y || {}) }, plugins: opts.plugins || {} } });
  const ds = (label, data, color, extra = {}) => Object.assign({ label, data, borderColor: color, backgroundColor: color }, extra);
  const dashed = (label, data, color) => ds(label, data, color, { borderDash: [4, 4], borderWidth: 1.5 });
  const rolling = (arr, n) => arr.map((_, i) => { const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null); return win.length >= Math.min(3, n) ? win.reduce((a, b) => a + b, 0) / win.length : null; });

  // ---------------------------------------------------------------- UI-Bausteine
  function tile(label, value, { unit = "", sub = "", delta = null, deltaLabel = "", deltaFmt = n1, invert = false, badge = null, badgeClass = "", progress = null } = {}) {
    const t = el("div", { class: "tile" });
    t.append(el("div", { class: "label" }, el("span", {}, label), badge ? el("span", { class: `badge ${badgeClass}` }, badge) : null));
    t.append(el("div", { class: "value" }, value == null || value === "–" ? "–" : value, unit && value != null && value !== "–" ? el("small", {}, unit) : null));
    if (delta != null && !Number.isNaN(delta)) {
      const good = invert ? delta < 0 : delta > 0; const cls = Math.abs(delta) < 1e-9 ? "neutral" : good ? "up" : "down";
      t.append(el("div", { class: `delta ${cls}` }, `${delta > 0 ? "+" : ""}${deltaFmt(delta)} ${deltaLabel}`.trim()));
    }
    if (sub) t.append(el("div", { class: "sub" }, sub));
    if (progress != null) t.append(el("div", { class: "bar" }, el("i", { style: `width:${Math.min(100, Math.max(0, progress))}%` })));
    return t;
  }
  const scoreClass = (v, good, ok) => v == null ? "" : v >= good ? "good" : v >= ok ? "warn" : "bad";
  const card = (title, ...body) => el("div", { class: "card" }, el("h3", {}, title), ...body);
  const section = (title, ...body) => el("section", { class: "block" }, el("h2", {}, title), ...body);
  const table = (heads, rowsData, { numCols = [] } = {}) => el("table", {}, el("thead", {}, el("tr", {}, heads.map((h, i) => el("th", { class: numCols.includes(i) ? "num" : "" }, h)))),
    el("tbody", {}, rowsData.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: numCols.includes(i) ? "num" : "" }, c))))));

  function stagesBar(r) {
    if (!r.sleep_seconds) return el("div", { class: "empty" }, "Keine Schlafdaten");
    const c = C(); const total = (r.deep_seconds || 0) + (r.light_seconds || 0) + (r.rem_seconds || 0) + (r.awake_seconds || 0);
    const parts = [["Tief", r.deep_seconds, c.seq[4]], ["Leicht", r.light_seconds, c.seq[2]], ["REM", r.rem_seconds, c.s7], ["Wach", r.awake_seconds, c.s4]];
    return el("div", {}, el("div", { class: "stages" }, parts.map(([, v, col]) => el("i", { style: `width:${pct(v || 0, total)}%;background:${col}`, title: hm(v) }))),
      el("div", { class: "legend" }, parts.map(([n, v, col]) => el("span", {}, el("i", { style: `background:${col}` }), `${n} ${hm(v)} (${n0(pct(v, total))} %)`))));
  }
  function factorBars(items) {
    const c = C();
    return el("div", { class: "factors" }, items.filter(([, v]) => v != null).map(([name, v, fb]) => el("div", { class: "factor" }, el("span", {}, name), el("div", { class: "bar" }, el("i", { style: `width:${v}%;background:${v >= 75 ? c.good : v >= 50 ? c.warn : c.critical}` })), el("span", { class: "num" }, `${v} %${fb ? " · " + tr(fb) : ""}`))));
  }
  function activityList(acts) {
    if (!acts.length) return el("div", { class: "empty" }, "Keine Garmin-Aktivitäten");
    return table(["Datum", "Aktivität", "Dauer", "Distanz", "kcal", "Ø HF", "max HF", "Höhe ↑"], acts.map((a) => [fmtShort(a.date) + " " + fmtTime(a.start_time), a.name || actName(a.type), mins(a.duration_s), a.distance_m > 0 ? n1(a.distance_m / 1000) + " km" : "–", n0(a.calories), n0(a.avg_hr), n0(a.max_hr), a.elevation_gain_m ? n0(a.elevation_gain_m) + " m" : "–"]), { numCols: [2, 3, 4, 5, 6, 7] });
  }
  function setStr(s) {
    if (s.duration_s && !s.reps) return `${Math.round(s.duration_s / 60)} min`;
    const w = s.weight_kg == null ? "" : `${n1(s.weight_kg).replace(",0", "")} kg × `;
    return `${w}${s.reps ?? "–"}${s.rpe ? ` @${s.rpe}` : ""}`;
  }
  function workoutCard(w, { expanded = true } = {}) {
    const byEx = new Map();
    for (const s of w.sets) { if (!byEx.has(s.exercise_index)) byEx.set(s.exercise_index, { title: s.exercise_title, sets: [] }); byEx.get(s.exercise_index).sets.push(s); }
    const body = el("div", { class: expanded ? "" : "hidden" }, [...byEx.values()].map((ex) => {
      const work = ex.sets.filter((s) => s.set_type !== "warmup"); const top = work.filter((s) => s.weight_kg != null && s.reps).sort((a, b) => e1rm(b.weight_kg, b.reps) - e1rm(a.weight_kg, a.reps))[0];
      return el("div", { class: "sets" }, el("b", {}, ex.title), ": ", work.map(setStr).join(" · ") || ex.sets.map(setStr).join(" · "), top ? el("span", { class: "muted" }, ` · e1RM ${n1(e1rm(top.weight_kg, top.reps))} kg`) : null);
    }));
    const head = el("div", { class: "title" }, el("span", {}, w.title), el("span", { class: "meta" }, `${fmtShort(w.date)} ${fmtTime(w.start_time)} · ${mins(w.duration_s)} · ${w.working_set_count} Sätze · ${n0(w.volume_kg)} kg`));
    const toggle = el("button", { class: "ghost toggle", onclick: () => { body.classList.toggle("hidden"); toggle.textContent = body.classList.contains("hidden") ? "Details" : "Weniger"; } }, expanded ? "Weniger" : "Details");
    return el("div", { class: "workout" }, head, toggle, body);
  }

  // ---------------------------------------------------------------- Ansicht: Tag
  function viewDay(date) {
    const r = day(date); const c = C(); const main = el("div");
    const head = el("div", { class: "viewhead" },
      el("button", { onclick: () => go(`tag/${addDays(date, -1)}`) }, "‹"), el("h2", {}, fmtDate(date)), el("button", { onclick: () => go(`tag/${addDays(date, 1)}`) }, "›"),
      el("button", { onclick: () => go(`tag/${today()}`) }, "Heute"), el("input", { type: "date", value: date, onchange: (e) => e.target.value && go(`tag/${e.target.value}`) }),
      el("a", { href: `#woche/${weekStart(date)}`, class: "small" }, `KW ${isoWeek(date)}`), el("a", { href: `#monat/${date.slice(0, 7)}`, class: "small" }, MONTHS[parseDate(date).getMonth()]));
    main.append(head);
    if (!D.daily.has(date)) main.append(el("div", { class: "empty" }, "Für diesen Tag liegen keine Garmin-Tagesdaten vor."));

    const im = (r.intensity_moderate || 0) + 2 * (r.intensity_vigorous || 0);
    const prev = day(addDays(date, -1));
    main.append(el("div", { class: "tiles" },
      tile("Schlaf", r.sleep_seconds ? hm(r.sleep_seconds).replace(" h", "") : null, { unit: "h", sub: r.sleep_start ? `${fmtTime(r.sleep_start)} – ${fmtTime(r.sleep_end)}` : "", badge: r.sleep_score != null ? `Score ${r.sleep_score}` : null, badgeClass: scoreClass(r.sleep_score, 80, 60) }),
      tile("HFV (Nacht)", r.hrv_last_night, { unit: "ms", sub: `7-Tage Ø ${n0(r.hrv_weekly_avg)} ms · 5-min-Hoch ${n0(r.hrv_5min_high)}`, badge: r.hrv_status ? tr(r.hrv_status) : null, badgeClass: r.hrv_status === "BALANCED" ? "good" : r.hrv_status ? "warn" : "" }),
      tile("Ruhepuls", r.resting_hr ?? r.sleep_rhr, { unit: "bpm", sub: `7-Tage Ø ${n0(r.rhr_7day_avg)} · min ${n0(r.min_hr)} / max ${n0(r.max_hr)}` }),
      tile("Trainingsbereitschaft", r.readiness_score, { unit: "/100", sub: r.recovery_time_hours != null ? `Erholung ${n0(r.recovery_time_hours)} h · ${tr(r.readiness_feedback)}` : "", badge: r.readiness_level ? tr(r.readiness_level) : null, badgeClass: scoreClass(r.readiness_score, 70, 50) }),
      tile("Body Battery", r.bb_high != null ? `${r.bb_low}–${r.bb_high}` : null, { sub: `Aufwachen ${n0(r.bb_at_wake)} · +${n0(r.bb_charged)} / −${n0(r.bb_drained)} · aktuell ${n0(r.bb_latest)}` }),
      tile("Stress", r.stress_avg, { unit: "Ø", sub: `max ${n0(r.stress_max)} · Ruhe ${n0(r.stress_rest_pct)} %`, badge: r.stress_qualifier ? tr(r.stress_qualifier) : null, badgeClass: r.stress_avg == null ? "" : r.stress_avg < 25 ? "good" : r.stress_avg < 50 ? "warn" : "bad" }),
      tile("Schritte", r.steps != null ? n0(r.steps) : null, { sub: r.step_goal ? `Ziel ${n0(r.step_goal)} · ${n1(r.distance_m / 1000)} km` : r.distance_m ? `${n1(r.distance_m / 1000)} km` : "", progress: pct(r.steps, r.step_goal) }),
      tile("Kalorien", r.total_calories != null ? n0(r.total_calories) : null, { unit: "kcal", sub: `aktiv ${n0(r.active_calories)} · Ruhe ${n0(r.resting_calories)}` }),
      tile("Intensitätsminuten", r.intensity_moderate != null ? im : null, { unit: "min", sub: `moderat ${n0(r.intensity_moderate)} · intensiv ${n0(r.intensity_vigorous)}` }),
      tile("Etagen", r.floors_up != null ? n0(r.floors_up) : null, { unit: "↑", sub: `↓ ${n0(r.floors_down)} · aktiv ${mins(r.active_seconds)} · sitzend ${hm(r.sedentary_seconds)}` }),
      tile("SpO₂ / Atmung", r.spo2_avg ?? r.sleep_spo2_avg, { unit: "%", sub: `min ${n0(r.spo2_low ?? r.sleep_spo2_low)} % · Atmung Ø ${n0(r.respiration_avg)} /min` }),
      tile("Gewicht", r.weight_kg != null ? n1(r.weight_kg) : null, { unit: "kg", delta: prev.weight_kg != null && r.weight_kg != null ? r.weight_kg - prev.weight_kg : null, deltaLabel: "vs. Vortag", deltaFmt: n2, invert: true, sub: `KF ${n1(r.body_fat_pct)} % · Muskeln ${n1(r.muscle_mass_kg)} kg · BMI ${n1(r.bmi)}` }),
      tile("VO₂max", r.vo2max != null ? n1(r.vo2max) : null, { sub: r.training_status ? `Status: ${tr(r.training_status)}` : "" }),
      tile("Trainingslast", r.ctl != null ? `${n0(r.atl)} / ${n0(r.ctl)}` : null, { sub: r.acwr_status ? `akut / chronisch · ACWR ${n2(r.acwr)} (${tr(r.acwr_status)}) · optimal ${n0(r.optimal_ctl_min)}–${n0(r.optimal_ctl_max)}` : "akut / chronisch" }),
    ));

    const grid = el("div", { class: "grid" });
    grid.append(card("Schlafphasen", stagesBar(r), r.sleep_seconds ? el("p", { class: "small muted" }, `Ruhepuls im Schlaf ${n0(r.sleep_rhr)} bpm · HFV ${n0(r.sleep_hrv)} ms · Stress ${n0(r.sleep_stress_avg)} · SpO₂ ${n0(r.sleep_spo2_avg)} % (min ${n0(r.sleep_spo2_low)}) · ${n0(r.restless_moments)} unruhige Momente · ${n0(r.awake_count)}× wach${r.nap_seconds ? ` · Nickerchen ${mins(r.nap_seconds)}` : ""}`) : null));
    grid.append(card("Bereitschaftsfaktoren", r.readiness_score != null ? factorBars([["Schlaf", r.readiness_sleep_pct], ["Erholungszeit", r.readiness_recovery_pct], ["Trainingslast", r.readiness_load_pct], ["HFV-Status", r.readiness_hrv_pct], ["Stress-Verlauf", r.readiness_stress_pct], ["Schlaf-Verlauf", r.readiness_sleep_hist_pct]]) : el("div", { class: "empty" }, "Keine Daten")));
    grid.append(card("Stressverteilung", r.stress_rest_pct != null ? (() => { const parts = [["Ruhe", r.stress_rest_pct, c.s3], ["niedrig", r.stress_low_pct, c.s4], ["mittel", r.stress_medium_pct, c.s2], ["hoch", r.stress_high_pct, c.s8]]; const tot = sum(parts.map((p) => p[1])) || 100; return el("div", {}, el("div", { class: "stages" }, parts.map(([, v, col]) => el("i", { style: `width:${(v / tot) * 100}%;background:${col}` }))), el("div", { class: "legend" }, parts.map(([n, v, col]) => el("span", {}, el("i", { style: `background:${col}` }), `${n} ${n0(v)} %`)))); })() : el("div", { class: "empty" }, "Keine Daten")));
    main.append(grid);

    // 14-Tage-Kontext
    const ctx = range(addDays(date, -13), date); const cr = ctx.map((d) => day(d)); const labels = ctx.map(fmtDM);
    main.append(section("14-Tage-Kontext", el("div", { class: "grid" },
      chartCard("HFV", { height: "short" }, line(labels, [ds("Nacht", cr.map((x) => x.hrv_last_night), c.s1, { pointRadius: 2 }), dashed("7-Tage Ø", cr.map((x) => x.hrv_weekly_avg), c.muted)], { y: { title: { display: true, text: "ms" } } })),
      chartCard("Ruhepuls", { height: "short" }, line(labels, [ds("Ruhepuls", cr.map((x) => x.resting_hr ?? x.sleep_rhr), c.s8, { pointRadius: 2 })], { y: { title: { display: true, text: "bpm" } } })),
      chartCard("Schlaf", { height: "short" }, bars(labels, [ds("Tief", cr.map((x) => x.deep_seconds / 3600 || null), c.seq[4]), ds("Leicht", cr.map((x) => x.light_seconds / 3600 || null), c.seq[2]), ds("REM", cr.map((x) => x.rem_seconds / 3600 || null), c.s7), ds("Wach", cr.map((x) => x.awake_seconds / 3600 || null), c.s4)], { stacked: true, y: { title: { display: true, text: "h" } } })),
      chartCard("Bereitschaft & Schlafscore", { height: "short" }, line(labels, [ds("Bereitschaft", cr.map((x) => x.readiness_score), c.s3, { pointRadius: 2 }), ds("Schlafscore", cr.map((x) => x.sleep_score), c.s7, { pointRadius: 2 })], { y: { min: 0, max: 100 } })),
      chartCard("Stress & Body Battery", { height: "short" }, line(labels, [ds("Stress Ø", cr.map((x) => x.stress_avg), c.s2, { pointRadius: 2 }), ds("Body Battery max", cr.map((x) => x.bb_high), c.s1, { pointRadius: 2 }), ds("Body Battery min", cr.map((x) => x.bb_low), c.s4, { pointRadius: 2 })], { y: { min: 0, max: 100 } })),
      chartCard("Schritte", { height: "short" }, bars(labels, [ds("Schritte", cr.map((x) => x.steps), c.s1)])),
    )));

    const acts = actsBetween(date, date); const wos = workoutsBetween(date, date);
    main.append(section(`Training am ${fmtDate(date, { day: "numeric", month: "long" })}`, el("div", { class: "grid wide" },
      card(`Garmin-Aktivitäten (${acts.length})`, activityList(acts)),
      card(`Hevy-Workouts (${wos.length})`, wos.length ? wos.map((w) => workoutCard(w)) : el("div", { class: "empty" }, "Kein Hevy-Workout")))));
    return main;
  }

  // ---------------------------------------------------------------- Aggregation (Woche / Monat)
  function aggregate(dates) {
    const rs = rows(dates); const acts = actsBetween(dates[0], dates[dates.length - 1]); const wos = workoutsBetween(dates[0], dates[dates.length - 1]);
    return {
      days: rs.length, sleep: avg(rs.map((r) => r.sleep_seconds)), sleepScore: avg(rs.map((r) => r.sleep_score)), deep: avg(rs.map((r) => r.deep_seconds)), rem: avg(rs.map((r) => r.rem_seconds)),
      hrv: avg(rs.map((r) => r.hrv_last_night)), rhr: avg(rs.map((r) => r.resting_hr ?? r.sleep_rhr)), readiness: avg(rs.map((r) => r.readiness_score)), stress: avg(rs.map((r) => r.stress_avg)),
      bbHigh: avg(rs.map((r) => r.bb_high)), bbLow: avg(rs.map((r) => r.bb_low)), steps: sum(rs.map((r) => r.steps)), stepsAvg: avg(rs.map((r) => r.steps)), activeCal: sum(rs.map((r) => r.active_calories)), totalCal: avg(rs.map((r) => r.total_calories)),
      intensity: sum(rs.map((r) => r.intensity_moderate != null ? (r.intensity_moderate || 0) + 2 * (r.intensity_vigorous || 0) : null)), floors: sum(rs.map((r) => r.floors_up)),
      weight: avg(rs.map((r) => r.weight_kg)), fat: avg(rs.map((r) => r.body_fat_pct)), muscle: avg(rs.map((r) => r.muscle_mass_kg)), vo2: avg(rs.filter((r) => r.vo2max != null).slice(-1).map((r) => r.vo2max)),
      spo2: avg(rs.map((r) => r.spo2_avg ?? r.sleep_spo2_avg)), resp: avg(rs.map((r) => r.respiration_avg)), sedentary: avg(rs.map((r) => r.sedentary_seconds)),
      acts, actDur: sum(acts.map((a) => a.duration_s)), actCal: sum(acts.map((a) => a.calories)), actDist: sum(acts.map((a) => a.distance_m)),
      wos, volume: sum(wos.map((w) => w.volume_kg)), setsN: sum(wos.map((w) => w.working_set_count)), woDur: sum(wos.map((w) => w.duration_s)),
    };
  }
  function summaryTiles(a, p, periodLabel) {
    const d = (k) => (a[k] != null && p[k] != null) ? a[k] - p[k] : null;
    return el("div", { class: "tiles" },
      tile("Ø Schlaf", a.sleep ? hm(a.sleep).replace(" h", "") : null, { unit: "h", delta: d("sleep") != null ? d("sleep") / 3600 : null, deltaFmt: (v) => n1(v) + " h", deltaLabel: periodLabel, badge: a.sleepScore != null ? `Score ${n0(a.sleepScore)}` : null, badgeClass: scoreClass(a.sleepScore, 80, 60) }),
      tile("Ø HFV", a.hrv != null ? n0(a.hrv) : null, { unit: "ms", delta: d("hrv"), deltaFmt: n1, deltaLabel: periodLabel }),
      tile("Ø Ruhepuls", a.rhr != null ? n1(a.rhr) : null, { unit: "bpm", delta: d("rhr"), invert: true, deltaLabel: periodLabel }),
      tile("Ø Bereitschaft", a.readiness != null ? n0(a.readiness) : null, { unit: "/100", delta: d("readiness"), deltaLabel: periodLabel, badgeClass: scoreClass(a.readiness, 70, 50) }),
      tile("Ø Stress", a.stress != null ? n0(a.stress) : null, { delta: d("stress"), invert: true, deltaLabel: periodLabel }),
      tile("Ø Body Battery", a.bbHigh != null ? `${n0(a.bbLow)}–${n0(a.bbHigh)}` : null, { sub: "min–max pro Tag" }),
      tile("Schritte", a.steps != null ? n0(a.steps) : null, { delta: d("steps"), deltaFmt: n0, deltaLabel: periodLabel, sub: `Ø ${n0(a.stepsAvg)} / Tag` }),
      tile("Aktive Kalorien", a.activeCal != null ? n0(a.activeCal) : null, { unit: "kcal", delta: d("activeCal"), deltaFmt: n0, deltaLabel: periodLabel, sub: `Ø gesamt ${n0(a.totalCal)} kcal/Tag` }),
      tile("Intensitätsminuten", a.intensity != null ? n0(a.intensity) : null, { unit: "min", delta: d("intensity"), deltaFmt: n0, deltaLabel: periodLabel }),
      tile("Garmin-Aktivitäten", a.acts.length, { sub: `${hm(a.actDur)} · ${n0(a.actCal)} kcal · ${n1((a.actDist || 0) / 1000)} km`, delta: a.acts.length - p.acts.length || null, deltaFmt: n0, deltaLabel: periodLabel }),
      tile("Hevy-Workouts", a.wos.length, { sub: `${n0(a.setsN)} Arbeitssätze · ${hm(a.woDur)}`, delta: a.wos.length - p.wos.length || null, deltaFmt: n0, deltaLabel: periodLabel }),
      tile("Kraft-Volumen", a.volume != null ? n0(a.volume) : null, { unit: "kg", delta: d("volume"), deltaFmt: n0, deltaLabel: periodLabel }),
      tile("Ø Gewicht", a.weight != null ? n1(a.weight) : null, { unit: "kg", delta: d("weight"), deltaFmt: n2, invert: true, deltaLabel: periodLabel, sub: `KF ${n1(a.fat)} % · Muskeln ${n1(a.muscle)} kg` }),
      tile("VO₂max", a.vo2 != null ? n1(a.vo2) : null, { delta: d("vo2"), deltaLabel: periodLabel, sub: "letzter Wert im Zeitraum" }),
    );
  }
  function workoutSummaryTable(wos) {
    if (!wos.length) return el("div", { class: "empty" }, "Keine Hevy-Workouts");
    return el("div", {}, wos.slice().reverse().map((w) => workoutCard(w, { expanded: false })));
  }
  function exerciseTop(wos) {
    const m = new Map();
    for (const w of wos) for (const s of w.sets) {
      if (s.set_type === "warmup" || s.weight_kg == null || !s.reps) continue;
      const k = s.exercise_title; const cur = m.get(k) || { sets: 0, vol: 0, best: null, bestStr: "" };
      cur.sets++; cur.vol += s.weight_kg * s.reps; const e = e1rm(s.weight_kg, s.reps);
      if (cur.best == null || e > cur.best) { cur.best = e; cur.bestStr = setStr(s); }
      m.set(k, cur);
    }
    const list = [...m.entries()].sort((a, b) => b[1].vol - a[1].vol);
    if (!list.length) return el("div", { class: "empty" }, "Keine Kraftsätze");
    return table(["Übung", "Sätze", "Volumen", "Top-Satz", "e1RM"], list.map(([k, v]) => [k, v.sets, n0(v.vol) + " kg", v.bestStr, n1(v.best) + " kg"]), { numCols: [1, 2, 3, 4] });
  }
  function activityTypeTable(acts) {
    const m = new Map();
    for (const a of acts) { const cur = m.get(a.type) || { n: 0, dur: 0, dist: 0, cal: 0 }; cur.n++; cur.dur += a.duration_s || 0; cur.dist += a.distance_m || 0; cur.cal += a.calories || 0; m.set(a.type, cur); }
    if (!m.size) return el("div", { class: "empty" }, "Keine Aktivitäten");
    return table(["Typ", "Anzahl", "Dauer", "Distanz", "kcal"], [...m.entries()].sort((a, b) => b[1].dur - a[1].dur).map(([t, v]) => [actName(t), v.n, hm(v.dur), v.dist ? n1(v.dist / 1000) + " km" : "–", n0(v.cal)]), { numCols: [1, 2, 3, 4] });
  }

  // ---------------------------------------------------------------- Ansicht: Woche
  function viewWeek(start) {
    start = weekStart(start); const end = addDays(start, 6); const dates = range(start, end); const c = C();
    const a = aggregate(dates); const p = aggregate(range(addDays(start, -7), addDays(start, -1)));
    const main = el("div");
    main.append(el("div", { class: "viewhead" },
      el("button", { onclick: () => go(`woche/${addDays(start, -7)}`) }, "‹"), el("h2", {}, `KW ${isoWeek(start)} · ${fmtDM(start)} – ${fmtDate(end, { day: "numeric", month: "long", year: "numeric" })}`), el("button", { onclick: () => go(`woche/${addDays(start, 7)}`) }, "›"),
      el("button", { onclick: () => go(`woche/${weekStart(today())}`) }, "Diese Woche"), el("input", { type: "date", value: start, onchange: (e) => e.target.value && go(`woche/${e.target.value}`) }),
      el("span", { class: "sub" }, `${a.days} von 7 Tagen mit Daten · Vergleich zur Vorwoche`)));
    main.append(summaryTiles(a, p, "vs. Vorwoche"));

    const rs = dates.map((d) => day(d)); const labels = dates.map(fmtShort);
    const wk = D.intensity.find((w) => w.week_start === start);
    main.append(section("Tagesverlauf", el("div", { class: "grid" },
      chartCard("Schlaf nach Phasen", {}, bars(labels, [ds("Tief", rs.map((x) => x.deep_seconds / 3600 || null), c.seq[4]), ds("Leicht", rs.map((x) => x.light_seconds / 3600 || null), c.seq[2]), ds("REM", rs.map((x) => x.rem_seconds / 3600 || null), c.s7), ds("Wach", rs.map((x) => x.awake_seconds / 3600 || null), c.s4)], { stacked: true, y: { title: { display: true, text: "h" } } })),
      chartCard("HFV", {}, line(labels, [ds("Nacht", rs.map((x) => x.hrv_last_night), c.s1, { pointRadius: 3 }), dashed("7-Tage Ø", rs.map((x) => x.hrv_weekly_avg), c.muted)], { y: { title: { display: true, text: "ms" } } })),
      chartCard("Ruhepuls & Schlafscore", {}, line(labels, [ds("Ruhepuls (bpm)", rs.map((x) => x.resting_hr ?? x.sleep_rhr), c.s8, { pointRadius: 3 }), ds("Schlafscore", rs.map((x) => x.sleep_score), c.s7, { pointRadius: 3 })])),
      chartCard("Bereitschaft & Stress", {}, line(labels, [ds("Bereitschaft", rs.map((x) => x.readiness_score), c.s3, { pointRadius: 3 }), ds("Stress Ø", rs.map((x) => x.stress_avg), c.s2, { pointRadius: 3 })], { y: { min: 0, max: 100 } })),
      chartCard("Body Battery", {}, line(labels, [ds("max", rs.map((x) => x.bb_high), c.s1, { pointRadius: 3 }), ds("beim Aufwachen", rs.map((x) => x.bb_at_wake), c.s3, { pointRadius: 3 }), ds("min", rs.map((x) => x.bb_low), c.s4, { pointRadius: 3 })], { y: { min: 0, max: 100 } })),
      chartCard("Schritte", {}, bars(labels, [ds("Schritte", rs.map((x) => x.steps), c.s1), Object.assign(dashed("Ziel", rs.map((x) => x.step_goal), c.muted), { type: "line", pointRadius: 0 })])),
      chartCard("Kalorien", {}, bars(labels, [ds("Ruhe", rs.map((x) => x.resting_calories), c.seq[1]), ds("aktiv", rs.map((x) => x.active_calories), c.s2)], { stacked: true })),
      chartCard("Intensitätsminuten", { subtitle: wk ? `Woche: ${wk.total_minutes} / Ziel ${wk.goal}` : "" }, bars(labels, [ds("moderat", rs.map((x) => x.intensity_moderate), c.seq[2]), ds("intensiv (×2)", rs.map((x) => x.intensity_vigorous != null ? 2 * x.intensity_vigorous : null), c.s2)], { stacked: true })),
      chartCard("Gewicht & Körperfett", {}, line(labels, [ds("Gewicht (kg)", rs.map((x) => x.weight_kg), c.s1, { pointRadius: 3 })], { y: { title: { display: true, text: "kg" } } })),
      chartCard("Körperfett & Muskelmasse", {}, line(labels, [ds("Körperfett (%)", rs.map((x) => x.body_fat_pct), c.s2, { pointRadius: 3 }), ds("Muskelmasse (kg)", rs.map((x) => x.muscle_mass_kg), c.s3, { pointRadius: 3 })])),
      chartCard("Trainingslast", {}, line(labels, [ds("akut (ATL)", rs.map((x) => x.atl), c.s2, { pointRadius: 3 }), ds("chronisch (CTL)", rs.map((x) => x.ctl), c.s1, { pointRadius: 3 })], { y: { beginAtZero: true } })),
      chartCard("Kraft-Volumen (Hevy)", {}, bars(labels, [ds("Volumen (kg)", dates.map((d) => sum(workoutsBetween(d, d).map((w) => w.volume_kg))), c.s7)])),
    )));
    main.append(section("Training", el("div", { class: "grid" },
      card(`Garmin-Aktivitäten (${a.acts.length})`, activityList(a.acts.slice().reverse())),
      card("Aktivitäten nach Typ", activityTypeTable(a.acts)),
      card(`Hevy-Workouts (${a.wos.length})`, workoutSummaryTable(a.wos)),
      card("Übungen der Woche", exerciseTop(a.wos)))));
    main.append(section("Tagestabelle", el("div", { class: "card" }, table(["Tag", "Schlaf", "Score", "HFV", "RHR", "Bereit.", "Stress", "BB", "Schritte", "akt. kcal", "Gewicht"],
      dates.map((d) => { const x = day(d); return [el("a", { href: `#tag/${d}` }, fmtShort(d)), hm(x.sleep_seconds), n0(x.sleep_score), n0(x.hrv_last_night), n0(x.resting_hr ?? x.sleep_rhr), n0(x.readiness_score), n0(x.stress_avg), x.bb_high != null ? `${x.bb_low}–${x.bb_high}` : "–", n0(x.steps), n0(x.active_calories), x.weight_kg != null ? n1(x.weight_kg) : "–"]; }), { numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }))));
    return main;
  }

  // ---------------------------------------------------------------- Ansicht: Monat
  function viewMonth(ym) {
    const start = monthStart(ym + "-01"); const n = daysInMonth(start); const end = addDays(start, n - 1); const dates = range(start, end); const c = C();
    const a = aggregate(dates); const pStart = addMonths(start, -1); const p = aggregate(range(pStart, addDays(start, -1)));
    const d0 = parseDate(start); const main = el("div");
    main.append(el("div", { class: "viewhead" },
      el("button", { onclick: () => go(`monat/${addMonths(start, -1).slice(0, 7)}`) }, "‹"), el("h2", {}, `${MONTHS[d0.getMonth()]} ${d0.getFullYear()}`), el("button", { onclick: () => go(`monat/${addMonths(start, 1).slice(0, 7)}`) }, "›"),
      el("button", { onclick: () => go(`monat/${today().slice(0, 7)}`) }, "Dieser Monat"), el("input", { type: "month", value: start.slice(0, 7), onchange: (e) => e.target.value && go(`monat/${e.target.value}`) }),
      el("span", { class: "sub" }, `${a.days} von ${n} Tagen mit Daten · Vergleich zum Vormonat`)));
    main.append(summaryTiles(a, p, "vs. Vormonat"));

    // Kalender
    const cal = el("div", { class: "cal" }, DOW.map((d) => el("div", { class: "dow" }, d)));
    const offset = (d0.getDay() + 6) % 7; for (let i = 0; i < offset; i++) cal.append(el("div", { class: "day empty" }));
    for (const d of dates) {
      const x = day(d); const acts = actsBetween(d, d); const wos = workoutsBetween(d, d);
      const sc = x.sleep_score; const col = sc == null ? "transparent" : sc >= 80 ? c.good : sc >= 60 ? c.warn : c.critical;
      cal.append(el("div", { class: "day", title: `${fmtDate(d)}: Schlaf ${hm(x.sleep_seconds)}, Score ${n0(sc)}, HFV ${n0(x.hrv_last_night)}, Bereitschaft ${n0(x.readiness_score)}${acts.length ? ", " + acts.map((q) => q.name).join(", ") : ""}${wos.length ? ", " + wos.map((q) => q.title).join(", ") : ""}`, onclick: () => go(`tag/${d}`) },
        el("div", { class: "d" }, String(Number(d.slice(8)))), el("div", { class: "score", style: `color:${col}` }, sc != null ? sc : ""),
        el("div", { class: "marks" }, acts.map(() => el("i", { style: `background:${c.s1}`, title: "Garmin-Aktivität" })), wos.map(() => el("i", { style: `background:${c.s7}`, title: "Hevy-Workout" })))));
    }
    const rs = dates.map((d) => day(d)); const labels = dates.map((d) => String(Number(d.slice(8))));
    // Wochenaggregate im Monat (Hevy Volumen, Intensitätsminuten)
    const weeks = []; for (let w = weekStart(start); w <= end; w = addDays(w, 7)) weeks.push(w);
    const wkLabels = weeks.map((w) => `KW ${isoWeek(w)}`);

    main.append(section("Kalender", el("div", { class: "grid" },
      el("div", { class: "card", style: "grid-column: 1 / -1; max-width: 720px" }, el("h3", {}, "Schlafscore & Trainingstage", el("span", { class: "muted" }, "● Garmin-Aktivität · ● Hevy-Workout")), cal))));

    main.append(section("Trends", el("div", { class: "grid" },
      chartCard("Gewicht", {}, line(labels, [ds("Gewicht (kg)", rs.map((x) => x.weight_kg), c.s1, { pointRadius: 2 }), dashed("7-Tage Ø", rolling(rs.map((x) => x.weight_kg), 7), c.muted)], { y: { title: { display: true, text: "kg" } } })),
      chartCard("Körperfett & Muskelmasse", {}, line(labels, [ds("Körperfett (%)", rs.map((x) => x.body_fat_pct), c.s2, { pointRadius: 2 }), ds("Muskelmasse (kg)", rs.map((x) => x.muscle_mass_kg), c.s3, { pointRadius: 2 })])),
      chartCard("Schlafdauer", {}, bars(labels, [ds("Schlaf (h)", rs.map((x) => x.sleep_seconds ? x.sleep_seconds / 3600 : null), c.seq[3]), Object.assign(dashed("7-Tage Ø", rolling(rs.map((x) => x.sleep_seconds ? x.sleep_seconds / 3600 : null), 7), c.muted), { type: "line" })], { y: { title: { display: true, text: "h" } } })),
      chartCard("Schlafphasen", {}, bars(labels, [ds("Tief", rs.map((x) => x.deep_seconds / 3600 || null), c.seq[4]), ds("Leicht", rs.map((x) => x.light_seconds / 3600 || null), c.seq[2]), ds("REM", rs.map((x) => x.rem_seconds / 3600 || null), c.s7), ds("Wach", rs.map((x) => x.awake_seconds / 3600 || null), c.s4)], { stacked: true, y: { title: { display: true, text: "h" } } })),
      chartCard("HFV", {}, line(labels, [ds("Nacht", rs.map((x) => x.hrv_last_night), c.s1, { pointRadius: 2 }), dashed("7-Tage Ø", rs.map((x) => x.hrv_weekly_avg), c.muted)], { y: { title: { display: true, text: "ms" } } })),
      chartCard("Ruhepuls", {}, line(labels, [ds("Ruhepuls", rs.map((x) => x.resting_hr ?? x.sleep_rhr), c.s8, { pointRadius: 2 }), dashed("7-Tage Ø", rolling(rs.map((x) => x.resting_hr ?? x.sleep_rhr), 7), c.muted)], { y: { title: { display: true, text: "bpm" } } })),
      chartCard("Bereitschaft & Schlafscore", {}, line(labels, [ds("Bereitschaft", rs.map((x) => x.readiness_score), c.s3, { pointRadius: 2 }), ds("Schlafscore", rs.map((x) => x.sleep_score), c.s7, { pointRadius: 2 })], { y: { min: 0, max: 100 } })),
      chartCard("Stress & Body Battery", {}, line(labels, [ds("Stress Ø", rs.map((x) => x.stress_avg), c.s2, { pointRadius: 2 }), ds("Body Battery max", rs.map((x) => x.bb_high), c.s1, { pointRadius: 2 }), ds("Body Battery min", rs.map((x) => x.bb_low), c.s4, { pointRadius: 2 })], { y: { min: 0, max: 100 } })),
      chartCard("Schritte", {}, bars(labels, [ds("Schritte", rs.map((x) => x.steps), c.s1), Object.assign(dashed("7-Tage Ø", rolling(rs.map((x) => x.steps), 7), c.muted), { type: "line" })])),
      chartCard("Aktive Kalorien", {}, bars(labels, [ds("aktiv (kcal)", rs.map((x) => x.active_calories), c.s2)])),
      chartCard("Trainingslast", {}, line(labels, [ds("akut (ATL)", rs.map((x) => x.atl), c.s2, { pointRadius: 0 }), ds("chronisch (CTL)", rs.map((x) => x.ctl), c.s1, { pointRadius: 0 }), dashed("optimal min", rs.map((x) => x.optimal_ctl_min), c.muted), dashed("optimal max", rs.map((x) => x.optimal_ctl_max), c.muted)], { y: { beginAtZero: true } })),
      chartCard("VO₂max", {}, line(labels, [ds("VO₂max", rs.map((x) => x.vo2max), c.s3, { pointRadius: 2, stepped: true })])),
      chartCard("Intensitätsminuten pro Woche", {}, bars(wkLabels, [ds("moderat", weeks.map((w) => (D.intensity.find((i) => i.week_start === w) || {}).moderate_minutes), c.seq[2]), ds("intensiv (×2)", weeks.map((w) => { const i = D.intensity.find((q) => q.week_start === w); return i ? 2 * i.vigorous_minutes : null; }), c.s2), Object.assign(dashed("Ziel", weeks.map((w) => (D.intensity.find((i) => i.week_start === w) || {}).goal), c.muted), { type: "line", pointRadius: 0 })], { stacked: true })),
      chartCard("Kraft-Volumen pro Woche", {}, bars(wkLabels, [ds("Volumen (kg)", weeks.map((w) => sum(workoutsBetween(w, addDays(w, 6)).map((q) => q.volume_kg))), c.s7)])),
      chartCard("Arbeitssätze pro Woche", {}, bars(wkLabels, [ds("Sätze", weeks.map((w) => sum(workoutsBetween(w, addDays(w, 6)).map((q) => q.working_set_count))), c.s7)])),
      chartCard("Aktivitätsdauer pro Woche", {}, bars(wkLabels, [ds("Garmin (h)", weeks.map((w) => { const s = sum(actsBetween(w, addDays(w, 6)).map((q) => q.duration_s)); return s == null ? null : s / 3600; }), c.s1), ds("Hevy (h)", weeks.map((w) => { const s = sum(workoutsBetween(w, addDays(w, 6)).map((q) => q.duration_s)); return s == null ? null : s / 3600; }), c.s7)], { stacked: true })),
    )));
    main.append(section("Training", el("div", { class: "grid" },
      card("Aktivitäten nach Typ", activityTypeTable(a.acts)),
      card("Übungen des Monats", exerciseTop(a.wos))),
      el("div", { class: "grid wide" },
      card(`Garmin-Aktivitäten (${a.acts.length})`, activityList(a.acts.slice().reverse())),
      card(`Hevy-Workouts (${a.wos.length})`, workoutSummaryTable(a.wos)))));
    return main;
  }

  // ---------------------------------------------------------------- Ansicht: Kraft (Übungsverlauf)
  function viewStrength(exName) {
    const c = C(); const main = el("div");
    const freq = new Map();
    for (const s of D.sets) if (s.set_type !== "warmup" && s.weight_kg != null && s.reps) freq.set(s.exercise_title, (freq.get(s.exercise_title) || 0) + 1);
    const exercises = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const current = exName && exercises.includes(exName) ? exName : exercises[0];
    const sel = el("select", { onchange: (e) => go(`kraft/${encodeURIComponent(e.target.value)}`) }, exercises.map((x) => el("option", { value: x, selected: x === current ? "" : null }, `${x} (${freq.get(x)} Sätze)`)));
    main.append(el("div", { class: "viewhead" }, el("h2", {}, "Kraft & Übungsverlauf"), sel));

    // Überblick: Workouts pro Woche (letzte 26 Wochen)
    const weeks = []; for (let w = weekStart(addDays(today(), -7 * 25)); w <= today(); w = addDays(w, 7)) weeks.push(w);
    const wkLabels = weeks.map((w) => `KW ${isoWeek(w)}`);
    const titleCount = new Map(); for (const w of D.workouts) titleCount.set(w.title, (titleCount.get(w.title) || 0) + 1);
    main.append(el("div", { class: "tiles" },
      tile("Workouts gesamt", D.workouts.length, { sub: D.workouts.length ? `seit ${fmtDM(D.workouts[0].date)}${D.workouts[0].date.slice(0, 4)}` : "" }),
      tile("Letzte 4 Wochen", workoutsBetween(addDays(today(), -27), today()).length, { sub: `${n0(sum(workoutsBetween(addDays(today(), -27), today()).map((w) => w.volume_kg)))} kg Volumen` }),
      tile("Arbeitssätze gesamt", n0(sum(D.workouts.map((w) => w.working_set_count)))),
      tile("Gesamtvolumen", n0(sum(D.workouts.map((w) => w.volume_kg)) / 1000), { unit: "t" }),
      tile("Übungen", exercises.length, { sub: "mit Gewicht & Wdh." }),
    ));
    main.append(el("div", { class: "grid" },
      chartCard("Workouts pro Woche", {}, bars(wkLabels, [ds("Workouts", weeks.map((w) => workoutsBetween(w, addDays(w, 6)).length), c.s7)], { y: { ticks: { stepSize: 1 } } })),
      chartCard("Volumen pro Woche", {}, bars(wkLabels, [ds("Volumen (kg)", weeks.map((w) => sum(workoutsBetween(w, addDays(w, 6)).map((q) => q.volume_kg))), c.s7)])),
      chartCard("Arbeitssätze pro Woche", {}, bars(wkLabels, [ds("Sätze", weeks.map((w) => sum(workoutsBetween(w, addDays(w, 6)).map((q) => q.working_set_count))), c.s7)])),
    ));

    if (current) {
      const sessions = new Map();
      for (const s of D.sets) {
        if (s.exercise_title !== current || s.set_type === "warmup" || s.weight_kg == null || !s.reps) continue;
        const d = localDate(s.start_time); const cur = sessions.get(d) || { date: d, sets: [], vol: 0, top: null, best: null, maxW: 0 };
        cur.sets.push(s); cur.vol += s.weight_kg * s.reps; const e = e1rm(s.weight_kg, s.reps);
        if (cur.best == null || e > cur.best) { cur.best = e; cur.top = s; } cur.maxW = Math.max(cur.maxW, s.weight_kg);
        sessions.set(d, cur);
      }
      const list = [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date)); const labels = list.map((x) => fmtDM(x.date) + x.date.slice(2, 4));
      const pr = list.reduce((m, x) => x.best > (m?.best ?? -1) ? x : m, null);
      main.append(section(current, el("div", { class: "tiles" },
        tile("Bestes e1RM", pr ? n1(pr.best) : null, { unit: "kg", sub: pr ? `${setStr(pr.top)} am ${fmtDM(pr.date)}${pr.date.slice(0, 4)}` : "" }),
        tile("Letztes e1RM", list.length ? n1(list[list.length - 1].best) : null, { unit: "kg", sub: list.length ? `${setStr(list[list.length - 1].top)} am ${fmtDM(list[list.length - 1].date)}` : "", delta: list.length > 1 ? list[list.length - 1].best - list[list.length - 2].best : null, deltaLabel: "vs. vorherige Einheit" }),
        tile("Höchstes Gewicht", list.length ? n1(Math.max(...list.map((x) => x.maxW))) : null, { unit: "kg" }),
        tile("Einheiten", list.length, { sub: `${n0(sum(list.map((x) => x.sets.length)))} Arbeitssätze` }),
      ), el("div", { class: "grid" },
        chartCard("Geschätztes 1RM (Epley) pro Einheit", {}, line(labels, [ds("e1RM (kg)", list.map((x) => x.best), c.s1, { pointRadius: 3 }), ds("Top-Gewicht (kg)", list.map((x) => x.maxW), c.s2, { pointRadius: 3 })])),
        chartCard("Volumen pro Einheit", {}, bars(labels, [ds("Volumen (kg)", list.map((x) => x.vol), c.s7)])),
        el("div", { class: "card", style: "grid-column: 1 / -1" }, el("h3", {}, "Einheiten"), table(["Datum", "Sätze", "Top-Satz", "e1RM", "Volumen"], list.slice().reverse().slice(0, 40).map((x) => [el("a", { href: `#tag/${x.date}` }, fmtDate(x.date, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })), x.sets.map(setStr).join(" · "), setStr(x.top), n1(x.best) + " kg", n0(x.vol) + " kg"]), { numCols: [3, 4] })))));
    }
    main.append(section("Workout-Vorlagen", el("div", { class: "card" }, table(["Titel", "Anzahl", "zuletzt", "Ø Volumen", "Ø Dauer"], [...titleCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, k]) => { const ws = D.workouts.filter((w) => w.title === t); return [t, k, fmtShort(ws[ws.length - 1].date), n0(avg(ws.map((w) => w.volume_kg))) + " kg", mins(avg(ws.map((w) => w.duration_s)))]; }), { numCols: [1, 3, 4] }))));
    return main;
  }

  // ---------------------------------------------------------------- Router / Auth
  const go = (hash) => { location.hash = hash; };
  function render() {
    destroyCharts();
    const [view, ...rest] = (location.hash.replace(/^#/, "") || "tag").split("/"); const arg = rest.join("/");
    let node;
    if (view === "woche") node = viewWeek(arg || today());
    else if (view === "monat") node = viewMonth((arg || today()).slice(0, 7));
    else if (view === "kraft") node = viewStrength(arg ? decodeURIComponent(arg) : null);
    else node = viewDay(arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : (D.days.length ? D.days[D.days.length - 1] : today()));
    for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("active", a.dataset.view === (["woche", "monat", "kraft"].includes(view) ? view : "tag"));
    const m = $("#main"); m.replaceChildren(node); window.scrollTo(0, 0);
  }

  function showLogin(msg = "", error = false) { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); const m = $("#login-msg"); m.textContent = msg; m.classList.toggle("error", error); }
  async function showApp() {
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#loading").classList.remove("hidden");
    try { await loadData(); } catch (e) { $("#main").replaceChildren(el("div", { class: "empty" }, `Fehler beim Laden: ${e.message || e}`)); return; }
    $("#sync-info").textContent = D.lastSync ? `Stand: ${new Date(D.lastSync).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })} · ${D.days.length} Tage · ${D.workouts.length} Workouts` : "";
    render();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (!f.get("password")) return showLogin("Bitte Passwort eingeben oder Magic-Link anfordern.", true);
    showLogin("Anmeldung …");
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
    if (error) showLogin(error.message, true);
  });
  $("#magic-link").addEventListener("click", async () => {
    const email = $("#login-form input[name=email]").value; if (!email) return showLogin("Bitte E-Mail eingeben.", true);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    showLogin(error ? error.message : "Link gesendet. Bitte E-Mail prüfen.", !!error);
  });
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("theme", next); } catch (_) { /* egal */ }
    if (!$("#app").classList.contains("hidden")) render();
  });
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* egal */ }

  window.addEventListener("hashchange", () => { if (!$("#app").classList.contains("hidden") && D.days) render(); });
  sb.auth.onAuthStateChange((event, session) => {
    if (session) { if ($("#app").classList.contains("hidden")) showApp(); }
    else showLogin();
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) showLogin(); });
})();
