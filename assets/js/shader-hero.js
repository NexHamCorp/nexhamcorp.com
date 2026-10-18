/*! shader-hero.js 1.0.0 | NexHam | hero-only ambient background on Paper Shaders' ShaderMount (vendored, Apache-2.0) */
// Production wrapper (2026-10-18). Same guardrails as the preview wrapper (../shader-bg.js), minus the preview HUD,
// and with no CDN: the pinned Paper mesh subset is loaded from the URL in data-shader-lib (theme asset / site file).
//
// Markup (one per hero; the layer is absolutely positioned inside a position:relative hero):
//   <div class="shader-layer" aria-hidden="true" data-shader-hero
//        data-shader-lib="/assets/js/vendor/paper-mesh-0.0.81.min.js"
//        data-shader='{"colors":["#000000","#3A1A0A","#000000","#52260F"],"speed":0.12,"frame":12000,
//                      "uniforms":{"u_distortion":0.75,"u_swirl":0.35,"u_grainMixer":0,"u_grainOverlay":0.06}}'></div>
//   <script type="module" src="/assets/js/shader-hero.js"></script>
//
// Guardrails:
//   - lazy: nothing loads until window 'load' + idle, so the shader never competes with LCP
//   - prefers-reduced-motion or Save-Data: one static frame, no loop; reacts live when the OS setting changes
//   - no WebGL2, or a software rasterizer (SwiftShader / llvmpipe): no mount, the hero stays exactly as it is today
//   - offscreen (IntersectionObserver) or hidden tab (visibilitychange): the loop stops, zero frames
//   - 30 fps cap, pixel cap (1.0 MP desktop, 0.4 MP phone), minPixelRatio 1, powerPreference low-power
//   - phones "settle": after settleMs of visible animation (default 20 s) the frame freezes; battery cost after
//     that is zero. Desktop keeps drifting (settleMs 0 = never settle)
//   - opacity-only fade-in, so no layout shift
// QA switches: ?shader=off (baseline, no mount) and ?shader=static (forces the reduced-motion path).

const SIZING = { u_fit: 0, u_scale: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0,
                 u_originX: 0.5, u_originY: 0.5, u_worldWidth: 0, u_worldHeight: 0 };
const qs = new URLSearchParams(location.search).get('shader');
const stats = (window.__shaderStats = { mounted: false, frames: 0, reason: null, canvas: null, settled: false });

function glSupport() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(r) ? 'software' : 'ok';
  } catch { return 'none'; }
}

function whenIdle() {
  return new Promise((resolve) => {
    const go = () => ('requestIdleCallback' in window ? requestIdleCallback(resolve, { timeout: 1500 }) : setTimeout(resolve, 200));
    document.readyState === 'complete' ? go() : addEventListener('load', go, { once: true });
  });
}

export async function mountShaderHero(el) {
  if (qs === 'off') { stats.reason = 'off'; return null; }
  let o;
  try { o = JSON.parse(el.dataset.shader || '{}'); } catch { stats.reason = 'bad-config'; return null; }
  if (!el.dataset.shaderLib || !Array.isArray(o.colors) || !o.colors.length) { stats.reason = 'bad-config'; return null; }
  const gl = glSupport();
  if (gl !== 'ok') { stats.reason = gl === 'software' ? 'software-gl' : 'no-webgl2'; return null; }

  await whenIdle();
  let lib;
  // resolve against the page, not this module (a relative data-shader-lib means relative to the document)
  try { lib = await import(new URL(el.dataset.shaderLib, document.baseURI).href); } catch { stats.reason = 'lib-load-failed'; return null; }
  const { ShaderMount, getShaderColorFromString: toColor, meshGradientFragmentShader } = lib;

  const uniforms = { ...SIZING, ...(o.uniforms || {}), u_colors: o.colors.map(toColor), u_colorsCount: o.colors.length };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const isStatic = () => qs === 'static' || saveData || reduce.matches;
  const small = matchMedia('(max-width: 749px)').matches;
  const maxPx = small ? (o.mobileMaxPixelCount || 400000) : (o.maxPixelCount || 1000000);
  const settleMs = small ? (o.mobileSettleMs ?? 20000) : (o.settleMs ?? 0);
  const speed = o.speed ?? 0.12;
  const interval = 1000 / Math.min(o.fps || 30, 60);

  let mount;
  try {
    mount = new ShaderMount(el, meshGradientFragmentShader, uniforms,
      { alpha: true, premultipliedAlpha: false, antialias: false, powerPreference: 'low-power' },
      0, o.frame || 0, 1, maxPx);
  } catch { stats.reason = 'mount-failed'; return null; }

  const orig = mount.render;
  mount.render = (t) => { stats.frames++; return orig(t); };

  // Our own capped loop drives setFrame(); ShaderMount's speed stays 0 so its rAF never runs.
  let visible = true, raf = null, last = 0, frame = o.frame || 0, animatedMs = 0;
  const running = () => visible && !document.hidden && !isStatic() && !stats.settled;
  const tick = (t) => {
    raf = null;
    if (!running()) return;
    if (!last) last = t;
    const dt = t - last;
    if (dt >= interval - 2) {
      frame += dt * speed; animatedMs += dt; last = t; mount.setFrame(frame);
      if (settleMs > 0 && animatedMs >= settleMs) { stats.settled = true; return; }
    }
    raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (running() && raf === null) { last = 0; raf = requestAnimationFrame(tick); } };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(el);
  document.addEventListener('visibilitychange', kick);
  reduce.addEventListener('change', kick);
  kick();

  const canvas = mount.canvasElement;
  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity 1.2s ease';
  requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.opacity = String(o.opacity ?? 1); }));
  Object.assign(stats, { mounted: true, reason: isStatic() ? 'static' : 'animated', canvas: `${canvas.width}x${canvas.height}`,
    maxPx, fps: Math.round(1000 / interval), settleMs });
  return mount;
}

for (const el of document.querySelectorAll('[data-shader-hero]')) mountShaderHero(el);
