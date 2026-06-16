// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// supabase-client.js — Supabase Auth manager (direct REST, no SDK dependency).
//
// Uses fetch against /auth/v1 endpoints — fully compatible with MV3 CSP.
// No network calls on import; call authManager.init() once in DOMContentLoaded.

const _URL         = 'https://ezoseqwigkedgmoqbhrz.supabase.co';
const _KEY         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6b3NlcXdpZ2tlZGdtb3FiaHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjQzNzMsImV4cCI6MjA5NzA0MDM3M30.NTqs9Yj3GTct5ab_ZoZLwZeGrt04Tysm_yFzCt3dOoQ';
const _SESSION_KEY = 'ux_auth_session';

export const authManager = {
  _session: null,
  _ready:   false,

  // ── Restore persisted session from chrome.storage ────────────────────────────
  async init() {
    if (this._ready) return;
    this._ready = true;
    try {
      const stored = await chrome.storage.local.get(_SESSION_KEY);
      if (stored[_SESSION_KEY]?.access_token) {
        this._session = stored[_SESSION_KEY];
      }
    } catch { /* non-extension context */ }
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
    if (data.access_token) await this._persist(data);
    return data;
  },

  // ── Sign in with email / password ─────────────────────────────────────────────
  // rememberMe=true (default) persists the session to chrome.storage so it
  // survives extension restarts. rememberMe=false keeps the session in memory
  // only — it is lost when the extension panel closes.
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
      this._session = data; // memory only — not written to chrome.storage
    }
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

    // Null in-memory session immediately
    this._session = null;

    // Remove persisted session from extension storage
    try { await chrome.storage.local.remove(_SESSION_KEY); } catch { }

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
  
  // ── DEVELOPER OVERRIDE STATE ────────────────────────────────────────────────
  // Change 'testingPremium = true' to elevate yourself to premium mode instantly.
  // Change 'testingPremium = false' to revert back to a standard free user account.
  isUserPremium() {
    const testingPremium = true; 
    
    if (testingPremium) {
      return true;
    }
    
    // Default fallback logic when testingPremium is false
    return false;
  },
  // ─────────────────────────────────────────────────────────────────────────────

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
    try { await chrome.storage.local.set({ [_SESSION_KEY]: session }); } catch { }
  },
};

// Legacy alias — keeps any external code that imports premiumManager working.
export const premiumManager = {
  isUserPremium: () => authManager.isUserPremium(),
};
