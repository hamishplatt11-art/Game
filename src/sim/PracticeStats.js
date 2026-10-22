// Practice-mode shot analysis (headless, unit tested): totals, zones, timing
// tendencies, contest levels and a coaching tip for the latest attempt.
export function summarizePractice(log) {
  const done = log.filter((s) => s.made !== null);
  const zones = {};
  for (const z of ['Paint', 'Mid-range', '3PT']) zones[z] = { att: 0, made: 0 };
  const grades = {};
  let errSum = 0, errN = 0, bias = 0;
  for (const s of done) {
    zones[s.zone].att++;
    if (s.made) zones[s.zone].made++;
    if (s.grade) grades[s.grade] = (grades[s.grade] || 0) + 1;
    if (s.err !== null && s.err !== undefined && s.kind !== 'layup' && s.kind !== 'dunk') { errSum += Math.abs(s.err); bias += s.err; errN++; }
  }
  const made = done.filter((s) => s.made).length;
  let streak = 0;
  for (let i = done.length - 1; i >= 0 && done[i].made; i--) streak++;
  return {
    att: done.length, made, pct: done.length ? made / done.length : 0, zones, grades, streak,
    avgErrMs: errN ? Math.round((errSum / errN) * 1000) : null,
    biasMs: errN ? Math.round((bias / errN) * 1000) : null,
    excellent: grades.Excellent || 0,
    last: log[log.length - 1] || null,
    tip: tipFor(log[log.length - 1], errN ? bias / errN : 0, errN),
  };
}

export function tipFor(s, bias = 0, n = 0) {
  if (!s) return 'Hold shoot, release at the top of the jump. The meter turns green inside the release window.';
  if (s.kind === 'dunk' || s.kind === 'layup') {
    if (s.contestV > 0.5) return `${s.contest} contest at the rim: attack the defender's off side or use a euro/hop step.`;
    return s.made === false ? 'Layup missed: finish earlier in the gather with sprint off, or approach from a better angle.' : 'Clean finish.';
  }
  const ms = s.err !== null && s.err !== undefined ? Math.round(s.err * 1000) : null;
  const win = s.window ? Math.round(s.window * 1000) : null;
  if (s.contestV > 0.58) return `${s.contest} contest (${Math.round((s.prob || 0) * 100)}% make chance). Create space first: stepback, side-step or a pump fake.`;
  if (ms !== null && win !== null && Math.abs(ms) > win) {
    const dir = ms < 0 ? 'early' : 'late';
    const trend = n >= 4 && Math.abs(bias) > 0.02 ? ` You tend to release ${bias < 0 ? 'early' : 'late'} (${Math.round(Math.abs(bias) * 1000)} ms on average).` : '';
    return `Released ${Math.abs(ms)} ms ${dir}; this shot's green window is ±${win} ms.${trend}`;
  }
  if (s.dist > 8.2) return 'Deep three: the release window is tighter and the base make chance lower beyond the arc.';
  if (s.made === false) return `Good timing (${ms} ms) but the shot still missed: open shots by strong shooters convert most often.`;
  return ms !== null ? `On time (${ms > 0 ? '+' : ''}${ms} ms, window ±${win} ms).` : 'Good shot.';
}
