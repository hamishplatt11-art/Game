// Player attribute model. Ratings are 25-99 like a modern basketball sim and
// are derived from an archetype template, the overall and physical build so
// that roster data stays compact while ratings still differ meaningfully.
import { clamp } from '../core/math.js';
import { Random } from '../core/Random.js';

export const ATTRS = [
  'closeShot', 'midShot', 'threeShot', 'freeThrow', 'layup', 'drivingDunk', 'standingDunk', 'postControl',
  'ballHandle', 'speedWithBall', 'passAccuracy', 'passVision', 'passIQ', 'offConsistency',
  'interiorD', 'perimeterD', 'steal', 'block', 'defAwareness', 'helpD', 'offReb', 'defReb',
  'speed', 'accel', 'agility', 'strength', 'vertical', 'stamina', 'durability', 'shotIQ',
];

// Deltas from overall for each archetype.
const T = {
  sharpshooter: { closeShot: -6, midShot: 4, threeShot: 6, freeThrow: 6, layup: -2, drivingDunk: -30, standingDunk: -45, postControl: -30, ballHandle: 2, speedWithBall: 0, passAccuracy: -2, passVision: -4, passIQ: -2, interiorD: -35, perimeterD: -18, steal: -14, block: -45, defAwareness: -15, helpD: -18, offReb: -45, defReb: -35, speed: -2, accel: 0, agility: 0, strength: -30, vertical: -16, stamina: 0, shotIQ: 2 },
  shooter: { closeShot: -6, midShot: 0, threeShot: 2, freeThrow: 2, layup: -6, drivingDunk: -20, standingDunk: -40, postControl: -25, ballHandle: -8, speedWithBall: -6, passAccuracy: -10, passVision: -14, passIQ: -8, interiorD: -28, perimeterD: -8, steal: -12, block: -36, defAwareness: -10, helpD: -10, offReb: -35, defReb: -25, speed: -4, accel: -4, agility: -4, strength: -18, vertical: -10, stamina: -2, shotIQ: 0 },
  playmaker: { closeShot: -4, midShot: -2, threeShot: -4, freeThrow: -2, layup: 0, drivingDunk: -20, standingDunk: -45, postControl: -20, ballHandle: 4, speedWithBall: 0, passAccuracy: 6, passVision: 6, passIQ: 6, interiorD: -30, perimeterD: -12, steal: -8, block: -40, defAwareness: -10, helpD: -10, offReb: -40, defReb: -26, speed: -2, accel: -2, agility: -2, strength: -20, vertical: -18, stamina: 0, shotIQ: 2 },
  slasher: { closeShot: 0, midShot: -6, threeShot: -12, freeThrow: -6, layup: 4, drivingDunk: 0, standingDunk: -30, postControl: -20, ballHandle: 2, speedWithBall: 4, passAccuracy: -8, passVision: -10, passIQ: -8, interiorD: -26, perimeterD: -10, steal: -10, block: -30, defAwareness: -12, helpD: -14, offReb: -30, defReb: -26, speed: 4, accel: 4, agility: 4, strength: -16, vertical: 2, stamina: 2, shotIQ: -4 },
  athleticFinisher: { closeShot: 0, midShot: -10, threeShot: -18, freeThrow: -14, layup: 2, drivingDunk: 4, standingDunk: -4, postControl: -12, ballHandle: -8, speedWithBall: 0, passAccuracy: -14, passVision: -18, passIQ: -12, interiorD: -10, perimeterD: -8, steal: -12, block: -12, defAwareness: -8, helpD: -10, offReb: -10, defReb: -10, speed: 2, accel: 2, agility: 0, strength: -2, vertical: 6, stamina: 0, shotIQ: -6 },
  twoWay: { closeShot: -6, midShot: -6, threeShot: -6, freeThrow: -6, layup: -4, drivingDunk: -10, standingDunk: -25, postControl: -18, ballHandle: -10, speedWithBall: -8, passAccuracy: -12, passVision: -16, passIQ: -8, interiorD: -10, perimeterD: 4, steal: 0, block: -14, defAwareness: 2, helpD: 2, offReb: -24, defReb: -16, speed: -2, accel: -2, agility: 0, strength: -8, vertical: -4, stamina: 2, shotIQ: -2 },
  allAround: { closeShot: 2, midShot: -4, threeShot: -6, freeThrow: -10, layup: 4, drivingDunk: 2, standingDunk: -8, postControl: -4, ballHandle: -4, speedWithBall: -2, passAccuracy: 0, passVision: 2, passIQ: 4, interiorD: -10, perimeterD: -6, steal: -10, block: -14, defAwareness: -2, helpD: -4, offReb: -18, defReb: -6, speed: -2, accel: -4, agility: -6, strength: 2, vertical: -4, stamina: 0, shotIQ: 2 },
  scoringWing: { closeShot: 0, midShot: 4, threeShot: 0, freeThrow: 2, layup: 0, drivingDunk: -8, standingDunk: -20, postControl: -8, ballHandle: -4, speedWithBall: -4, passAccuracy: -10, passVision: -14, passIQ: -6, interiorD: -20, perimeterD: -10, steal: -14, block: -18, defAwareness: -10, helpD: -12, offReb: -28, defReb: -16, speed: -4, accel: -4, agility: -4, strength: -12, vertical: -6, stamina: -2, shotIQ: 4 },
  stretchBig: { closeShot: -2, midShot: -4, threeShot: -6, freeThrow: -8, layup: -10, drivingDunk: -16, standingDunk: -6, postControl: -10, ballHandle: -22, speedWithBall: -20, passAccuracy: -14, passVision: -18, passIQ: -10, interiorD: -6, perimeterD: -14, steal: -20, block: -8, defAwareness: -6, helpD: -6, offReb: -14, defReb: -2, speed: -16, accel: -16, agility: -18, strength: -4, vertical: -14, stamina: -4, shotIQ: 0 },
  playmakingBig: { closeShot: 4, midShot: -4, threeShot: -10, freeThrow: -10, layup: -2, drivingDunk: -14, standingDunk: -6, postControl: 2, ballHandle: -14, speedWithBall: -18, passAccuracy: 2, passVision: 4, passIQ: 4, interiorD: -10, perimeterD: -24, steal: -18, block: -14, defAwareness: -4, helpD: -6, offReb: -6, defReb: 2, speed: -20, accel: -20, agility: -20, strength: 2, vertical: -22, stamina: -2, shotIQ: 4 },
  rimProtector: { closeShot: -4, midShot: -26, threeShot: -45, freeThrow: -22, layup: -10, drivingDunk: -8, standingDunk: 6, postControl: -14, ballHandle: -38, speedWithBall: -34, passAccuracy: -26, passVision: -32, passIQ: -20, interiorD: 6, perimeterD: -20, steal: -20, block: 8, defAwareness: 2, helpD: 4, offReb: 0, defReb: 6, speed: -18, accel: -18, agility: -22, strength: 2, vertical: -6, stamina: -6, shotIQ: -6 },
  postScorer: { closeShot: 4, midShot: -10, threeShot: -30, freeThrow: -16, layup: -6, drivingDunk: -16, standingDunk: 0, postControl: 6, ballHandle: -30, speedWithBall: -28, passAccuracy: -20, passVision: -24, passIQ: -12, interiorD: -4, perimeterD: -28, steal: -24, block: -8, defAwareness: -8, helpD: -8, offReb: -2, defReb: 0, speed: -24, accel: -24, agility: -26, strength: 6, vertical: -20, stamina: -8, shotIQ: 0 },
  unicorn: { closeShot: 2, midShot: -6, threeShot: -10, freeThrow: -10, layup: -6, drivingDunk: -4, standingDunk: 6, postControl: -10, ballHandle: -18, speedWithBall: -16, passAccuracy: -18, passVision: -22, passIQ: -12, interiorD: 2, perimeterD: -12, steal: -14, block: 8, defAwareness: 2, helpD: 4, offReb: -8, defReb: 0, speed: -10, accel: -10, agility: -12, strength: -16, vertical: -4, stamina: -4, shotIQ: -2 },
};

