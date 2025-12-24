const donutActiveFill = "#f5e6a6";
const donutActiveStroke = "#e3c45a";
const donutSliceStroke = "rgba(255,255,255,0.22)";
const donutFocusHint = "Toca o navega una sección";

const spinePalettes = [
  ["#f7b500", "#ff6f61"],
  ["#6dd5ed", "#2193b0"],
  ["#8e2de2", "#4a00e0"],
  ["#00b09b", "#96c93d"],
  ["#ff758c", "#ff7eb3"],
  ["#4158d0", "#c850c0"],
  ["#f83600", "#fe8c00"],
  ["#43cea2", "#185a9d"],
  ["#ffd700", "#f37335"]
];

const donutPalettes = [
  ["#f8e6aa", "#d3a74a"],
  ...spinePalettes
];

const donutPaletteFor = (idx) => donutPalettes[idx % donutPalettes.length][0];

const escapeHtml = (str) => String(str ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const normalizeLabel = (v) => String(v ?? "").trim();

const toRoman = (num) => {
  const n = Math.max(0, Math.floor(Number(num) || 0));
  if (!n) return "—";
  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let x = n;
  let out = "";
  for (const [v, sym] of map) {
    while (x >= v) { out += sym; x -= v; }
  }
  return out || "—";
};

const yearToCenturyLabel = (year) => {
  const y = Number(year) || 0;
  if (!y) return "Sin año";
  const c = Math.floor((y - 1) / 100) + 1;
  return `S. ${toRoman(c)}`;
};

const countBy = (ids, getter, books) => {
  const m = new Map();
  (ids || []).forEach((id) => {
    const b = books?.[id];
    const key = normalizeLabel(getter(b));
    const label = key || "—";
    m.set(label, (m.get(label) || 0) + 1);
  });
  return m;
};

const topNMap = (m, maxSlices = 6) => {
  const arr = Array.from(m.entries()).map(([label, value]) => ({ label, value }));
  arr.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
  if (arr.length <= maxSlices) return arr;

  const head = arr.slice(0, maxSlices - 1);
  const tail = arr.slice(maxSlices - 1);
  const others = tail.reduce((acc, x) => acc + x.value, 0);
  head.push({ label: "Otros", value: others });
  return head;
};

const polar = (cx, cy, r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + (r * Math.cos(a)), y: cy + (r * Math.sin(a)) };
};

