// Bite For Less — single client configuration point.
// APK distribution: versioned assets on GitHub Releases in the Android repo
// (https://github.com/ckmupazviriwo5-hue/BiteForLess-).
// Until a verified release-asset URL exists, keep APK_URL empty/falsy so the
// UI shows a polished "coming soon" state instead of a broken download.
// Only public, client-safe values belong here. Never put service-role keys,
// database passwords, or JWT secrets in this file.
window.BFL_CONFIG = {
  API_BASE: '/api',
  // Example (do NOT use until verified): 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases/download/v1.0.0/bite-for-less.apk'
  APK_URL: '',
  APK_RELEASES_URL: 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases',
  DATA_BACKEND: 'express'
};
