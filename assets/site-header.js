(()=>{
  'use strict';

  const ROOT='/Igropoisk/';
  const HEADER_SELECTOR='.site-header,.game-header,.article-header,.ig-site-header';
  const items=[
    {id:'home',label:'Главное',href:`${ROOT}#home`},
    {id:'what-to-play',label:'Во что поиграть?',href:`${ROOT}#what-to-play`},
    {id:'search',label:'Поиск игр',href:`${ROOT}#search`},
    {id:'news',label:'Новости',href:`${ROOT}#news`}
  ];

  function escapeHTML(value){
    return String(value||'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }

  function currentSection(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(items.some(item=>item.id===hash))return hash;
    const path=location.pathname.toLowerCase();
    if(path.includes('/news/'))return 'news';
    if(path.includes('/game/'))return 'search';
    if(path.endsWith('/igropoisk/')||path.endsWith('/igropoisk/index.html')||path==='/')return 'home';
    return '';
  }

  function themeValue(){
    try{return localStorage.getItem('igroTheme')||document.documentElement.dataset.theme||'dark'}
    catch(error){return document.documentElement.dataset.theme||'dark'}
  }

  function applyTheme(value){
    const theme=value==='light'?'light':'dark';
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('igroTheme',theme)}catch(error){}
    document.querySelectorAll('[data-ig-theme-toggle]').forEach(button=>{
      const light=theme==='light';
      button.textContent=light?'☾':'☀';
      button.setAttribute('aria-label',light?'Включить тёмную тему':'Включить светлую тему');
      button.title=light?'Тёмная тема':'Светлая тема';
    });
  }

  function headerMarkup(context){
    const links=items.map(item=>`<a href="${item.href}" data-page="${item.id}">${item.label}</a>`).join('');
    const contextLink=context?.href?`<a class="ig-site-header__context" href="${escapeHTML(context.href)}">${escapeHTML(context.label||'К игре')}</a>`:'';
    return `<div class="ig-container ig-site-header__inner">
      <a class="ig-site-header__logo" href="${ROOT}#home" data-page="home" aria-label="Игропоиск — главное">ИГРОПОИСК</a>
      <nav class="ig-site-header__nav" aria-label="Основная навигация">${links}</nav>
      <div class="ig-site-header__actions">
        ${contextLink}
        <a class="ig-site-header__action" href="${ROOT}#search" data-page="search">Поиск</a>
        <button class="ig-site-header__theme" type="button" data-ig-theme-toggle aria-label="Переключить тему"></button>
        <button class="ig-site-header__menu-button" type="button" data-ig-menu-toggle aria-expanded="false">Меню</button>
      </div>
    </div>`;
  }

  function normalize(header){
    if(!(header instanceof HTMLElement)||header.dataset.igSharedHeader==='true')return;
    const oldContext=header.querySelector('.article-nav__game');
    const context=oldContext?{href:oldContext.getAttribute('href')||'',label:oldContext.textContent.trim()}:null;
    header.dataset.igSharedHeader='true';
    header.classList.add('ig-site-header');
    header.innerHTML=headerMarkup(context);
    applyTheme(themeValue());
    updateActive();
  }

  function scan(root=document){
    if(root instanceof HTMLElement&&root.matches(HEADER_SELECTOR))normalize(root);
    root.querySelectorAll?.(HEADER_SELECTOR).forEach(normalize);
  }

  function activatePage(id,updateHistory=true){
    const target=document.getElementById(id);
    if(!target||!target.classList.contains('page'))return false;
    document.querySelectorAll('main.page').forEach(page=>page.classList.toggle('active',page===target));
    if(updateHistory){
      const url=new URL(location.href);
      url.hash=id;
      history.replaceState(null,'',url);
    }
    window.scrollTo({top:0,behavior:'auto'});
    updateActive(id);
    return true;
  }

  function updateActive(forced){
    const active=forced||document.querySelector('main.page.active')?.id||currentSection();
    document.querySelectorAll('.ig-site-header__nav a[data-page],.ig-site-header__logo[data-page]').forEach(link=>{
      const selected=link.dataset.page===active;
      link.classList.toggle('is-active',selected&&link.classList.contains('ig-site-header__nav')===false);
      if(link.closest('.ig-site-header__nav')){
        link.classList.toggle('is-active',selected);
        if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      }
    });
  }

  document.addEventListener('click',event=>{
    const menuButton=event.target.closest('[data-ig-menu-toggle]');
    if(menuButton){
      const header=menuButton.closest(HEADER_SELECTOR);
      const open=!header.classList.contains('is-menu-open');
      document.querySelectorAll(`${HEADER_SELECTOR}.is-menu-open`).forEach(node=>node.classList.remove('is-menu-open'));
      header.classList.toggle('is-menu-open',open);
      menuButton.setAttribute('aria-expanded',String(open));
      return;
    }

    const themeButton=event.target.closest('[data-ig-theme-toggle]');
    if(themeButton){
      applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
      return;
    }

    const link=event.target.closest('.ig-site-header [data-page]');
    if(link){
      const id=link.dataset.page;
      if(activatePage(id,true))event.preventDefault();
      link.closest(HEADER_SELECTOR)?.classList.remove('is-menu-open');
      return;
    }

    if(!event.target.closest(HEADER_SELECTOR)){
      document.querySelectorAll(`${HEADER_SELECTOR}.is-menu-open`).forEach(node=>{
        node.classList.remove('is-menu-open');
        node.querySelector('[data-ig-menu-toggle]')?.setAttribute('aria-expanded','false');
      });
    }

    if(event.target.closest('[data-page]'))setTimeout(updateActive,0);
  });

  window.addEventListener('hashchange',()=>{
    const id=decodeURIComponent(location.hash.slice(1));
    if(!activatePage(id,false))updateActive();
  });

  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      mutation.addedNodes.forEach(node=>{if(node instanceof HTMLElement)scan(node)});
    }
    updateActive();
  });

  observer.observe(document.documentElement,{subtree:true,childList:true});
  scan();
  applyTheme(themeValue());
  const initial=decodeURIComponent(location.hash.slice(1));
  if(initial)activatePage(initial,false);else updateActive();
})();
