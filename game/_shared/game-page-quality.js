(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';if(!slug)return;
const fetchJSON=async u=>{try{const r=await fetch(u,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};const waitFor=async s=>{for(let i=0;i<120;i++){const n=document.querySelector(s);if(n)return n;await new Promise(r=>setTimeout(r,100))}return null};
function simplifyRating(){const note=document.querySelector('#editorialNote');if(note)note.remove();document.querySelector('.rating-method-details')?.remove()}
function removeBlueBackgrounds(){document.querySelectorAll('img[src*="storepagebackground/app/"]').forEach(img=>img.closest('article,button,figure,.ig-media-card')?.remove());document.querySelectorAll('[style*="storepagebackground/app/"]').forEach(node=>node.style.backgroundImage='none')}
async function main(){await waitFor('#gameTitle');simplifyRating();removeBlueBackgrounds();setTimeout(simplifyRating,600);setTimeout(removeBlueBackgrounds,1000)}main().catch(e=>console.warn('Игропоиск: quality layer',e));
})();
