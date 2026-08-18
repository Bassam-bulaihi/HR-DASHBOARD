/**
 * charts.js — Pure SVG chart primitives. No dependencies.
 *
 * Every chart renders to an inline SVG string that can be dropped into innerHTML.
 * All text is positioned for RTL and uses the app's CSS variables for color.
 */

/* ========================= Donut ========================= */

/**
 * Renders a donut chart with a centered total label.
 *
 * @param {Array<{label:string, value:number, color:string}>} segments
 * @param {object} opts — { size, thickness, centerLabel, centerValue }
 */
export function donutChart(segments, opts = {}) {
  const {
    size = 220,
    thickness = 32,
    centerLabel = '',
    centerValue = '',
    animate = true,
  } = opts;

  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return `<div style="text-align:center;color:var(--text-40);padding:32px">لا توجد بيانات</div>`;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const paths = segments
    .filter((s) => s.value > 0)
    .map((seg, i) => {
      const pct = seg.value / total;
      const len = circ * pct;
      const gap = circ - len;
      const rotation = (offset / total) * 360 - 90; // start at top
      offset += seg.value;

      return `<circle
        cx="${cx}" cy="${cy}" r="${r}"
        fill="none"
        stroke="${seg.color}"
        stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(2)} ${gap.toFixed(2)}"
        transform="rotate(${rotation.toFixed(2)} ${cx} ${cy})"
        stroke-linecap="round"
        ${animate ? `style="animation:donut-draw 0.7s ease ${i * 0.08}s both"` : ''}
      >
        <title>${seg.label}: ${seg.value.toLocaleString()} (${(pct * 100).toFixed(0)}%)</title>
      </circle>`;
    })
    .join('');

  const legendItems = segments
    .filter((s) => s.value > 0)
    .map(
      (seg) => `
    <div class="chart-legend__item">
      <span class="chart-legend__dot" style="background:${seg.color}"></span>
      <span class="chart-legend__label">${seg.label}</span>
      <span class="chart-legend__value ltr">${seg.value.toLocaleString()}</span>
    </div>`
    )
    .join('');

  return `
    <div class="chart-donut-wrap">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="chart-donut">
        <!-- background ring -->
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-alt)" stroke-width="${thickness}" />
        ${paths}
        ${
          centerLabel
            ? `<text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="var(--text)" font-size="26" font-weight="500" font-family="var(--font)">
                ${centerValue}
              </text>
              <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="var(--text-60)" font-size="12" font-family="var(--font)">
                ${centerLabel}
              </text>`
            : ''
        }
      </svg>
      <div class="chart-legend">${legendItems}</div>
    </div>`;
}

/* ========================= Bar Chart ========================= */

/**
 * Renders a vertical bar chart with labels and values.
 *
 * @param {Array<{label:string, value:number, color?:string}>} bars
 * @param {object} opts — { height, barWidth, gap, unit, showValues, maxBars }
 */
