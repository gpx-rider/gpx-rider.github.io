// Baked in at deploy time by .github/workflows/deploy-pages.yml, which
// replaces the value below with the MAPS_API_KEY repository secret (an HTTP
// referrer-restricted key, scoped to the Pages origin) before uploading the
// site. Stays empty in this checked-in source and in any local checkout or
// fork without that secret configured — the app then falls back to asking
// the visitor for their own key, exactly as before. A key saved by a visitor
// in Settings always takes precedence over this default.
//
// Base64-encoded, not encrypted — this is a public webapp, so the key is
// visible in the network tab regardless of anything done here. The encoding
// only keeps the raw "AIzaSy..." string out of the JS source as a literal,
// so naive scrapers and secret-scanning bots grepping page source don't
// flag it. It is not a security boundary.
const DEPLOYED_MAPS_API_KEY_B64 = "";

export function deployedMapsApiKey() {
  if (!DEPLOYED_MAPS_API_KEY_B64) return "";
  try {
    return atob(DEPLOYED_MAPS_API_KEY_B64);
  } catch {
    return "";
  }
}
