// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for report viewer; completely safe for standard web hosting.

import { initReportPage } from './export-handler.js';
import { authManager }    from './supabase-client.js';

// ─── Theme Bootstrap ─────────────────────────────────────────────────────────
// IIFE runs immediately at module evaluation before DOMContentLoaded handlers.
(function () {
  try {
    if (localStorage.getItem('ux_audit_theme') === 'dark') {
      document.documentElement.classList.add('dark-theme');
      if (document.body) document.body.classList.add('dark-theme');
    }
  } catch (_) {}
}());

const LEMONSQUEEZY_CHECKOUT_URL =
  'https://navidsemi.lemonsqueezy.com/checkout/buy/YOUR_VARIANT_ID';

const RPW_STATE = Object.freeze({ AUTH: 'auth', UPGRADE: 'upgrade' });

// Clear the "Loading report…" placeholder as soon as the DOM is ready,
// then hand off to initReportPage which hydrates the full report content.
document.addEventListener('DOMContentLoaded', async () => {
  // Web-Safe Theme Detection: Uses localStorage fallbacks entirely to avoid Extension environment crashes
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const stored = await chrome.storage.sync.get('ux_audit_theme');
      const theme  = stored['ux_audit_theme'] || localStorage.getItem('ux_audit_theme') || 'light';
      document.documentElement.classList.toggle('dark-theme', theme === 'dark');
      document.body.classList.toggle('dark-theme', theme === 'dark');
    } else {
      const isDark = localStorage.getItem('ux_audit_theme') === 'dark';
      document.documentElement.classList.toggle('dark-theme', isDark);
      document.body.classList.toggle('dark-theme', isDark);
    }
  } catch {
    const isDark = localStorage.getItem('ux_audit_theme') === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  }

  // Restore auth session before deciding which paywall state to show
  await authManager.init();

  initReportPaywallModal();

  const contentEl  = document.getElementById('report-content');
  const isLoggedIn = authManager.isLoggedIn();
  const isPremium  = authManager.isUserPremium();

  try {
    await initReportPage({
      isPremium,
      openPaywall: () => {
        showReportPaywall(isLoggedIn ? RPW_STATE.UPGRADE : RPW_STATE.AUTH);
      },
    });
    
    // ─── Premium Watermark Eraser Loop ───────────────────────────────────────
    // If the active profile evaluates to premium, search for the branding element
    // and wipe it cleanly out of view.
    if (isPremium) {
      const watermark = document.getElementById('report-branding-watermark');
      if (watermark) {
        watermark.style.display = 'none';
      }
    }
  } catch (err) {
    // Surface a readable error instead of a frozen loading screen
    if (contentEl) {
      contentEl.innerHTML =
        `<div style="padding:40px 24px;text-align:center;font-family:sans-serif;color:#505973;">
           <strong style="display:block;margin-bottom:8px;color:#dc2626;">Report could not be loaded</strong>
           ${String(err.message || err).slice(0, 200)}
         </div>`;
    }
    console.error('[UX Audit Report]', err);
  }
});

// ─── Report Paywall Modal ─────────────────────────────────────────────────────

function showReportPaywall(state) {
  const modal = document.getElementById('report-paywall-modal');
  if (!modal) return;
  document.getElementById('report-paywall-view-auth').hidden    = (state !== RPW_STATE.AUTH);
  document.getElementById('report-paywall-view-upgrade').hidden = (state !== RPW_STATE.UPGRADE);
  modal.setAttribute('aria-hidden', 'false');
  if (window.feather) window.feather.replace();
  if (state === RPW_STATE.AUTH) {
    requestAnimationFrame(() => document.getElementById('report-paywall-email')?.focus());
  }
}

function hideReportPaywall() {
  document.getElementById('report-paywall-modal')?.setAttribute('aria-hidden', 'true');
}

function initReportPaywallModal() {
  document.getElementById('btn-report-paywall-close')?.addEventListener('click', hideReportPaywall);
  document.getElementById('report-paywall-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideReportPaywall();
  });

  // ── AUTH view: sign up (falls back to sign-in if already registered) ──────
  const signupBtn = document.getElementById('report-paywall-signup-btn');

  async function _doAuth() {
    const email    = document.getElementById('report-paywall-email')?.value.trim()  ?? '';
    const password = document.getElementById('report-paywall-password')?.value      ?? '';
    const errEl    = document.getElementById('report-paywall-error');

    if (!email || !password) {
      if (errEl) { errEl.style.color = ''; errEl.textContent = 'Please enter your email and password.'; }
      return;
    }
    if (errEl) { errEl.style.color = ''; errEl.textContent = ''; }
    if (signupBtn) { signupBtn.disabled = true; signupBtn.textContent = 'Please wait…'; }

    try {
      try {
        await authManager.signUp(email, password);
      } catch (e) {
        if (/already registered|user already/i.test(e.message)) {
          await authManager.signIn(email, password);
        } else {
          throw e;
        }
      }
      if (authManager.isLoggedIn()) {
        hideReportPaywall();
      } else {
        if (errEl) {
          errEl.style.color = '#0f766e';
          errEl.textContent = 'Check your inbox to confirm your email, then try again.';
        }
      }
    } catch (e) {
      if (errEl) { errEl.style.color = ''; errEl.textContent = e.message; }
    } finally {
      if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = 'Create Your Account'; }
    }
  }

  signupBtn?.addEventListener('click', _doAuth);

  // ── UPGRADE view: Lemon Squeezy with user.id ─────────────────────────────
  document.getElementById('report-paywall-upgrade-btn')?.addEventListener('click', () => {
    const user   = authManager.getUser();
    const params = new URLSearchParams();
    if (user?.email) params.set('checkout[email]', user.email);
    if (user?.id)    params.set('checkout[custom][user_id]', user.id);
    const qs  = params.toString();
    window.open(LEMONSQUEEZY_CHECKOUT_URL + (qs ? '?' + qs : ''), '_blank', 'noopener,noreferrer');
  });
}
