/*!
 * USGS River Widget v2.1.0 — embeddable live river conditions
 * MIT licensed. Free for personal and commercial use. No sign-up, no API key.
 * Data courtesy of the U.S. Geological Survey (U.S. public domain).
 * Provisional USGS data, subject to revision — waterdata.usgs.gov/provisional-data-statement/
 *
 * Embed:
 *   <a class="riverwidget" href="https://waterdata.usgs.gov/monitoring-location/USGS-12041200/"
 *      data-site="12041200" data-label="HOH RIVER" data-theme="river">HOH RIVER — current flow</a>
 *   <script src="https://YOUR-HOST/v1/widget.js" async></script>
 *
 * Compatibility ladder, widest rung first:
 *   no JavaScript      -> the anchor stays a working link to the USGS station
 *   JavaScript, no CORS-> the anchor stays a working link (we never blank the page)
 *   IE10/IE11          -> XHR + inline render, scoped class names, flexbox
 *   modern browsers    -> Shadow DOM, full style isolation from the host theme
 *
 * No dependencies. Nothing to install server-side.
 */
(function () {
  'use strict';

  // Several embeds on one page means several copies of the loader snippet.
  // The snippet guards by script id, but a hand-written page, a plugin, or a
  // page builder that rewrites markup can still get the file in twice. Running
  // the IIFE again would install a second MutationObserver and a second set of
  // refresh timers, so bail if we are already here.
  if (window.RiverWidget && window.RiverWidget.version) return;

  var VERSION = '2.1.0';
  var USGS = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
  var SELECTOR = 'a.riverwidget, .riverwidget-io, [data-river-site], [data-river-sites]';
  var FLAG = '__riverWidgetReady';
  var MAX_SITES = 6;
  var scopeSeq = 0;

  /* -------------------------------------------------------- diagnostics */

  /**
   * Everything the widget says out loud is prefixed "[River Widget]" so a site
   * owner told to search their console for it finds all of it and nothing
   * else. Silence on failure was the old behaviour, and it left the person
   * whose page had gone blank with nothing to go on.
   */
  var log = [];

  function report(level, message, extra) {
    log.push({ at: new Date().toISOString(), level: level, message: message, extra: extra || null });
    if (log.length > 40) log.shift();
    if (!window.console || typeof window.console[level] !== 'function') return;
    var line = '[River Widget v' + VERSION + '] ' + message;
    try {
      if (extra === undefined || extra === null) window.console[level](line);
      else window.console[level](line, extra);
    } catch (e) { /* a console that throws is not our problem to solve */ }
  }

  /**
   * Typed into the console by someone trying to work out why their page is
   * blank, usually because a support page told them to. Prints what is on the
   * page, what it asked for, and what went wrong.
   */
  function diagnose() {
    var nodes = document.querySelectorAll(SELECTOR);
    var out = {
      version: VERSION,
      api: API || '(none detected — the script may be self-hosted)',
      embedsFound: nodes.length,
      embeds: [],
      recentMessages: log.slice(-15)
    };
    for (var i = 0; i < nodes.length; i++) {
      var c = readConfig(nodes[i]);
      out.embeds.push({
        sites: c.sites,
        rawSitesAttribute: nodes[i].getAttribute('data-sites')
          || nodes[i].getAttribute('data-site') || '(missing)',
        mounted: !!nodes[i][FLAG],
        chart: c.chart, source: c.source, theme: c.theme,
        metrics: c.metrics
      });
    }
    if (!nodes.length) {
      report('warn', 'No embeds found on this page. Check the element has class="riverwidget" '
        + 'and that your CMS did not strip the data- attributes.');
    }
    try { window.console.log(JSON.stringify(out, null, 2)); } catch (e) { window.console.log(out); }
    return out;
  }

  /* ------------------------------------------------------------- origin */

  function apiOrigin() {
    var override = document.querySelector('[data-river-api]');
    if (override) return String(override.getAttribute('data-river-api')).replace(/\/+$/, '');
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      var at = src.indexOf('/v1/widget.js');
      if (at > -1) return src.slice(0, at);
    }
    return '';
  }
  var API = apiOrigin();

  /* ------------------------------------------------------------- themes */

  var THEMES = {
    river:  { bg:'#ffffff', fg:'#16233a', muted:'#63748f', line:'#dbe3ee', accent:'#1c6b8c', radius:'12px' },
    slate:  { bg:'#f7f8fa', fg:'#1d2430', muted:'#68748a', line:'#dfe3ea', accent:'#3f5a76', radius:'10px' },
    forest: { bg:'#ffffff', fg:'#152019', muted:'#5f7268', line:'#dae2dc', accent:'#2f6b46', radius:'12px' },
    sand:   { bg:'#fbf8f3', fg:'#241d14', muted:'#7a6b57', line:'#e6dccc', accent:'#9a6b24', radius:'8px' },
    night:  { bg:'#151d2b', fg:'#eaf0f8', muted:'#93a3ba', line:'#2c3a4f', accent:'#6fb6d4', radius:'12px' },
    mono:   { bg:'#ffffff', fg:'#111111', muted:'#6b6b6b', line:'#e0e0e0', accent:'#111111', radius:'2px' },
    bare:   { bg:'transparent', fg:'inherit', muted:'inherit', line:'currentColor', accent:'currentColor', radius:'0' }
  };

  /* -------------------------------------------------------------- utils */

  function attr(el, name, fallback) {
    var v = el.getAttribute('data-' + name);
    return v === null || v === '' ? fallback : v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function uniq(list) {
    var seen = {}, out = [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && !seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
    }
    return out;
  }
  function map(list, fn) {
    var out = [], i;
    for (i = 0; i < list.length; i++) out.push(fn(list[i], i));
    return out;
  }

  /* --------------------------------------------------------- transport */

  /**
   * XHR rather than fetch: same code path back to IE10, and every platform
   * that allows a script tag allows this. Callback-style so no Promise
   * polyfill is needed either.
   */
  function getJSON(url, done, fail) {
    var xhr;
    if (typeof XMLHttpRequest !== 'undefined' && 'withCredentials' in new XMLHttpRequest()) {
      xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
    } else if (typeof XDomainRequest !== 'undefined') {
      xhr = new XDomainRequest(); // IE8/9 cross-origin
      xhr.open('GET', url);
    } else {
      fail(new Error('no cors transport'));
      return;
    }

    var settled = false;
    function ok() {
      if (settled) return;
      settled = true;
      var status = typeof xhr.status === 'number' ? xhr.status : 200;
      if (status && (status < 200 || status >= 300)) { fail(new Error('http ' + status)); return; }
      try { done(JSON.parse(xhr.responseText)); }
      catch (e) { fail(e); }
    }
    function bad() {
      if (settled) return;
      settled = true;
      fail(new Error('network'));
    }

    xhr.onload = ok;
    xhr.onerror = bad;
    xhr.ontimeout = bad;
    xhr.onreadystatechange = function () { if (xhr.readyState === 4) ok(); };
    xhr.timeout = 15000;
    try { xhr.send(); } catch (e) { bad(); }
  }

  /* --------------------------------------------------------------- units */

  var UNITS = {
    us:     { flow:{ f:1,         u:'cfs',  d:0 }, stage:{ f:1,      u:'ft', d:2 }, temp:{ u:'°F', d:0 } },
    metric: { flow:{ f:0.0283168, u:'m³/s', d:2 }, stage:{ f:0.3048, u:'m', d:2 }, temp:{ u:'°C', d:1 } }
  };

  function convert(kind, value, system) {
    var spec = UNITS[system][kind];
    if (kind === 'temp') {
      return { n: system === 'us' ? value * 9 / 5 + 32 : value, u: spec.u, d: spec.d };
    }
    return { n: value * spec.f, u: spec.u, d: spec.d };
  }

  function fmt(n, decimals) {
    var d = (n < 10 && decimals === 0) ? 1 : decimals;
    try {
      return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    } catch (e) {
      // IE without full Intl: fixed decimals plus manual thousands separators.
      var s = Number(n).toFixed(d).split('.');
      s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return s.join('.');
    }
  }

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function when(iso, tz) {
    // Safari and IE both choke on "+00:00" offsets in some versions.
    var d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    if (tz) {
      try {
        return d.toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          timeZone: tz, timeZoneName: 'short'
        });
      } catch (e) { /* fall through to the manual format */ }
    }
    var h = d.getHours(), ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (!h) h = 12;
    var mm = d.getMinutes(); mm = mm < 10 ? '0' + mm : String(mm);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + mm + ' ' + ap;
  }

  /* ----------------------------------------------------------- sparkline */

  function sparkline(values, days) {
    if (!values || values.length < 3) return '';
    var w = 300, h = 40, lo = values[0], hi = values[0], i;
    for (i = 1; i < values.length; i++) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    var span = (hi - lo) || 1, d = '', lx = 0, ly = 0;
    for (i = 0; i < values.length; i++) {
      var x = (i / (values.length - 1)) * w;
      var y = h - 3 - ((values[i] - lo) / span) * (h - 6);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      lx = x; ly = y;
    }
    d = d.replace(/\s+$/, '');
    return '<svg class="rw-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img"'
      + ' aria-label="' + esc((days || values.length) + ' day trend of daily mean flow') + '">'
      + '<path class="rw-fill" d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z"/>'
      + '<path class="rw-line" d="' + d + '"/>'
      + '<circle class="rw-dot" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3"/></svg>';
  }


  /* ---------------------------------------------------------- hydrograph */

  /**
   * "Nice" axis numbers (Heckbert). Picks a tick step of 1, 2 or 5 times a
   * power of ten, so a stage axis lands on 2.0 / 2.2 / 2.4 rather than
   * 1.877 / 2.131 / 2.385.
   */
  function niceNum(range, round) {
    var exp = Math.floor(Math.log(range) / Math.LN10);
    var frac = range / Math.pow(10, exp);
    var nf;
    if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
    else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /**
   * A river axis never starts at zero. A gauge sitting between 1.9 and 3.2 ft
   * plotted from zero is a flat line with a bump, and the whole reason anglers
   * read this chart is the shape inside that 1.3 ft band.
   *
   * So: enumerate every 1/2/5 step that could cover the padded data range and
   * score them. Around seven gridlines reads best, and a candidate that floors
   * to zero when the river never goes near zero is penalised hard — that is
   * the failure mode this whole function exists to avoid.
   */
  function axisTicks(lo, hi) {
    if (!(hi > lo)) {
      var nudge = Math.abs(lo || 1) * 0.05;
      hi = lo + nudge; lo = lo - nudge;
    }
    var pad = (hi - lo) * 0.08;
    var dLo = lo - pad, dHi = hi + pad;
    // Flow is never negative, and neither is stage on all but a few gauges.
    if (lo >= 0 && dLo < 0) dLo = 0;
    var span = dHi - dLo;
    var baseExp = Math.floor(Math.log(span) / Math.LN10) - 2;
    var mults = [1, 2, 5];
    var best = null, e, m;

    for (e = baseExp; e <= baseExp + 4; e++) {
      for (m = 0; m < mults.length; m++) {
        var step = mults[m] * Math.pow(10, e);
        var aLo = Math.floor(dLo / step) * step;
        var aHi = Math.ceil(dHi / step) * step;
        var n = Math.round((aHi - aLo) / step) + 1;
        if (n < 4 || n > 12) continue;
        if (aLo < 0 && lo >= 0) continue;

        // What fraction of the chart's height the trace actually occupies.
        // This is the number that decides whether the chart looks "zoomed in"
        // the way the USGS hydrograph does, so it dominates the score.
        var waste = 1 - (hi - lo) / (aHi - aLo);
        var score = Math.abs(n - 7) * 0.5 + waste * 10;

        // A zero floor under a river that never approaches zero throws away
        // the bottom of the chart to say nothing.
        if (aLo === 0 && lo > (hi - lo) * 0.15) score += 3;

        if (!best || score < best.score) best = { step: step, lo: aLo, hi: aHi, n: n, score: score };
      }
    }
    if (!best) best = { step: span / 4, lo: dLo, hi: dHi, n: 5 };

    var dec = Math.max(0, -Math.floor(Math.log(best.step) / Math.LN10));
    var out = [], i;
    for (i = 0; i < best.n; i++) {
      out.push(Number((best.lo + i * best.step).toFixed(dec + 2)));
    }
    return { values: out, decimals: dec };
  }

  function tickLabel(v, decimals) {
    if (Math.abs(v) >= 1000) return fmt(v, 0);
    return v.toFixed(decimals);
  }

  var SHORT_MONTHS = MONTHS;

  /** "Sep 03" in the gauge's own timezone, with an IE-safe fallback. */
  function dayLabel(epochSec, tz) {
    var d = new Date(epochSec * 1000);
    if (tz) {
      try {
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: tz });
      } catch (e) { /* fall through */ }
    }
    var dd = d.getDate();
    return SHORT_MONTHS[d.getMonth()] + ' ' + (dd < 10 ? '0' + dd : dd);
  }

  /** Local midnights inside the window, for the day gridlines. */
  function dayBoundaries(t0, t1, tz) {
    var out = [], day = 86400;
    // Walk back to the first midnight at or after t0. Working in whole days
    // from a UTC midnight is close enough for tick placement; the labels
    // themselves are formatted in the gauge's zone.
    var first = Math.ceil(t0 / day) * day;
    for (var t = first; t <= t1; t += day) out.push(t);
    return out;
  }

  /**
   * The chart most anglers already know: a real y-axis in the gauge's units,
   * day labels along the bottom, and the 15-minute trace between them.
   *
   * Fixed viewBox with `meet` rather than the sparkline's `none`, because this
   * one has text in it — stretching the box would stretch the numerals.
   */
  function hydrograph(series, cfg, tz) {
    var pts = series && series.points;
    if (!pts || pts.length < 3) return '';

    var W = 560, H = 232, L = 48, R = 12, T = 12, B = 30;
    var iw = W - L - R, ih = H - T - B;

    var lo = pts[0][1], hi = pts[0][1], t0 = pts[0][0], t1 = pts[pts.length - 1][0], i;
    for (i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }

    // Convert to display units before scaling, or the axis lies in metric.
    var kind = series.param === 'stage' ? 'stage' : 'flow';
    var cLo = convert(kind, lo, cfg.units), cHi = convert(kind, hi, cfg.units);
    var unit = cLo.u;
    var axis = axisTicks(cLo.n, cHi.n);
    var aLo = axis.values[0], aHi = axis.values[axis.values.length - 1];
    var aSpan = (aHi - aLo) || 1;
    var tSpan = (t1 - t0) || 1;

    var x = function (t) { return L + ((t - t0) / tSpan) * iw; };
    var y = function (v) { return T + ih - ((v - aLo) / aSpan) * ih; };

    var out = [];
    // 'both' | 'horizontal' | 'vertical' | 'none'. The axis labels stay
    // whatever the lines do — a chart without numbers is a sparkline.
    var showH = cfg.gridlines === 'both' || cfg.gridlines === 'horizontal';
    var showV = cfg.gridlines === 'both' || cfg.gridlines === 'vertical';

    // Horizontal gridlines and their labels.
    for (i = 0; i < axis.values.length; i++) {
      var gv = axis.values[i], gy = y(gv).toFixed(1);
      if (showH) {
        out.push('<line class="rw-grid" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/>');
      }
      out.push('<text class="rw-tick" x="' + (L - 7) + '" y="' + (y(gv) + 3.5).toFixed(1)
        + '" text-anchor="end">' + esc(tickLabel(gv, axis.decimals)) + '</text>');
    }

    // Unit, rotated up the left edge, the way USGS labels theirs.
    out.push('<text class="rw-unit-lbl" transform="translate(11,' + (T + ih / 2).toFixed(1)
      + ') rotate(-90)" text-anchor="middle">' + esc(unit) + '</text>');

    // Day boundaries.
    var days = dayBoundaries(t0, t1, tz);
    var everyNth = Math.ceil(days.length / 7);
    for (i = 0; i < days.length; i++) {
      var dx = x(days[i]);
      if (dx < L + 4 || dx > W - R - 4) continue;
      if (showV) {
        out.push('<line class="rw-daygrid" x1="' + dx.toFixed(1) + '" y1="' + T
          + '" x2="' + dx.toFixed(1) + '" y2="' + (T + ih) + '"/>');
      }
      if (i % everyNth === 0) {
        out.push('<text class="rw-tick" x="' + dx.toFixed(1) + '" y="' + (H - 10)
          + '" text-anchor="middle">' + esc(dayLabel(days[i], tz)) + '</text>');
      }
    }

    // Axis rules.
    out.push('<line class="rw-axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '"/>');
    out.push('<line class="rw-axis" x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - R) + '" y2="' + (T + ih) + '"/>');

    // The trace.
    var d = '';
    for (i = 0; i < pts.length; i++) {
      d += (i ? 'L' : 'M') + x(pts[i][0]).toFixed(1) + ' '
        + y(convert(kind, pts[i][1], cfg.units).n).toFixed(1) + ' ';
    }
    d = d.replace(/\s+$/, '');
    out.push('<path class="rw-hline" d="' + d + '"/>');

    var last = pts[pts.length - 1];
    out.push('<circle class="rw-dot" cx="' + x(last[0]).toFixed(1) + '" cy="'
      + y(convert(kind, last[1], cfg.units).n).toFixed(1) + '" r="3"/>');

    var label = (kind === 'stage' ? 'Gauge height' : 'Streamflow') + ' over '
      + series.days + ' day' + (series.days === 1 ? '' : 's') + ', in ' + unit;

    return '<svg class="rw-hydro" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet"'
      + ' role="img" aria-label="' + esc(label) + '">' + out.join('') + '</svg>';
  }

  /* --------------------------------------------------------------- style */

  /**
   * `scope` is ':host' in the Shadow DOM path and '.rw-sN' when rendering
   * inline. Inline mode leans on !important for the handful of properties
   * that aggressive site themes reach into.
   */
  function css(cfg, scope) {
    var base = THEMES[cfg.theme] || THEMES.river;

    // Per-element overrides on top of the theme. A widget usually has to sit
    // inside a design that already exists, and "the theme is close but the
    // card must be transparent and the border has to go" is the normal case,
    // not an edge one.
    var t = {
      bg: cfg.bg || base.bg,
      fg: cfg.text || base.fg,
      muted: cfg.muted || base.muted,
      line: cfg.border === 'none' ? 'transparent' : (cfg.border || base.line),
      accent: base.accent,
      radius: base.radius
    };
    var accent = cfg.accent || base.accent;
    // The numerals are the thing people look at, so they get their own colour
    // rather than inheriting body text. Gridlines likewise: a chart usually
    // wants them fainter than the card's own border.
    var value = cfg.value || t.fg;
    var grid = cfg.grid || (cfg.border === 'none' ? (base.line) : t.line);
    var radius = cfg.radius || base.radius;
    var noBorder = cfg.border === 'none';
    var d = cfg.density === 'compact'
      ? { pad: '13px 15px', num: '30px', minor: '18px', gap: '18px', name: '11px', spark: '32px' }
      : { pad: '18px 20px', num: '38px', minor: '21px', gap: '26px', name: '11.5px', spark: '40px' };
    var shadow = scope === ':host';
    var bang = shadow ? '' : ' !important';
    var font = cfg.font === 'system'
      ? '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
      : 'inherit';

    var s = scope + '{display:block;font-family:' + font + ';color:' + t.fg + ';font-size:16px;'
      + 'line-height:1.5;text-align:left' + bang + ';box-sizing:border-box}'
      + (shadow ? ':host{all:initial;display:block;font-family:' + font + ';color:' + t.fg + ';font-size:16px;line-height:1.5}' : '')
      + scope + ' *,' + scope + ' *::before,' + scope + ' *::after{box-sizing:border-box;margin:0;padding:0}'

      // flexbox, not grid: identical result, and it does not strand IE11
      + scope + ' .rw-grid{display:-webkit-box;display:-ms-flexbox;display:flex;'
      + '-ms-flex-wrap:wrap;flex-wrap:wrap;margin:-7px}'
      + scope + ' .rw-cell{-webkit-box-flex:1;-ms-flex:1 1 260px;flex:1 1 260px;padding:7px;min-width:0}'

      + scope + ' .rw-card{background:' + t.bg + ';'
      + (noBorder ? 'border:0;' : 'border:1px solid ' + t.line + ';')
      + 'border-radius:' + radius + ';padding:' + d.pad + ';height:100%;display:block;overflow:hidden'
      + (cfg.shadow === '1' ? ';box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px -14px rgba(0,0,0,.25)' : '')
      + '}'
      + scope + ' .rw-name{font-weight:700;letter-spacing:.08em;text-transform:uppercase;'
      + 'color:' + t.muted + ';margin:0 0 12px' + bang + ';font-size:' + d.name + '}'
      + scope + ' .rw-row{display:-webkit-box;display:-ms-flexbox;display:flex;-ms-flex-wrap:wrap;flex-wrap:wrap;'
      + '-webkit-box-align:end;-ms-flex-align:end;align-items:flex-end}'
      + scope + ' .rw-metric{margin:0 ' + d.gap + ' 6px 0}'
      + scope + ' .rw-key{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;'
      + 'color:' + t.muted + ';margin-bottom:3px}'
      + scope + ' .rw-num{font-size:' + d.num + ';font-weight:700;line-height:1;letter-spacing:-.02em;'
      + 'font-variant-numeric:tabular-nums;color:' + value + bang + '}'
      + scope + ' .rw-minor .rw-num{font-size:' + d.minor + ';font-weight:600}'
      + scope + ' .rw-u{font-size:13px;font-weight:600;color:' + t.muted + ';margin-left:3px}'
      + scope + ' .rw-trend{display:inline-block;font-size:12px;font-weight:600;padding:3px 9px;'
      + 'border-radius:999px;border:1px solid ' + t.line + ';color:' + t.muted + ';white-space:nowrap;margin:0 0 6px}'
      + scope + ' .rw-trend.rw-up,' + scope + ' .rw-trend.rw-down{color:' + accent + ';border-color:' + accent + '}'
      + scope + ' .rw-spark{display:block;width:100%;height:' + d.spark + ';margin:14px 0 0}'
      + scope + ' .rw-hydro{display:block;width:100%;height:auto;margin:14px 0 0}'
      + scope + ' .rw-grid{stroke:' + grid + ';stroke-width:1}'
      + scope + ' .rw-daygrid{stroke:' + grid + ';stroke-width:1;stroke-dasharray:2 3}'
      + scope + ' .rw-axis{stroke:' + grid + ';stroke-width:1}'
      + scope + ' .rw-tick{fill:' + t.muted + ';font-size:11px;font-family:inherit}'
      + scope + ' .rw-unit-lbl{fill:' + t.muted + ';font-size:11px;font-family:inherit}'
      + scope + ' .rw-hline{fill:none;stroke:' + accent + ';stroke-width:1.8;'
      + 'stroke-linejoin:round;stroke-linecap:round}'
      + scope + ' .rw-line{fill:none;stroke:' + accent + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round}'
      + scope + ' .rw-fill{fill:' + accent + ';opacity:.1;stroke:none}'
      + scope + ' .rw-dot{fill:' + accent + '}'
      + scope + ' .rw-foot{margin:14px 0 0;padding-top:10px;border-top:1px solid ' + t.line + ';'
      + 'font-size:11px;color:' + t.muted + ';line-height:1.5}'
      + scope + ' .rw-foot span{margin-right:9px}'
      + scope + ' .rw-foot a{color:inherit' + bang + ';text-decoration:underline}'
      + scope + ' .rw-warn{color:' + accent + ';font-weight:600}'
      + scope + ' .rw-msg{font-size:14px;margin:0 0 10px' + bang + '}'
      + scope + ' .rw-skeleton .rw-num{color:' + t.line + '}';

    return s;
  }

  /* -------------------------------------------------------------- render */

  function metricEl(key, label, obs, system, minor) {
    if (!obs) return '';
    var c = convert(key, obs.v, system);
    return '<div class="rw-metric' + (minor ? ' rw-minor' : '') + '">'
      + '<span class="rw-key">' + esc(label) + '</span>'
      + '<span class="rw-num">' + esc(fmt(c.n, c.d)) + '</span>'
      + '<span class="rw-u">' + c.u + '</span></div>';
  }

  function cardHTML(g, cfg, label) {
    var name = label || (g && g.name) || '';
    var url = (g && g.url) || 'https://waterdata.usgs.gov/';
    var show = cfg.metrics;

    if (!g || !g.reporting) {
      return '<div class="rw-cell"><div class="rw-card"><p class="rw-name">' + esc(name) + '</p>'
        + '<p class="rw-msg">This gauge is not reporting right now.</p>'
        + '<p class="rw-foot"><a href="' + esc(url) + '" target="_blank" rel="noopener nofollow">'
        + 'Check the USGS station page</a></p></div></div>';
    }

    var html = '<div class="rw-cell"><div class="rw-card"><p class="rw-name">' + esc(name) + '</p><div class="rw-row">';
    if (show.flow)  html += metricEl('flow', 'Streamflow', g.obs.flow, cfg.units, false);
    if (show.stage) html += metricEl('stage', 'Gauge height', g.obs.stage, cfg.units, true);
    if (show.temp)  html += metricEl('temp', 'Water temp', g.obs.temp, cfg.units, true);

    if (show.trend && g.trend) {
      var d = g.trend.dir;
      var arrow = d === 'up' ? '▲' : d === 'down' ? '▼' : '▬';
      var word = d === 'up' ? 'Rising' : d === 'down' ? 'Falling' : 'Steady';
      var pct = d === 'flat' ? '' : ' ' + Math.abs(Math.round(g.trend.pct)) + '%';
      html += '<span class="rw-trend rw-' + d + '">' + arrow + ' ' + word + pct + ' ' + g.trend.hours + ' hr</span>';
    }
    html += '</div>';

    if (cfg.chart === 'hydrograph') html += hydrograph(g.series, cfg, cfg.tz || g.tz);
    else if (cfg.chart === 'spark') {
      html += sparkline((g.series && g.series.points)
        ? map(g.series.points, function (pt) { return pt[1]; })
        : g.spark, cfg.chartDays);
    }

    var newest = (g.obs.flow || g.obs.stage || g.obs.temp || {}).t;
    var stale = newest && (new Date().getTime() - new Date(String(newest).replace(' ', 'T')).getTime()) > 3 * 3600e3;

    html += '<p class="rw-foot">';
    if (newest) html += '<span>Updated ' + esc(when(newest, cfg.tz || g.tz)) + '</span>';
    if (stale) html += '<span class="rw-warn">Delayed — gauge has not reported recently</span>';
    // USGS asks to be credited, and requires the provisional notice to travel
    // with real-time readings. Both stay: see src/license.js.
    html += '<span>Provisional data, subject to revision. '
      + '<a href="' + esc(url) + '" target="_blank" rel="noopener nofollow">U.S. Geological Survey</a></span>';
    html += '</p></div></div>';
    return html;
  }

  function skeletonHTML(labels) {
    return map(labels, function (l) {
      return '<div class="rw-cell"><div class="rw-card rw-skeleton"><p class="rw-name">'
        + esc(l || 'River gauge') + '</p><div class="rw-row"><div class="rw-metric">'
        + '<span class="rw-key">Streamflow</span><span class="rw-num">———</span></div></div>'
        + '<p class="rw-foot">Loading current conditions…</p></div></div>';
    }).join('');
  }

  function errorHTML(sites, labels) {
    return map(sites, function (s, i) {
      return '<div class="rw-cell"><div class="rw-card"><p class="rw-name">'
        + esc(labels[i] || ('USGS ' + s)) + '</p>'
        + '<p class="rw-msg">Live river conditions are temporarily unavailable.</p>'
        + '<p class="rw-foot"><a href="https://waterdata.usgs.gov/monitoring-location/USGS-' + esc(s)
        + '/" target="_blank" rel="noopener nofollow">View current flow at the U.S. Geological Survey →</a>'
        + '</p></div></div>';
    }).join('');
  }

  /* --------------------------------------------------------------- parse */

  function readConfig(el) {
    var raw = attr(el, 'river-sites', attr(el, 'river-site', attr(el, 'sites', attr(el, 'site', ''))));
    var candidates = uniq(map(String(raw).split(','), function (s) {
      return s.replace(/^USGS-/i, '').replace(/^\s+|\s+$/g, '');
    }));
    var clean = [];
    for (var i = 0; i < candidates.length; i++) {
      if (/^\d{8,15}$/.test(candidates[i])) clean.push(candidates[i]);
    }
    clean = clean.slice(0, MAX_SITES);

    var labels = map(String(attr(el, 'labels', attr(el, 'label_1', attr(el, 'label', '')))).split('|'),
      function (s) { return s.replace(/^\s+|\s+$/g, ''); });

    var list = String(attr(el, 'metrics', 'flow,stage,trend,spark')).toLowerCase();
    var metrics = {
      flow:  list.indexOf('flow') > -1,
      stage: list.indexOf('stage') > -1,
      temp:  list.indexOf('temp') > -1,
      trend: list.indexOf('trend') > -1,
      spark: list.indexOf('spark') > -1
    };

    // `data-chart` is the current control. Embeds written before it existed
    // said "spark" in data-metrics instead, so that still decides the default.
    var chart = String(attr(el, 'chart', metrics.spark ? 'spark' : 'none')).toLowerCase();
    if (chart === 'hydro') chart = 'hydrograph';
    if (chart !== 'spark' && chart !== 'hydrograph') chart = 'none';

    var chartParam = attr(el, 'chart-param', 'flow') === 'stage' ? 'stage' : 'flow';
    var maxDays = chart === 'hydrograph' ? 14 : 60;
    var chartDays = parseInt(attr(el, 'chart-days', chart === 'hydrograph' ? '7' : '14'), 10);
    if (!chartDays || chartDays < 1) chartDays = chart === 'hydrograph' ? 7 : 14;
    if (chartDays > maxDays) chartDays = maxDays;

    return {
      sites: clean,
      labels: labels,
      theme: attr(el, 'theme', 'river'),
      accent: attr(el, 'accent', ''),
      radius: attr(el, 'radius', ''),
      bg: attr(el, 'bg', ''),
      text: attr(el, 'text', ''),
      value: attr(el, 'value-color', ''),
      muted: attr(el, 'muted', ''),
      border: attr(el, 'border', ''),
      grid: attr(el, 'grid-color', ''),
      gridlines: (function () {
        var g = String(attr(el, 'gridlines', 'both')).toLowerCase();
        return g === 'horizontal' || g === 'vertical' || g === 'none' ? g : 'both';
      })(),
      shadow: attr(el, 'shadow', '0'),
      density: attr(el, 'density', 'comfortable'),
      font: attr(el, 'font', 'inherit'),
      units: attr(el, 'units', 'us') === 'metric' ? 'metric' : 'us',
      tz: attr(el, 'tz', ''),
      source: attr(el, 'source', 'usgs'),
      beacon: attr(el, 'beacon', '1'),
      metrics: metrics,
      chart: chart,
      chartDays: chartDays,
      chartParam: chartParam,
      refresh: parseInt(attr(el, 'refresh', '900'), 10) || 0
    };
  }

  /* --------------------------------------------------- direct from USGS */

  /**
   * Read the gauges straight from api.waterdata.usgs.gov, in the visitor's
   * own browser.
   *
   * This is the default, and the reason is correctness before cost. An angler
   * checks the flow here and then checks it on waterdata.usgs.gov or a river
   * app; if our number is fifteen minutes behind theirs, the site looks wrong
   * and the lodge loses the argument. Going direct means the number shown is
   * the number USGS is serving, by definition.
   *
   * It also removes us as a single point of failure — an outage on our side
   * cannot freeze every site running the widget — and the quota is the
   * visitor's own 1,000/hour rather than one bucket shared by every embed on
   * the internet. USGS sends Access-Control-Allow-Origin: *, so this needs no
   * key, no proxy and no server.
   */

  var PARAM = { flow: '00060', stage: '00065', temp: '00010' };
  var CODE = { '00060': 'flow', '00065': 'stage', '00010': 'temp' };

  function usgsUrl(collection, params) {
    var qs = ['f=json'];
    for (var k in params) {
      if (params.hasOwnProperty(k) && params[k] !== null && params[k] !== '') {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    return USGS + '/' + collection + '/items?' + qs.join('&');
  }

  function ids(sites) {
    return map(sites, function (s) { return 'USGS-' + s; }).join(',');
  }
  function bare(id) { return String(id || '').replace(/^USGS-/, ''); }

  /**
   * USGS stores most station names in capitals. The builder bakes a tidied
   * name into the embed, so this only runs for hand-written embeds that left
   * data-labels off. Names already in mixed case are left alone.
   */
  var SMALL = { at: 1, near: 1, above: 1, below: 1, of: 1, the: 1, and: 1, to: 1, nr: 1, ab: 1, bl: 1 };
  function titleCase(name) {
    if (!name || /[a-z]/.test(name)) return name || '';
    return name.toLowerCase().replace(/[a-z]+/g, function (w, at) {
      if (at > 0 && SMALL[w]) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).replace(/\b(us|sf|nf|ef|wf|mf|rm)\b/gi, function (m) { return m.toUpperCase(); })
      // Case-insensitive: by this point the word has already been
      // capitalised, so a lowercase-only pattern would never match and every
      // station would read "Clearwater, Wa".
      .replace(/,\s*([A-Za-z]{2})\.?$/, function (m, st) { return ', ' + st.toUpperCase(); });
  }
  function isoAt(ms) { return new Date(ms).toISOString().slice(0, 19) + 'Z'; }
  function dayAt(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * Largest-Triangle-Three-Buckets. A week of 15-minute readings is ~670
   * points; plain decimation drops whichever sample sits on the flood peak,
   * which is the one thing the chart exists to show.
   */
  function lttb(data, target) {
    var n = data.length, i;
    if (target >= n || target < 3) return data;
    var every = (n - 2) / (target - 2), out = [data[0]], a = 0;

    for (i = 0; i < target - 2; i++) {
      var sn = Math.floor((i + 1) * every) + 1;
      var en = Math.min(Math.floor((i + 2) * every) + 1, n);
      var ax = 0, ay = 0, j;
      for (j = sn; j < en; j++) { ax += data[j][0]; ay += data[j][1]; }
      var span = Math.max(en - sn, 1); ax /= span; ay /= span;

      var st = Math.floor(i * every) + 1, e2 = Math.floor((i + 1) * every) + 1;
      var px = data[a][0], py = data[a][1], best = st, bestArea = -1;
      for (j = st; j < Math.min(e2, n); j++) {
        var area = Math.abs((px - ax) * (data[j][1] - py) - (px - data[j][0]) * (ay - py));
        if (area > bestArea) { bestArea = area; best = j; }
      }
      out.push(data[best]); a = best;
    }
    out.push(data[n - 1]);
    return out;
  }

  /** Run several requests, calling back once with whatever succeeded. */
  function all(jobs, done) {
    var left = jobs.length, results = new Array(left);
    if (!left) { done(results); return; }
    map(jobs, function (job, i) {
      job(function (value) {
        results[i] = value;
        if (--left === 0) done(results);
      });
    });
  }

  function getSoft(url, cb) {
    getJSON(url, cb, function () { cb(null); });
  }

  function fetchDirect(cfg, done, fail) {
    var now = new Date().getTime();
    var idList = ids(cfg.sites);
    var wantChart = cfg.chart !== 'none';
    var chartCode = PARAM[cfg.chartParam] || PARAM.flow;

    var jobs = [
      function (cb) {
        getJSON(usgsUrl('latest-continuous', {
          monitoring_location_id: idList,
          parameter_code: PARAM.flow + ',' + PARAM.stage + ',' + PARAM.temp,
          limit: 500
        }), cb, function () { cb(null); });
      },
      function (cb) {
        if (!cfg.metrics.trend) { cb(null); return; }
        getSoft(usgsUrl('continuous', {
          monitoring_location_id: idList,
          parameter_code: PARAM.flow,
          datetime: isoAt(now - 6 * 3600e3) + '/' + isoAt(now),
          limit: 2000, sortby: 'time'
        }), cb);
      },
      function (cb) {
        if (!wantChart) { cb(null); return; }
        if (cfg.chart === 'hydrograph') {
          getSoft(usgsUrl('continuous', {
            monitoring_location_id: idList,
            parameter_code: chartCode,
            datetime: isoAt(now - cfg.chartDays * 864e5) + '/' + isoAt(now),
            limit: 12000, sortby: 'time'
          }), cb);
        } else {
          getSoft(usgsUrl('daily', {
            monitoring_location_id: idList,
            parameter_code: chartCode,
            statistic_id: '00003',
            datetime: dayAt(now - cfg.chartDays * 864e5) + '/' + dayAt(now),
            limit: 2000, sortby: 'time'
          }), cb);
        }
      },
      function (cb) {
        // Only needed when the embed did not bake in its own labels, which
        // the builder always does.
        var named = 0, i;
        for (i = 0; i < cfg.sites.length; i++) if (cfg.labels[i]) named++;
        if (named >= cfg.sites.length) { cb(null); return; }
        getSoft(usgsUrl('monitoring-locations', { id: idList, limit: 100 }), cb);
      }
    ];

    all(jobs, function (res) {
      var latest = res[0], recent = res[1], chart = res[2], meta = res[3];
      if (!latest || !latest.features) { fail(new Error('no data')); return; }

      var obs = {}, trendSeries = {}, chartRaw = {}, names = {}, unit = '', i, p, v, site;

      for (i = 0; i < latest.features.length; i++) {
        p = latest.features[i].properties;
        v = toNum(p.value);
        if (v === null || !CODE[p.parameter_code]) continue;
        site = bare(p.monitoring_location_id);
        if (!obs[site]) obs[site] = {};
        obs[site][CODE[p.parameter_code]] = { v: v, u: p.unit_of_measure, t: p.time };
      }

      if (recent && recent.features) {
        for (i = 0; i < recent.features.length; i++) {
          p = recent.features[i].properties;
          v = toNum(p.value);
          if (v === null) continue;
          site = bare(p.monitoring_location_id);
          (trendSeries[site] = trendSeries[site] || []).push(v);
        }
      }

      if (chart && chart.features) {
        for (i = 0; i < chart.features.length; i++) {
          p = chart.features[i].properties;
          v = toNum(p.value);
          if (v === null) continue;
          if (!unit) unit = p.unit_of_measure || '';
          var raw = p.time.length <= 10 ? p.time + 'T12:00:00Z' : p.time;
          var t = new Date(raw).getTime();
          if (isNaN(t)) continue;
          site = bare(p.monitoring_location_id);
          (chartRaw[site] = chartRaw[site] || []).push([Math.round(t / 1000), v]);
        }
      }

      if (meta && meta.features) {
        for (i = 0; i < meta.features.length; i++) {
          p = meta.features[i].properties;
          names[p.monitoring_location_number] = titleCase(p.monitoring_location_name);
        }
      }

      var gauges = map(cfg.sites, function (s) {
        var o = obs[s] || {}, ts = trendSeries[s] || [], tr = null;
        if (ts.length > 3 && ts[0]) {
          var pct = ((ts[ts.length - 1] - ts[0]) / ts[0]) * 100;
          tr = { dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat', pct: Math.round(pct * 10) / 10, hours: 6 };
        }
        var pts = lttb(chartRaw[s] || [], cfg.chart === 'hydrograph' ? 260 : 60);
        var hasObs = false;
        for (var k in o) { if (o.hasOwnProperty(k)) { hasObs = true; break; } }
        return {
          site: s,
          name: names[s] || ('USGS ' + s),
          url: 'https://waterdata.usgs.gov/monitoring-location/USGS-' + s + '/',
          obs: o,
          trend: tr,
          spark: map(pts, function (pt) { return pt[1]; }),
          series: wantChart ? {
            param: cfg.chartParam, unit: unit, days: cfg.chartDays,
            resolution: cfg.chart === 'hydrograph' ? 'continuous' : 'daily', points: pts
          } : null,
          reporting: hasObs
        };
      });

      done({ gauges: gauges, source: 'usgs' });
    });
  }

  /* ---------------------------------------------------------------- boot */

  var pending = {};   // url -> [callbacks]  (two widgets, one request)
  var results = {};   // url -> payload

  function proxyUrl(cfg) {
    return API + '/api/v1/gauge?sites=' + cfg.sites.join(',')
      + '&chart=' + cfg.chart
      + '&days=' + cfg.chartDays
      + '&param=' + cfg.chartParam
      + '&trend=' + (cfg.metrics.trend ? 1 : 0);
  }

  /**
   * Where the numbers come from, widest rung first:
   *
   *   1. USGS directly, from the visitor's browser. The default. The reading
   *      shown is the reading USGS is serving, so it matches waterdata.usgs.gov
   *      and every river app to the minute.
   *   2. Our cached API, if the direct call fails — a corporate proxy blocking
   *      the request, or USGS having a bad minute. Up to fifteen minutes
   *      behind, which beats a blank card.
   *   3. The anchor, which was a working link to the station all along.
   *
   * `data-source="proxy"` pins it to our API for anyone who would rather have
   * one cached origin than the freshest number.
   */
  function loadGauges(cfg, done, fail) {
    var url = (cfg.source === 'proxy' ? 'proxy:' : 'direct:') + proxyUrl(cfg);

    if (results[url]) { done(results[url]); return; }
    if (pending[url]) { pending[url].push([done, fail]); return; }
    pending[url] = [[done, fail]];

    var settle = function (data) {
      results[url] = data;
      setTimeout(function () { delete results[url]; }, 300000);
      var waiters = pending[url]; delete pending[url];
      for (var i = 0; i < waiters.length; i++) waiters[i][0](data);
    };
    var giveUp = function (err) {
      var waiters = pending[url] || []; delete pending[url];
      for (var i = 0; i < waiters.length; i++) waiters[i][1](err);
    };

    if (cfg.source !== 'proxy') {
      fetchDirect(cfg, settle, function (err) {
        report('warn', 'Could not reach the USGS API directly (' + (err && err.message || 'unknown')
          + ') for gauges ' + cfg.sites.join(', ') + '. Falling back to the cached copy, which '
          + 'may be up to 15 minutes old. A blocked request here is usually a network filter, an '
          + 'ad blocker, or a content security policy on this page.', { gauges: cfg.sites });
        if (!API) {
          giveUp(new Error('USGS unreachable and no fallback configured'));
          return;
        }
        getJSON(proxyUrl(cfg), function (d) {
          d.source = 'cache';
          report('info', 'Showing cached readings from the fallback API.');
          settle(d);
        }, function (err2) {
          report('error', 'Both the USGS API and the fallback are unreachable, so no readings '
            + 'can be shown for gauges ' + cfg.sites.join(', ') + ' (' + (err2 && err2.message
            || 'unknown error') + '). The embed has been left as a link to the USGS station page.',
            { gauges: cfg.sites, error: err2 && err2.message });
          giveUp(err2);
        });
      });
      return;
    }

    legacyLoad(proxyUrl(cfg), settle, giveUp);
  }

  function legacyLoad(url, settle, giveUp) {
    getJSON(url, function (data) {
      data.source = 'cache';
      settle(data);
    }, giveUp);
  }

  /**
   * Tell us a widget rendered. One request, no cookie, no visitor identifier,
   * nothing about the page beyond the domain the browser already sends. It
   * exists because going direct to USGS means we no longer see renders as a
   * side effect of serving the data, and an install count that only works by
   * being in the data path is not worth being in the data path for.
   */
  var beaconed = false;
  function beacon(cfg) {
    if (beaconed || !API || cfg.beacon === '0') return;
    beaconed = true;
    try {
      var img = new Image();
      img.referrerPolicy = 'origin';
      img.src = API + '/api/v1/beacon?sites=' + cfg.sites.join(',')
        + '&chart=' + cfg.chart + '&theme=' + encodeURIComponent(cfg.theme)
        + '&t=' + new Date().getTime();
    } catch (e) { /* counting is never worth an error */ }
  }

  function mount(el) {
    if (el[FLAG]) return;
    el[FLAG] = true;

    var cfg = readConfig(el);
    if (!cfg.sites.length) {
      var got = el.getAttribute('data-sites') || el.getAttribute('data-site') || '(attribute missing)';
      // The value goes in the message text, not only in the detail object.
      // People are asked to copy console output and send it on, and a detail
      // object copies as "[object Object]".
      report('warn', 'An embed has no usable USGS site number, so nothing was rendered. '
        + 'Got: "' + got + '". Expected 8 to 15 digits, for example data-sites="12041200".',
        { got: got, element: el.className || el.tagName });
      return;
    }

    var host = document.createElement('div');
    host.className = 'riverwidget-host';
    host.setAttribute('aria-live', 'polite');
    el.parentNode.insertBefore(host, el);

    // The anchor stays in the DOM as the no-JavaScript fallback and as an
    // accessible link to the source data. Hidden, never removed.
    el.style.display = 'none';

    var grid, root = null;
    if (host.attachShadow) {
      root = host.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      style.appendChild(document.createTextNode(css(cfg, ':host')));
      grid = document.createElement('div');
      grid.className = 'rw-grid';
      root.appendChild(style);
      root.appendChild(grid);
    } else {
      var scope = 'rw-s' + (++scopeSeq);
      host.className += ' ' + scope;
      var tag = document.createElement('style');
      tag.type = 'text/css';
      var rules = css(cfg, '.' + scope);
      if (tag.styleSheet) tag.styleSheet.cssText = rules;   // IE
      else tag.appendChild(document.createTextNode(rules));
      (document.head || document.getElementsByTagName('head')[0]).appendChild(tag);
      grid = document.createElement('div');
      grid.className = 'rw-grid';
      host.appendChild(grid);
    }

    grid.innerHTML = skeletonHTML(map(cfg.sites, function (s, i) { return cfg.labels[i]; }));

    function paint() {
      loadGauges(cfg, function (data) {
        var bySite = {}, list = data.gauges || [], i;
        for (i = 0; i < list.length; i++) bySite[list[i].site] = list[i];
        var silent = [];
        for (var k = 0; k < cfg.sites.length; k++) {
          var g = bySite[cfg.sites[k]];
          if (!g) silent.push(cfg.sites[k] + ' (not returned by USGS — check the site number)');
          else if (!g.reporting) silent.push(cfg.sites[k] + ' (no current reading — the gauge may be '
            + 'seasonal, offline, or down for maintenance)');
        }
        if (silent.length) {
          report('warn', 'Some gauges have no current reading: ' + silent.join(', ')
            + '. This is usually the gauge, not the widget — open the station page to confirm.');
        }
        grid.innerHTML = map(cfg.sites, function (s, idx) {
          return cardHTML(bySite[s], cfg, cfg.labels[idx]);
        }).join('');
        emitHeight();
      }, function () {
        grid.innerHTML = errorHTML(cfg.sites, cfg.labels);
        emitHeight();
      });
    }

    // In iframe mode the embed page tells its parent how tall it needs to be.
    function emitHeight() {
      if (window.parent === window || !window.postMessage) return;
      setTimeout(function () {
        try {
          var h = document.documentElement.scrollHeight;
          window.parent.postMessage({ type: 'riverwidget:height', height: h, version: VERSION }, '*');
        } catch (e) { /* cross-origin parent that does not want to listen */ }
      }, 60);
    }

    paint();
    beacon(cfg);
    if (cfg.refresh >= 300) setInterval(paint, cfg.refresh * 1000);
  }

  function scan() {
    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  function start() {
    scan();
    // Page builders (Elementor popups, tabs, AJAX loads, SPA route changes)
    // inject markup after load. Re-scan cheaply rather than making people
    // call an init function.
    if (window.MutationObserver) {
      var t = null;
      new MutationObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(scan, 150);
      }).observe(document.documentElement, { childList: true, subtree: true });
    } else {
      var n = 0;
      var poll = setInterval(function () { scan(); if (++n > 20) clearInterval(poll); }, 500);
    }
  }

  if (document.readyState === 'loading') {
    if (document.addEventListener) document.addEventListener('DOMContentLoaded', start);
    else document.attachEvent('onreadystatechange', function () {
      if (document.readyState === 'complete') start();
    });
  } else {
    start();
  }

  window.RiverWidget = {
    scan: scan,
    diagnose: diagnose,
    // Internal, exposed so the direct-from-USGS path — now the primary data
    // path — can be exercised by the test suite rather than only in a browser.
    _direct: fetchDirect,
    themes: (function () { var k = [], n; for (n in THEMES) if (THEMES.hasOwnProperty(n)) k.push(n); return k; })(),
    version: VERSION
  };
})();
