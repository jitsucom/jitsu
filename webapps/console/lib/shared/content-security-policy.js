// Content-Security-Policy of the console. Plain CommonJS so next.config.js can require it and the code editor can
// import the same Monaco URL.
//
// There is no nonce: the console's pages (static and server rendered alike) contain no executable inline script, only
// `<script src>` of its own files and the non-executable `__NEXT_DATA__` JSON block. Without 'unsafe-inline' in
// script-src an injected <script> or event handler does not run, which is what a nonce would add. A per-request nonce
// would also mean rendering every page on request instead of serving static HTML.

/**
 * @monaco-editor/react loads the editor from this path at runtime. It is pinned in CodeEditor so the policy and the
 * loader cannot drift apart, and only this path (not the whole jsdelivr host, where anyone can publish a file) may
 * run as a script.
 */
const MONACO_VS_URL = "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs";
const MONACO_SOURCE = `${MONACO_VS_URL}/`;

const FIREBASE_SCRIPTS = "https://apis.google.com"; // signInWithPopup loads its gapi from here
const CALENDLY = "https://assets.calendly.com"; // import wizard booking widget
const FONT_STYLES = "https://fonts.googleapis.com"; // Inter
const FONT_FILES = "https://fonts.gstatic.com";

/** Enforced: costs nothing, the console uses no plugins or <base> and is never framed. */
const enforcedPolicy = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"].join("; ");

/**
 * Report-only: the policy meant to be enforced once the browser console of a real deployment shows no violations.
 * Styles keep 'unsafe-inline' (antd injects <style> elements and style attributes).
 */
const strictPolicy = [
  "default-src 'self'",
  `script-src 'self' ${FIREBASE_SCRIPTS} ${CALENDLY} ${MONACO_SOURCE}`,
  `style-src 'self' 'unsafe-inline' ${FONT_STYLES} ${CALENDLY} ${MONACO_SOURCE}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${FONT_FILES} ${MONACO_SOURCE}`,
  "connect-src 'self' https: wss:",
  "frame-src https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
].join("; ");

module.exports = { MONACO_VS_URL, enforcedPolicy, strictPolicy };
