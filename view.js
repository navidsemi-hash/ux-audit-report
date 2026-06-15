// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public report viewer: fetches a saved audit from Supabase and hydrates the DOM.

'use strict';

// ─── 1. Supabase Config ───────────────────────────────────────────────────────

const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL_HERE';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

// ─── 2. Design Constants ─────────────────────────────────────────────────────

const SEV = {
  critical: { text: '#dc2626', bg: '#fef2f2' },
  major:    { text: '#c2410c', bg: '#fff4ee' },
  minor:    { text: '#a16207', bg: '#fefce8' },
  info:     { text: '#1d4ed8', bg: '#eff6ff' },
};

const PILLAR_META = {
  flows:          { initial: 'F', color: '#185FA5' },
  hierarchy:      { initial: 'H', color: '#534AB7' },
  accessibility:  { initial: 'A', color: '#0F6E56' },
  responsiveness: { initial: 'R', color: '#854F0B' },
  consistency:    { initial: 'C', color: '#993C1D' },
  ux:             { initial: 'U', color: '#993356' },
};

// Full pillar + item definitions — mirrors sidepanel.js PILLARS exactly.
const PILLARS = [
  {
    id: 'flows', label: 'User flows & navigation',
    desc: 'Navigation architecture, task flows & wayfinding',
    items: [
      { id: 'flows-1', severity: 'high', label: 'Navigation labels are clear and match user expectations' },
      { id: 'flows-2', severity: 'high', label: 'Primary actions reachable within 1–2 clicks from entry points' },
      { id: 'flows-3', severity: 'med',  label: 'Breadcrumbs or back-navigation exist for deep hierarchies' },
      { id: 'flows-4', severity: 'med',  label: 'Search is available and returns relevant results' },
      { id: 'flows-5', severity: 'high', label: 'Core user journeys have no dead ends or orphaned pages' },
      { id: 'flows-6', severity: 'high', label: 'Error recovery paths are clearly signposted' },
      { id: 'flows-7', severity: 'med',  label: 'Multi-step flows show progress indicators' },
      { id: 'flows-8', severity: 'low',  label: 'Exit / cancel options are available in every flow' },
    ],
  },
  {
    id: 'hierarchy', label: 'Visual hierarchy & layout',
    desc: 'Typography, spacing & composition',
    items: [
      { id: 'hier-1', severity: 'high', label: 'Heading scale creates clear content hierarchy (H1 > H2 > H3)' },
      { id: 'hier-2', severity: 'high', label: 'Body text is at least 16px with 1.5 line-height' },
      { id: 'hier-3', severity: 'med',  label: 'No more than 2–3 typefaces used across the interface' },
      { id: 'hier-4', severity: 'med',  label: 'Line length stays between 45–75 characters' },
      { id: 'hier-5', severity: 'high', label: 'Primary CTAs are visually dominant and above the fold' },
      { id: 'hier-6', severity: 'med',  label: 'Whitespace consistently groups related elements' },
      { id: 'hier-7', severity: 'med',  label: 'Grid or spacing system applied consistently across pages' },
      { id: 'hier-8', severity: 'low',  label: 'Visual weight guides the eye through intended reading order' },
    ],
  },
  {
    id: 'accessibility', label: 'Accessibility (a11y)',
    desc: 'Colour contrast, keyboard access & screen reader support',
    items: [
      { id: 'a11y-1',  severity: 'high', label: 'Text contrast meets WCAG AA (4.5:1 normal, 3:1 large text)' },
      { id: 'a11y-2',  severity: 'high', label: 'UI components and focus indicators meet 3:1 contrast' },
      { id: 'a11y-3',  severity: 'high', label: 'Information is not conveyed by colour alone' },
      { id: 'a11y-4',  severity: 'high', label: 'All interactive elements reachable via keyboard Tab' },
      { id: 'a11y-5',  severity: 'high', label: 'Focus indicators are clearly visible and not suppressed' },
      { id: 'a11y-6',  severity: 'med',  label: 'Touch targets are at least 44×44px on mobile' },
      { id: 'a11y-7',  severity: 'high', label: 'No keyboard traps in modals or components' },
      { id: 'a11y-8',  severity: 'high', label: 'All images have meaningful alt text (or empty alt="" if decorative)' },
      { id: 'a11y-9',  severity: 'high', label: 'Form fields have associated label elements' },
      { id: 'a11y-10', severity: 'med',  label: 'ARIA roles and landmarks are used correctly' },
      { id: 'a11y-11', severity: 'med',  label: 'Dynamic content updates announced via live regions' },
    ],
  },
  {
    id: 'responsiveness', label: 'Responsiveness & performance',
    desc: 'Breakpoint behaviour & perceived performance',
    items: [
      { id: 'resp-1', severity: 'high', label: 'Layout adapts at mobile (320px), tablet (768px), desktop (1280px)' },
      { id: 'resp-2', severity: 'high', label: 'No horizontal scrolling at standard breakpoints' },
      { id: 'resp-3', severity: 'med',  label: 'Images and media scale without distortion' },
      { id: 'resp-4', severity: 'med',  label: 'Navigation collapses gracefully on small screens' },
      { id: 'resp-5', severity: 'med',  label: 'Skeleton loaders or spinners shown during loading' },
      { id: 'resp-6', severity: 'high', label: 'Page feels interactive within 3 seconds on average connection' },
      { id: 'resp-7', severity: 'med',  label: 'Animations do not cause jank or layout shifts' },
      { id: 'resp-8', severity: 'low',  label: 'Offline or error states handled gracefully' },
    ],
  },
  {
    id: 'consistency', label: 'Consistency & design system',
    desc: 'Component uniformity & interaction patterns',
    items: [
      { id: 'con-1', severity: 'high', label: 'Buttons, inputs, and cards follow a unified style across all screens' },
      { id: 'con-2', severity: 'med',  label: 'Icons are from a single family at consistent sizes' },
      { id: 'con-3', severity: 'med',  label: 'Spacing follows a defined scale (4px or 8px base unit)' },
      { id: 'con-4', severity: 'high', label: 'Colour palette is limited and applied to consistent semantic roles' },
      { id: 'con-5', severity: 'med',  label: 'Hover, focus, active states defined for all interactive elements' },
      { id: 'con-6', severity: 'high', label: 'Feedback messages (success, error, warning) use consistent patterns' },
      { id: 'con-7', severity: 'med',  label: 'Modals, drawers, toasts behave identically site-wide' },
      { id: 'con-8', severity: 'low',  label: 'Copy and microcopy uses consistent tone and terminology' },
    ],
  },
  {
    id: 'ux', label: 'Overall user experience',
    desc: 'Onboarding, feedback & delight',
    items: [
      { id: 'ux-1',  severity: 'high', label: 'New users understand product value within 30 seconds' },
      { id: 'ux-2',  severity: 'med',  label: 'First-run experience includes guidance without being patronising' },
      { id: 'ux-3',  severity: 'med',  label: 'Empty states give clear next actions (not just "nothing here")' },
      { id: 'ux-4',  severity: 'high', label: 'Every user action has visible feedback (confirmation, error, or change)' },
      { id: 'ux-5',  severity: 'high', label: 'Destructive actions require confirmation before executing' },
      { id: 'ux-6',  severity: 'high', label: 'Form validation messages are specific and constructive' },
      { id: 'ux-7',  severity: 'med',  label: 'System status (saving, loading, syncing) is always visible' },
      { id: 'ux-8',  severity: 'low',  label: 'Micro-interactions add meaning without distracting from tasks' },
      { id: 'ux-9',  severity: 'med',  label: 'Error messages are human and suggest a next step' },
      { id: 'ux-10', severity: 'low',  label: 'Interface feels fast even when it is not (optimistic UI)' },
    ],
  },
];

