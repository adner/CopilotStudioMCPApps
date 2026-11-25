/**
 * Hand-written sample in CopilotKit's generateSandboxedUi shape.
 * Tests CopilotKit's renderer in the host without involving OpenAI, including
 * a CDN library (gsap from cdnjs) loaded inside the renderer's sandbox frame.
 */
export const SAMPLE = {
  initialHeight: 380,
  placeholderMessages: ["Carving a pumpkin…"],
  css: `
    body { margin: 0; font-family: Georgia, serif; background: radial-gradient(circle at 50% 30%, #3b2410, #140b05); color: #ffe7c2; }
    .wrap { display: grid; place-items: center; gap: 10px; padding: 22px 16px 26px; text-align: center; }
    h1 { margin: 0; font-size: 24px; letter-spacing: .04em; color: #ffb347; text-shadow: 0 0 18px #ff7b0088; }
    p { margin: 0; font-size: 13px; opacity: .8; }
    button { background: none; border: 0; cursor: pointer; padding: 0; }
    svg { width: 130px; height: 130px; filter: drop-shadow(0 0 22px #ff8a0066); }
    .count { font-size: 34px; font-weight: bold; color: #ffd27a; font-variant-numeric: tabular-nums; }
    .lib { font-size: 11px; opacity: .55; }
    .bridge { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 6px; }
    .bridge button { font: 12px Georgia, serif; color: #ffe7c2; background: #3a2412; border: 1px solid #a8642a; border-radius: 999px; padding: 4px 10px; }
    .bridge button:hover { background: #4d3018; }`,
  htmlChunks: [
    `<div class="wrap"><h1>🎃 Pumpkin Tapper</h1><p>Tap the pumpkin. It likes it.</p>`,
    `<button id="pumpkin" aria-label="Tap the pumpkin"><svg viewBox="0 0 100 100">`,
    `<ellipse cx="50" cy="58" rx="40" ry="32" fill="#ff8a1c"/><ellipse cx="50" cy="58" rx="16" ry="32" fill="#ff9d3a"/>`,
    `<rect x="46" y="18" width="8" height="14" rx="3" fill="#5b8c2a"/>`,
    `<polygon points="32,50 40,42 44,52" fill="#2a1405"/><polygon points="68,50 60,42 56,52" fill="#2a1405"/>`,
    `<path d="M30 66 Q50 82 70 66 L64 70 L58 66 L52 72 L46 66 L40 72 L36 66 Z" fill="#2a1405"/></svg></button>`,
    `<div class="count" id="count">0</div><div class="lib" id="lib">loading gsap…</div>`,
    `<div class="bridge"><button data-fn="say">🔮 Tell the chat</button><button data-fn="remember">🧠 Remember</button>`,
    `<button data-fn="openLink">🔗 Open link</button><button data-fn="fullscreen">⛶ Fullscreen</button>`,
    `<button data-fn="error">💥 Throw error</button></div><div class="lib" id="bridge-out">host functions: click to test</div></div>`,
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>`,
  ],
  jsFunctions: `
    function initPumpkin() {
      var n = 0, btn = document.getElementById('pumpkin'), out = document.getElementById('count'), lib = document.getElementById('lib');
      function bounce() { if (window.gsap) gsap.fromTo(btn, { scale: 0.85, rotate: -8 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'elastic.out(1, 0.35)' }); }
      btn.addEventListener('click', function () { n++; out.textContent = n; bounce(); });
      var bo = document.getElementById('bridge-out'), host = Websandbox.connection.remote;
      document.querySelector('.bridge').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var fn = b.getAttribute('data-fn'), p;
        if (fn === 'say') p = host.say('The pumpkin has been tapped ' + n + ' times. Tell me my fortune!');
        else if (fn === 'remember') p = host.remember('The user has tapped the pumpkin ' + n + ' times.', { taps: n });
        else if (fn === 'openLink') p = host.openLink('https://en.wikipedia.org/wiki/Jack-o%27-lantern');
        else if (fn === 'fullscreen') p = host.fullscreen();
        else { setTimeout(function () { throw new Error('deliberate test error from the pumpkin'); }, 0); bo.textContent = 'error thrown — check the server log'; return; }
        bo.textContent = fn + '… ';
        p.then(function (r) { bo.textContent = fn + ' → ' + JSON.stringify(r); }, function (err) { bo.textContent = fn + ' failed: ' + (err && err.message || err); });
      });
      (function waitGsap(tries) {
        if (window.gsap) { lib.textContent = 'gsap ' + gsap.version + ' loaded from cdnjs ✔'; bounce(); }
        else if (tries > 50) { lib.textContent = 'gsap did not load ✖'; }
        else setTimeout(function () { waitGsap(tries + 1); }, 100);
      })(0);
    }`,
  jsExpressions: ["initPumpkin()"],
};
