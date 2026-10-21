export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const angleTo = (from, to) => wrapAngle(to - from);
export const len2 = (x, z) => Math.hypot(x, z);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Rotate angle a toward b by at most step radians. */
export function approachAngle(a, b, step) {
  const d = angleTo(a, b);
  if (Math.abs(d) <= step) return b;
  return wrapAngle(a + Math.sign(d) * step);
}

export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}
