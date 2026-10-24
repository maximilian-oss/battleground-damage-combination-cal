(function (root) {
  'use strict';
  const EPS = 1e-8;
  function choose(n, k) {
    if (k < 0 || n < k || n < 0) return 0;
    k = Math.min(k, n - k);
    let v = 1;
    for (let i = 1; i <= k; i++) v = v * (n - k + i) / i;
    return Math.round(v);
  }
  function curveAt(keys, r) {
    if (r <= keys[0].time) return keys[0].value;
    if (r >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (r < a.time || r > b.time) continue;
      const dt = b.time - a.time, t = (r - a.time) / dt;
      if (a.interpMode === 1) return a.value;
      if (!a.interpMode) return a.value + (b.value - a.value) * t;
      return (2*t*t*t - 3*t*t + 1)*a.value + (t*t*t - 2*t*t + t)*dt*a.leaveTangent
        + (-2*t*t*t + 3*t*t)*b.value + (t*t*t - t*t)*dt*b.arriveTangent;
    }
    return null;
  }
  function baseAt(weapon, distance, model) {
    if (!Number.isFinite(distance) || distance < 0 || distance > weapon.maxDistance) return null;
    if (weapon.model === 'curve' && weapon.curveKeys && model !== 'sampled')
      return weapon.baseDamage * curveAt(weapon.curveKeys, distance);
    const p = weapon.damagePoints;
    if (distance <= p[0].x) return p[0].y;
    for (let i = 1; i < p.length; i++) {
      if (distance <= p[i].x) {
        const a = p[i - 1], b = p[i];
        return a.y + (b.y - a.y) * (distance - a.x) / (b.x - a.x);
      }
    }
    return null;
  }
  function context(weapon, state, data) {
    const base = baseAt(weapon, state.distance, state.model);
    if (base === null) return null;
    const armors = data.armorMultipliers || [1, .7, .6, .45];
    const included = new Set(state.zones || data.zones.map(z => z.id));
    const zones = data.zones.map(z => {
      const part = weapon.zoneOverrides?.[z.id] ?? z.multipliers[weapon.class];
      const armor = z.armor === 'helmet' ? armors[state.helmet] : z.armor === 'vest' ? armors[state.vest] : 1;
      const coefficient = part * armor;
      return { ...z, coefficient, damage: base * coefficient, included: included.has(z.id) };
    });
    return { weapon, base, hp: state.hp, zones, active: zones.filter(z => z.included), exact: state.countMode === 'exact' };
  }
  function countCombinations(ctx, n, mode) {
    if (!ctx || !ctx.active.length || n < 1) return 0;
    const exact = mode ? mode === 'exact' : ctx.exact;
    const groupsByValue = new Map();
    for (const z of ctx.active) {
      const w = Math.round(z.coefficient * 1e6);
      groupsByValue.set(w, (groupsByValue.get(w) || 0) + 1);
    }
    const groups = [...groupsByValue].sort((a,b) => a[0] - b[0]);
    const threshold = ctx.hp / ctx.base * 1e6, eps = EPS / ctx.base * 1e6;
    const suffixSize = groups.map((_, i) => groups.slice(i).reduce((s,x) => s + x[1], 0));
    const maximum = groups[groups.length - 1][0];
    function visit(i, remaining, sum, minHit) {
      if (!remaining) return sum + eps >= threshold && (!exact || sum - minHit + eps < threshold) ? 1 : 0;
      if (sum + maximum * remaining + eps < threshold) return 0;
      if (exact && sum + eps >= threshold) return 0;
      const [w, size] = groups[i];
      if (!exact && sum + w * remaining + eps >= threshold)
        return choose(remaining + suffixSize[i] - 1, remaining);
      if (i === groups.length - 1) {
        const total = sum + remaining*w, min = Math.min(minHit, w);
        return total + eps >= threshold && (!exact || total - min + eps < threshold)
          ? choose(remaining + size - 1, remaining) : 0;
      }
      let result = 0;
      for (let k = 0; k <= remaining; k++) {
        result += choose(k + size - 1, k) * visit(i + 1, remaining - k, sum + k*w, k ? Math.min(minHit, w) : minHit);
      }
      return result;
    }
    return visit(0, n, 0, Infinity);
  }
  function shotBounds(ctx, counts) {
    const hits = [];
    for (let i = 0; i < counts.length; i++) for (let k=0; k<counts[i]; k++) hits.push(ctx.active[i].damage);
    function needed(values) { let sum=0; for (let i=0; i<values.length; i++) { sum+=values[i]; if (sum + EPS >= ctx.hp) return i+1; } return null; }
    return [needed([...hits].sort((a,b)=>b-a)), needed([...hits].sort((a,b)=>a-b))];
  }
  function pageCombinations(ctx, n, offset=0, limit=40, mode) {
    if (!ctx || !ctx.active.length) return { rows: [], visited: 0 };
    const exact = mode ? mode === 'exact' : ctx.exact;
    const zones = ctx.active, k = zones.length, counts = Array(k).fill(0), rows = [];
    const suffixMin = zones.map((_,i)=>Math.min(...zones.slice(i).map(z=>z.damage)));
    const suffixMax = zones.map((_,i)=>Math.max(...zones.slice(i).map(z=>z.damage)));
    let skipped=0, visited=0;
    function visit(i, left, sum, minHit) {
      if (rows.length >= limit) return;
      if (!left) {
        if (sum + EPS < ctx.hp || (exact && sum-minHit+EPS >= ctx.hp)) return;
        if (skipped++ < offset) return;
        const bounds = shotBounds(ctx, counts);
        rows.push({ counts: [...counts], damage: sum, excess: sum-ctx.hp, minShots: bounds[0], maxShots: bounds[1] });
        return;
      }
      if (i >= k || sum + suffixMax[i]*left + EPS < ctx.hp) return;
      if (exact && sum + EPS >= ctx.hp) return;
      if (!exact && sum + suffixMin[i]*left + EPS >= ctx.hp) {
        const all = choose(left + k-i-1, left);
        if (skipped + all <= offset) { skipped += all; return; }
      }
      visited++;
      if (i === k-1) {
        counts[i]=left;
        visit(k, 0, sum+left*zones[i].damage, Math.min(minHit,zones[i].damage));
        counts[i]=0;
        return;
      }
      for (let c=left; c>=0; c--) {
        counts[i]=c;
        visit(i+1,left-c,sum+c*zones[i].damage,c ? Math.min(minHit,zones[i].damage) : minHit);
        if (rows.length >= limit) break;
      }
      counts[i]=0;
    }
    visit(0,n,0,Infinity);
    return {rows, visited};
  }
  function ttk(shots, mode, rpmOverride) {
    if (!shots || shots < 1) return 0;
    if (rpmOverride) return (shots-1)*60/rpmOverride;
    if (mode?.intervalPattern?.length) {
      let seconds=0;
      for(let i=0;i<shots-1;i++) seconds += mode.intervalPattern[i%mode.intervalPattern.length];
      return seconds;
    }
    return (shots-1)*(mode?.tbs || 60/(mode?.rpm || 600));
  }
  function globalBounds(ctx,n) {
    if (!ctx?.active.length) return [0,0];
    const values=ctx.active.map(z=>z.damage);
    return [Math.ceil((ctx.hp-EPS)/Math.max(...values)), Math.min(n, Math.ceil((ctx.hp-EPS)/Math.min(...values)))];
  }
  const api={choose,curveAt,baseAt,context,countCombinations,pageCombinations,shotBounds,ttk,globalBounds};
  root.PUBG_ENGINE=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(globalThis);
