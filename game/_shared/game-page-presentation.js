(()=>{
'use strict';
const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
const overrides={
  'arx-fatalis':{
    meta:'2002 · RPG · Immersive sim · Фэнтези',
    pitch:'Мрачная подземная RPG от Arkane: магию здесь рисуют мышью, задачи решают несколькими способами, а мир реагирует на эксперименты игрока.',
    description:'Солнце погасло, и люди Аркса ушли под землю — в огромный многоуровневый мир, где рядом живут люди, гоблины, тролли и куда менее дружелюбные существа. Arx Fatalis не ведёт игрока за руку: здесь можно подслушивать разговоры, готовить еду, комбинировать предметы, искать обходные пути и буквально рисовать мышью руны заклинаний. Именно эта свобода — ранний почерк Arkane, из которого позже выросли Dark Messiah, Dishonored и Prey. Игра старая и местами шероховатая, но её подземелья до сих пор ощущаются не декорацией, а местом, которое хочется изучать и проверять на прочность.',
    genres:['RPG','Immersive sim','Фэнтези'],
    developer:'Arkane Studios',publishers:'JoWooD Productions, DreamCatcher Interactive'
  }
};
const data=overrides[slug];if(!data)return;
function apply(){
  const title=document.querySelector('#gameTitle');if(!title?.textContent?.trim())return false;
  const meta=document.querySelector('#gameMeta');if(meta)meta.textContent=data.meta;
  const copy=document.querySelector('.hero-copy');if(copy&&!copy.querySelector('.hero-pitch')){const p=document.createElement('p');p.className='hero-pitch';p.textContent=data.pitch;meta?.after(p)}
  const description=document.querySelector('#description');if(description)description.textContent=data.description;
  const tags=document.querySelector('#genreTags');if(tags)tags.innerHTML=data.genres.map(value=>`<span class="game-chip">${value}</span>`).join('');
  const details=document.querySelector('#details');if(details)details.innerHTML=`<dt>Дата выхода</dt><dd>2002</dd><dt>Разработчик</dt><dd>${data.developer}</dd><dt>Издатель</dt><dd>${data.publishers}</dd><dt>Жанры</dt><dd>${data.genres.join(', ')}</dd>`;
  const note=document.querySelector('#editorialNote');if(note)note.remove();
  return true;
}
(async()=>{for(let i=0;i<80;i++){if(apply())break;await new Promise(r=>setTimeout(r,100))}setTimeout(apply,700);setTimeout(apply,1800)})();
})();
