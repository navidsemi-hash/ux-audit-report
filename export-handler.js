/**
 * ============================================================
 * UX Audit Checklist — Export Handler
 * ============================================================
 * Copyright © 2026 Navid Semi (navidsemi.com).
 * All Rights Reserved.
 *
 * Unauthorized reproduction, modification, or distribution of
 * this source code or its compiled output, in whole or in part,
 * is strictly prohibited without the express written permission
 * of Navid Semi.
 *
 * export-handler.js — Generates branded, multi-page PDF audit
 * reports from live checklist state.  Integrates html2pdf.js
 * (loaded from a local extension asset) with a graceful
 * print-window fallback when the bundle is not present.
 * ============================================================
 */

'use strict';

// ─── 1. Design Constants ─────────────────────────────────────────────────────
// Hardcoded counterparts to the CSS-variable design tokens in sidepanel.css.

const C = {
  brand:        '#4f46e5',
  brandLight:   '#eef0fd',
  brandDark:    '#3730a3',
  textPrimary:  '#0d1117',
  textSecondary:'#505973',
  textMuted:    '#9299b0',
  textChecked:  '#b8bdd1',
  bgBase:       '#f4f5f9',
  bgSurface:    '#ffffff',
  border:       '#e0e3ef',
  borderSoft:   '#eceef6',
};

const SEV = {
  critical: { text: '#dc2626', bg: '#fef2f2', border: '#fee2e2' },
  major:    { text: '#ea580c', bg: '#fff7ed', border: '#ffedd5' },
  minor:    { text: '#16a34a', bg: '#f0fdf4', border: '#dcfce7' },
  info:     { text: '#1d4ed8', bg: '#eff6ff', border: '#dbeafe' },
};

// Per-pillar accent colour and SVG icon for the PDF pillar header.
const PILLAR_META = {
  flows:          { iconBg: '#E6F1FB', color: '#185FA5', svgKey: 'flows'          },
  hierarchy:      { iconBg: '#EEEDFE', color: '#534AB7', svgKey: 'hierarchy'      },
  accessibility:  { iconBg: '#E1F5EE', color: '#0F6E56', svgKey: 'accessibility'  },
  responsiveness: { iconBg: '#FAEEDA', color: '#854F0B', svgKey: 'responsiveness' },
  consistency:    { iconBg: '#FAECE7', color: '#993C1D', svgKey: 'consistency'    },
  ux:             { iconBg: '#FBEAF0', color: '#993356', svgKey: 'ux'             },
};

const PILLAR_SVG = {
  flows:          '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  hierarchy:      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  accessibility:  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  responsiveness: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  consistency:    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  ux:             '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  discovery:      '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  annotations:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
};

function _svgIcon(svgKey, color, size = 18) {
  const path = PILLAR_SVG[svgKey] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const COPYRIGHT          = '© 2026 Navid Semi  |  navidsemi.com. All Rights Reserved.';
const CURRENT_REPORT_KEY = 'uxCurrentReport_v1';

// ── Supabase cloud publishing config ─────────────────────────────────────────
const SUPABASE_URL       = 'https://ezoseqwigkedgmoqbhrz.supabase.co';
const SUPABASE_KEY       = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6b3NlcXdpZ2tlZGdtb3FiaHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjQzNzMsImV4cCI6MjA5NzA0MDM3M30.NTqs9Yj3GTct5ab_ZoZLwZeGrt04Tysm_yFzCt3dOoQ';
const REPORT_VIEW_BASE   = 'https://navidsemi-hash.github.io/ux-audit-report/';

// ─── 2. Public API ───────────────────────────────────────────────────────────

export function initExport({ getState, getPillars, getUrl, getDiscovery = () => ({}), getReportMeta = () => ({}), getPerf = () => null, toast, requireAuth = null }) {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const run = async () => {
      btn.disabled = true;
      try {
        await generateReport(getState(), getPillars(), getUrl(), getDiscovery(), getReportMeta(), getPerf(), toast);
      } catch (err) {
        console.error('[UX Audit Export]', err);
        toast(`Export failed: ${err.message?.slice(0, 70) || 'Unknown error'}`);
      } finally {
        btn.disabled = false;
      }
    };
    requireAuth ? await requireAuth(run) : await run();
  });
}

// ─── 3. Report Orchestration ─────────────────────────────────────────────────

async function generateReport(auditState, pillars, pageUrl, discovery, reportMeta, perfData, toast) {
  toast('Preparing report…');

  // Persist full snapshot so report.html can hydrate itself on load
  try {
    await chrome.storage.local.set({
      [CURRENT_REPORT_KEY]: { auditState, pillars, pageUrl, discovery, reportMeta, perfData },
    });
  } catch { /* non-extension context */ }

  // ── Path A: Open dedicated report.html tab (extension context) ─────────────
  try {
    chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
    toast('Report opened in new tab.');
    return;
  } catch { /* non-extension context — fall through */ }

  // ── Path B: Inline print-window fallback (non-extension / dev context) ──────
  const meta     = buildMeta(auditState, pillars, pageUrl);
  const filename = buildFilename(pageUrl);
  const bodyHtml = buildReportBody(meta, auditState, pillars, discovery, reportMeta, perfData);
  renderWithPrintWindow(bodyHtml, filename);
  toast('Report opened — press Ctrl+P → Save as PDF.');
}

// ─── 3a-i. Supabase Report Fetcher ───────────────────────────────────────────