const ARCH_BADGES = {
  sharpshooter: [['sniper', 4], ['deepRange', 4], ['spotUp', 3], ['tightHandles', 2]],
  shooter: [['sniper', 2], ['spotUp', 3], ['deepRange', 1]],
  playmaker: [['setupArtist', 4], ['tightHandles', 3], ['ankleBreaker', 2], ['sniper', 1]],
  slasher: [['bodyControl', 3], ['tightHandles', 2], ['ankleBreaker', 2], ['strongFinisher', 1]],
  athleticFinisher: [['posterThreat', 4], ['bodyControl', 2], ['strongFinisher', 2], ['bounceBack', 2]],
  twoWay: [['lockdown', 3], ['ballHawk', 2], ['laneThief', 2], ['spotUp', 1]],
  allAround: [['strongFinisher', 4], ['posterThreat', 3], ['setupArtist', 3], ['brickWall', 2]],
  scoringWing: [['sniper', 3], ['deepRange', 2], ['bodyControl', 2], ['tightHandles', 1]],
  stretchBig: [['spotUp', 3], ['deepRange', 2], ['glassCleaner', 1], ['paintWall', 1]],
  playmakingBig: [['setupArtist', 4], ['glassCleaner', 3], ['boxOutPro', 3], ['strongFinisher', 2]],
  rimProtector: [['paintWall', 4], ['glassCleaner', 3], ['boxOutPro', 3], ['brickWall', 3], ['posterThreat', 1]],
  postScorer: [['strongFinisher', 3], ['brickWall', 3], ['boxOutPro', 2], ['glassCleaner', 2]],
  unicorn: [['paintWall', 4], ['posterThreat', 3], ['spotUp', 2], ['glassCleaner', 2]],
};

