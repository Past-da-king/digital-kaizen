p='scripts/e2e-browser.mjs'
s=open(p).read()
s=s.replace("const stopRes = await fetch(","""// a real sensor must have learned the stroke before it can tell a stop from a start-up
for (let i = 0; i < 60; i++) {
  const lv = await (await aget('/api/live')).json();
  const m2 = lv.machines.find(m => m.machine_id === 'MA2');
  if (m2 && !m2.offline && m2.status === 'RUNNING' && m2.shots > 0) break;
  await sleep(5000);
}
const stopRes = await fetch(""")
open(p,'w').write(s)
