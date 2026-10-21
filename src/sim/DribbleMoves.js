// Dribble move library. Each move describes timing, displacement in the
// player's local frame (x = right, z = forward), hand change, how exposed the
// ball is to steals and how much it can unbalance a defender.
export const MOVES = {
  crossover: { label: 'Crossover', dur: 0.42, switchHand: true, side: 'new', lat: 0.8, fwd: 0.3, exposure: 0.35, quality: 0.8, cost: 0.006, path: 'cross' },
  betweenLegs: { label: 'Between the Legs', dur: 0.5, switchHand: true, side: 'new', lat: 0.5, fwd: 0.1, exposure: 0.15, quality: 0.72, cost: 0.006, path: 'legs' },
  behindBack: { label: 'Behind the Back', dur: 0.52, switchHand: true, side: 'new', lat: 0.9, fwd: 0.3, exposure: 0.2, quality: 0.85, cost: 0.007, path: 'behind' },
  hesitation: { label: 'Hesitation', dur: 0.55, switchHand: false, side: 'none', lat: 0, fwd: 0.2, exposure: 0.25, quality: 0.7, cost: 0.004, path: 'hesi', burst: true },
  inAndOut: { label: 'In-and-Out', dur: 0.48, switchHand: false, side: 'ball', lat: 0.35, fwd: 0.25, exposure: 0.3, quality: 0.76, cost: 0.005, path: 'inout' },
  spin: { label: 'Spin', dur: 0.62, switchHand: true, side: 'ball', lat: 0.9, fwd: 0.55, exposure: 0.3, quality: 0.9, cost: 0.01, path: 'spin', spin: true },
  halfSpin: { label: 'Half Spin', dur: 0.48, switchHand: false, side: 'ball', lat: 0.3, fwd: 0.15, exposure: 0.3, quality: 0.78, cost: 0.008, path: 'halfspin' },
  stepback: { label: 'Stepback', dur: 0.5, switchHand: false, side: 'none', lat: 0, fwd: -1.25, exposure: 0.2, quality: 0.74, cost: 0.008, path: 'stepback', shotReady: true },
  sidestep: { label: 'Side-Step', dur: 0.45, switchHand: false, side: 'ball', lat: 1.15, fwd: 0, exposure: 0.2, quality: 0.6, cost: 0.007, path: 'stepback', shotReady: true },
  escape: { label: 'Escape Dribble', dur: 0.45, switchHand: false, side: 'none', lat: 0, fwd: -1.45, exposure: 0.1, quality: 0.5, cost: 0.008, path: 'stepback' },
  snatchback: { label: 'Snatchback', dur: 0.5, switchHand: false, side: 'none', lat: 0, fwd: -1.0, exposure: 0.15, quality: 0.65, cost: 0.007, path: 'stepback', shotReady: true },
  sizeup: { label: 'Size-Up', dur: 0.9, switchHand: false, side: 'none', lat: 0, fwd: 0, exposure: 0.2, quality: 0.45, cost: 0.004, path: 'sizeup', rhythm: true },
  jab: { label: 'Jab Step', dur: 0.4, switchHand: false, side: 'none', lat: 0, fwd: 0, exposure: 0.05, quality: 0.45, cost: 0.002, path: 'jab', triple: true },
  dropStep: { label: 'Drop Step', dur: 0.55, switchHand: false, side: 'hoop', lat: 0, fwd: 0, exposure: 0.15, quality: 0.8, cost: 0.008, path: 'post', post: true },
};

/**
 * Map a right-stick flick (already converted to the player's local frame)
 * to a move, following the long-standing NBA 2K right-stick conventions:
 * flick toward the off hand = crossover, back toward the off hand = between
 * the legs, back toward the ball hand = behind the back, ball-hand side =
 * in-and-out, forward = hesitation, straight back = stepback/escape.
 */
export function classifyFlick(localR, localF, hand, ctx) {
  if (ctx.triple) return localF > 0.5 ? 'jab' : null;
  if (ctx.posting) return localF > 0.3 ? 'dropStep' : null;
  const ang = Math.atan2(localR * hand, localF); // + = toward ball hand
  const deg = (ang * 180) / Math.PI;
  if (deg > -22.5 && deg <= 22.5) return 'hesitation';
  if (deg > 22.5 && deg <= 67.5) return 'hesitation';
  if (deg > 67.5 && deg <= 112.5) return ctx.speed > 2.5 ? 'inAndOut' : 'sidestep';
  if (deg > 112.5 && deg <= 157.5) return 'behindBack';
  if (deg > 157.5 || deg <= -157.5) return ctx.sprint ? 'escape' : ctx.speed > 3 ? 'snatchback' : 'stepback';
  if (deg > -157.5 && deg <= -112.5) return 'betweenLegs';
  return 'crossover';
}