async function fetchReportFromSupabase(reportId) {
  const endpoint = `${SUPABASE_URL}/rest/v1/rpc/get_report_by_id`;
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ report_id: reportId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 120) || res.statusText}`);
  }
  const rows = await res.json();
  // RPC returns a single row object (or null) rather than an array
  if (!rows) throw new Error('Report not found.');
  return rows;
}

// ─── 3b. Report Page Initialiser (called from report.html / view.html) ───────

export async function initReportPage({ reportId = null, isPremium = true, openPaywall = null } = {}) {

  // ── Web viewer path: fetch live data from Supabase ──────────────────────────
  if (reportId) {
    const data = await fetchReportFromSupabase(reportId);

    // Robustly parse context_data (may arrive as a JSON string from Supabase)
    let parsedContext = {};
    try {
      parsedContext = typeof data.context_data === 'string'
        ? JSON.parse(data.context_data)
        : (data.context_data || {});
    } catch (e) {
      console.error('Failed to parse context_data:', e);
      parsedContext = data.context_data || {};
    }
    alert('parsedContext.pillars type: ' + typeof parsedContext.pillars + ', isArray: ' + Array.isArray(parsedContext.pillars) + ', length: ' + (parsedContext.pillars ? parsedContext.pillars.length : 'n/a'));

    // Robustly parse audit_progress
    let parsedProgress = {};
    try {
      parsedProgress = typeof data.audit_progress === 'string'
        ? JSON.parse(data.audit_progress)
        : (data.audit_progress || {});
    } catch (e) {
      console.error('Failed to parse audit_progress:', e);
      parsedProgress = data.audit_progress || {};
    }

    // Robustly parse screenshot_data
    let parsedScreenshots = {};
    try {
      parsedScreenshots = typeof data.screenshot_data === 'string'
        ? JSON.parse(data.screenshot_data)
        : (data.screenshot_data || {});
    } catch (e) {
      parsedScreenshots = {};
    }

    // context_data new format: { discovery: {...}, pillars: [...] }
    // Legacy format: context_data IS the discovery object directly
    const discovery = (parsedContext.discovery !== undefined)
      ? parsedContext.discovery
      : parsedContext;
    const pillars   = Array.isArray(parsedContext.pillars) ? parsedContext.pillars : [];

    const pageUrl    = data.page_name    || '';
    const reportMeta = { auditor: data.auditor_name || '', projectName: parsedContext.project_name || '' };
    const auditState = {
      checked:     parsedProgress.checked     || {},
      notes:       parsedProgress.notes       || {},
      screenshots: parsedScreenshots,
      annotations: parsedProgress.annotations || [],
      expanded:    {},
      pillarOpen:  {},
    };

    // Parse performance_metrics top-level column (new records).
    // Falls back to context_data.perf for old reports that predate the column.
    let _parsedPerfMetrics = null;
    try {
      _parsedPerfMetrics = typeof data.performance_metrics === 'string'
        ? JSON.parse(data.performance_metrics)
        : (data.performance_metrics || null);
    } catch (_) { _parsedPerfMetrics = null; }

    const storedPerf = _parsedPerfMetrics || parsedContext.perf || null;
    // performance_metrics uses {pageLoad, domReady}; legacy context_data.perf uses {load, domReady}
    const perfData = storedPerf
      ? {
          load:     (storedPerf.pageLoad != null ? storedPerf.pageLoad : storedPerf.load) || null,
          domReady: storedPerf.domReady || null,
        }
      : null;

    // Hydrate any plain-text DOM fields the host page exposes
    const pageNameEl    = document.getElementById('pageName');
    const auditorNameEl = document.getElementById('auditorName');
    if (pageNameEl)    pageNameEl.textContent    = pageUrl          || 'No URL recorded';
    if (auditorNameEl) auditorNameEl.textContent = data.auditor_name || 'Anonymous';

    // Hand off to the existing render pipeline with restored perf values
    const meta     = buildMeta(auditState, pillars, pageUrl);
    const filename = buildFilename(pageUrl);
    const bodyHtml = buildReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium);

    const contentEl = document.getElementById('report-content');
    if (contentEl) {
      const screenHtml = (!isPremium)
        ? _buildScreenReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium)
        : bodyHtml;
      contentEl.innerHTML = `<style>${getReportStyles()}</style><div class="pdf-report">${screenHtml}</div>`;
    }

    if (window.feather) window.feather.replace();

    if (!isPremium && typeof openPaywall === 'function') {
      document.getElementById('premium-blurred-report-zone')?.classList.add('gated');
      _initReportGate(openPaywall);
      return;
    }

    document.getElementById('btn-download-pdf')?.addEventListener('click', async () => {
      try {
        await ensureHtml2pdf();
        const wrapper = mountOffscreenDiv(bodyHtml);
        try { await renderWithHtml2pdf(wrapper, filename); }
        finally { unmountElement(wrapper); }
      } catch {
        window.print();
      }
    });

    document.getElementById('btn-print')?.addEventListener('click', () => window.print());
    return;
  }

  // ── Extension path: hydrate from chrome.storage.local snapshot ───────────────
  let reportData = {};
  try {
    const r = await chrome.storage.local.get(CURRENT_REPORT_KEY);
    reportData = r[CURRENT_REPORT_KEY] || {};
  } catch { /* non-extension context */ }

  const {
    auditState  = { checked: {}, notes: {}, screenshots: {}, expanded: {}, pillarOpen: {} },
    pillars     = [],
    pageUrl     = '',
    discovery   = {},
    reportMeta  = {},
    perfData    = null,
  } = reportData;

  const meta     = buildMeta(auditState, pillars, pageUrl);
  const filename = buildFilename(pageUrl);
  const bodyHtml = buildReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium);

  // 2. Inject rendered report into the page.
  //    Non-premium users see a split view: top half visible, bottom half in the gate zone.
  const contentEl = document.getElementById('report-content');
  if (contentEl) {
    const screenHtml = (!isPremium)
      ? _buildScreenReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium)
      : bodyHtml;
    contentEl.innerHTML =
      `<style>${getReportStyles()}</style><div class="pdf-report">${screenHtml}</div>`;
  }

  // 3. Replace Feather icon placeholders
  if (window.feather) window.feather.replace();

  // 4. Non-premium: apply blur gate and intercept all toolbar actions
  if (!isPremium && typeof openPaywall === 'function') {
    document.getElementById('premium-blurred-report-zone')?.classList.add('gated');
    _initReportGate(openPaywall);
    return;
  }

  // 5. Download PDF — uses a fresh offscreen div so the pdf-footer is captured correctly
  document.getElementById('btn-download-pdf')?.addEventListener('click', async () => {
    try {
      await ensureHtml2pdf();
      const wrapper = mountOffscreenDiv(bodyHtml);
      try { await renderWithHtml2pdf(wrapper, filename); }
      finally { unmountElement(wrapper); }
    } catch {
      window.print();   // graceful fallback if html2pdf unavailable
    }
  });

  // 6. Print
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());

  // 7. Share buttons (pass discovery + perfData so publishReport includes all context)
  _initReportShare(auditState, pillars, pageUrl, reportMeta, discovery, perfData);
}

// ─── 3b-i. Screen-only split report body (free top half / gated bottom half) ──

function _buildScreenReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium = false) {
  const dcHtml    = buildDiscoverySection(discovery || {});
  const annotHtml = buildAnnotationsSection(auditState.annotations || []);
  const withDc    = dcHtml.trim().length > 0;

  const splitAt          = Math.ceil(pillars.length / 2);
  const freePillarsHtml  = pillars.slice(0, splitAt)
    .map((p, i) => buildPillarSection(p, auditState, i === 0 && !withDc)).join('\n');
  const gatedPillarsHtml = pillars.slice(splitAt)
    .map(p => buildPillarSection(p, auditState, false)).join('\n');

  return `
    ${buildCover(meta, reportMeta || {}, perfData, isPremium)}
    ${dcHtml}
    ${freePillarsHtml}
    <div id="premium-blurred-report-zone">
      ${gatedPillarsHtml}
      ${annotHtml}
    </div>
    ${buildReportTrailingFooter()}
  `;
}

// ─── 3b-ii. Report gate — intercepts toolbar + blurred zone clicks ────────────

function _initReportGate(openPaywall) {
  const gatedIds = [
    'btn-download-pdf', 'btn-print',
    'share-wa', 'share-tg', 'share-x', 'share-gmail', 'share-link',
  ];
  for (const id of gatedIds) {
    document.getElementById(id)?.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPaywall();
    });
  }
  document.getElementById('premium-blurred-report-zone')?.addEventListener('click', () => {
    openPaywall();
  });
}

// ─── 3c. Supabase Cloud Publisher ────────────────────────────────────────────

async function publishReport(auditState, pillars, pageUrl, discovery, reportMeta, perfData = null) {
  const allItems  = pillars.flatMap(p => p.items);
  const totalDone = allItems.filter(i => auditState.checked[i.id]).length;
  const counts    = { critical: 0, major: 0, minor: 0 };
  for (const item of allItems) {
    if (!auditState.checked[item.id]) {
      const s = normalizeSev(item.severity);
      if (s in counts) counts[s]++;
    }
  }

  let _perfMetrics = null;
  try {
    const t         = window.performance.timing;
    const pageLoad  = t.loadEventEnd                - t.navigationStart;
    const domReady  = t.domContentLoadedEventEnd    - t.navigationStart;
    if (pageLoad > 0 || domReady > 0) {
      _perfMetrics = { pageLoad: pageLoad || null, domReady: domReady || null };
    }
  } catch (_) { /* timing API unavailable */ }

  const payload = {
    page_name:    pageUrl            || '',
    auditor_name: reportMeta.auditor || '',
    // Bundle discovery, pillars, and project metadata together — no extra schema columns needed
    context_data: {
      discovery:    discovery               || {},
      pillars:      pillars                 || [],
      project_name: reportMeta.projectName  || '',
      perf: (perfData && (perfData.load || perfData.domReady))
        ? { load: perfData.load || null, domReady: perfData.domReady || null }
        : null,
    },
    audit_progress: {
      checked:     auditState.checked     || {},
      notes:       auditState.notes       || {},
      annotations: auditState.annotations || [],
    },
    screenshot_data:    auditState.screenshots || {},
    performance_metrics: _perfMetrics,
  };

  const endpoint = `${SUPABASE_URL}/rest/v1/ux_reports`;
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 120) || res.statusText}`);
  }

  const rows = await res.json();
  const id   = rows?.[0]?.id;
  if (!id) throw new Error('Supabase returned no row ID.');

  return `${REPORT_VIEW_BASE}view.html?id=${id}`;
}

