// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// supabase-client.js — Supabase Auth manager (direct REST, no SDK dependency).
//
// Uses fetch against /auth/v1 endpoints — fully compatible with MV3 CSP.
// No network calls on import; call authManager.init() once in DOMContentLoaded.

const _URL         = 'https://ezoseqwigkedgmoqbhrz.supabase.co';
const _KEY         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6b3NlcXdpZ2tlZGdtb3FiaHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjQzNzMsImV4cCI6MjA5NzA0MDM3M30.NTqs9Yj3GTct5ab_ZoZLwZeGrt04Tysm_yFzCt3dOoQ';
const _SESSION_KEY = 'ux_auth_session';

// Returns the exp claim (Unix seconds) from a JWT, or null if unreadable.
// Fallback for _refreshSession() when a stored session predates expires_at
// being recorded, or the field is otherwise missing.
function _jwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch { return null; }
}

// Session persistence for this file's own context: a plain web page at
// navidsemi-hash.github.io. chrome.storage is never available there — it's
// only exposed to an extension's own pages, not to an arbitrary web origin,
// regardless of whether the extension happens to be installed in the
// browser. The chrome.storage calls this file used to make were silently
// throwing and being swallowed on every real page load; this was invisible
// while isUserPremium() was hardcoded true (nothing depended on the session
// actually surviving), but once real Pro-gating started depending on
// isLoggedIn(), it meant a user could sign in successfully and still be
// gated on the very next reload. localStorage (already used elsewhere in
// this file for the device token, and the pattern ux-research-report's
// supabase-client.js uses) is what's actually available here.
const _localStore = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
  },
};

