'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMagicLink, runSessionSmoke } = require('../scripts/smoke-session.cjs');

const origin = 'https://example.test';
const token = 'a'.repeat(80);
const csrf = `csrf-${'b'.repeat(32)}`;
const link = `${origin}/auth/verify#token=${token}`;

function json(status, body, setCookie) {
  const headers = { 'content-type':'application/json' };
  if (setCookie) headers['set-cookie']=setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

test('rechaza consumir enlaces sin confirmación exacta o de otro origen', async () => {
  assert.throws(() => parseMagicLink(`https://evil.invalid/auth/verify#token=${token}`, origin), /origen autorizado/);
  await assert.rejects(runSessionSmoke({ origin, magicLink:link, confirm:'NO', fetchImpl:async()=>{ throw new Error('no debe llamar'); } }), /CONFIRM=SI/);
});

test('smoke consume una vez, mantiene la sesión solo en su jar y la revoca sin JSON vacío', async () => {
  let consumed=false, active=false; const calls=[];
  const fetchImpl=async(url,options)=>{
    const pathname=new URL(url).pathname, cookie=options.headers.cookie||''; calls.push({pathname,method:options.method,headers:options.headers,body:options.body});
    if(pathname==='/api/v1/auth/verify'){
      if(consumed)return json(401,{code:'LINK_INVALID'});
      consumed=true;active=true;return json(200,{authenticated:true,user:{id:'user-1'}},'rv_session=opaque; Path=/; HttpOnly; Secure');
    }
    if(pathname==='/api/v1/users/me')return cookie.includes('rv_session=opaque')&&active?json(200,{user:{id:'user-1'}}):json(401,{code:'AUTHENTICATION_REQUIRED'});
    if(pathname==='/api/v1/auth/csrf')return cookie.includes('rv_session=opaque')&&active?json(200,{csrfToken:csrf}):json(401,{});
    if(pathname==='/api/v1/auth/logout'){
      assert.match(cookie,/rv_session=opaque/);assert.equal(options.headers['x-csrf-token'],csrf);active=false;return new Response(null,{status:204,headers:{'set-cookie':'rv_session=; Max-Age=0; Path=/; HttpOnly; Secure'}});
    }
    throw new Error(`ruta inesperada ${pathname}`);
  };
  const result=await runSessionSmoke({origin,magicLink:link,confirm:'SI',fetchImpl});
  assert.deepEqual(result,{ok:true,origin,checks:7});
  const logout=calls.find(call=>call.pathname==='/api/v1/auth/logout');
  assert.equal(logout.method,'POST');assert.equal(logout.body,undefined);assert.equal(logout.headers['content-type'],undefined);
  assert.equal(calls.filter(call=>call.pathname==='/api/v1/auth/verify').length,2);
});

test('no imprime ni devuelve el token o la cookie', async () => {
  await assert.rejects(runSessionSmoke({origin,magicLink:link,confirm:'SI',fetchImpl:async()=>json(500,{})}), error=>!error.message.includes(token)&&!error.message.includes('opaque'));
});