const donutSlicePath = (cx, cy, rOuter, rInner, startDeg, endDeg) => {
  const sweep = Math.max(0.001, endDeg - startDeg);
  const e = startDeg + Math.min(359.999, sweep);

  const p1 = polar(cx, cy, rOuter, startDeg);
  const p2 = polar(cx, cy, rOuter, e);
  const p3 = polar(cx, cy, rInner, e);
  const p4 = polar(cx, cy, rInner, startDeg);

  const large = (e - startDeg) > 180 ? 1 : 0;

  return [
    `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
    `L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)}`,
    "Z"
  ].join(" ");
};

const createSvgEl = (tag, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

const getDonutGeometry = (hostWidth = 360) => {
  const baseW = 360;
  const baseH = 240;
  const minW = 260;
  const maxW = 520;
  const width = Math.max(minW, Math.min(maxW, hostWidth || baseW));
  const scale = width / baseW;
  const height = baseH * scale;
  const cx = width / 2;
  const cy = height / 2;
  const rOuter = 92 * scale;
  const rInner = 60 * scale;

  return {
    width,
    height,
    cx,
    cy,
    rOuter,
    rInner,
    strokeWidth: rOuter - rInner,
    calloutInnerGap: 2 * scale,
    calloutOuterGap: 18 * scale,
    labelOffset: 32 * scale,
    centerYOffset: 4 * scale,
    centerSubYOffset: 14 * scale,
    focusYOffset: 34 * scale
  };
};

/**
 * Renderiza un gráfico donut interactivo.
 * @param {HTMLElement|null} $host
 * @param {string} centerTitle
 * @param {Map<string, number>} mapData
 * @param {{ onSliceSelect?: (slice: { label: string, value: number, pct: number }|null) => void }} options
 */
export function renderDonutChart($host, centerTitle, mapData, options = {}) {
  if (!$host) return;

  if (typeof $host.__donutCleanup === "function") {
    $host.__donutCleanup();
    delete $host.__donutCleanup;
  }

  const data = topNMap(mapData, 6);
  const total = data.reduce((acc, d) => acc + d.value, 0);

  if (!total) {
    $host.innerHTML = `<div class="books-shelf-empty">Sin datos</div>`;
    return;
  }

  let a0 = 0;
  const slicesData = data.map((d) => {
    const frac = d.value / total;
    const a1 = a0 + frac * 360;
    const mid = (a0 + a1) / 2;
    const pct = Math.round(frac * 100);
    const out = { ...d, frac, a0, a1, mid, pct };
    a0 = a1;
    return out;
  });

  const onSliceSelect = typeof options.onSliceSelect === "function" ? options.onSliceSelect : null;
  let activeIdx = null;
  let applyActive = () => {};

  const renderWithWidth = (hostWidth) => {
    const { svg, setActive } = buildDonutSvg(hostWidth);
    applyActive = setActive;
    $host.innerHTML = "";
    $host.appendChild(svg);
    applyActive(activeIdx);
  };

  const handleSelect = (idx) => {
    activeIdx = idx === activeIdx ? null : idx;
    applyActive(activeIdx);
    if (onSliceSelect) {
      onSliceSelect(activeIdx != null ? slicesData[activeIdx] : null);
    }
  };

  function buildDonutSvg(hostWidth = 360) {
    const {
      width,
      height,
      cx,
      cy,
      rOuter,
      rInner,
      strokeWidth,
      calloutInnerGap,
      calloutOuterGap,
      labelOffset,
      centerYOffset,
      centerSubYOffset,
      focusYOffset
    } = getDonutGeometry(hostWidth);

    const svg = createSvgEl("svg", {
      class: "donut-svg",
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": escapeHtml(centerTitle)
    });

    const defs = createSvgEl("defs");
    const glow = createSvgEl("filter", {
      id: "donut-glow",
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%"
    });
    glow.appendChild(createSvgEl("feDropShadow", {
      dx: "0",
      dy: "6",
      stdDeviation: "8",
      "flood-color": "rgba(245,230,166,0.45)"
    }));
    defs.appendChild(glow);
    svg.appendChild(defs);

    const ring = createSvgEl("circle", {
      class: "donut-ring-base",
      cx,
      cy,
      r: (rOuter + rInner) / 2,
      "stroke-width": strokeWidth
    });
    svg.appendChild(ring);

    const slicesGroup = createSvgEl("g", { class: "donut-slices" });
    const calloutsGroup = createSvgEl("g", { class: "donut-callouts" });
    const centerGroup = createSvgEl("g", { class: "donut-center-group" });

    const centerMain = createSvgEl("text", {
      class: "donut-center",
      x: cx,
      y: cy - centerYOffset,
      "text-anchor": "middle"
    });
    centerMain.textContent = centerTitle;

    const centerSub = createSvgEl("text", {
      class: "donut-center-sub",
      x: cx,
      y: cy + centerSubYOffset,
      "text-anchor": "middle"
    });
    centerSub.textContent = `${total} libros`;

    const centerFocus = createSvgEl("text", {
      class: "donut-center-focus",
      x: cx,
      y: cy + focusYOffset,
      "text-anchor": "middle"
    });
    centerFocus.textContent = donutFocusHint;

    centerGroup.appendChild(centerMain);
    centerGroup.appendChild(centerSub);
    centerGroup.appendChild(centerFocus);

    const slicesEls = [];
    const calloutEls = [];

    slicesData.forEach((s, idx) => {
      const fill = donutPaletteFor(idx);
      const path = createSvgEl("path", {
        class: "donut-slice",
        d: donutSlicePath(cx, cy, rOuter, rInner, s.a0, s.a1),
        fill: "transparent",
        stroke: donutSliceStroke,
        "data-index": String(idx),
        role: "button",
        tabindex: "0",
        "aria-label": `${s.label}: ${s.value} (${s.pct}%)`
      });
      path.dataset.label = s.label;
      path.dataset.value = String(s.value);
      path.dataset.pct = String(s.pct);
      slicesGroup.appendChild(path);
      slicesEls.push(path);

      const p1 = polar(cx, cy, rOuter + calloutInnerGap, s.mid);
      const p2 = polar(cx, cy, rOuter + calloutOuterGap, s.mid);
      const right = Math.cos((s.mid - 90) * Math.PI / 180) >= 0;
      const x3 = right ? (p2.x + labelOffset) : (p2.x - labelOffset);
      const y3 = p2.y;
      const tx = right ? (x3 + 3) : (x3 - 3);
      const anchor = right ? "start" : "end";

      const callout = createSvgEl("g", {
        class: "donut-callout",
        "data-index": String(idx),
        role: "button",
        tabindex: "0",
        "aria-label": `${s.label}: ${s.value} (${s.pct}%)`
      });
      const line = createSvgEl("polyline", {
        class: "donut-line",
        points: `${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${x3.toFixed(2)},${y3.toFixed(2)}`,
        fill: "none"
      });
      const label = createSvgEl("text", {
        class: "donut-label",
        x: tx.toFixed(2),
        y: (y3 - 2).toFixed(2),
        "text-anchor": anchor
      });
      const t1 = createSvgEl("tspan", { x: tx.toFixed(2), dy: "0" });
      t1.textContent = s.label;
      const t2 = createSvgEl("tspan", {
        class: "donut-label-value",
        x: tx.toFixed(2),
        dy: "12"
      });
      t2.textContent = `${s.value} · ${s.pct}%`;
      label.appendChild(t1);
      label.appendChild(t2);

      callout.appendChild(line);
      callout.appendChild(label);
      calloutsGroup.appendChild(callout);
      calloutEls.push(callout);

      const activate = () => handleSelect(idx);
      const handleKey = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      };

      path.addEventListener("click", activate);
      path.addEventListener("keydown", handleKey);
      callout.addEventListener("click", activate);
      callout.addEventListener("keydown", handleKey);
      path.style.setProperty("--slice-fill", fill);
    });

    function setActive(idx = null) {
      slicesEls.forEach((p, i) => {
        const isActive = i === idx;
        p.classList.toggle("active", isActive);
        const fill = p.style.getPropertyValue("--slice-fill") || donutActiveFill;
        p.setAttribute("fill", isActive ? fill : "transparent");
        p.setAttribute("stroke", isActive ? donutActiveStroke : donutSliceStroke);
        p.setAttribute("filter", isActive ? "url(#donut-glow)" : "");
        p.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      calloutEls.forEach((c, i) => {
        const isActive = i === idx;
        c.classList.toggle("active", isActive);
        c.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      if (idx == null) {
        centerFocus.textContent = donutFocusHint;
      } else {
        const s = slicesData[idx];
        centerFocus.textContent = `${s.label}: ${s.value} (${s.pct}%)`;
      }
    }

    setActive(activeIdx);

    svg.appendChild(slicesGroup);
    svg.appendChild(calloutsGroup);
    svg.appendChild(centerGroup);

    return { svg, setActive };
  }

  const ro = new ResizeObserver((entries) => {
    const width = Math.round(entries?.[0]?.contentRect?.width || $host.clientWidth || 360);
    renderWithWidth(width);
  });
  ro.observe($host);
  $host.__donutCleanup = () => ro.disconnect();
  renderWithWidth($host.clientWidth || 360);
}

/**
 * Renderiza los tres gráficos de terminados.
 * @param {{
 *  finishedIds: string[],
 *  books: Record<string, any>,
 *  section: HTMLElement|null,
 *  chartGenre: HTMLElement|null,
 *  chartAuthor: HTMLElement|null,
 *  chartCentury: HTMLElement|null,
 *  onGenreSelect?: (slice: any) => void,
 *  onSearchSelect?: (slice: any) => void
 * }} config
 */
export function renderFinishedCharts(config) {
  const {
    finishedIds = [],
    books = {},
    section,
    chartGenre,
    chartAuthor,
    chartCentury,
    onGenreSelect,
    onSearchSelect
  } = config;

  if (!section) return;

  if (!finishedIds.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const byGenre = countBy(finishedIds, (b) => b?.genre || "Sin categoría", books);
  const byAuthor = countBy(finishedIds, (b) => b?.author || "Sin autor", books);
  const byCentury = countBy(finishedIds, (b) => yearToCenturyLabel(b?.year), books);

  renderDonutChart(chartGenre, "Categoría", byGenre, {
    onSliceSelect: (selection) => onGenreSelect?.(selection)
  });
  renderDonutChart(chartAuthor, "Autor", byAuthor, {
    onSliceSelect: (selection) => onSearchSelect?.(selection)
  });
  renderDonutChart(chartCentury, "Siglo", byCentury, {
    onSliceSelect: (selection) => onSearchSelect?.(selection)
  });
}