// ─── 3d. Report Share Button Wiring ──────────────────────────────────────────

function _initReportShare(auditState, pillars, pageUrl, reportMeta, discovery, perfData = null) {
  function buildSummary(publicUrl) {
    const allItems  = pillars.flatMap(p => p.items);
    const totalDone = allItems.filter(i => auditState.checked[i.id]).length;
    const pct       = allItems.length ? Math.round((totalDone / allItems.length) * 100) : 0;
    const counts    = { critical: 0, major: 0, minor: 0 };
    for (const item of allItems) {
      if (!auditState.checked[item.id]) {
        const s = normalizeSev(item.severity);
        if (s in counts) counts[s]++;
      }
    }
    const lines = ['UX Audit Report'];
    if (reportMeta.projectName) lines.push(`Project: ${reportMeta.projectName}`);
    if (reportMeta.auditor)     lines.push(`Auditor: ${reportMeta.auditor}`);
    lines.push('');
    lines.push(`Progress: ${totalDone}/${allItems.length} items reviewed (${pct}%)`);
    lines.push(`Issues: ${counts.critical} Critical, ${counts.major} Major, ${counts.minor} Minor`);
    if (publicUrl)              lines.push(`\nView Report: ${publicUrl}`);
    lines.push('\nGenerated with UX Audit Checklist — navidsemi.com');
    return lines.join('\n');
  }

  // Wraps a share action: publishes to Supabase first, shows a spinner on the
  // button during the write, then calls onSuccess(publicUrl) with the result.
  // Falls back to onSuccess(null) if publishing fails so sharing still works.
  async function withPublishedUrl(btn, onSuccess) {
    const origHtml  = btn.innerHTML;
    const origTitle = btn.title;
    btn.innerHTML = '<i data-feather="loader" aria-hidden="true"></i>';
    btn.disabled  = true;
    btn.classList.add('is-loading');
    if (window.feather) window.feather.replace();

    let publicUrl = null;
    try {
      publicUrl = await publishReport(auditState, pillars, pageUrl, discovery, reportMeta, perfData);
    } catch (err) {
      console.warn('[UX Audit Share] Publish failed, sharing without public URL:', err.message);
    } finally {
      btn.innerHTML = origHtml;
      btn.title     = origTitle;
      btn.disabled  = false;
      btn.classList.remove('is-loading');
      if (window.feather) window.feather.replace();
    }

    onSuccess(publicUrl);
  }

  // WhatsApp
  document.getElementById('share-wa')?.addEventListener('click', async function() {
    await withPublishedUrl(this, publicUrl => {
      window.open(
        `https://api.whatsapp.com/send?text=${encodeURIComponent(buildSummary(publicUrl))}`,
        '_blank', 'noopener,noreferrer'
      );
    });
  });

  // Telegram
  document.getElementById('share-tg')?.addEventListener('click', async function() {
    await withPublishedUrl(this, publicUrl => {
      const dest = publicUrl || pageUrl || window.location.href;
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(dest)}&text=${encodeURIComponent(buildSummary(publicUrl))}`,
        '_blank', 'noopener,noreferrer'
      );
    });
  });

  // X (Twitter)
  document.getElementById('share-x')?.addEventListener('click', async function() {
    await withPublishedUrl(this, publicUrl => {
      const full = buildSummary(publicUrl);
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(full.length > 260 ? full.slice(0, 257) + '…' : full)}`,
        '_blank', 'noopener,noreferrer'
      );
    });
  });

  // Gmail
  document.getElementById('share-gmail')?.addEventListener('click', async function() {
    await withPublishedUrl(this, publicUrl => {
      window.location.href =
        `mailto:?subject=${encodeURIComponent('UX Audit Report Summary')}&body=${encodeURIComponent(buildSummary(publicUrl))}`;
    });
  });

  // Copy Link — transitions loading → copied → original (no intermediate flash)
  const linkBtn = document.getElementById('share-link');
  if (linkBtn) {
    linkBtn.addEventListener('click', async function() {
      const origHtml  = linkBtn.innerHTML;
      const origTitle = linkBtn.title;
      linkBtn.innerHTML = '<i data-feather="loader" aria-hidden="true"></i>';
      linkBtn.disabled  = true;
      linkBtn.classList.add('is-loading');
      if (window.feather) window.feather.replace();

      let publicUrl = null;
      try {
        publicUrl = await publishReport(auditState, pillars, pageUrl, discovery, reportMeta, perfData);
      } catch (err) {
        console.warn('[UX Audit Share] Publish failed, copying page URL:', err.message);
      }

      linkBtn.disabled = false;
      linkBtn.classList.remove('is-loading');

      const url = publicUrl || pageUrl || window.location.href;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const ta = Object.assign(document.createElement('textarea'), {
          value: url, style: 'position:fixed;opacity:0;top:0;left:0',
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      linkBtn.innerHTML = '<i data-feather="check"></i>';
      linkBtn.title     = 'Link Copied!';
      linkBtn.classList.add('is-copied');
      if (window.feather) window.feather.replace();
      setTimeout(() => {
        linkBtn.innerHTML = origHtml;
        linkBtn.title     = origTitle;
        linkBtn.classList.remove('is-copied');
        if (window.feather) window.feather.replace();
      }, 2000);
    });
  }
}

// ─── 4. html2pdf.js Path ─────────────────────────────────────────────────────

async function ensureHtml2pdf() {
  if (typeof window.html2pdf === 'function') return;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    try {
      // chrome.runtime.getURL resolves to the extension-local asset path
      script.src = chrome.runtime.getURL('assets/html2pdf/html2pdf.bundle.min.js');
    } catch {
      // Non-extension context (e.g., dev browser open) — try relative path
      script.src = 'assets/html2pdf/html2pdf.bundle.min.js';
    }
    script.onload  = () => (typeof window.html2pdf === 'function' ? resolve() : reject(new Error('html2pdf loaded but not a function')));
    script.onerror = () => reject(new Error('html2pdf.bundle.min.js not found. Place it in assets/html2pdf/.'));
    document.head.appendChild(script);
  });
}

