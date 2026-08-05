import fs from 'node:fs';
import path from 'node:path';

const remoteBase=String(process.env.HOME_FEEDS_SMOKE_BASE_URL||'').trim();
const base=remoteBase?new URL(remoteBase.endsWith('/')?remoteBase:`${remoteBase}/`):null;
async function text(relative){
  if(base){const response=await fetch(new URL(relative,base),{cache:'no-store'});if(!response.ok)throw new Error(`${relative}: HTTP ${response.status}`);return response.text();}
  return fs.readFileSync(path.join(process.cwd(),relative),'utf8');
}
const health=JSON.parse(await text('data/home-feeds-health.json'));
const admin=await text('admin/home-feeds-health/index.html');
const errors=[];
if(!['pending','healthy','degraded'].includes(health.status))errors.push(`Health status is ${health.status||'missing'}.`);
if(health.read_only!==true)errors.push('Health snapshot is not read-only.');
if(health.status!=='pending'){
  if(Number(health.popular?.selected)<20)errors.push('Published popular quality selection has fewer than 20 cards.');
  if(Number(health.releases?.selected_home)<6)errors.push('Published release quality selection has fewer than six cards.');
}
if(!admin.includes('data-home-feeds-health-admin'))errors.push('Read-only home feeds admin page is unavailable.');
if(errors.length)throw new Error(`Home feeds quality smoke failed:\n${errors.map(error=>`- ${error}`).join('\n')}`);
console.log(JSON.stringify({base:base?.href||'local',status:health.status,popular:health.popular?.selected||0,releases:health.releases?.selected_home||0},null,2));