const TENDENCIES = {
  sharpshooter: { shot: 0.75, three: 0.75, drive: 0.35, pass: 0.45, post: 0.02 },
  shooter: { shot: 0.6, three: 0.7, drive: 0.25, pass: 0.4, post: 0.02 },
  playmaker: { shot: 0.45, three: 0.4, drive: 0.5, pass: 0.8, post: 0.03 },
  slasher: { shot: 0.5, three: 0.25, drive: 0.85, pass: 0.4, post: 0.05 },
  athleticFinisher: { shot: 0.45, three: 0.15, drive: 0.75, pass: 0.3, post: 0.15 },
  twoWay: { shot: 0.35, three: 0.5, drive: 0.4, pass: 0.45, post: 0.08 },
  allAround: { shot: 0.65, three: 0.35, drive: 0.8, pass: 0.65, post: 0.3 },
  scoringWing: { shot: 0.8, three: 0.45, drive: 0.55, pass: 0.35, post: 0.2 },
  stretchBig: { shot: 0.45, three: 0.6, drive: 0.15, pass: 0.35, post: 0.2 },
  playmakingBig: { shot: 0.5, three: 0.2, drive: 0.3, pass: 0.85, post: 0.55 },
  rimProtector: { shot: 0.3, three: 0.02, drive: 0.15, pass: 0.3, post: 0.4 },
  postScorer: { shot: 0.6, three: 0.05, drive: 0.15, pass: 0.35, post: 0.85 },
  unicorn: { shot: 0.55, three: 0.4, drive: 0.4, pass: 0.3, post: 0.4 },
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Build the full player definition from compact roster data. */
export function buildPlayerDef(raw, teamId) {
  const rng = new Random(hash(`${teamId}-${raw.first}-${raw.last}`));
  const tpl = T[raw.arch] || T.twoWay;
  const ovr = raw.ovr;
  const heightM = raw.h / 100;
  const wingM = raw.ws / 100;
  const ratings = {};
  for (const a of ATTRS) {
    let v = ovr + (tpl[a] ?? -10) + rng.range(-3, 3);
    if (a === 'offConsistency') v = ovr - 4 + rng.range(-4, 4);
    if (a === 'durability') v = 70 + rng.range(-10, 20);
    ratings[a] = v;
  }
  // Physical build pushes athletic ratings around: tall/heavy players are stronger, slower.
  const hDelta = (raw.h - 200) / 10;
  const bmi = raw.w / (heightM * heightM);
  ratings.strength += (bmi - 24.5) * 3 + hDelta * 2;
  ratings.speed -= hDelta * 2.5;
  ratings.accel -= hDelta * 2.2;
  ratings.agility -= hDelta * 2.5;
  ratings.block += (raw.ws - raw.h) * 0.6;
  ratings.steal += (raw.ws - raw.h) * 0.3;
  // Custom builds: category points plus physique caps (trade-offs for size).
  if (raw.custom) {
    for (const [cat, pts] of Object.entries(raw.custom)) for (const a of CATEGORY_ATTRS[cat] || []) ratings[a] += pts;
    const caps = physiqueCaps(raw.h, raw.w, raw.ws);
    for (const a of ATTRS) if (caps[a] !== undefined) ratings[a] = Math.min(ratings[a], caps[a]);
  }
  for (const a of ATTRS) ratings[a] = Math.round(clamp(ratings[a], 25, 99));

  const badges = {};
  for (const [b, tier] of ARCH_BADGES[raw.arch] || []) {
    const t = clamp(tier + (ovr >= 90 ? 1 : ovr < 75 ? -1 : 0), 0, 4);
    if (t > 0) badges[b] = t;
  }
  const tend = { ...(TENDENCIES[raw.arch] || TENDENCIES.twoWay) };
  // Shooting style: release speed and the arc of the jumper.
  const jumper = raw.jumper ? { ...raw.jumper } : {
    speed: clamp(0.92 + (ratings.threeShot - 75) * 0.004 + rng.range(-0.04, 0.04), 0.85, 1.12),
    arc: clamp(50 + rng.range(-3, 4), 46, 56),
    setPoint: rng.range(0.9, 1.1),
  };
  return {
    id: `${teamId}-${raw.num}-${raw.last}`.replace(/[^\w-]/g, ''),
    first: raw.first,
    last: raw.last,
    name: `${raw.first} ${raw.last}`,
    num: raw.num,
    pos: raw.pos,
    arch: raw.arch,
    ovr,
    heightM,
    wingM,
    weightKg: raw.w,
    skin: raw.skin ?? 2,
    hair: raw.hair || 'short',
    beard: raw.beard || 'none',
    acc: raw.acc || [],
    my: !!raw.my,
    ratings,
    badges,
    tend,
    jumper,
  };
}

export const CATEGORY_ATTRS = {
  shooting: ['closeShot', 'midShot', 'threeShot', 'freeThrow'],
  finishing: ['layup', 'drivingDunk', 'standingDunk', 'postControl'],
  playmaking: ['ballHandle', 'speedWithBall', 'passAccuracy', 'passVision', 'passIQ'],
  defense: ['interiorD', 'perimeterD', 'steal', 'block', 'defAwareness', 'helpD'],
  rebounding: ['offReb', 'defReb'],
  physicals: ['speed', 'accel', 'agility', 'strength', 'vertical', 'stamina'],
};
export const BUILD_POINTS = 60;

/** Maximum ratings a body can reach: size helps inside and hurts handle/speed. */
export function physiqueCaps(hCm, wKg, wsCm) {
  const tall = (hCm - 200) / 10;
  const heavy = (wKg - 100) / 10;
  const reach = (wsCm - hCm) / 10;
  const c = (v) => Math.round(clamp(v, 40, 99));
  return {
    ballHandle: c(92 - tall * 9 - heavy * 2), speedWithBall: c(92 - tall * 9 - heavy * 3), speed: c(95 - tall * 8 - heavy * 4),
    accel: c(95 - tall * 8 - heavy * 4), agility: c(94 - tall * 9 - heavy * 3), threeShot: c(95 - Math.max(0, tall) * 6 + reach * -3),
    midShot: c(96 - Math.max(0, tall) * 3), drivingDunk: c(70 + tall * 8 + reach * 5), standingDunk: c(60 + tall * 12 + heavy * 3),
    block: c(55 + tall * 12 + reach * 10), interiorD: c(65 + tall * 10 + heavy * 4), perimeterD: c(92 - Math.max(0, tall) * 6 + reach * 4),
    offReb: c(60 + tall * 10 + heavy * 3), defReb: c(65 + tall * 10 + heavy * 3), strength: c(65 + heavy * 9 + tall * 3), vertical: c(95 - heavy * 6 - Math.max(0, tall) * 3),
    postControl: c(60 + tall * 8 + heavy * 5),
  };
}

export const BADGES = {
  sniper: { cat: 'Shooting', name: 'Sniper', desc: 'Widens the release window on jumpers and softens contests.' },
  deepRange: { cat: 'Shooting', name: 'Deep Range', desc: 'Reduces the penalty for shots beyond the arc.' },
  spotUp: { cat: 'Shooting', name: 'Spot-Up', desc: 'Boosts catch-and-shoot attempts.' },
  bodyControl: { cat: 'Finishing', name: 'Body Control', desc: 'Better contested and adjusted layups.' },
  posterThreat: { cat: 'Finishing', name: 'Poster Threat', desc: 'More contact dunks over defenders.' },
  strongFinisher: { cat: 'Finishing', name: 'Strong Finisher', desc: 'Absorbs contact on drives and finishes.' },
  tightHandles: { cat: 'Playmaking', name: 'Tight Handles', desc: 'Faster dribble moves; harder to strip.' },
  ankleBreaker: { cat: 'Playmaking', name: 'Ankle Breaker', desc: 'Dribble moves stagger defenders more.' },
  setupArtist: { cat: 'Playmaking', name: 'Setup Artist', desc: 'Passes boost the receiver’s shot.' },
  lockdown: { cat: 'Defense', name: 'Lockdown', desc: 'Stronger on-ball contests and cutoffs.' },
  ballHawk: { cat: 'Defense', name: 'Ball Hawk', desc: 'More successful steal attempts.' },
  laneThief: { cat: 'Defense', name: 'Lane Thief', desc: 'Reads passing lanes for interceptions.' },
  paintWall: { cat: 'Defense', name: 'Paint Wall', desc: 'Better blocks and rim contests.' },
  glassCleaner: { cat: 'Rebounding', name: 'Glass Cleaner', desc: 'Wins more contested rebounds.' },
  boxOutPro: { cat: 'Rebounding', name: 'Box-Out Pro', desc: 'Stronger box outs.' },
  brickWall: { cat: 'Physicals', name: 'Brick Wall', desc: 'Harder to move; better screens.' },
  bounceBack: { cat: 'Physicals', name: 'Bounce Back', desc: 'Recovers stamina faster.' },
};

export const BADGE_TIERS = ['None', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
