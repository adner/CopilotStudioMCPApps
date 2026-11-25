/**
 * Pinned library versions for generated UIs, shared by the prompt (server) and the
 * import map the app injects into every generated page. Bare specifiers ("three") and
 * subpaths ("three/examples/jsm/...") resolve to esm.sh, which the UI resource's CSP allows.
 */
export const LIBRARIES = {
  three: "https://esm.sh/three@0.170.0",
  gsap: "https://esm.sh/gsap@3.12.5",
  d3: "https://esm.sh/d3@7.9.0",
  "chart.js": "https://esm.sh/chart.js@4.4.1",
} as const;

export const IMPORT_MAP_TAG = `<script type="importmap">${JSON.stringify({
  imports: Object.fromEntries(
    Object.entries(LIBRARIES).flatMap(([name, url]) => [
      [name, url],
      [`${name}/`, `${url}/`],
    ]),
  ),
})}</script>`;
