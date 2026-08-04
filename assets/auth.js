(()=>{
  'use strict';

  const SESSION_LOCAL='igroAuthSessionV1';
  const SESSION_TAB='igroAuthSessionTabV1';
  const ROOT=location.pathname.startsWith('/Igropoisk/')?'/Igropoisk/':'/';
  const USERS={
    sangrar:{
      username:'Sangrar',
      displayName:'Sangrar',
      role:'admin',
      roleLabel:'Администратор',
      salt:'7nQYMcepoSVW1mpBKE7v9A==',
      hash:'Vg7EAwe7495CqBlumUqOFhj8MpsJDGJ2CheSLHsVLrA=',
      iterations:240000
    }
  };

  const bytesFromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  const base64FromBytes=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
  const safeJson=(value,fallback=null)=>{
    try{return JSON.parse(value)||fallback}catch{return fallback}
  };
  const normalizeUsername=value=>String(value||'').trim().toLowerCase();

  function readSession(){
    const now=Date.now();
    for(const storage of [sessionStorage,localStorage]){
      let session=null;
      try{session=safeJson(storage.getItem(storage===localStorage?SESSION_LOCAL:SESSION_TAB))}catch{}
      if(!session)continue;
      if(!USERS[normalizeUsername(session.username)]||Number(session.expiresAt)<=now){
        try{storage.removeItem(storage===localStorage?SESSION_LOCAL:SESSION_TAB)}catch{}
        continue;
      }
      return {...session,user:USERS[normalizeUsername(session.username)]};
    }
    return null;
  }

  function clearSession(){
    try{localStorage.removeItem(SESSION_LOCAL)}catch{}
    try{sessionStorage.removeItem(SESSION_TAB)}catch{}
    window.dispatchEvent(new CustomEvent('igro-auth-change',{detail:null}));
    syncHeader();
  }

  async function derive(password,user){
    if(!crypto?.subtle)throw new Error('secure_context_required');
    const key=await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits=await crypto.subtle.deriveBits(
      {
        name:'PBKDF2',
        salt:bytesFromBase64(user.salt),
        iterations:user.iterations,
        hash:'SHA-256'
      },
      key,
      256
    );
    return base64FromBytes(bits);
  }

  async function login(username,password,remember=false){
    const key=normalizeUsername(username);
    const user=USERS[key];
    if(!user||!password)return {ok:false,error:'Неверное имя пользователя или пароль.'};
    try{
      const hash=await derive(password,user);
      if(hash!==user.hash)return {ok:false,error:'Неверное имя пользователя или пароль.'};
      const issuedAt=Date.now();
      const session={
        username:user.username,
        role:user.role,
        issuedAt,
        expiresAt:issuedAt+(remember?30*24*60*60*1000:12*60*60*1000)
      };
      clearSession();
      const storage=remember?localStorage:sessionStorage;
      storage.setItem(remember?SESSION_LOCAL:SESSION_TAB,JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('igro-auth-change',{detail:{...session,user}}));
      syncHeader();
      return {ok:true,session:{...session,user}};
    }catch(error){
      return {
        ok:false,
        error:error?.message==='secure_context_required'
          ?'Вход доступен только через HTTPS.'
          :'Не удалось выполнить вход. Обновите страницу и повторите.'
      };
    }
  }

  function destination(path){
    return `${ROOT}${String(path||'').replace(/^\/+/,'')}`;
  }

  function safeReturn(value){
    if(!value)return destination('account/');
    try{
      const url=new URL(value,location.origin);
      if(url.origin!==location.origin||!url.pathname.startsWith(ROOT))return destination('account/');
      return `${url.pathname}${url.search}${url.hash}`;
    }catch{return destination('account/')}
  }

  function loginUrl(returnTo=location.href){
    return `${destination('login/')}?return=${encodeURIComponent(safeReturn(returnTo))}`;
  }

  function requireAuth(options={}){
    const session=readSession();
    if(!session){
      location.replace(loginUrl(options.returnTo||location.href));
      return null;
    }
    if(options.role&&session.user.role!==options.role){
      location.replace(destination('account/'));
      return null;
    }
    return session;
  }

  function accountMarkup(session){
    if(!session){
      return '<span class="account-action__avatar" aria-hidden="true">↗</span><span class="account-action__label">Войти</span>';
    }
    const initial=session.user.displayName.slice(0,1).toUpperCase();
    return `<span class="account-action__avatar" aria-hidden="true">${initial}</span><span class="account-action__label">${session.user.displayName}</span>`;
  }

  function syncHeader(){
    const session=readSession();
    document.querySelectorAll('.site-actions').forEach(actions=>{
      let link=actions.querySelector('[data-auth-link]');
      if(!link){
        link=document.createElement('a');
        link.className='ig-button account-action';
        link.dataset.authLink='';
        actions.appendChild(link);
      }
      link.href=session?destination('account/'):loginUrl();
      link.setAttribute('aria-label',session?`Личный кабинет: ${session.user.displayName}`:'Войти в Игропоиск');
      link.innerHTML=accountMarkup(session);
    });
  }

  const observer=new MutationObserver(syncHeader);
  const start=()=>{
    syncHeader();
    if(document.body)observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();

  window.addEventListener('storage',syncHeader);
  window.IgropoiskAuth={
    login,
    logout:clearSession,
    session:readSession,
    requireAuth,
    root:ROOT,
    destination,
    safeReturn,
    loginUrl,
    syncHeader
  };
})();