async function renderWithHtml2pdf(element, filename) {
  const opts = {
    margin:      [14, 13, 18, 13],      // mm — top, right, bottom, left (bottom leaves room for footer)
    filename,
    image:       { type: 'jpeg', quality: 0.93 },
    html2canvas: {
      scale:           2,               // 2× for crisp text at A4 print resolution
      useCORS:         true,
      letterRendering: true,
      backgroundColor: C.bgSurface,
      width:           768,             // inner content width in px (≈ A4 – margins at 96dpi)
    },
    jsPDF:     { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: 'css', before: '.pdf-page-break' },
  };

  // Render to PDF, then inject the hardcoded copyright footer on every page.
  await window.html2pdf()
    .set(opts)
    .from(element)
    .toPdf()
    .get('pdf')
    .then(pdf => {
      const pages   = pdf.internal.getNumberOfPages();
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const ruleY   = pageH - 9.5;
      const textY   = pageH - 5.5;

      for (let i = 1; i <= pages; i++) {
        pdf.setPage(i);

        // Hairline rule above footer
        pdf.setDrawColor(224, 227, 239);
        pdf.setLineWidth(0.25);
        pdf.line(13, ruleY, pageW - 13, ruleY);

        // Copyright — centred
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(146, 153, 176);
        pdf.text(COPYRIGHT, pageW / 2, textY, { align: 'center' });

        // Page number — right-aligned
        pdf.setFontSize(7);
        pdf.setTextColor(146, 153, 176);
        pdf.text(`${i} / ${pages}`, pageW - 13, textY, { align: 'right' });
      }
    })
    .save();
}

// ─── 5. Print-Window Fallback ────────────────────────────────────────────────

function renderWithPrintWindow(bodyHtml, filename) {
  const printDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(filename.replace('.pdf', ''))}</title>
  <style>
    ${getPrintPageCss()}
    ${getReportStyles()}
  </style>