export function barChart(bars, opts = {}) {
  const {
    height = 260,
    barWidth = 44,
    gap = 24,
    unit = '',
    showValues = true,
    animate = true,
    colors = ['#534feb', '#1c6ce5', '#069855', '#d39c1d', '#d62525', '#8b5cf6'],
  } = opts;

  if (!bars.length || bars.every((b) => b.value === 0)) {
    return `<div style="text-align:center;color:var(--text-40);padding:32px">لا توجد بيانات</div>`;
  }

  const max = Math.max(...bars.map((b) => b.value));
  const chartW = bars.length * (barWidth + gap) + gap;
  const topPad = 32;
  const bottomPad = 60;
  const svgH = height + topPad + bottomPad;

  // Grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const y = topPad + height - height * pct;
    const val = Math.round(max * pct);
    return `
      <line x1="0" y1="${y}" x2="${chartW}" y2="${y}" stroke="var(--border-faint)" stroke-width="1" />
      <text x="${chartW - 4}" y="${y - 4}" text-anchor="end" fill="var(--text-40)" font-size="11" font-family="var(--font)">
        ${val.toLocaleString()}
      </text>`;
  });

  const rects = bars.map((bar, i) => {
    const barH = max > 0 ? (bar.value / max) * height : 0;
    const x = gap + i * (barWidth + gap);
    const y = topPad + height - barH;
    const color = bar.color || colors[i % colors.length];

    return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}"
              rx="4" fill="${color}" opacity="0.85"
              ${animate ? `style="animation:bar-grow 0.5s ease ${i * 0.06}s both; transform-origin: bottom"` : ''}>
          <title>${bar.label}: ${bar.value.toLocaleString()} ${unit}</title>
        </rect>
        ${
          showValues
            ? `<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="400" font-family="var(--font)">
                ${bar.value.toLocaleString()}
              </text>`
            : ''
        }
        <text x="${x + barWidth / 2}" y="${topPad + height + 20}" text-anchor="middle" fill="var(--text-60)" font-size="11" font-family="var(--font)">
          ${bar.label.length > 8 ? bar.label.slice(0, 7) + '…' : bar.label}
        </text>
      </g>`;
  });

  return `
    <div class="chart-bar-wrap" style="overflow-x:auto">
      <svg viewBox="0 0 ${chartW} ${svgH}" width="100%" height="${svgH}" preserveAspectRatio="xMinYMid meet"
           style="min-width:${chartW}px" class="chart-bar">
        ${gridLines.join('')}
        ${rects.join('')}
      </svg>
    </div>`;
}

/* ========================= Horizontal Bar Chart ========================= */

/**
 * Renders horizontal bars — good for department comparisons in RTL.
 *
 * @param {Array<{label:string, value:number, count?:number, color?:string}>} bars
 * @param {object} opts — { unit, formatValue }
 */
export function horizontalBarChart(bars, opts = {}) {
  const {
    unit = 'ر.س',
    formatValue = (v) => v.toLocaleString(),
    colors = ['#534feb', '#1c6ce5', '#069855', '#d39c1d', '#d62525', '#8b5cf6'],
    animate = true,
  } = opts;

  if (!bars.length) {
    return `<div style="text-align:center;color:var(--text-40);padding:32px">لا توجد بيانات</div>`;
  }

  const max = Math.max(...bars.map((b) => b.value));

  return bars
    .map((bar, i) => {
      const pct = max > 0 ? ((bar.value / max) * 100).toFixed(1) : 0;
      const color = bar.color || colors[i % colors.length];
      return `
      <div class="hbar" ${animate ? `style="animation:fade-up 0.35s ease ${i * 0.06}s both"` : ''}>
        <div class="hbar__head">
          <span class="hbar__name">
            ${bar.label}
            ${bar.count != null ? `<span class="hbar__count">(<span class="ltr">${bar.count}</span> موظف)</span>` : ''}
          </span>
          <span class="hbar__value"><span class="ltr num">${formatValue(bar.value)}</span> ${unit}</span>
        </div>
        <div class="hbar__track">
          <div class="hbar__fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
    })
    .join('');
}

/* ========================= Daily Trend ========================= */

/**
 * Mini daily attendance trend — bars for each day colored by status composition.
 */
export function dailyTrendChart(dailyData, opts = {}) {
  const { height = 180, barWidth = 32, gap = 12 } = opts;
  const chartW = dailyData.length * (barWidth + gap) + gap;
  const topPad = 24;
  const bottomPad = 44;
  const svgH = height + topPad + bottomPad;
  const max = Math.max(...dailyData.map((d) => d.total), 1);

  const dayBars = dailyData.map((day, i) => {
    const x = gap + i * (barWidth + gap);
    const segments = [
      { value: day.present, color: 'var(--success)' },
      { value: day.late, color: 'var(--warning)' },
      { value: day.absent, color: 'var(--danger)' },
      { value: day.onLeave, color: 'var(--secondary)' },
    ];

    let currentY = topPad + height;
    const segs = segments
      .filter((s) => s.value > 0)
      .map((seg) => {
        const segH = (seg.value / max) * height;
        currentY -= segH;
        return `<rect x="${x}" y="${currentY}" width="${barWidth}" height="${segH}" fill="${seg.color}" rx="2" opacity="0.8">
          <title>${seg.value}</title>
        </rect>`;
      })
      .join('');

    const dateLabel = day.date.slice(8); // DD
    return `
      <g>
        ${segs}
        <text x="${x + barWidth / 2}" y="${topPad + height + 18}" text-anchor="middle"
              fill="var(--text-60)" font-size="11" font-family="var(--font)">
          <tspan class="ltr">${dateLabel}</tspan>
        </text>
        <text x="${x + barWidth / 2}" y="${topPad + height + 34}" text-anchor="middle"
              fill="var(--text-40)" font-size="10" font-family="var(--font)">
          <tspan class="ltr">${day.total}</tspan>
        </text>
      </g>`;
  });

  return `
    <div class="chart-bar-wrap" style="overflow-x:auto">
      <svg viewBox="0 0 ${chartW} ${svgH}" width="100%" height="${svgH}" preserveAspectRatio="xMinYMid meet"
           style="min-width:${chartW}px" class="chart-bar">
        ${dayBars.join('')}
      </svg>
    </div>`;
}
