"use strict";

/* Reiter "Farben und Schrift": alle Farben, die Theme und Extension setzen, und die Schriftgrößen als Prozent der bisherigen Größe.
 *  - Farben des Hauptfensters: Variablen --ms-* des Themes (Hell/Dunkel getrennt). Gespeichert wird nur, was vom Theme abweicht
 *    (mainColors), alles andere folgt weiter dem Theme. Die vier Farben der Dialoge/Einstellungen/Verfassen bleiben in "colors".
 *  - Schrift: Faktoren in Prozent; background.js gibt sie an das Experiment settingsRedesign weiter.
 * Benötigt aus options.js: t, DEFAULTS, save. */
(async () => {
  const COLOR_GROUPS = [
    ["g_areas", ["spaces", "toolbar", "sidebar", "list"]],
    ["g_text", ["text", "muted", "sidebarText", "border", "rowLine", "hover"]],
    ["g_accent", ["accent", "accentDark", "accentSoft", "accentFocus", "count"]],
  ];
  const PAIRS = { count: ["countBg", "countFg"] };
  const DIALOG = [["d_bg", "bg", "bgLabel", "cd_dbg"], ["d_fg", "fg", "fgLabel", "cd_dfg"], ["d_border", "border", "borderLabel", "cd_dborder"], ["d_accent", "accent", "accentLabel", "cd_daccent"]];
  const COMPOSE_BASE = 13.3; // px, wie compose.css
  const FAMILIES = ["", "system-ui", "Segoe UI", "Noto Sans", "Cantarell", "Ubuntu", "Arial", "Verdana"];

  const s = await messenger.storage.local.get(DEFAULTS);
  let theme = null;
  try {
    theme = await messenger.runtime.sendMessage({ type: "themeColors" });
  } catch (e) {
    theme = null;
  }
  theme = theme && theme.light ? theme : { light: {}, dark: {}, rowH: "", rowPad: "" };
  document.getElementById("cfNoTheme").hidden = Boolean(theme.light.accent); // ohne NovaBird-Theme gibt es keine --ms-Variablen

  const ctx = document.createElement("canvas").getContext("2d");
  const hex = v => {
    if (/^#[0-9a-f]{6}$/i.test(v || "")) {
      return v.toLowerCase();
    }
    ctx.fillStyle = "#808080";
    ctx.fillStyle = v || "#808080";
    return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle.toLowerCase() : "#808080";
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (text !== undefined) {
      e.textContent = text;
    }
    return e;
  };
  const fmt = n => String(Math.round(n * 10) / 10).replace(".", ",");

  let mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const mainColors = { light: { ...(s.mainColors?.light || {}) }, dark: { ...(s.mainColors?.dark || {}) } };
  const dialog = { ...DEFAULTS.colors, ...s.colors };

  const base = key => hex(theme[mode][key]);
  const cur = key => mainColors[mode][key] || base(key);
  let customOn = s.colorMode === "custom";
  const isCustom = () => customOn;

  // ---- Skizze ------------------------------------------------------------------------------------
  const prev = document.getElementById("cfPrev");
  function paint() {
    const custom = isCustom();
    const all = Object.values(PAIRS).flat().concat(COLOR_GROUPS.flatMap(g => g[1]).filter(k => !PAIRS[k]));
    for (const key of all) {
      prev.style.setProperty("--c-" + key, custom ? cur(key) : base(key));
    }
    const d = custom ? dialog : { bg: base("toolbar"), fg: base("text"), border: base("border"), accent: base("accent") };
    for (const [id, key] of DIALOG) {
      prev.style.setProperty("--c-" + id, d[key]);
    }
  }
  function highlight(keys, on) {
    for (const k of keys) {
      for (const e of prev.querySelectorAll(`[data-c~="${k}"]`)) {
        e.classList.toggle("hl", on);
      }
    }
  }

  // ---- Farben -------------------------------------------------------------------------------------
  const grid = document.getElementById("cfGrid");
  const inputs = []; // { input, key, kind: "main" | "dialog", dkey }
  const codes = [];

  function colorRow(rowKey, keys, name, desc, kind) {
    const row = el("div", "cf-row" + (keys.length > 1 ? " two" : ""));
    const pair = el("div", "pair");
    for (const key of keys) {
      const input = el("input");
      input.type = "color";
      input.setAttribute("aria-label", name);
      input.addEventListener("input", () => {
        if (kind === "dialog") {
          dialog[key] = input.value;
          save({ colors: { ...dialog } }); // sofort speichern: Vorschau beim Ziehen im Farbwähler
        } else {
          if (input.value.toLowerCase() === base(key)) {
            delete mainColors[mode][key]; // wie das Theme: nicht speichern, folgt weiter dem Theme
          } else {
            mainColors[mode][key] = input.value.toLowerCase();
          }
          save({ mainColors: { light: { ...mainColors.light }, dark: { ...mainColors.dark } } });
        }
        sync();
      });
      inputs.push({ input, key, kind });
      pair.append(input);
    }
    const text = el("div");
    text.append(el("b", "", name), el("small", "", desc));
    const code = el("code");
    codes.push({ code, keys, kind });
    row.append(pair, text, code);
    row.addEventListener("mouseenter", () => highlight([rowKey], true));
    row.addEventListener("mouseleave", () => highlight([rowKey], false));
    return row;
  }

  for (const [gk, rows] of COLOR_GROUPS) {
    grid.append(el("h4", "", t[gk]));
    for (const rk of rows) {
      grid.append(colorRow(rk, PAIRS[rk] || [rk], t["c_" + rk], t["cd_" + rk], "main"));
    }
  }
  grid.append(el("h4", "", t.g_dialog));
  for (const [id, key, nameKey, descKey] of DIALOG) {
    grid.append(colorRow(id, [key], t[nameKey], t[descKey], "dialog"));
  }

  function sync() {
    for (const { input, key, kind } of inputs) {
      input.value = kind === "dialog" ? dialog[key] : cur(key);
    }
    for (const { code, keys, kind } of codes) {
      code.textContent = keys.map(k => (kind === "dialog" ? dialog[k] : cur(k))).join(" ");
    }
    paint();
  }

  const seg = document.getElementById("cfModeSeg");
  const syncSeg = () => {
    for (const b of seg.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.m === mode);
    }
  };
  seg.addEventListener("click", e => {
    const m = e.target.dataset?.m;
    if (m) {
      mode = m;
      syncSeg();
      sync();
    }
  });
  for (const r of document.querySelectorAll("input[name=colorMode]")) {
    r.addEventListener("change", () => {
      if (r.checked) {
        customOn = r.value === "custom";
        paint();
      }
    });
  }
  document.getElementById("reset").addEventListener("click", () => {
    mainColors.light = {};
    mainColors.dark = {};
    Object.assign(dialog, DEFAULTS.colors);
    save({ mainColors: { light: {}, dark: {} }, colors: { ...DEFAULTS.colors } });
    sync();
  });
  syncSeg();
  sync();

  // ---- Schrift ------------------------------------------------------------------------------------
  const val = key => Number(s[key]) || 100;
  const padPx = pct => {
    const m = String(theme.rowPad || "").match(/-?\d+(?:\.\d+)?/g);
    return m ? m.map(n => fmt((parseFloat(n) * pct) / 100)).join(" / ") + " px" : "";
  };
  const rowPx = pct => {
    const n = parseFloat(theme.rowH);
    return n ? fmt((n * pct) / 100) + " px" : "";
  };
  const FONTS = [
    ["fg_main", [
      { id: "family", key: "fontFamily", select: true },
      { id: "row", key: "fontRow", min: 70, max: 150, hint: p => rowPx(p) },
      { id: "pad", key: "fontPad", min: 70, max: 150, hint: p => padPx(p) },
    ]],
    ["fg_compose", [
      { id: "compose", key: "fontCompose", min: 80, max: 140, hint: p => "≥ " + fmt((COMPOSE_BASE * p) / 100) + " px" },
      { id: "subject", key: "fontSubject", min: 80, max: 160, hint: p => fmt((COMPOSE_BASE * 1.143 * val("fontCompose") * p) / 10000) + " px" },
      { id: "labels", key: "fontLabels", min: 70, max: 130, hint: p => fmt((COMPOSE_BASE * 0.929 * val("fontCompose") * p) / 10000) + " px" },
      { id: "sample", key: "fontSample", min: 80, max: 160, hint: p => fmt((COMPOSE_BASE * 1.286 * val("fontCompose") * p) / 10000) + " px" },
    ]],
    ["fg_other", [
      { id: "settings", key: "fontSettings", min: 80, max: 140, hint: p => fmt((14 * p) / 100) + " px" },
      { id: "contact", key: "fontContact", min: 80, max: 140, hint: p => fmt((14 * p) / 100) + " px" },
    ]],
  ];
  const fonts = document.getElementById("cfFonts");
  const resetters = [];
  const updaters = [];
  for (const [gk, rows] of FONTS) {
    fonts.append(el("h4", "", t[gk]));
    for (const f of rows) {
      const row = el("div", "cf-frow");
      const text = el("div");
      text.append(el("b", "", t["f_" + f.id]), el("small", "", t["fd_" + f.id]));
      row.append(text);
      if (f.select) {
        const sel = el("select");
        const list = FAMILIES.includes(s[f.key]) ? FAMILIES : FAMILIES.concat(s[f.key]);
        for (const fam of list) {
          const o = el("option", "", fam === "" ? t.famTheme : fam === "system-ui" ? t.famSystem : fam);
          o.value = fam;
          sel.append(o);
        }
        sel.value = s[f.key] || "";
        sel.addEventListener("change", () => save({ [f.key]: sel.value }));
        resetters.push(() => { sel.value = ""; });
        row.append(sel);
      } else {
        const range = el("input");
        range.type = "range";
        range.min = f.min;
        range.max = f.max;
        range.step = 1;
        range.value = val(f.key);
        const out = el("output");
        const upd = () => {
          const p = Number(range.value);
          out.textContent = "";
          out.append(document.createTextNode(p + " %"));
          const h = f.hint(p);
          if (h) {
            out.append(el("i", "", h));
          }
        };
        range.addEventListener("input", () => {
          s[f.key] = Number(range.value);
          upd();
          updaters.forEach(fn => fn());
          save({ [f.key]: Number(range.value) });
        });
        upd();
        updaters.push(upd);
        resetters.push(() => { range.value = 100; s[f.key] = 100; upd(); });
        row.append(range, out);
      }
      fonts.append(row);
    }
  }
  document.getElementById("fontReset").addEventListener("click", () => {
    const patch = {};
    for (const [, rows] of FONTS) {
      for (const f of rows) {
        patch[f.key] = DEFAULTS[f.key];
      }
    }
    resetters.forEach(fn => fn());
    updaters.forEach(fn => fn());
    save(patch);
  });
})();
