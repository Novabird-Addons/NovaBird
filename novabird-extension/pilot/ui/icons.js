"use strict";
/* Icons (Linienstil) und Initialen-Avatare – aufgebaut ohne innerHTML */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  /* Jedes Icon: Liste von [Element, Attribute] */
  const P = {"mail":[["rect",{"x":"2.5","y":"4.5","width":"15","height":"11","rx":"1.5"}],["path",{"d":"m3 5.5 7 5.5 7-5.5"}]],"inbox":[["path",{"d":"M3 11.5 5.2 4.6a1.5 1.5 0 0 1 1.4-1.1h6.8a1.5 1.5 0 0 1 1.4 1.1L17 11.5"}],["path",{"d":"M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5h-4l-1 2H8l-1-2H3z"}]],"sent":[["path",{"d":"M17.5 2.5 12 17.5l-3-6.5-6.5-3z"}],["path",{"d":"M17.5 2.5 9 11"}]],"archive":[["rect",{"x":"2.5","y":"3.5","width":"15","height":"4","rx":"1"}],["path",{"d":"M4 7.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15V7.5"}],["path",{"d":"M8 11h4"}]],"trash":[["path",{"d":"M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"}],["path",{"d":"m5 5.5.8 10.1A1.5 1.5 0 0 0 7.3 17h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5"}]],"junk":[["path",{"d":"M10 2.5 4 4.8v4.7c0 3.6 2.6 6.4 6 8 3.4-1.6 6-4.4 6-8V4.8z"}],["path",{"d":"m8 8 4 4M12 8l-4 4"}]],"drafts":[["path",{"d":"M11 3.5H5.5A1.5 1.5 0 0 0 4 5v10a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15V9"}],["path",{"d":"M14.6 2.9a1.4 1.4 0 0 1 2 2L10.5 11l-2.5.5.5-2.5z"}]],"folder":[["path",{"d":"M2.5 6A1.5 1.5 0 0 1 4 4.5h3.6l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15z"}]],"book":[["path",{"d":"M4.5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"}],["path",{"d":"M6.5 3.5v13"}],["circle",{"cx":"11","cy":"8.5","r":"1.8"}],["path",{"d":"M8.6 13c.4-1.3 1.3-2 2.4-2s2 .7 2.4 2"}]],"bookcheck":[["path",{"d":"M9.5 16.5h-5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V10"}],["path",{"d":"M6.5 3.5v13"}],["path",{"d":"m11.5 14.5 1.8 1.8 3.2-3.6"}]],"filter":[["path",{"d":"M3 4.5h14l-5.5 6.5v4.5l-3 1.5v-6z"}]],"at":[["circle",{"cx":"10","cy":"10","r":"3"}],["path",{"d":"M13 10v1.2a2.3 2.3 0 0 0 4.5 0V10a7.5 7.5 0 1 0-3 6"}]],"ban":[["circle",{"cx":"10","cy":"10","r":"7"}],["path",{"d":"m5 5 10 10"}]],"search":[["circle",{"cx":"8.5","cy":"8.5","r":"5"}],["path",{"d":"m12.2 12.2 4.3 4.3"}]],"x":[["path",{"d":"M5 5l10 10M15 5 5 15"}]],"users":[["circle",{"cx":"7.5","cy":"7","r":"2.6"}],["path",{"d":"M2.5 16c.5-2.6 2.5-4 5-4s4.5 1.4 5 4"}],["circle",{"cx":"14","cy":"6.5","r":"2"}],["path",{"d":"M13.5 10.5c2.2 0 3.7 1.2 4 3.5"}]],"user":[["circle",{"cx":"10","cy":"7.5","r":"3"}],["path",{"d":"M4 16.5c.6-2.9 3-4.5 6-4.5s5.4 1.6 6 4.5"}]],"merge":[["path",{"d":"M4.5 3v2.5a4 4 0 0 0 4 4h1.5v7"}],["path",{"d":"M15.5 3v2.5a4 4 0 0 1-4 4H10"}],["path",{"d":"m7.5 14 2.5 2.5 2.5-2.5"}]],"split":[["path",{"d":"M10 17v-5a2 2 0 0 0-2-2 3.5 3.5 0 0 1-3.5-3.5V3.5"}],["path",{"d":"M10 12a2 2 0 0 1 2-2 3.5 3.5 0 0 0 3.5-3.5V3.5"}],["path",{"d":"m2.5 5.5 2-2 2 2M13.5 5.5l2-2 2 2"}]],"userx":[["circle",{"cx":"8","cy":"7","r":"3"}],["path",{"d":"M2.5 16.5c.6-2.9 2.8-4.5 5.5-4.5 1.2 0 2.3.3 3.2.9"}],["path",{"d":"m13.5 12.5 4 4M17.5 12.5l-4 4"}]],"link":[["path",{"d":"M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1"}],["path",{"d":"M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1"}]],"check":[["path",{"d":"m4.5 10.5 3.5 3.5 7.5-8"}]],"checkcircle":[["circle",{"cx":"10","cy":"10","r":"7.5"}],["path",{"d":"m6.5 10.2 2.4 2.4 4.6-5"}]],"info":[["circle",{"cx":"10","cy":"10","r":"7.5"}],["path",{"d":"M10 9v4.5M10 6.5v.01"}]],"alert":[["path",{"d":"M10 3 2.5 16.5h15z"}],["path",{"d":"M10 8v4M10 14.2v.01"}]],"phone":[["path",{"d":"M5 3h2.5l1.2 3.5-1.7 1.2a9 9 0 0 0 5.3 5.3l1.2-1.7 3.5 1.2V15a2 2 0 0 1-2 2A12.5 12.5 0 0 1 3 5a2 2 0 0 1 2-2z"}]],"pin":[["path",{"d":"M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9z"}],["circle",{"cx":"10","cy":"8.5","r":"2"}]],"building":[["rect",{"x":"4","y":"2.5","width":"9","height":"15","rx":"1"}],["path",{"d":"M13 7.5h2.5a1 1 0 0 1 1 1v9H13M7 6h3M7 9h3M7 12h3M8.5 17.5V15"}]],"briefcase":[["rect",{"x":"2.5","y":"6","width":"15","height":"10.5","rx":"1.5"}],["path",{"d":"M7 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6M2.5 10.5h15"}]],"cake":[["path",{"d":"M3.5 16.5v-5A1.5 1.5 0 0 1 5 10h10a1.5 1.5 0 0 1 1.5 1.5v5z"}],["path",{"d":"M3.5 13c1.2 1 2.3 1 3.3 0s2.3-1 3.3 0 2.2 1 3.3 0 2.2-1 3.1 0M10 10V7"}],["path",{"d":"M10 5.5c-.8-.6-.8-1.6 0-2.5.8.9.8 1.9 0 2.5z"}]],"note":[["path",{"d":"M5 2.5h7l3.5 3.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5z"}],["path",{"d":"M12 2.5V6h3.5M6.5 10h7M6.5 13h5"}]],"image":[["rect",{"x":"2.5","y":"3.5","width":"15","height":"13","rx":"1.5"}],["circle",{"cx":"7","cy":"8","r":"1.5"}],["path",{"d":"m3 15 4.5-4.5 3 3 2-2 4.5 4.5"}]],"tag":[["path",{"d":"M3 3h6.5l8 8-6.5 6.5-8-8z"}],["circle",{"cx":"6.5","cy":"6.5","r":"1.2"}]],"globe":[["circle",{"cx":"10","cy":"10","r":"7.5"}],["path",{"d":"M2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5z"}]],"chat":[["path",{"d":"M3 5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 5v7a1.5 1.5 0 0 1-1.5 1.5H8.5L5 16.5v-3h-.5A1.5 1.5 0 0 1 3 12z"}]],"calendar":[["rect",{"x":"3","y":"4","width":"14","height":"13","rx":"1.5"}],["path",{"d":"M3 8h14M7 2.5v3M13 2.5v3"}]],"clock":[["circle",{"cx":"10","cy":"10","r":"7.5"}],["path",{"d":"M10 6v4l2.5 2"}]],"sparkle":[["path",{"d":"M10 2.5l1.8 4.7 4.7 1.8-4.7 1.8L10 15.5l-1.8-4.7L3.5 9l4.7-1.8z"}],["path",{"d":"M15.5 14v3M14 15.5h3"}]],"list":[["path",{"d":"M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01"}]],"hash":[["path",{"d":"M7.5 3 6 17M14 3l-1.5 14M3.5 7.5h14M2.5 12.5h14"}]],"arrow":[["path",{"d":"M4 10h12M11.5 5.5 16 10l-4.5 4.5"}]],"save":[["path",{"d":"M4 3.5h9.5l3 3V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 4 3.5z"}],["path",{"d":"M6.5 3.5v4h6v-4M6.5 16.5v-5h7v5"}]],"plus":[["path",{"d":"M10 4v12M4 10h12"}]]};

  function icon(name, cls = "") {
    const parts = P[name];
    if (!parts) return document.createTextNode("");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", ("ic " + cls).trim());
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [tag, attrs] of parts) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.append(el);
    }
    return svg;
  }

  const PAL = [["#e4effd", "#1f6fc5"], ["#e3f4ea", "#2f8a57"], ["#fdeee3", "#c0612b"], ["#f1e9fb", "#7c4fc4"],
               ["#fde8ec", "#c23b5a"], ["#e1f3f5", "#1f8492"], ["#fbf3dc", "#9a7410"], ["#eceef1", "#4a5058"]];
  function avatar(name, email, size = "") {
    const src = String(name || email || "?").trim();
    const words = src.replace(/[,"'()]/g, " ").split(/\s+/)
      .filter(w => /^\p{L}/u.test(w) && !/^(dr|prof|herr|frau|mr|mrs|ms)\.?$/i.test(w));
    const ini = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : ((words[0] || src)[0] || "?");
    let h = 0;
    const key = String(name || email || "").toLowerCase().replace(/^(dr|prof)\.?\s+/g, "").split(/[\s,]+/).filter(Boolean).sort().join(" ");
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [bg, fg] = PAL[h % PAL.length];
    const el = document.createElement("span");
    el.className = ("av " + size).trim();
    el.style.background = bg;
    el.style.color = fg;
    el.textContent = ini.toUpperCase();
    return el;
  }

  function apply(root = document) {
    root.querySelectorAll("[data-icon]").forEach(el => { if (!el.firstChild) el.append(icon(el.dataset.icon)); });
  }
  globalThis.UI_ICONS = { icon, avatar, apply };
})();
