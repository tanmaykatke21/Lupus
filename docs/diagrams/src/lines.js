// draw(list of [fromId, toId, label, opts]) — connects element edges with straight/elbow lines.
function draw(edges){
  const c=document.getElementById('c'), r0=c.getBoundingClientRect();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('class','w');
  svg.setAttribute('width',c.scrollWidth); svg.setAttribute('height',c.scrollHeight);
  svg.innerHTML='<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#445"/></marker></defs>';
  for(const [f,t,label,o={}] of edges){
    const a=document.getElementById(f).getBoundingClientRect(), b=document.getElementById(t).getBoundingClientRect();
    let x1,y1,x2,y2;
    const side=o.side||'v';
    if(side==='v'){ x1=(o.ax??0.5)*a.width+a.left; y1=a.bottom; x2=(o.bx??0.5)*b.width+b.left; y2=b.top; }
    else { x1=a.right; y1=a.top+a.height*(o.ay??0.5); x2=b.left; y2=b.top+b.height*(o.by??0.5); if(o.rev){x1=a.left;x2=b.right;} }
    x1-=r0.left;y1-=r0.top;x2-=r0.left;y2-=r0.top;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    const d = side==='v' ? `M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}` : `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`;
    p.setAttribute('d',d); p.setAttribute('fill','none'); p.setAttribute('stroke',o.color||'#445'); p.setAttribute('stroke-width',o.w||1.6);
    if(o.dash) p.setAttribute('stroke-dasharray','6 5');
    if(!o.noarrow) p.setAttribute('marker-end','url(#a)');
    svg.appendChild(p);
    if(label){const tx=document.createElementNS('http://www.w3.org/2000/svg','text');
      const mx=(x1+x2)/2+(o.lx||0), my=(y1+y2)/2+(o.ly||0);
      tx.setAttribute('x',mx);tx.setAttribute('y',my);tx.setAttribute('class','lbl');tx.setAttribute('text-anchor',o.anchor||'middle');
      tx.setAttribute('paint-order','stroke');tx.setAttribute('stroke','#fff');tx.setAttribute('stroke-width',5);tx.textContent=label;svg.appendChild(tx);}
  }
  c.appendChild(svg);
}