// ─── 3. Utilities ─────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

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

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

// ─── 4. Overlay Control ───────────────────────────────────────────────────────

function hideOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('is-hidden');
}

function showError(title, body) {
  hideOverlay();
  const el = document.getElementById('error-state');
  if (el) el.classList.add('is-visible');
  const t = document.getElementById('error-title');
  const b = document.getElementById('error-body');
  if (t) t.textContent = title;
  if (b) b.textContent = body;
  
  const toolbar = document.querySelector('.report-toolbar');
  const wrap    = document.getElementById('report-body-wrap');
  if (toolbar) toolbar.style.display = 'none';
  if (wrap)    wrap.style.display    = 'none';
}

// ─── 5. Meta Table Builder ────────────────────────────────────────────────────

function buildMetaRow(key, value) {
  return `<tr>
    <td class="pdf-meta-key">${esc(key)}</td>
    <td class="pdf-meta-val">${esc(value)}</td>
  </tr>`;
}

// ─── 6. Stat Cards Builder ────────────────────────────────────────────────────

function buildStatCard(label, count, sevKey) {
  const s = SEV[sevKey];
  return `
    <div class="pdf-stat-card" style="border-top:3px solid ${s.text}">
      <span class="pdf-stat-count" style="color:${s.text}">${count}</span>
      <span class="pdf-stat-label">${esc(label)}</span>
      <span class="pdf-stat-sub">unchecked</span>
    </div>`;
}

