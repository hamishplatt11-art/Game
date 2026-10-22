// Practice HUD panel: live shot chart (half court, made/missed dots), zone
// splits, timing tendency and a coaching tip for the last shot.
import { summarizePractice } from '../sim/PracticeStats.js';
import { THREE_R, CORNER_Z, CORNER_STRAIGHT_DX, LANE_W, FT_LINE_FROM_BASELINE, HALF_L, HOOP_X, HALF_W, RESTRICTED_R } from '../sim/constants.js';
import { PRACTICE_SPOTS } from '../sim/Match.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BASE = HALF_L - HOOP_X; // hoop centre to baseline
const pct = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : '—');

function courtSVG(log) {
  // Coordinates: x = sideline offset (z), y = distance out from the baseline.
  const Y = (u) => BASE + u;
  const arc = `M ${-CORNER_Z} 0 L ${-CORNER_Z} ${Y(CORNER_STRAIGHT_DX)} A ${THREE_R} ${THREE_R} 0 0 0 ${CORNER_Z} ${Y(CORNER_STRAIGHT_DX)} L ${CORNER_Z} 0`;
  const dots = log.map((s) => {
    const u = s.hx > 0 ? s.hx - s.x : s.x - s.hx;
    const v = s.hx > 0 ? s.z : -s.z;
    const c = s.made === null ? '#ffd23f' : s.made ? '#3ddc84' : '#ff5a5a';
    return s.made === false
      ? `<g stroke="${c}" stroke-width="0.14"><line x1="${v - 0.22}" y1="${Y(u) - 0.22}" x2="${v + 0.22}" y2="${Y(u) + 0.22}"/><line x1="${v - 0.22}" y1="${Y(u) + 0.22}" x2="${v + 0.22}" y2="${Y(u) - 0.22}"/></g>`
      : `<circle cx="${v}" cy="${Y(u)}" r="0.26" fill="${c}"/>`;
  }).join('');
  return `<svg viewBox="${-HALF_W} -0.3 ${HALF_W * 2} 10.6" class="prc-court" aria-label="Shot chart">
    <g fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.07">
      <rect x="${-HALF_W}" y="0" width="${HALF_W * 2}" height="10.3"/>
      <rect x="${-LANE_W / 2}" y="0" width="${LANE_W}" height="${FT_LINE_FROM_BASELINE}"/>
      <path d="${arc}"/>
      <path d="M ${-RESTRICTED_R} ${BASE} A ${RESTRICTED_R} ${RESTRICTED_R} 0 0 0 ${RESTRICTED_R} ${BASE}"/>
      <circle cx="0" cy="${BASE}" r="0.23" stroke="#ff7a2f"/>
    </g>${dots}</svg>`;
}

export class PracticePanel {
  constructor(root, sim) {
    this.sim = sim;
    this.el = document.createElement('div');
    this.el.className = 'practice-panel';
    root.appendChild(this.el);
    this.visible = true;
    this.key = '';
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  update() {
    const m = this.sim.match;
    const log = m.practiceLog;
    const last = log[log.length - 1];
    const key = `${log.length}:${last ? last.made : ''}:${m.practiceSpot ? m.practiceSpot.name : ''}`;
    if (key === this.key || !this.visible) return;
    this.key = key;
    const S = summarizePractice(log);
    const z = S.zones;
    const lastLine = last ? `<div class="prc-last"><b>#${last.n} ${esc(last.zone)} · ${last.dist.toFixed(1)} m</b>
      <span>${last.made === null ? 'in flight' : last.made ? 'MADE' : 'MISSED'} · ${esc(last.grade || last.kind)}${last.err !== null && last.err !== undefined ? ` (${last.err > 0 ? '+' : ''}${Math.round(last.err * 1000)} ms)` : ''} · ${esc(last.contest)} · ${last.prob !== null ? Math.round(last.prob * 100) + '% chance' : ''}</span></div>` : '';
    this.el.innerHTML = `
      <div class="prc-head"><b>PRACTICE</b><span>${esc(m.practiceSpot ? m.practiceSpot.name : PRACTICE_SPOTS[0].name)}</span></div>
      ${courtSVG(log)}
      <div class="prc-stats">
        <div><em>FG</em><b>${S.made}/${S.att}</b><i>${pct(S.made, S.att)}</i></div>
        <div><em>Paint</em><b>${z.Paint.made}/${z.Paint.att}</b><i>${pct(z.Paint.made, z.Paint.att)}</i></div>
        <div><em>Mid</em><b>${z['Mid-range'].made}/${z['Mid-range'].att}</b><i>${pct(z['Mid-range'].made, z['Mid-range'].att)}</i></div>
        <div><em>3PT</em><b>${z['3PT'].made}/${z['3PT'].att}</b><i>${pct(z['3PT'].made, z['3PT'].att)}</i></div>
      </div>
      <div class="prc-timing">Greens ${S.excellent} · avg timing error ${S.avgErrMs ?? '—'} ms${S.biasMs ? ` · bias ${S.biasMs > 0 ? '+' : ''}${S.biasMs} ms` : ''} · streak ${S.streak}</div>
      ${lastLine}
      <div class="prc-tip">${esc(S.tip)}</div>
      <div class="prc-keys"><kbd>X</kbd> reset <kbd>Z</kbd> next spot <kbd>B</kbd> replay <kbd>N</kbd> hide · pad: D-pad ↓ → ←</div>`;
  }

  dispose() { this.el.remove(); }
}
