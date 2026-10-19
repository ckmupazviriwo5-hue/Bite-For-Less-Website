// Bite For Less — single client configuration point.
// Local-first architecture: every page talks to the Express + SQLite API that
// serves it (same origin), so no absolute URLs or secrets are needed in the
// browser. Only public, client-safe values belong here. Never put service-role
// keys, database passwords, or JWT secrets in this file.
//
// APK distribution policy: Android builds are published as versioned GitHub
// Releases by the Android repository. The website never hosts APK binaries.
// If/when a verified release exists, APK_URL may point directly at the asset;
// otherwise the button stays disabled and is driven by the release lookup.
window.BFL_CONFIG = {
  API_BASE: '/api',
  APK_URL: '',
  APK_RELEASES_URL: 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases',
  // Data backend: 'express' = the local Express/SQLite API (canonical).
  // 'supabase' = legacy shared catalog mode, retained only as an explicitly
  // selectable fallback; the Supabase project itself is untouched/deprecated
  // for app traffic. Never enable it without the public keys present.
  DATA_BACKEND: 'express',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
