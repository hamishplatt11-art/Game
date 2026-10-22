// Browser / GPU capability detection, run before any heavy renderer is created.
export function detectGraphics() {
  const info = { webgl2: false, renderer: 'unknown', vendor: 'unknown', software: false, tier: 'medium', maxTexture: 0, dpr: window.devicePixelRatio || 1, ua: navigator.userAgent };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return info;
    info.webgl2 = true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    info.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    info.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const r = String(info.renderer).toLowerCase();
    info.software = /swiftshader|llvmpipe|software|basic render|mesa offscreen/.test(r);
    // Would the browser refuse a "fast" context? (indicates a software fallback)
    const c2 = document.createElement('canvas');
    if (!c2.getContext('webgl2', { failIfMajorPerformanceCaveat: true })) info.software = true;
    if (info.software) info.tier = 'low';
    else if (/apple m\d|apple gpu|nvidia|geforce|rtx|radeon rx|radeon pro/.test(r)) info.tier = 'high';
    else if (/intel|iris|uhd|adreno|mali/.test(r)) info.tier = 'medium';
    else info.tier = 'medium';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) {
    info.error = String(e);
  }
  return info;
}

/** Quality preset to use when the player hasn't chosen one. */
export function autoQuality(info) {
  if (!info.webgl2) return 'low';
  if (info.software) return 'low';
  if (info.tier === 'high') return info.dpr > 1.5 ? 'high' : 'high';
  return 'medium';
}

export function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}
