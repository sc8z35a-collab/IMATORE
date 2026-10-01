// paste-able JS for ms.py: instant teleport to the terrace that frames landmark KEY, looking at it.
// usage in shell:  "$(sed s/KEY/fuji/ collab/agents/C/tools/lm.js)"
(()=>{const I=window.__imatore, L={lattice:[135,720,333],skytree:[-45,1500,634],wheel:[45,980,115],fuji:[180,4700,820]}.KEY;
const a=L[0]*Math.PI/180, lx=Math.cos(a)*L[1], lz=Math.sin(a)*L[1];
let best=0,bd=9;for(let i=0;i<8;i++){const p=I.avePoint(i,1,0);const d=Math.abs(Math.atan2(Math.sin(a-Math.atan2(p.z,p.x)),Math.cos(a-Math.atan2(p.z,p.x))));if(d<bd){bd=d;best=i;}}
const p=I.avePoint(best,206.5,0); const yaw=Math.atan2(-(lx-p.x),-(lz-p.z)); const dist=Math.hypot(lx-p.x,lz-p.z);
I.tp(p.x,p.z,yaw,Math.max(-0.05,Math.min(0.28,Math.atan2(L[2]*0.45-28,dist))));})()
