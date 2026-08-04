(()=>{
  'use strict';

  const SESSION_LOCAL='igroAuthSessionV1';
  const SESSION_TAB='igroAuthSessionTabV1';
  const REGISTERED_USERS='igroRegisteredUsersV1';
  const USER_DATA_PREFIX='igroUserDataV1:';
  const ROOT=location.pathname.startsWith('/Igropoisk/')?'/Igropoisk/':'/';
  const SYSTEM_USERS={
    sangrar:{
      username:'Sangrar',
      displayName:'Sangrar',
      email:'',
      role:'admin',
      roleLabel:'Администратор',
      salt:'7nQYMcepoSVW1mpBKE7v9A==',
      hash:'Vg7EAwe7495CqBlumUqOFhj8MpsJDGJ2CheSLHsVLrA=',
      iterations:240000,
      createdAt:'2026-08-04T00:00:00.000Z',
      system:true
    }
  };

  const bytesFromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  const base64FromBytes=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
  const safeJson=(value,fallback=null)=>{try{return JSON.parse(value)||fallback}catch{return fallback}};
  const normalizeUsername=value=>String(value||'').trim().toLowerCase();
  const normalizeEmail=value=>String(value||'').trim().toLowerCase();
  const escapeHtml=value=>String(value||'').replace(/[&<>'"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  })[char]);

  function registeredUsers(){
    try{return safeJson(localStorage.getItem(REGISTERED_USERS),{})||{}}catch{return {}}
  }

  function saveRegisteredUsers(users){localStorage.setItem(REGISTERED_USERS,JSON.stringify(users))}
  function allUsers(){return {...registeredUsers(),...SYSTEM_USERS}}

  function findUser(identifier){
    const normalized=normalizeUsername(identifier);
    const email=normalizeEmail(identifier);
    return Object.values(allUsers()).find(user=>
      normalizeUsername(user.username)===normalized||Boolean(user.email&&normalizeEmail(user.email)===email)
    )||null;
  }

  function userKey(user){return normalizeUsername(user?.username)}

  function defaultUserData(user){
    return {
      username:user.username,
      createdAt:user.createdAt||new Date().toISOString(),
      library:{want:[],playing:[],completed:[],dropped:[],favorites:[]},
      ratings:{},
      lists:[],
      recent:[]
    };
  }

  function getUserData(userOrSession){
    const user=userOrSession?.user||userOrSession;
    if(!user)return null;
    const key=`${USER_DATA_PREFIX}${userKey(user)}`;
    try{
      const stored=safeJson(localStorage.getItem(key),null);
      return stored?{...defaultUserData(user),...stored}:defaultUserData(user);
    }catch{return defaultUserData(user)}
  }

  function saveUserData(userOrSession,data){
    const user=userOrSession?.user||userOrSession;
    if(!user)return null;
    const next={...defaultUserData(user),...(data||{}),username:user.username};
    localStorage.setItem(`${USER_DATA_PREFIX}${userKey(user)}`,JSON.stringify(next));
    return next;
  }

  function stats(userOrSession){
    const data=getUserData(userOrSession);
    if(!data)return {saved:0,rated:0,lists:0,playing:0,completed:0,want:0,favorites:0,dropped:0};
    const library=data.library||{};
    const unique=new Set(Object.values(library).flatMap(value=>Array.isArray(value)?value:[]));
    return {
      saved:unique.size,
      rated:Object.keys(data.ratings||{}).length,
      lists:Array.isArray(data.lists)?data.lists.length:0,
      playing:Array.isArray(library.playing)?library.playing.length:0,
      completed:Array.isArray(library.completed)?library.completed.length:0,
      want:Array.isArray(library.want)?library.want.length:0,
      favorites:Array.isArray(library.favorites)?library.favorites.length:0,
      dropped:Array.isArray(library.dropped)?library.dropped.length:0
    };
  }

  function readSession(){
    const now=Date.now();
    for(const storage of [sessionStorage,localStorage]){
      const storageKey=storage===localStorage?SESSION_LOCAL:SESSION_TAB;
      let session=null;
      try{session=safeJson(storage.getItem(storageKey))}catch{}
      if(!session)continue;
      const user=findUser(session.username);
      if(!user||Number(session.expiresAt)<=now){
        try{storage.removeItem(storageKey)}catch{}
        continue;
      }
      return {...session,user};
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
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({
      name:'PBKDF2',salt:bytesFromBase64(user.salt),iterations:user.iterations,hash:'SHA-256'
    },key,256);
    return base64FromBytes(bits);
  }

  function createSession(user,remember){
    const issuedAt=Date.now();
    const session={username:user.username,role:user.role,issuedAt,expiresAt:issuedAt+(remember?30*24*60*60*1000:12*60*60*1000)};
    clearSession();
    const storage=remember?localStorage:sessionStorage;
    storage.setItem(remember?SESSION_LOCAL:SESSION_TAB,JSON.stringify(session));
    const result={...session,user};
    window.dispatchEvent(new CustomEvent('igro-auth-change',{detail:result}));
    syncHeader();
    return result;
  }

  async function login(identifier,password,remember=false){
    const user=findUser(identifier);
    if(!user||!password)return {ok:false,error:'Неверное имя пользователя, email или пароль.'};
    try{
      const hash=await derive(password,user);
      if(hash!==user.hash)return {ok:false,error:'Неверное имя пользователя, email или пароль.'};
      return {ok:true,session:createSession(user,remember)};
    }catch(error){
      return {ok:false,error:error?.message==='secure_context_required'?'Вход доступен только через HTTPS.':'Не удалось выполнить вход. Обновите страницу и повторите.'};
    }
  }

  async function register(payload={}){
    const username=String(payload.username||'').trim();
    const displayName=String(payload.displayName||username).trim();
    const email=normalizeEmail(payload.email);
    const password=String(payload.password||'');
    const key=normalizeUsername(username);
    if(!/^[A-Za-zА-Яа-яЁё0-9_.-]{3,24}$/u.test(username))return {ok:false,error:'Имя пользователя: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание.'};
    if(!/^\S+@\S+\.\S+$/.test(email))return {ok:false,error:'Введите корректный email.'};
    if(password.length<8)return {ok:false,error:'Пароль должен содержать не меньше 8 символов.'};
    const users=allUsers();
    if(users[key])return {ok:false,error:'Такое имя пользователя уже занято.'};
    if(Object.values(users).some(user=>user.email&&normalizeEmail(user.email)===email))return {ok:false,error:'Аккаунт с таким email уже существует.'};
    try{
      const saltBytes=crypto.getRandomValues(new Uint8Array(16));
      const user={
        username,displayName:displayName||username,email,role:'user',roleLabel:'Пользователь',
        salt:base64FromBytes(saltBytes),hash:'',iterations:240000,createdAt:new Date().toISOString(),system:false
      };
      user.hash=await derive(password,user);
      const registered=registeredUsers();
      registered[key]=user;
      saveRegisteredUsers(registered);
      saveUserData(user,defaultUserData(user));
      return {ok:true,session:createSession(user,true)};
    }catch(error){
      return {ok:false,error:error?.message==='secure_context_required'?'Регистрация доступна только через HTTPS.':'Не удалось создать аккаунт. Повторите попытку.'};
    }
  }

  function destination(path){return `${ROOT}${String(path||'').replace(/^\/+/, '')}`}

  function safeReturn(value){
    if(!value)return destination('account/');
    try{
      const url=new URL(value,location.origin);
      if(url.origin!==location.origin||!url.pathname.startsWith(ROOT))return destination('account/');
      return `${url.pathname}${url.search}${url.hash}`;
    }catch{return destination('account/')}
  }

  function loginUrl(returnTo=location.href){return `${destination('login/')}?return=${encodeURIComponent(safeReturn(returnTo))}`}
  function registerUrl(returnTo=location.href){return `${destination('register/')}?return=${encodeURIComponent(safeReturn(returnTo))}`}

  function requireAuth(options={}){
    const session=readSession();
    if(!session){location.replace(loginUrl(options.returnTo||location.href));return null}
    if(options.role&&session.user.role!==options.role){location.replace(destination('account/'));return null}
    return session;
  }

  function accountMarkup(session){
    if(!session)return '<span class="account-action__avatar" aria-hidden="true">↗</span><span class="account-action__label">Войти</span>';
    const initial=escapeHtml(session.user.displayName.slice(0,1).toUpperCase());
    return `<span class="account-action__avatar" aria-hidden="true">${initial}</span><span class="account-action__label">${escapeHtml(session.user.displayName)}</span>`;
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
  const start=()=>{syncHeader();if(document.body)observer.observe(document.body,{childList:true,subtree:true})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('storage',syncHeader);

  window.IgropoiskAuth={
    login,register,logout:clearSession,session:readSession,requireAuth,getUserData,saveUserData,stats,
    root:ROOT,destination,safeReturn,loginUrl,registerUrl,syncHeader
  };
})();
