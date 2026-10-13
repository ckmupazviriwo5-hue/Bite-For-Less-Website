// Bite For Less — single client configuration point.
// APK distribution: versioned assets on GitHub Releases in the Android repo
// (https://github.com/ckmupazviriwo5-hue/BiteForLess-).
// Until a verified release-asset URL exists, keep APK_URL empty/falsy so the
// UI shows a polished "coming soon" state instead of a broken download.
// Only public, client-safe values belong here. Never put service-role keys,
// database passwords, or JWT secrets in this file.
window.BFL_CONFIG = {
  API_BASE: '/api',
  // Website-served file (copied from the Android project's verified local build).
  // Replace with a versioned GitHub Release asset URL when publishing officially.
  APK_URL: '/downloads/app-debug.apk',
  APK_RELEASES_URL: 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases',
  // Marketplace reads: shared Supabase backend (public project URL +
  // publishable key only — safe for browser code, RLS enforced server-side).
  SUPABASE_URL: 'https://ktvlytdmjqkcdeahgdqy.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ZdqDZK5Q2hCjSorTOMQweA_P1JQZgHw',
  // 'supabase' = live catalog via Supabase; 'express' = legacy local backend.
  DATA_BACKEND: 'supabase'
};