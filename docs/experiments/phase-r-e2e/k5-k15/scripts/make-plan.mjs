// Randomized run order (seeded Fisher-Yates) for the Phase R k=5/15 campaign.
const n=Number(process.argv[2]??6), seed0=Number(process.argv[3]??20261125);
let seed=seed0; const rnd=()=>(seed=(seed*1103515245+12345)%2**31)/2**31;
const runs=[];
for(const k of [5,15])for(const v of ["batch","single"])for(let i=1;i<=n;i++)runs.push(`${v}-k${k}-${i} ${v} ${k}`);
for(let i=runs.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[runs[i],runs[j]]=[runs[j],runs[i]];}
console.log(runs.join("\n"));