</head>
<body>
  <div class="pdf-report">${bodyHtml}</div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  <\/script>
</body>
</html>`;

  const blob = new Blob([printDoc], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  // Revoke the object URL after the window has had time to load it
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  if (!win) {
    // Fallback if popup was blocked: create a download link
    const a = Object.assign(document.createElement('a'), {
      href:     url,
      download: filename.replace('.pdf', '.html'),
      style:    'display:none',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

// ─── 6. Offscreen DOM Helpers ────────────────────────────────────────────────

function mountOffscreenDiv(innerHtml) {
  const wrapper = document.createElement('div');
  // Render at exactly A4-minus-margins width. Fixed + negative left keeps it
  // out of view but still fully rendered so html2canvas can capture it.
  wrapper.style.cssText = [
    'position:fixed',
    'top:0',
    'left:-9999px',
    'width:768px',
    'background:#ffffff',
    'color:#0d1117',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
    'font-size:12px',
    'line-height:1.5',
    'z-index:-1000',
    'overflow:visible',
  ].join(';');

  wrapper.innerHTML = `<style>${getReportStyles()}</style><div class="pdf-report">${innerHtml}</div>`;
  document.body.appendChild(wrapper);
  return wrapper;
}

function unmountElement(el) {
  try { el?.parentNode?.removeChild(el); } catch { /* already removed */ }
}

// ─── 7. Metadata Computation ─────────────────────────────────────────────────

function buildMeta(auditState, pillars, pageUrl) {
  const allItems   = pillars.flatMap(p => p.items);
  const totalItems = allItems.length;
  const totalDone  = allItems.filter(i => auditState.checked[i.id]).length;
  const pct        = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

  const issuesBySev = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const item of allItems) {
    if (!auditState.checked[item.id]) issuesBySev[normalizeSev(item.severity)]++;
  }

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return { pageUrl, date, totalItems, totalDone, pct, issuesBySev };
}

function buildFilename(pageUrl) {
  const date = new Date().toISOString().slice(0, 10);
  if (!pageUrl) return `ux-audit-${date}.pdf`;
  try {
    const hostname = new URL(pageUrl).hostname.replace(/^www\./, '');
    const slug     = hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30);
    return `ux-audit-${slug}-${date}.pdf`;
  } catch { return `ux-audit-${date}.pdf`; }
}

// ─── 8. HTML Builder — Full Report Body ──────────────────────────────────────

function buildReportBody(meta, auditState, pillars, discovery, reportMeta, perfData, isPremium = false) {
  alert('pillars count: ' + (pillars ? pillars.length : 'pillars is ' + pillars));
  const dcHtml   = buildDiscoverySection(discovery || {});
  const annotHtml = buildAnnotationsSection(auditState.annotations || []);
  const withDc   = dcHtml.trim().length > 0;
  return `
    ${buildCover(meta, reportMeta || {}, perfData, isPremium)}
    ${dcHtml}
    ${pillars.map((p, i) => buildPillarSection(p, auditState, i === 0 && !withDc)).join('\n')}
    ${annotHtml}
    ${buildReportTrailingFooter()}
  `;
}

// ─── 9a. Discovery & Context Section ─────────────────────────────────────────

function buildDiscoverySection(discovery) {
  const fields = [
    { label: 'Who are the primary users?',           value: discovery.users      },
    { label: 'What are the main use cases?',          value: discovery.usecases   },
    { label: 'What business goals does this serve?',  value: discovery.goals      },
    { label: 'What are common user complaints?',      value: discovery.complaints },
  ].filter(f => f.value?.trim());

  if (!fields.length) return '';

  const rowsHtml = fields.map(f => `
  <div class="pdf-dc-row">
    <div class="pdf-dc-label">${escHtml(f.label)}</div>
    <div class="pdf-dc-value">${escHtml(f.value.trim())}</div>
  </div>`).join('');

  return `
<section class="pdf-dc-section pdf-page-break">
  <div class="pdf-pillar-hd" style="border-left:4px solid #495057">
    <div class="pdf-pillar-icon" style="background:#F1F3F5">${_svgIcon('discovery', '#495057')}</div>
    <div class="pdf-pillar-title-wrap">
      <h2 class="pdf-pillar-name">Discovery &amp; Context</h2>
      <span class="pdf-pillar-stat">Project setup &amp; research notes</span>
    </div>
  </div>
  <div class="pdf-dc-body">${rowsHtml}</div>
</section>`;
}

// ─── 9. Cover Section ────────────────────────────────────────────────────────

function buildCover({ pageUrl, date, totalItems, totalDone, pct, issuesBySev }, reportMeta = {}, perfData = null, isPremium = false) {
  const perfLoad = (perfData?.load    && perfData.load    !== '--') ? escHtml(perfData.load)    : '--';
  const perfDom  = (perfData?.domReady && perfData.domReady !== '--') ? escHtml(perfData.domReady) : '--';
  const statCards = [
    { label: 'Critical', count: issuesBySev.critical, ...SEV.critical },
    { label: 'Major',    count: issuesBySev.major,    ...SEV.major    },
    { label: 'Minor',    count: issuesBySev.minor,    ...SEV.minor    },
  ].map(s => `
    <div class="pdf-stat-card" style="background:${s.bg};border:1px solid ${s.border}">
      <span class="pdf-stat-count" style="color:${s.text}">${s.count}</span>
      <span class="pdf-stat-label">${s.label}</span>
      <span class="pdf-stat-sub">unchecked</span>
    </div>`).join('');

  const urlDisplay    = pageUrl || 'No URL recorded';
  const projectRow    = reportMeta.projectName
    ? `<tr><td class="pdf-meta-key">Project Name</td><td class="pdf-meta-val"><strong>${escHtml(reportMeta.projectName)}</strong></td></tr>`
    : '';
  const auditorRow    = reportMeta.auditor
    ? `<tr><td class="pdf-meta-key">Auditor</td><td class="pdf-meta-val">${escHtml(reportMeta.auditor)}</td></tr>`
    : '';

  return `