// ─── 7. Discovery Section Hydration ──────────────────────────────────────────

function hydrateDiscovery(discovery) {
  if (!discovery || typeof discovery !== 'object') return;

  const fields = [
    { label: 'Who are the primary users?',           value: discovery.users    },
    { label: 'What are the main use cases?',          value: discovery.usecases   },
    { label: 'What business goals does this serve?',  value: discovery.goals      },
    { label: 'What are common user complaints?',      value: discovery.complaints },
  ].filter(f => f.value?.trim());

  if (!fields.length) return;

  const bodyEl = document.getElementById('discovery-body');
  const cardEl = document.getElementById('discovery-card');
  if (!bodyEl || !cardEl) return;

  bodyEl.innerHTML = fields.map(f => `
    <div class="pdf-dc-row">
      <div class="pdf-dc-label">${esc(f.label)}</div>
      <div class="pdf-dc-value">${esc(f.value.trim())}</div>
    </div>`).join('');

  cardEl.style.display = '';
}

// ─── 8. Pillar Section Builder ────────────────────────────────────────────────

function buildPillarSection(pillar, checked, notes, screenshots) {
  const meta   = PILLAR_META[pillar.id] || { initial: pillar.label[0].toUpperCase(), color: '#4f46e5' };
  const done   = pillar.items.filter(i => !!checked[i.id]).length;
  const total  = pillar.items.length;
  const pct    = total ? Math.round((done / total) * 100) : 0;

  const itemsHtml = pillar.items.map(item => {
    const isChecked  = !!checked[item.id];
    const note       = (notes[item.id] || '').trim();
    const screenshot = (screenshots || {})[item.id] || '';
    const sev        = SEV[normalizeSev(item.severity)];

    const checkMark = isChecked
      ? `<div class="pdf-check is-checked">&#10003;</div>`
      : `<div class="pdf-check"></div>`;

    const noteHtml = note
      ? `<div class="pdf-item-note" style="border-left-color:${meta.color}">${esc(note)}</div>`
      : '';

    const screenshotHtml = screenshot
      ? `<div class="pdf-screenshot"><img src="${esc(screenshot)}" alt="Audit screenshot" loading="lazy" /></div>`
      : '';

    return `
      <div class="pdf-item${isChecked ? ' is-checked' : ''}">
        <div class="pdf-item-main">
          ${checkMark}
          <span class="pdf-item-label">${esc(item.label)}</span>
          <span class="pdf-badge" style="background:${sev.bg};color:${sev.text}">${capitalize(item.severity)}</span>
        </div>
        ${noteHtml}
        ${screenshotHtml}
      </div>`;
  }).join('');

  return `
    <div class="report-card pdf-pillar-section">
      <div class="pdf-pillar-hd" style="border-left:4px solid ${meta.color}">
        <div class="pdf-pillar-icon" style="background:${meta.color}">${esc(meta.initial)}</div>
        <div class="pdf-pillar-title-wrap">
          <h2 class="pdf-pillar-name">${esc(pillar.label)}</h2>
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
    </div>`;
}

