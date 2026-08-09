(()=>{
  const script=document.createElement('script');
  script.src='../_shared/game-page-v3-bootstrap.js?v=20260803-2';
  document.head.appendChild(script);
  const editions=document.createElement('script');
  editions.src='../_shared/game-editions.js?v=20260807-1';
  document.head.appendChild(editions);
  const mediaCategories=document.createElement('script');
  mediaCategories.src='../_shared/game-media-categories.js?v=20260808-1';
  document.head.appendChild(mediaCategories);
})();