<div class="pdf-cover">

  <!-- Solid header bar -->
  <div class="pdf-header-bar">
    <div class="pdf-header-left">
      <span class="pdf-header-mark">◼</span>
      <span class="pdf-header-title">UX Audit Checklist</span>
    </div>
    <div class="pdf-header-right">${isPremium ? '' : '<span id="report-branding-watermark" style="color:rgba(255,255,255,0.7);font-size:12px;">navidsemi.com</span>'}</div>
  </div>

  <!-- Report identity -->
  <div class="pdf-cover-body">
    <h1 class="pdf-report-h1">UX Audit Report</h1>

    <div style="display:flex;gap:12px;margin:16px 0 24px 0;box-sizing:border-box;">
      <div style="flex:1;background:${C.bgBase};border:1px solid ${C.border};padding:12px 16px;border-radius:8px;display:flex;align-items:center;gap:10px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:0;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div>
          <div style="color:${C.textSecondary};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;line-height:1;">Page Load</div>
          <strong id="report-perf-load" style="color:${C.textPrimary};font-size:16px;font-weight:700;display:block;margin-top:4px;line-height:1;">${perfLoad}</strong>
        </div>
      </div>
      <div style="flex:1;background:${C.bgBase};border:1px solid ${C.border};padding:12px 16px;border-radius:8px;display:flex;align-items:center;gap:10px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:0;flex-shrink:0;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        <div>
          <div style="color:${C.textSecondary};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;line-height:1;">DOM Ready</div>
          <strong id="report-perf-dom" style="color:${C.textPrimary};font-size:16px;font-weight:700;display:block;margin-top:4px;line-height:1;">${perfDom}</strong>
        </div>
      </div>
    </div>

    <table class="pdf-meta-table">
      ${projectRow}
      ${auditorRow}
      <tr>
        <td class="pdf-meta-key">Audited Page</td>
        <td class="pdf-meta-val">${escHtml(urlDisplay)}</td>
      </tr>
      <tr>
        <td class="pdf-meta-key">Date Generated</td>
        <td class="pdf-meta-val">${escHtml(date)}</td>
      </tr>
      <tr>
        <td class="pdf-meta-key">Items Reviewed</td>
        <td class="pdf-meta-val">
          <strong style="color:${C.brand}">${totalDone}</strong>
          of ${totalItems} items (${pct}%)
        </td>
      </tr>
    </table>

    <!-- Global progress bar -->
    <div class="pdf-section-label">Overall Progress</div>
    <div class="pdf-prog-track">
      <div class="pdf-prog-fill" style="width:${pct}%"></div>
    </div>
    <div class="pdf-prog-pct">${pct}% complete</div>

    <!-- Issues summary -->
    <div class="pdf-section-label" style="margin-top:20px">Issues by Severity (unchecked items)</div>
    <div class="pdf-stats-grid">${statCards}</div>
  </div>

</div>`;
}

// ─── 9b. Annotations Section ─────────────────────────────────────────────────

const REPORT_CATEGORY_CLASSES = {
  'User flows & navigation':         'pdf-ann-cat--flows',
  'Visual hierarchy & layout':       'pdf-ann-cat--hierarchy',
  'Accessibility (a11y)':            'pdf-ann-cat--a11y',
  'Responsiveness & performance':    'pdf-ann-cat--responsiveness',
  'Consistency & design system':     'pdf-ann-cat--consistency',
  'Overall user experience':         'pdf-ann-cat--ux',
};

function categoryToReportClass(cat) {
  return REPORT_CATEGORY_CLASSES[cat] || '';
}

function buildAnnotationsSection(annotations) {
  if (!annotations.length) return '';

  const plural = annotations.length === 1 ? 'observation' : 'observations';
  const cardsHtml = annotations.map((a, i) => `
<div class="pdf-annotation-card">
  ${a.imageDataUrl
    ? `<img class="pdf-annotation-img" src="${a.imageDataUrl}" alt="Annotation ${i + 1}" />`
    : ''}
  <div class="pdf-annotation-body">
    ${a.category ? `<span class="pdf-annotation-cat ${categoryToReportClass(a.category)}">${escHtml(a.category)}</span>` : ''}
    <p class="pdf-annotation-note">${escHtml(a.note || '(no note)')}</p>
    <span class="pdf-annotation-meta">Annotated ${_fmtDate(a.createdAt)}</span>
  </div>
</div>`).join('');

  return `
<section class="pdf-annotation-section pdf-page-break">
  <div class="pdf-pillar-hd" style="border-left:4px solid #7c3aed">
    <div class="pdf-pillar-icon" style="background:#F0EBFF">${_svgIcon('annotations', '#7c3aed')}</div>
    <div class="pdf-pillar-title-wrap">
      <h2 class="pdf-pillar-name">Visual Annotations</h2>
      <span class="pdf-pillar-stat">${annotations.length} page-level ${plural}</span>
    </div>
  </div>
  <div class="pdf-annotation-list">${cardsHtml}</div>
</section>`;
}

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

// ─── 9c. Report Trailing Footer ──────────────────────────────────────────────

function buildReportTrailingFooter() {
  return `<div class="pdf-report-footer">${COPYRIGHT}</div>`;
}

// ─── 10. Pillar Section ───────────────────────────────────────────────────────

function buildPillarSection(pillar, auditState, isFirst) {
  const meta  = PILLAR_META[pillar.id] || { iconBg: C.brandLight, color: C.brand, svgKey: null };
  const done  = pillar.items.filter(i => auditState.checked[i.id]).length;
  const total = pillar.items.length;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  const itemsHtml = pillar.items.map(item => buildItem(item, auditState, meta.color)).join('\n');

  return `
