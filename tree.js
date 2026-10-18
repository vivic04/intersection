"use strict";
/* Growth tree for the Today screen.
   Trunk grows with total plays; five branches (one per skill, in its colour) lengthen with that skill's XP;
   each learned technique is a leaf, each mastered one a blossom. New growth animates in on open. */
const Tree = (() => {
  let raf = 0, canvas = null, from = null, to = null, t0 = 0, swayOn = false;
  const DUR = 1800;
  const ease = x => 1 - Math.pow(1 - x, 3);
  const rnd = seed => { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

  function model() {
    const plays = Object.values(S.log).reduce((a, b) => a + b, 0);
    const br = ORDER.map(k => ({
      k,
      len: Math.min(1, Math.sqrt((S.xp[k] || 0) / 2200)),
      leaves: IX.lib.filter(l => l.sk === k && (S.learned[l.id] || S.mem[l.id])).map(l => ({ id: l.id, bloom: S.mem[l.id] && S.mem[l.id].m >= MASTERED && S.mem[l.id].n >= 2 }))
    }));
    return { plays, trunk: Math.min(1, Math.pow(plays / 120, 0.55)), br };
  }
  function snap(m) { return { trunk: m.trunk, len: m.br.map(b => b.len), leaves: Object.fromEntries(m.br.flatMap(b => b.leaves.map(l => [l.id, l.bloom ? 2 : 1]))) }; }

  function draw(p, time) {
    const ctx = canvas.getContext("2d"), W = canvas.clientWidth, H = canvas.clientHeight, dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue("--" + n).trim() || "#888";
    const e = ease(p), lerp = (a, b) => a + (b - a) * e;
    const sway = swayOn ? Math.sin(time / 1400) * 0.025 : 0;
    const gx = W / 2, gy = H - 18;
    // ground
    ctx.fillStyle = col("soft"); ctx.beginPath(); ctx.ellipse(gx, gy + 6, Math.min(W * 0.42, 150), 10, 0, 0, Math.PI * 2); ctx.fill();
    const trunk = lerp(from.trunk, to.trunk);
    const th = 18 + trunk * (H * 0.42);
    const bark = col("muted");
    // trunk (tapered)
    const topX = gx + sway * th * 0.6, topY = gy - th;
    ctx.fillStyle = bark; ctx.beginPath();
    const wb = 4 + trunk * 7, wt = 2 + trunk * 2.5;
    ctx.moveTo(gx - wb, gy); ctx.quadraticCurveTo(gx - wb * 0.6, gy - th * 0.5, topX - wt, topY);
    ctx.quadraticCurveTo(topX, topY - 6, topX + wt, topY); ctx.quadraticCurveTo(gx + wb * 0.6, gy - th * 0.5, gx + wb, gy); ctx.closePath(); ctx.fill();
    // seedling leaves when brand new
    if (to.trunk < 0.08) {
      ctx.fillStyle = col("s");
      [-1, 1].forEach(s => { ctx.save(); ctx.translate(topX, topY + 2); ctx.rotate(s * 0.9 + sway); ctx.beginPath(); ctx.ellipse(s * 8, 0, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
    }
    // branches
    const angles = [-1.05, -0.55, 0, 0.55, 1.05], attach = [0.55, 0.72, 1, 0.78, 0.6];
    const maxLen = Math.min(W * 0.4, H * 0.55);
    let born = 0;
    const newTotal = Math.max(1, Object.keys(to.leaves).filter(id => !from.leaves[id]).length);
    ORDER.forEach((k, i) => {
      const L = 8 + lerp(from.len[i], to.len[i]) * maxLen;
      if (L < 9 && !Object.keys(to.leaves).some(id => id[0] === k)) return;
      const bx = gx + (topX - gx) * attach[i], by = gy - th * attach[i];
      const a = -Math.PI / 2 + angles[i] + sway * (1 + i * 0.2);
      const ex = bx + Math.cos(a) * L, ey = by + Math.sin(a) * L;
      const cx = bx + Math.cos(a - 0.25 * Math.sign(angles[i] || 1)) * L * 0.55, cy = by + Math.sin(a - 0.25 * Math.sign(angles[i] || 1)) * L * 0.55;
      ctx.strokeStyle = bark; ctx.lineCap = "round"; ctx.lineWidth = 1.5 + L / 30;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
      // tip bud in skill colour
      ctx.fillStyle = col(k); ctx.beginPath(); ctx.arc(ex, ey, 2.5 + L / 40, 0, Math.PI * 2); ctx.fill();
      // leaves along the branch
      const ids = Object.keys(to.leaves).filter(id => id[0] === k);
      ids.forEach((id, j) => {
        const r = rnd(id), t = 0.25 + r() * 0.75, side = r() > 0.5 ? 1 : -1;
        const px = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * ex, py = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy + t * t * ey;
        const isNew = !from.leaves[id], bloomNew = to.leaves[id] === 2 && from.leaves[id] !== 2;
        let sc = 1;
        if (isNew) { const start = 0.3 + 0.45 * (born / newTotal); sc = ease(Math.min(1, Math.max(0, (p - start) / 0.25))); born++; }
        if (sc <= 0) return;
        const la = a + side * (0.6 + r() * 0.7) + Math.sin(time / 900 + j) * (swayOn ? 0.08 : 0);
        const twig = 3 + r() * 9;
        ctx.save(); ctx.translate(px, py); ctx.rotate(la); ctx.scale(sc, sc);
        ctx.strokeStyle = bark; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(twig, 0); ctx.stroke();
        ctx.fillStyle = col(k); ctx.globalAlpha = 0.55 + r() * 0.4;
        ctx.beginPath(); ctx.moveTo(twig, 0); ctx.quadraticCurveTo(twig + 6, -5.5, twig + 13, 0); ctx.quadraticCurveTo(twig + 6, 5.5, twig, 0); ctx.fill();
        ctx.restore();
        if (to.leaves[id] === 2) { // blossom
          const bs = bloomNew ? ease(Math.min(1, Math.max(0, (p - 0.6) / 0.4))) : 1;
          if (bs > 0) {
            const fx = px + Math.cos(la) * (twig + 13), fy = py + Math.sin(la) * (twig + 13);
            ctx.save(); ctx.translate(fx, fy); ctx.scale(bs, bs);
            ctx.fillStyle = col("surface");
            for (let q = 0; q < 5; q++) { ctx.beginPath(); ctx.arc(Math.cos(q * 1.2566) * 3.6, Math.sin(q * 1.2566) * 3.6, 3, 0, Math.PI * 2); ctx.fill(); }
            ctx.strokeStyle = col(k); ctx.lineWidth = 1;
            for (let q = 0; q < 5; q++) { ctx.beginPath(); ctx.arc(Math.cos(q * 1.2566) * 3.6, Math.sin(q * 1.2566) * 3.6, 3, 0, Math.PI * 2); ctx.stroke(); }
            ctx.fillStyle = col("e"); ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        }
      });
    });
  }

  function loop(now) {
    if (!canvas || !canvas.isConnected) { raf = 0; return; }
    const p = Math.min(1, (now - t0) / DUR);
    draw(p, now);
    if (p >= 1 && !swayOn) { S.treeSeen = to; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} raf = 0; return; }
    if (p >= 1 && !S.treeSeenSet) { S.treeSeen = to; S.treeSeenSet = true; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
    raf = document.hidden ? 0 : requestAnimationFrame(loop);
  }
  function mount(el, replay) {
    cancelAnimationFrame(raf);
    canvas = el; const m = model(); to = snap(m);
    const empty = { trunk: 0, len: ORDER.map(() => 0), leaves: {} };
    from = replay ? empty : (S.treeSeen && S.treeSeen.len ? S.treeSeen : empty);
    S.treeSeenSet = false;
    swayOn = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    t0 = performance.now(); raf = requestAnimationFrame(loop);
    return m;
  }
  function caption() {
    const m = model(), leaves = m.br.reduce((a, b) => a + b.leaves.length, 0), blooms = m.br.reduce((a, b) => a + b.leaves.filter(l => l.bloom).length, 0);
    if (!m.plays) return "A seed. Every play helps it grow.";
    return `${leaves} ${leaves === 1 ? "leaf" : "leaves"} · ${blooms} ${blooms === 1 ? "blossom" : "blossoms"}`;
  }
  return { mount, caption };
})();
document.addEventListener("visibilitychange", () => { const c = document.getElementById("tree"); if (!document.hidden && c) Tree.mount(c, false); });
