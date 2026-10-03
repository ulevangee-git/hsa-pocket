import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
const KEY='hsa-pocket:2026:v1';
const dates=['2026-10-09','2026-10-23','2026-11-06','2026-11-20','2026-12-04','2026-12-18','2026-12-31'];
export const seed=()=>({version:0,limit:440000,employerAnnual:100000,personalOpening:260000,employerOpening:66664,rows:dates.map(date=>({date,personal:null,employer:null,taxYear:2026})),updatedAt:null});
export function validate(s){
 const money=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000000;
 if(!s||!Number.isSafeInteger(s.version)||s.version<0||!['limit','employerAnnual','personalOpening','employerOpening'].every(k=>money(s[k]))||s.employerAnnual<s.employerOpening||!Array.isArray(s.rows)||s.rows.length!==7) return false;
 return s.rows.every((r,i)=>r.date===dates[i]&&(r.personal===null||money(r.personal))&&(r.employer===null||money(r.employer))&&[2026,2027].includes(r.taxYear));
}
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const signature=v=>createHmac('sha256',process.env.SESSION_SECRET).update(v).digest('base64url');
function authorized(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hsa_session='))?.slice(12);if(!token)return false;const parts=token.split('.');return parts.length===3&&Number(parts[0])>Date.now()&&equal(parts[2],signature(parts[0]+'.'+parts[1]));}
const redisUrl=()=>process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL;
const redisToken=()=>process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
function setupError(){
 const problems=[];
 if(!process.env.HSA_PASSCODE)problems.push('HSA_PASSCODE is missing');
 else if(process.env.HSA_PASSCODE.length<8)problems.push('HSA_PASSCODE must contain at least 8 characters');
 if(!process.env.SESSION_SECRET)problems.push('SESSION_SECRET is missing');
 else if(process.env.SESSION_SECRET.length<32)problems.push('SESSION_SECRET must contain at least 32 characters');
 if(!redisUrl())problems.push('KV_REST_API_URL is missing');
 if(!redisToken())problems.push('KV_REST_API_TOKEN is missing');
 return problems.length?'Cloud setup is incomplete: '+problems.join('; ')+'.':'';
}
async function redis(command){const response=await fetch(redisUrl(),{method:'POST',headers:{Authorization:'Bearer '+redisToken(),'Content-Type':'application/json'},body:JSON.stringify(command)});const data=await response.json();if(!response.ok||data.error)throw Error('Storage unavailable');return data.result;}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const send=(status,data)=>res.status(status).json(data);
 if(!['GET','POST','PUT','DELETE'].includes(req.method))return send(405,{error:'Method not allowed'});
 const configurationError=setupError();
 if(configurationError){console.warn('[hsa-pocket] '+configurationError);return send(503,{error:configurationError});}
 if(req.method!=='GET'&&req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'Request origin rejected'});
 try{
  if(req.method==='POST'){
   const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0].trim();const rateKey='hsa-pocket:attempts:'+createHash('sha256').update(ip).digest('hex');
   const count=await redis(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n",'1',rateKey]);
   if(count>10)return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
   if(typeof req.body?.passcode!=='string'||req.body.passcode.length>256||!equal(req.body.passcode,process.env.HSA_PASSCODE))return send(401,{error:'That passcode is not correct.'});
   const value=(Date.now()+30*86400000)+'.'+randomBytes(24).toString('base64url');res.setHeader('Set-Cookie',`hsa_session=${value}.${signature(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);return send(200,{ok:true});
  }
  if(!authorized(req))return send(401,{error:'Unlock your tracker to continue.'});
  if(req.method==='DELETE'){res.setHeader('Set-Cookie','hsa_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
  await redis(['SET',KEY,JSON.stringify(seed()),'NX']);
  if(req.method==='GET')return send(200,JSON.parse(await redis(['GET',KEY])));
  if(!validate(req.body))return send(400,{error:'Check your amounts and annual employer total.'});
  const next={...req.body,version:req.body.version+1,updatedAt:new Date().toISOString()};
  const result=await redis(['EVAL',"local old=cjson.decode(redis.call('GET',KEYS[1])); if old.version~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1",'1',KEY,String(req.body.version),JSON.stringify(next)]);
  if(!result)return send(409,{error:'Another device saved a change. Refresh, then re-enter this edit.'});
  return send(200,next);
 }catch{return send(503,{error:'Could not reach cloud storage. Your changes were not saved. Try again.'});}
}