<section class="pdf-pillar-section${isFirst ? '' : ' pdf-page-break'}">

  <div class="pdf-pillar-hd" style="border-left:4px solid ${meta.color}">
    <div class="pdf-pillar-icon" style="background:${meta.iconBg}">${_svgIcon(meta.svgKey, meta.color)}</div>

    <div class="pdf-pillar-title-wrap">
      <h2 class="pdf-pillar-name">${escHtml(pillar.label)}</h2>
      <span class="pdf-pillar-stat">${done} of ${total} reviewed</span>
    </div>

    <div class="pdf-pillar-bar-wrap">
      <div class="pdf-pillar-bar-track">
        <div class="pdf-pillar-bar-fill" style="width:${pct}%;background:${meta.color}"></div>
      </div>
      <span class="pdf-pillar-pct">${pct}%</span>
    </div>
  </div>

  <div class="pdf-items">${itemsHtml}</div>

</section>`;
}

// ─── 11. Item Row ─────────────────────────────────────────────────────────────

function buildItem(item, auditState, pillarColor) {
  const isChecked  = !!auditState.checked[item.id];
  const note       = (auditState.notes[item.id] || '').trim();
  const rawShot = (auditState.screenshots || {})[item.id];
  const shots   = Array.isArray(rawShot) ? rawShot : (rawShot ? [rawShot] : []);
  const sev     = SEV[normalizeSev(item.severity)];

  const checkBox = isChecked
    ? `<div class="pdf-check is-checked">&#10003;</div>`
    : `<div class="pdf-check"></div>`;

  const noteHtml = note
    ? `<div class="pdf-item-note" style="border-left-color:${pillarColor}">${escHtml(note)}</div>`
    : '';

  const screenshotHtml = shots.length
    ? shots.map((src, i) => `<div class="pdf-screenshot"><img src="${src}" alt="Screenshot ${i + 1}" /></div>`).join('')
    : '';

  return `
<div class="pdf-item${isChecked ? ' is-checked' : ''}">
  <div class="pdf-item-main">
    ${checkBox}
    <span class="pdf-item-label">${escHtml(item.label)}</span>
    <span class="pdf-badge" style="background:${sev.bg};color:${sev.text}">${capitalize(item.severity)}</span>
  </div>
  ${noteHtml}
  ${screenshotHtml}
</div>`;
}

// ─── 12. Inline CSS — Report Styles ──────────────────────────────────────────

