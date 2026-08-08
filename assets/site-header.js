(()=>{
  'use strict';

  const ROOT='/Igropoisk/';
  const HEADER_SELECTOR='.site-header,.game-header,.article-header,.ig-site-header';
  const pages=['home','what-to-play','search','news'];

  function mainHeaderMarkup(){
    return `<div class="ig-container site-header__inner">
      <button class="site-logo" data-page="home" aria-label="Игропоиск — главное">ИГРОПОИСК</button>
      <nav class="site-nav" aria-label="Основная навигация">
        <button data-page="home">Главное</button>
        <button data-page="what-to-play">Во что поиграть?</button>
        <button data-page="search">Поиск игр</button>
        <a href="${ROOT}top-250/" data-top250-nav>Топ-250</a>
        <a class="release-nav-link" href="${ROOT}calendar/" data-ig-release-nav>Календарь релизов</a>
        <button data-page="news">Новости</button>
      </nav>
      <div class="site-actions">
        <button class="ig-button icon-button search-action" data-page="search" aria-label="Открыть поиск">⌕</button>
        <button class="ig-button icon-button" id="theme" type="button" aria-label="Переключить тему">☀</button>
      </div>
    </div>`;
  }

  function isNativeMainHeader(header){
    return header.classList.contains('site-header')
      && header.querySelector(':scope > .site-header__inner')
      && header.querySelector('.site-logo')
      && header.querySelector('.site-nav')
      && header.querySelector('.site-actions');
  }

  function ensureTop250Link(header){
    const nav=header.querySelector('.site-nav');
    if(!nav||nav.querySelector('[data-top250-nav]'))return;
    const link=document.createElement('a');
    link.href=`${ROOT}top-250/`;
    link.dataset.top250Nav='';
    link.textContent='Топ-250';
    const release=nav.querySelector('[data-ig-release-nav]');
    nav.insertBefore(link,release||nav.querySelector('[data-page="news"]')||null);
  }

  function currentSection(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(pages.includes(hash))return hash;
    const path=location.pathname.toLowerCase();
    if(path.includes('/top-250/'))return 'top-250';
    if(path.includes('/calendar/'))return 'calendar';
    if(path.includes('/news/'))return 'news';
    if(path.includes('/game/')||path.includes('/article/'))return 'search';
    return 'home';
  }

  function storedTheme(){
    try{return localStorage.getItem('igroTheme')||document.documentElement.dataset.theme||'dark'}
    catch(error){return document.documentElement.dataset.theme||'dark'}
  }

  function paintGeneratedTheme(){
    const light=document.documentElement.dataset.theme==='light';
    document.querySelectorAll('.site-header[data-ig-shared-header="generated"] #theme').forEach(button=>{
      button.textContent=light?'☾':'☀';
      button.setAttribute('aria-label',light?'Включить тёмную тему':'Включить светлую тему');
    });
  }

  function setTheme(theme){
    const value=theme==='light'?'light':'dark';
    document.documentElement.dataset.theme=value;
    try{localStorage.setItem('igroTheme',value)}catch(error){}
    paintGeneratedTheme();
  }

  function updateGeneratedActive(forced){
    const active=forced||currentSection();
    document.querySelectorAll('.site-header[data-ig-shared-header="generated"] .site-nav [data-page]').forEach(button=>{
      button.classList.toggle('active',button.dataset.page===active);
    });
    document.querySelectorAll('.site-header[data-ig-shared-header="generated"] [data-ig-release-nav]').forEach(link=>{
      const selected=active==='calendar';
      link.classList.toggle('active',selected);
      if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    document.querySelectorAll('.site-header[data-ig-shared-header="generated"] [data-top250-nav]').forEach(link=>{
      const selected=active==='top-250';
      link.classList.toggle('active',selected);
      if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
  }

  function freshNode(node){
    if(!node)return null;
    const clone=node.cloneNode(true);
    node.replaceWith(clone);
    return clone;
  }

  function ensureMobileMenu(header){
    if(!(header instanceof HTMLElement))return;
    const inner=header.querySelector(':scope > .site-header__inner');
    const desktopNav=header.querySelector(':scope > .site-header__inner > .site-nav');
    const actions=header.querySelector(':scope > .site-header__inner > .site-actions');
    if(!inner||!desktopNav||!actions)return;

    let toggle=header.querySelector('.mobile-menu-toggle[data-ig-mobile-menu-toggle]');
    header.querySelectorAll('.mobile-menu-toggle').forEach(node=>{if(node!==toggle)node.remove()});
    let menu=header.querySelector('.mobile-menu[data-ig-mobile-menu]');
    header.querySelectorAll('.mobile-menu').forEach(node=>{if(node!==menu)node.remove()});

    if(toggle&&menu)return;

    toggle=freshNode(toggle||header.querySelector('.mobile-menu-toggle'))||document.createElement('button');
    if(toggle.parentElement!==inner)inner.insertBefore(toggle,actions);
    toggle.className='ig-button icon-button mobile-menu-toggle';
    toggle.type='button';
    toggle.dataset.igMobileMenuToggle='';
    toggle.setAttribute('aria-label','Открыть меню');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-controls','mobileMenu');
    toggle.innerHTML='<span></span><span></span><span></span>';

    menu=freshNode(menu||header.querySelector('.mobile-menu'))||document.createElement('div');
    if(menu.parentElement!==header)header.appendChild(menu);
    menu.className='mobile-menu';
    menu.id='mobileMenu';
    menu.dataset.igMobileMenu='';
    menu.hidden=true;

    const sync=()=>{
      const theme=actions.querySelector('#theme');
      const account=actions.querySelector('[data-auth-link]');
      const themeLabel=document.documentElement.dataset.theme==='light'?'Включить тёмную тему':'Включить светлую тему';
      menu.innerHTML=`<nav aria-label="Мобильная навигация">${desktopNav.innerHTML}</nav><div class="mobile-menu__actions"><button type="button" class="mobile-menu__action" data-mobile-theme>${themeLabel}</button></div>`;
      if(account){
        const clone=account.cloneNode(true);
        clone.classList.add('mobile-menu__action','mobile-menu__account');
        menu.querySelector('.mobile-menu__actions')?.appendChild(clone);
      }
      if(theme)menu.querySelector('[data-mobile-theme]')?.setAttribute('aria-label',themeLabel);
    };
    const setOpen=open=>{
      if(open)sync();
      menu.hidden=!open;
      toggle.classList.toggle('open',open);
      toggle.setAttribute('aria-expanded',String(open));
      toggle.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
      document.body.classList.toggle('mobile-menu-open',open);
    };

    sync();
    toggle.addEventListener('click',()=>setOpen(menu.hidden));
    menu.addEventListener('click',event=>{
      const themeAction=event.target.closest('[data-mobile-theme]');
      if(themeAction){
        event.preventDefault();
        actions.querySelector('#theme')?.click();
        setOpen(false);
        return;
      }
      const pageButton=event.target.closest('[data-page]');
      if(pageButton){
        event.preventDefault();
        event.stopPropagation();
        const page=pageButton.dataset.page;
        const original=desktopNav.querySelector(`[data-page="${CSS.escape(page)}"]`);
        setOpen(false);
        original?.click();
        return;
      }
      if(event.target.closest('a'))setOpen(false);
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false)});
    window.addEventListener('resize',()=>{if(window.innerWidth>760)setOpen(false)},{passive:true});
  }

  function normalize(header){
    if(!(header instanceof HTMLElement))return;
    if(header.dataset.igSharedHeader){
      ensureTop250Link(header);
      ensureMobileMenu(header);
      return;
    }

    if(isNativeMainHeader(header)){
      ensureTop250Link(header);
      header.dataset.igSharedHeader='native';
      ensureMobileMenu(header);
      return;
    }

    header.className='site-header';
    header.dataset.igSharedHeader='generated';
    header.innerHTML=mainHeaderMarkup();
    setTheme(storedTheme());
    updateGeneratedActive();
    ensureMobileMenu(header);
  }

  function scan(root=document){
    if(root instanceof HTMLElement&&root.matches(HEADER_SELECTOR))normalize(root);
    root.querySelectorAll?.(HEADER_SELECTOR).forEach(normalize);
  }

  function ensureHeader(){
    if(!document.body||document.querySelector(HEADER_SELECTOR))return;
    const header=document.createElement('header');
    header.className='ig-site-header';
    document.body.prepend(header);
    normalize(header);
  }

  function activateLocalPage(id){
    const target=document.getElementById(id);
    if(!target||!target.classList.contains('page'))return false;
    document.querySelectorAll('main.page').forEach(page=>page.classList.toggle('active',page===target));
    history.replaceState(null,'',`#${id}`);
    window.scrollTo({top:0,behavior:'auto'});
    updateGeneratedActive(id);
    return true;
  }

  function ensureAuthScript(){
    if(document.querySelector('script[src*="assets/auth.js"]'))return;
    const script=document.createElement('script');
    script.src=`${ROOT}assets/auth.js?v=20260804-6`;
    script.dataset.igAuth='';
    document.head.appendChild(script);
  }

  function ensureHomeTop250Module(){
    if(!document.querySelector('#home .hero')||document.querySelector('script[data-top250-home-module]'))return;
    const script=document.createElement('script');
    script.src=`${ROOT}assets/top250-home.js?v=20260808-1`;
    script.dataset.top250HomeModule='';
    document.body.appendChild(script);
  }

  document.addEventListener('click',event=>{
    const header=event.target.closest('.site-header[data-ig-shared-header="generated"]');
    if(!header)return;

    const pageButton=event.target.closest('[data-page]');
    if(pageButton){
      const id=pageButton.dataset.page;
      if(!activateLocalPage(id))location.href=`${ROOT}#${id}`;
      return;
    }

    const themeButton=event.target.closest('#theme');
    if(themeButton){
      if(typeof themeButton.onclick==='function'){
        setTimeout(paintGeneratedTheme,0);
      }else{
        setTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
      }
    }
  });

  window.addEventListener('hashchange',()=>updateGeneratedActive());

  let queued=false;
  function queueScan(){
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      scan();
      ensureHeader();
      ensureHomeTop250Module();
      updateGeneratedActive();
    });
  }

  new MutationObserver(queueScan).observe(document.documentElement,{subtree:true,childList:true});
  scan();
  ensureHeader();
  ensureAuthScript();
  ensureHomeTop250Module();
  document.documentElement.dataset.theme=storedTheme();
  paintGeneratedTheme();
  updateGeneratedActive();
})();
