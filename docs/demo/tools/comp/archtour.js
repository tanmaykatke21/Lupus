// Pans the architecture diagram layer by layer, timed to the narration.
(() => {
  const c = document.getElementById('c');
  document.body.style.cssText = 'margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff';
  c.style.transformOrigin = '0 0'; c.style.transition = 'transform 1.6s cubic-bezier(.4,0,.2,1)';
  const box = ids => { const rs = ids.map(i => document.getElementById(i).getBoundingClientRect());
    return { x: Math.min(...rs.map(r => r.left)), y: Math.min(...rs.map(r => r.top)), r: Math.max(...rs.map(r => r.right)), b: Math.max(...rs.map(r => r.bottom)) }; };
  const full = { x: 0, y: 0, r: c.offsetWidth, b: c.offsetHeight };
  const fit = (b, pad = 40) => { const w = b.r - b.x + 2 * pad, h = b.b - b.y + 2 * pad, s = Math.min(1920 / w, 1080 / h);
    const tx = (1920 - (b.r - b.x) * s) / 2 - b.x * s, ty = (1080 - (b.b - b.y) * s) / 2 - b.y * s;
    c.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; };
  const ALL = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'POLL'];
  ALL.forEach(i => { document.getElementById(i).style.transition = 'opacity .8s'; });
  const spot = ids => ALL.forEach(i => { document.getElementById(i).style.opacity = !ids || ids.includes(i) ? 1 : 0.18; });
  const steps = [[0, full, null], [3.5, box(['L1']), ['L1']], [8, box(['L2', 'L3']), ['L2', 'L3']], [14.5, box(['L4']), ['L4']], [21.5, box(['L5', 'L4']), ['L5']], [30, box(['L6', 'POLL']), ['L6', 'POLL']], [38, full, null]];
  c.style.transition = 'none'; fit(full); c.offsetWidth; c.style.transition = 'transform 1.6s cubic-bezier(.4,0,.2,1)';
  window.startTour = () => steps.forEach(([t, b, ids]) => setTimeout(() => { fit(b); spot(ids); }, t * 1000));
})();
