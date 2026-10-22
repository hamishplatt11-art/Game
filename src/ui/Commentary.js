// Text play-by-play generated from simulation events (original lines; no
// recorded or imitated broadcaster voices). Optional speech synthesis reads
// these through the commentary volume bus.
let lastT = -99;
// Recently used lines are skipped so the same call never repeats back to back.
const recent = [];
const pick = (a) => {
  const fresh = a.filter((l) => !recent.includes(l));
  const l = (fresh.length ? fresh : a)[Math.floor(Math.random() * (fresh.length || a.length))];
  recent.push(l);
  if (recent.length > 12) recent.shift();
  return l;
};

export function commentaryFor(e, sim) {
  const now = sim.t;
  const big = ['score', 'block', 'ankleBreaker', 'poster', 'takeover', 'final', 'andOne', 'steal'].includes(e.type);
  if (!big && now - lastT < 4) return null;
  let line = null;
  switch (e.type) {
    case 'score': {
      const s = e.scorer ? e.scorer.last : 'They';
      if (e.kind === 'ft') return null;
      const c = e.context || {};
      if (c.fast && (e.kind === 'dunk' || e.kind === 'layup')) line = pick([`${s} on the break — easy two.`, `Off the turnover, ${s} is gone!`, `Out in transition, ${s} finishes.`, `Nobody gets back — ${s} scores.`]);
      else if (e.kind === 'dunk') line = pick([`${s} throws it down!`, `Hammer dunk from ${s}!`, `${s} finishes with authority.`, `${s} rocks the rim!`]);
      else if (e.three) line = pick([`${s} from downtown... got it!`, `Splash! ${s} buries the three.`, `${s} lets it fly — bang!`]);
      else if (e.kind === 'layup') line = pick([`${s} lays it in.`, `Nice finish by ${s} at the rim.`, `${s} gets the roll.`]);
      else line = pick([`${s} knocks it down.`, `${s} with the jumper — good.`, `Pull-up for ${s}... yes.`, `Smooth from ${s}.`]);
      if (c.clutch) line = pick([`Big shot! ${s} delivers late.`, `${s} with a huge bucket down the stretch.`, `Clutch! ${s}.`]);
      else if (c.leadChange) line += pick([' And that takes the lead.', ' Lead change.', ' They are back in front.']);
      if (e.assist && !c.clutch) line += ` ${e.assist.last} with the assist.`;
      break;
    }
    case 'block': line = pick([`Rejected by ${e.player.last}!`, `${e.player.last} sends it away!`, `Get that out of here — ${e.player.last}!`]); break;
    case 'steal': line = pick([`Picked off by ${e.player.last}.`, `${e.player.last} with the steal.`]); break;
    case 'ankleBreaker': line = `${e.player.last} sends the defender to the floor!`; break;
    case 'poster': line = `${e.player.last} puts ${e.defender.last} on a poster!`; break;
    case 'takeover': line = `${e.player.last} is taking over this game.`; break;
    case 'andOne': line = `And one! ${e.player.last} gets the bucket and the foul.`; break;
    case 'final': line = `That's the final buzzer. ${sim.teams[e.winner].raw.city} wins it.`; break;
    case 'timeout': line = `${sim.teams[e.team].raw.city} calls timeout.`; break;
    case 'periodEnd': line = `That will end the ${['first', 'second', 'third', 'fourth'][e.quarter - 1] || 'overtime'} ${e.quarter <= 4 ? 'quarter' : 'period'}.`; break;
    case 'tipWon': line = `${e.player.last} wins the tip.`; break;
    case 'foulOut': line = `${e.player.last} has fouled out.`; break;
    default: return null;
  }
  lastT = now;
  return line;
}