// ─── 9. Full Page Hydration ───────────────────────────────────────────────────

function hydrateReport(row) {
  const checklist   = row.audit_progress   || {};
  const checked     = checklist.checked     || {};
  const notes       = checklist.notes       || {};
  const screenshots = row.screenshot_data   || {};
  const discovery   = row.context_data      || {};

  // ── Meta table ──
  const tbody = document.querySelector('#meta-table tbody');
  if (tbody) {
    const rows = [];
    if (row.page_name)    rows.push(buildMetaRow('Project Name', row.page_name));
    if (row.auditor_name) rows.push(buildMetaRow('Auditor',      row.auditor_name));

    const date = row.created_at
      ? new Date(row.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'Unknown date';
    rows.push(buildMetaRow('Date Generated', date));

    // Recalculate totals from the live pillar data
    const allItems  = PILLARS.flatMap(p => p.items);
    const totalDone = allItems.filter(i => !!checked[i.id]).length;
    const total     = allItems.length;
    const pct       = total ? Math.round((totalDone / total) * 100) : 0;

    rows.push(`<tr>
      <td class="pdf-meta-key">Items Reviewed</td>
      <td class="pdf-meta-val"><strong style="color:#4f46e5">${totalDone}</strong> of ${total} items (${pct}%)</td>
    </tr>`);

    tbody.innerHTML = rows.join('');

    // ── Progress bar ──
    const fill = document.getElementById('prog-fill');
    const pctEl = document.getElementById('prog-pct');
    if (fill)  fill.style.width  = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}% complete`;

    // ── Severity counts ──
    const counts = { critical: 0, major: 0, minor: 0, info: 0 };
    for (const item of allItems) {
      if (!checked[item.id]) counts[normalizeSev(item.severity)]++;
    }

    const statsGrid = document.getElementById('stats-grid');
    if (statsGrid) {
      statsGrid.innerHTML = [
        buildStatCard('Critical', counts.critical, 'critical'),
        buildStatCard('Major',    counts.major,    'major'),
        buildStatCard('Minor',    counts.minor,    'minor'),
        buildStatCard('Info',     counts.info,     'info'),
      ].join('');
    }
  }

  // ── Discovery & Context ──
  hydrateDiscovery(discovery);

  // ── Pillar sections ──
  const pillarsEl = document.getElementById('pillars-container');
  if (pillarsEl) {
    pillarsEl.innerHTML = PILLARS.map(
      p => buildPillarSection(p, checked, notes, screenshots)
    ).join('');
  }

  // Refresh Feather icons after DOM update
  if (window.feather) window.feather.replace();
}

// ─── 10. Supabase Fetch ───────────────────────────────────────────────────────

async function fetchReport(reportId) {
  const endpoint = `${SUPABASE_URL}/rest/v1/ux_reports?id=eq.${encodeURIComponent(reportId)}`;

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Database error ${res.status}: ${detail.slice(0, 120) || res.statusText}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

// ─── 11. Boot ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wire print button
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());

  // Initial Feather pass for error icon etc.
  if (window.feather) window.feather.replace();

  // Parse report ID from query string
  const urlParams = new URLSearchParams(window.location.search);
  const reportId  = urlParams.get('id');

  if (!reportId || reportId.trim() === '') {
    showError(
      'No Report ID Provided',
      'The URL is missing a report ID. Check the link you were sent and try again.'
    );
    return;
  }

  try {
    const row = await fetchReport(reportId.trim());

    if (!row) {
      showError(
        'Report Not Found',
        'No report exists for this ID. It may have been deleted, or the link may be incorrect.'
      );
      return;
    }

    hydrateReport(row);
    hideOverlay();

  } catch (err) {
    console.error('[UX Audit Viewer]', err);
    showError(
      'Failed to Load Report',
      err.message || 'An unexpected error occurred. Please try refreshing the page.'
    );
  }
});