export const authManager = {
  _session: null,
  _ready:   false,
  _isPremium:               false,
  _premiumStatusLoadFailed: false,
  _trialStartedAt:          null,
  _statusChecked:           false,

  // ── Restore persisted session from localStorage ───────────────────────────────
  async init() {
    if (this._ready) return;
    this._ready = true;
    const stored = _localStore.get(_SESSION_KEY);
    if (stored?.access_token) {
      this._session = stored;
      // Refresh BEFORE checking premium status — a session that survived
      // the reload (localStorage fix) can still carry an expired
      // access_token; _checkPremiumStatus()'s profiles fetch would 401 on a
      // stale token and fail closed, gating an otherwise-entitled user.
      await this._refreshSession();
      await this._checkPremiumStatus();
    }
  },

  // ── Sign up — creates account and establishes session (if email confirm off) ─
  async signUp(email, password) {
    const res  = await fetch(`${_URL}/auth/v1/signup`, {
      method:  'POST',
      headers: { apikey: _KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign-up failed.');
    if (data.access_token) {
      await this._persist(data);
      await this._checkPremiumStatus();
    }
    return data;
  },

  // ── Sign in with email / password ─────────────────────────────────────────────
  // rememberMe=true (default) persists the session to localStorage so it
  // survives a page reload. rememberMe=false keeps the session in memory
  // only — it is lost as soon as the page reloads or closes.
  async signIn(email, password, { rememberMe = true } = {}) {
    const res  = await fetch(`${_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { apikey: _KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign-in failed.');
    if (rememberMe) {
      await this._persist(data);
    } else {
      this._session = data; // memory only — not written to localStorage
    }
    await this._checkPremiumStatus();
    return data;
  },

  // ── Sign out ──────────────────────────────────────────────────────────────────
  async signOut() {
    // Fire server-side token revocation (best-effort — non-blocking)
    const token = this._session?.access_token;
    if (token) {
      fetch(`${_URL}/auth/v1/logout`, {
        method:  'POST',
        headers: { apikey: _KEY, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    // Null in-memory session and premium cache immediately
    this._session                 = null;
    this._isPremium                = false;
    this._premiumStatusLoadFailed  = false;
    this._trialStartedAt           = null;
    this._statusChecked            = false;

    // Remove persisted session
    _localStore.remove(_SESSION_KEY);

    // Sweep any Supabase SDK keys that may have landed in localStorage
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-') || k === 'supabase.auth.token')
        .forEach(k => localStorage.removeItem(k));
    } catch { }
  },

  // ── Accessors ─────────────────────────────────────────────────────────────────
  getUser()       { return this._session?.user ?? null; },
  isLoggedIn()    { return !!this._session?.access_token; },

  // Real gate, ported from the extension's supabase-client.js
  // hasProToolAccess(): true for actual premium subscribers, true during the
  // 30-day trial window, and true for grandfathered pre-trial accounts
  // (trial_started_at IS NULL — the account predates the trial feature).
  // Replaces a hardcoded 'testingPremium = true' developer override that was
  // accidentally left in and shipped — every visitor was being treated as
  // Pro regardless of actual status.
  // The trial_started_at-IS-NULL branch below is also what a visitor whose
  // status was never checked at all looks like by default (anonymous, or a
  // session that just got invalidated) — _statusChecked is what tells those
  // two "null" cases apart. It's only set true once _checkPremiumStatus()
  // actually reaches the profiles table, so a never-checked visitor reads as
  // not-premium here instead of silently inheriting the grandfathered path.
  isUserPremium() {
    if (this._premiumStatusLoadFailed) return false;
    if (this._isPremium) return true;
    if (this._trialStartedAt === null) return this._statusChecked; // grandfathered — only once confirmed, not merely unchecked
    const trialElapsedMs = Date.now() - new Date(this._trialStartedAt).getTime();
    return trialElapsedMs < 30 * 24 * 60 * 60 * 1000;
  },

  // ── Internal: fetch premium status from the profiles table ──────────────────
  // Same query shape as the extension's _checkPremiumStatus() — only the two
  // columns this viewer actually needs (is_premium, trial_started_at); this
  // repo has no trial-countdown UI or customer-portal link to justify
  // carrying plan_type/expires_at/customer_portal_url too.
  async _checkPremiumStatus() {
    const token  = this._session?.access_token;
    const userId = this._session?.user?.id;
    // No token/user to query against — leave _statusChecked at its current
    // value (false unless a prior call already confirmed a real profile row)
    // rather than marking this pass as a check. Setting it true here would
    // let a never-verified visitor fall into isUserPremium()'s grandfathered
    // branch the same way a real one does.
    if (!token || !userId) { this._isPremium = false; return; }
    this._premiumStatusLoadFailed = false;
    try {
      const res = await fetch(
        `${_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_premium,trial_started_at&limit=1`,
        { headers: { apikey: _KEY, Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        // A failed fetch means we don't know ANYTHING about the user's
        // status — fail closed rather than keep a stale cached value.
        this._premiumStatusLoadFailed = true;
        this._isPremium      = false;
        this._trialStartedAt = null;
        this._statusChecked  = true;
        return;
      }
      const rows = await res.json();
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      this._isPremium       = row?.is_premium === true;
      this._trialStartedAt  = row?.trial_started_at ?? null;
      this._statusChecked   = true;
    } catch {
      this._premiumStatusLoadFailed = true;
      this._isPremium      = false;
      this._trialStartedAt = null;
      this._statusChecked  = true;
    }
  },
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Internal: refresh the access_token if expired or expiring soon ──────────
  // Ported from the extension's supabase-client.js — same 5-minute buffer,
  // same fail-open-on-network-error behavior (an offline visitor shouldn't
  // be signed out over a transient fetch failure), same clean sign-out if
  // the refresh token itself is rejected (expired or revoked refresh token
  // means the session is genuinely over, not just stale).
  async _refreshSession() {
    const refreshToken = this._session?.refresh_token;
    if (!refreshToken) return;

    const expiresAt = this._session?.expires_at ?? _jwtExp(this._session?.access_token);
    if (expiresAt && (Date.now() / 1000) < expiresAt - 300) return;

    try {
      const res  = await fetch(`${_URL}/auth/v1/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: { apikey: _KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Refresh token rejected (expired or revoked) — sign out cleanly so
        // the UI shows a logged-out state instead of a stale broken session.
        await this.signOut();
        return;
      }
      await this._persist(data);
    } catch {
      // Network error — don't sign out; user may be offline.
    }
  },

  // ── Multi-device enforcement (max 2 concurrent devices, Google-profile-bound) ──

  // Reads the sync signature from chrome.storage.sync, minting a new UUID on
  // first use. The key is scoped to the user's Chrome profile (Google account),
  // so two browsers signed into the same Google account share it automatically
  // while any other Chrome profile has a completely separate namespace.
  // Returns null in non-extension contexts so callers degrade gracefully.
  async _getSyncSignature() {
    try {
      const stored = await chrome.storage.sync.get('user_sync_signature');
      if (stored.user_sync_signature) return stored.user_sync_signature;
      const signature = crypto.randomUUID();
      await chrome.storage.sync.set({ user_sync_signature: signature });
      return signature;
    } catch {
      return null; // non-extension context or sync API unavailable
    }
  },

  // Registers this device in user_devices. Enforces two independent gates:
  //   1. Sync-signature mismatch → a different Google account is attempting access
  //   2. Slot count >= 2          → device cap reached
  // Throws with a user-readable message on either failure so the caller can
  // surface the error in the UI and abort the login flow.
  // Must be called immediately after every successful sign-in / sign-up.
  async registerDeviceSlot() {
    const token  = this._session?.access_token;
    const userId = this._session?.user?.id;
    if (!token || !userId) return;

    const signature   = await this._getSyncSignature();
    const deviceToken = crypto.randomUUID();
    try { localStorage.setItem('extension_device_token', deviceToken); } catch { }

    // Fetch all currently registered device slots including their signatures
    const listRes = await fetch(
      `${_URL}/rest/v1/user_devices?user_id=eq.${encodeURIComponent(userId)}&select=device_token,sync_signature`,
      { headers: { apikey: _KEY, Authorization: `Bearer ${token}` } }
    );

    if (listRes.ok) {
      const existing = await listRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        // Gate 1: reject a different Google Sync profile.
        // Only enforce when both sides carry a non-empty signature so that rows
        // written before this feature was deployed are not falsely rejected.
        const storedSig = existing.find(d => d.sync_signature)?.sync_signature;
        if (signature && storedSig && storedSig !== signature) {
          try { localStorage.removeItem('extension_device_token'); } catch { }
          throw new Error(
            'Unauthorized device: these credentials are linked to a different Google Sync ' +
            'profile. Please use a browser signed into the same Google account as the ' +
            'original device.'
          );
        }

        // Gate 2: device cap
        if (existing.length >= 2) {
          try { localStorage.removeItem('extension_device_token'); } catch { }
          throw new Error(
            'Device limit reached: your plan allows up to 2 active devices simultaneously ' +
            '(e.g. laptop + desktop). Please log out from one of your other devices first.'
          );
        }
      }
    }

    // Both gates passed — claim the slot
    await fetch(`${_URL}/rest/v1/user_devices`, {
      method:  'POST',
      headers: {
        apikey:         _KEY,
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id:        userId,
        device_token:   deviceToken,
        sync_signature: signature ?? '',
        created_at:     new Date().toISOString(),
      }),
    });
  },

  // Confirms this device's slot still exists AND was written by the same Google
  // Sync profile. Returns true (valid) or false (slot missing or profile mismatch).
  // Fails open on network errors so a transient outage does not eject the user.
  async verifyDeviceSlot() {
    const token  = this._session?.access_token;
    const userId = this._session?.user?.id;
    if (!token || !userId) return false;

    let localToken;
    try { localToken = localStorage.getItem('extension_device_token'); } catch { }
    if (!localToken) return false;

    const signature = await this._getSyncSignature();

    // Filter by device_token and, when available, sync_signature
    let query = `${_URL}/rest/v1/user_devices?user_id=eq.${encodeURIComponent(userId)}&device_token=eq.${encodeURIComponent(localToken)}&select=device_token`;
    if (signature) query += `&sync_signature=eq.${encodeURIComponent(signature)}`;

    const res = await fetch(query, {
      headers: { apikey: _KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return true; // fail open

    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  },

  // Deletes only this device's row from user_devices, immediately freeing the
  // slot for any new machine. Must be called BEFORE signOut() while the access
  // token is still valid.
  async removeDeviceSlot() {
    const token  = this._session?.access_token;
    const userId = this._session?.user?.id;
    if (!token || !userId) return;

    let localToken;
    try { localToken = localStorage.getItem('extension_device_token'); } catch { }
    if (!localToken) return;

    await fetch(
      `${_URL}/rest/v1/user_devices?user_id=eq.${encodeURIComponent(userId)}&device_token=eq.${encodeURIComponent(localToken)}`,
      {
        method:  'DELETE',
        headers: { apikey: _KEY, Authorization: `Bearer ${token}` },
      }
    );

    try { localStorage.removeItem('extension_device_token'); } catch { }
  },

  // ── Internal ──────────────────────────────────────────────────────────────────
  async _persist(session) {
    this._session = session;
    _localStore.set(_SESSION_KEY, session);
  },
};

// Legacy alias — keeps any external code that imports premiumManager working.
export const premiumManager = {
  isUserPremium: () => authManager.isUserPremium(),
};
