(()=>{
'use strict';

const root=document.documentElement;
const header=document.querySelector('.site-header');
const inner=document.querySelector('.site-header__inner');
const desktopNav=document.querySelector('.site-nav');
const actions=document.querySelector('.site-actions');
if(!header||!inner||!desktopNav||!actions)return;

const safeStorage={
  get(key){try{return window.localStorage.getItem(key)}catch{return null}},
  set(key,value){try{window.localStorage.setItem(key,value)}catch{}}
};

const themeButton=document.querySelector('#theme');
if(themeButton){
  const cleanButton=themeButton.cloneNode(true);
  themeButton.replaceWith(cleanButton);
  const preferred=safeStorage.get('igroTheme');
  const initial=preferred==='light'||preferred==='dark'
    ?preferred
    :(window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark');
  const applyTheme=theme=>{
    root.dataset.theme=theme;
    cleanButton.textContent=theme==='light'?'☾':'☀';
    cleanButton.setAttribute('aria-label',theme==='light'?'Включить тёмную тему':'Включить светлую тему');
    cleanButton.setAttribute('aria-pressed',String(theme==='light'));
  };
  applyTheme(initial);
  cleanButton.addEventListener('click',()=>{
    const next=root.dataset.theme==='light'?'dark':'light';
    applyTheme(next);
    safeStorage.set('igroTheme',next);
  });
}

const menuButton=document.createElement('button');
menuButton.className='ig-button icon-button mobile-menu-toggle';
menuButton.type='button';
menuButton.setAttribute('aria-label','Открыть меню');
menuButton.setAttribute('aria-expanded','false');
menuButton.setAttribute('aria-controls','mobileMenu');
menuButton.innerHTML='<span></span><span></span><span></span>';
inner.insertBefore(menuButton,actions);

const mobileMenu=document.createElement('div');
mobileMenu.className='mobile-menu';
mobileMenu.id='mobileMenu';
mobileMenu.hidden=true;
mobileMenu.innerHTML=`<nav aria-label="Мобильная навигация">${desktopNav.innerHTML}</nav>`;
header.appendChild(mobileMenu);

const setOpen=open=>{
  mobileMenu.hidden=!open;
  menuButton.classList.toggle('open',open);
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
  document.body.classList.toggle('mobile-menu-open',open);
};

menuButton.addEventListener('click',()=>setOpen(mobileMenu.hidden));
mobileMenu.addEventListener('click',event=>{
  const button=event.target.closest('[data-page]');
  if(!button)return;
  const page=button.dataset.page;
  const original=desktopNav.querySelector(`[data-page="${CSS.escape(page)}"]`);
  original?.click();
  setOpen(false);
});

document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false)});
window.addEventListener('resize',()=>{if(window.innerWidth>760)setOpen(false)},{passive:true});

const syncActive=()=>{
  const active=desktopNav.querySelector('[data-page].active')?.dataset.page;
  mobileMenu.querySelectorAll('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===active));
};
desktopNav.addEventListener('click',()=>queueMicrotask(syncActive));
syncActive();

const style=document.createElement('style');
style.textContent=`
.mobile-menu-toggle{display:none;margin-left:auto;position:relative;gap:4px;align-content:center}
.mobile-menu-toggle span{display:block;width:18px;height:2px;background:currentColor;border-radius:2px;transition:transform 160ms ease,opacity 160ms ease}
.mobile-menu-toggle.open span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.mobile-menu-toggle.open span:nth-child(2){opacity:0}
.mobile-menu-toggle.open span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.mobile-menu{position:absolute;left:0;right:0;top:100%;border-bottom:1px solid var(--ig-line);background:var(--ig-header);backdrop-filter:blur(18px);box-shadow:var(--ig-shadow)}
.mobile-menu nav{display:grid;padding:10px var(--ig-gutter) 16px}
.mobile-menu button{position:relative;width:100%;border:0;border-bottom:1px solid var(--ig-line);background:transparent;color:var(--ig-text);padding:15px 2px;text-align:left;font-weight:700}
.mobile-menu button:last-child{border-bottom:0}
.mobile-menu button.active{color:var(--ig-rating)}
@media(max-width:760px){
  .site-header__inner{gap:10px}
  .mobile-menu-toggle{display:grid}
  .site-actions{margin-left:0}
  .site-logo{font-size:21px}
  body.mobile-menu-open{overflow:hidden}
}
`;
document.head.appendChild(style);
})();
