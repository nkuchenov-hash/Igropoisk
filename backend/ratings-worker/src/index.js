const json=(data,status=200,origin='*')=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});

async function hmacHex(secret,value){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

const validSlug=value=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

async function aggregate(env,slug){
  const result=await env.DB.prepare('SELECT COUNT(*) AS count, AVG(rating) AS average FROM ratings WHERE game_slug = ?').bind(slug).first();
  return{game_slug:slug,count:Number(result?.count||0),average:result?.average===null||result?.average===undefined?null:Number(Number(result.average).toFixed(2))};
}

export default{
  async fetch(request,env){
    const origin=env.ALLOWED_ORIGIN||'*';
    if(request.method==='OPTIONS')return json({},204,origin);
    const url=new URL(request.url);
    const match=url.pathname.match(/^\/api\/ratings\/([a-z0-9-]+)$/);
    if(!match)return json({error:'Not found'},404,origin);
    const slug=match[1];
    if(!validSlug(slug))return json({error:'Invalid game slug'},400,origin);

    if(request.method==='GET')return json(await aggregate(env,slug),200,origin);
    if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);

    const ip=request.headers.get('cf-connecting-ip');
    if(!ip)return json({error:'Client IP is unavailable'},400,origin);
    if(!env.IP_HASH_SECRET)return json({error:'Server secret is not configured'},500,origin);

    let body;
    try{body=await request.json()}catch{return json({error:'Invalid JSON'},400,origin)}
    const rating=Number(body?.rating);
    if(!Number.isInteger(rating)||rating<1||rating>10)return json({error:'Rating must be an integer from 1 to 10'},400,origin);

    const voterHash=await hmacHex(env.IP_HASH_SECRET,ip);
    const upsert=env.DB.prepare(`INSERT INTO ratings (game_slug,voter_hash,rating,created_at,updated_at)
      VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(game_slug,voter_hash) DO UPDATE SET rating=excluded.rating,updated_at=CURRENT_TIMESTAMP`).bind(slug,voterHash,rating);
    const history=env.DB.prepare('INSERT INTO rating_events (game_slug,voter_hash,rating) VALUES (?,?,?)').bind(slug,voterHash,rating);
    await env.DB.batch([upsert,history]);

    return json({...await aggregate(env,slug),saved_rating:rating},200,origin);
  }
};