function getReportStyles() {
  return `
/* ── Reset ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── Root ── */
.pdf-report{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  font-size:12px;
  line-height:1.5;
  color:${C.textPrimary};
  background:${C.bgSurface};
  width:100%;
}

/* ── Cover ── */
.pdf-cover{margin-bottom:0}

.pdf-header-bar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:16px 24px;
  background:${C.brand};
  color:#fff;
  margin-bottom:0;
}
.pdf-header-left{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
.pdf-header-mark{font-size:18px;opacity:.85}
.pdf-header-right{font-size:11px;opacity:.75;letter-spacing:.3px}

.pdf-cover-body{padding:24px 24px 20px}

.pdf-report-h1{
  font-size:24px;
  font-weight:700;
  color:${C.textPrimary};
  margin-bottom:16px;
}

.pdf-meta-table{
  width:100%;
  border-collapse:collapse;
  margin-bottom:20px;
  font-size:11.5px;
}
.pdf-meta-key{
  width:130px;
  padding:5px 10px 5px 0;
  color:${C.textSecondary};
  font-weight:600;
  vertical-align:top;
  white-space:nowrap;
  border-bottom:1px solid ${C.borderSoft};
}
.pdf-meta-val{
  padding:5px 0;
  color:${C.textPrimary};
  border-bottom:1px solid ${C.borderSoft};
  word-break:break-all;
}

.pdf-section-label{
  font-size:10px;
  font-weight:700;
  letter-spacing:.6px;
  text-transform:uppercase;
  color:${C.textMuted};
  margin-bottom:6px;
}

/* ── Progress bar ── */
.pdf-prog-track{
  height:6px;
  background:${C.border};
  border-radius:100px;
  overflow:hidden;
  margin-bottom:4px;
}
.pdf-prog-fill{
  height:100%;
  background:linear-gradient(90deg,${C.brand},#818cf8);
  border-radius:100px;
  min-width:2px;
}
.pdf-prog-pct{font-size:10.5px;color:${C.brand};font-weight:600;margin-bottom:0}

/* ── Stats grid ── */
.pdf-stats-grid{
  display:flex;
  gap:8px;
  margin-top:6px;
}
.pdf-stat-card{
  flex:1;
  border-radius:8px;
  padding:10px 8px 8px;
  text-align:center;
}
.pdf-stat-count{
  display:block;
  font-size:22px;
  font-weight:800;
  line-height:1.1;
}
.pdf-stat-label{
  display:block;
  font-size:10px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.4px;
  margin-top:2px;
  color:${C.textSecondary};
}
.pdf-stat-sub{
  display:block;
  font-size:9px;
  color:${C.textMuted};
  margin-top:1px;
}

/* ── Report trailing copyright footer ── */
.pdf-report-footer{
  margin-top:32px;
  padding:12px 24px;
  border-top:1px solid ${C.border};
  font-size:9px;
  color:${C.textMuted};
  text-align:center;
  letter-spacing:.2px;
}

/* ── Pillar section ── */
.pdf-pillar-section{padding:0 0 4px}

.pdf-pillar-hd{
  display:flex;
  align-items:center;
  gap:12px;
  padding:14px 16px;
  background:${C.bgBase};
  margin-bottom:2px;
}

.pdf-pillar-icon{
  display:flex;
  align-items:center;
  justify-content:center;
  width:34px;
  height:34px;
  min-width:34px;
  border-radius:8px;
}

.pdf-pillar-title-wrap{flex:1;min-width:0}
.pdf-pillar-name{
  font-size:15px;
  font-weight:800;
  color:${C.textPrimary};
  letter-spacing:-0.2px;
}
.pdf-pillar-stat{
  display:block;
  font-size:10px;
  color:${C.textMuted};
  margin-top:1px;
}

.pdf-pillar-bar-wrap{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:80px;
}
.pdf-pillar-bar-track{
  flex:1;
  height:5px;
  background:${C.border};
  border-radius:100px;
  overflow:hidden;
}
.pdf-pillar-bar-fill{height:100%;border-radius:100px;min-width:2px}
.pdf-pillar-pct{font-size:9.5px;font-weight:700;color:${C.textSecondary};white-space:nowrap}

/* ── Items ── */
.pdf-items{padding:0 0 8px}

.pdf-item{
  padding:8px 16px;
  border-bottom:1px solid ${C.borderSoft};
}
.pdf-item:last-child{border-bottom:none}
.pdf-item.is-checked{background:${C.bgBase}}

.pdf-item-main{
  display:flex;
  align-items:flex-start;
  gap:8px;
}

.pdf-check{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:16px;
  height:16px;
  min-width:16px;
  margin-top:1px;
  border-radius:3px;
  border:1.5px solid ${C.border};
  background:${C.bgSurface};
  font-size:10px;
  font-weight:700;
  color:transparent;
}
.pdf-check.is-checked{
  background:#16a34a;
  border-color:#16a34a;
  color:#ffffff;
}
input[type="checkbox"]{accent-color:#16a34a;}
input[type="checkbox"]:focus-visible{outline:2px solid #16a34a;outline-offset:2px;}

.pdf-item-label{
  flex:1;
  font-size:11.5px;
  line-height:1.45;
  color:${C.textPrimary};
}
.pdf-item.is-checked .pdf-item-label{
  color:${C.textChecked};
}

.pdf-badge{
  flex-shrink:0;
  font-size:8.5px;
  font-weight:700;
  letter-spacing:.4px;
  text-transform:uppercase;
  padding:2px 6px;
  border-radius:100px;
  white-space:nowrap;
  margin-top:2px;
}
.pdf-item.is-checked .pdf-badge{opacity:.45}

.pdf-item-note{
  margin:5px 0 0 24px;
  padding:5px 9px;
  border-left:3px solid ${C.brand};
  background:${C.bgBase};
  border-radius:0 4px 4px 0;
  font-size:10.5px;
  color:${C.textSecondary};
  line-height:1.45;
}

/* ── Screenshot evidence ── */
.pdf-screenshot{margin:6px 0 2px 24px}
.pdf-screenshot img{
  max-width:360px;
  width:100%;
  height:auto;
  display:block;
  border:1px solid ${C.border};
  border-radius:4px;
}

/* ── Discovery & Context section ── */
.pdf-dc-section{margin-bottom:0}
.pdf-dc-body{padding:4px 16px 16px}
.pdf-dc-row{
  margin-bottom:10px;
  padding-bottom:10px;
  border-bottom:1px solid ${C.borderSoft};
}
.pdf-dc-row:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.pdf-dc-label{
  font-size:9.5px;
  font-weight:700;
  letter-spacing:.5px;
  text-transform:uppercase;
  color:${C.textMuted};
  margin-bottom:3px;
}
.pdf-dc-value{
  font-size:11.5px;
  color:${C.textPrimary};
  line-height:1.5;
  white-space:pre-wrap;
}

/* ── Visual Annotations section ── */
.pdf-annotation-list{padding:4px 0 8px}
.pdf-annotation-card{
  display:flex;
  gap:14px;
  padding:12px 16px;
  border-bottom:1px solid ${C.borderSoft};
  align-items:flex-start;
}
.pdf-annotation-card:last-child{border-bottom:none}
.pdf-annotation-img{
  width:160px;
  min-width:160px;
  height:auto;
  display:block;
  border:1px solid ${C.border};
  border-radius:5px;
  flex-shrink:0;
}
.pdf-annotation-body{flex:1;min-width:0}
.pdf-annotation-cat{
  display:inline-block;
  padding:2px 8px;
  border-radius:100px;
  font-size:9.5px;
  font-weight:700;
  letter-spacing:.3px;
  background:#f1f0ff;
  color:#534AB7;
  margin-bottom:5px;
  white-space:nowrap;
}
.pdf-ann-cat--flows          { background:#E6F1FB; color:#185FA5; }
.pdf-ann-cat--hierarchy      { background:#EEEDFE; color:#534AB7; }
.pdf-ann-cat--a11y           { background:#E1F5EE; color:#0F6E56; }
.pdf-ann-cat--responsiveness { background:#FAEEDA; color:#854F0B; }
.pdf-ann-cat--consistency    { background:#FAECE7; color:#993C1D; }
.pdf-ann-cat--ux             { background:#FBEAF0; color:#993356; }
.pdf-annotation-note{
  font-size:12px;
  line-height:1.55;
  color:${C.textPrimary};
  margin:0 0 5px;
  white-space:pre-wrap;
  word-break:break-word;
}
.pdf-annotation-meta{
  font-size:9.5px;
  color:${C.textMuted};
  letter-spacing:.2px;
}

/* ── Page break marker (html2pdf) ── */
.pdf-page-break{page-break-before:always}
`;
}

// ─── 13. Print-Window @page CSS ──────────────────────────────────────────────

function getPrintPageCss() {
  // The copyright footer appears on every printed page via CSS named strings.
  // This is supported by Chrome's native print engine.
  return `
@page{
  size:A4 portrait;
  margin:16mm 14mm 22mm 14mm;
  @bottom-center{
    content:"${COPYRIGHT}";
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    font-size:7pt;
    color:#9299b0;
  }
  @bottom-right{
    content:counter(page) " / " counter(pages);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    font-size:7pt;
    color:#9299b0;
  }
}
@media print{
  .pdf-page-break{page-break-before:always}
  .pdf-item{page-break-inside:avoid}
  .pdf-pillar-hd{page-break-inside:avoid;page-break-after:avoid}
  .pdf-report-footer{display:none} /* suppressed — @page footer handles it in print mode */
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;
}

// ─── 14. Utilities ───────────────────────────────────────────────────────────

// Maps our PILLARS severity strings ('high','med','low') and any legacy /
// alias values to the four SEV keys used in the PDF stat cards and badges.
function normalizeSev(sev) {
  switch ((sev || '').toLowerCase()) {
    case 'high':
    case 'critical': return 'critical';
    case 'med':
    case 'medium':
    case 'major':    return 'major';
    case 'low':
    case 'minor':    return 'minor';
    default:         return 'info';
  }
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}
