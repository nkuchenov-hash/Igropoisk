from pathlib import Path
import re

p = Path('preview/doom-dark-ages-alt/index.html')
s = p.read_text(encoding='utf-8')

start = s.index("const VIDEO_ID='S7IEg0_qNXs';")
end = s.index("document.querySelectorAll('.tab')", start)

new = r"""const VIDEO_ID='S7IEg0_qNXs';
const hero=document.getElementById('hero');
const heroVideo=document.getElementById('heroVideo');
let paused=false;
let heroPlayer=null;
let heroPlayerReady=false;
let heroLoopWatch=null;
function videoSrc(){return `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&controls=0&loop=1&playlist=${VIDEO_ID}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1`;}
function clearHeroWatch(){if(heroLoopWatch){clearInterval(heroLoopWatch);heroLoopWatch=null;}}
function hardRestartHero(){
  if(paused)return;
  heroPlayerReady=false;
  heroPlayer=null;
  clearHeroWatch();
  hero.classList.remove('video-ready');
  heroVideo.onload=()=>hero.classList.add('video-ready');
  heroVideo.src='about:blank';
  setTimeout(()=>{if(!paused){heroVideo.src=videoSrc();attachHeroPlayer();}},80);
}
function loopHeroNow(){
  if(paused)return;
  try{
    if(heroPlayer&&heroPlayerReady){heroPlayer.seekTo(0,true);heroPlayer.mute();heroPlayer.playVideo();return;}
  }catch(error){}
  hardRestartHero();
}
function startHeroWatch(){
  clearHeroWatch();
  heroLoopWatch=setInterval(()=>{
    if(paused||!heroPlayer||!heroPlayerReady)return;
    try{
      const duration=Number(heroPlayer.getDuration())||0;
      const current=Number(heroPlayer.getCurrentTime())||0;
      const state=heroPlayer.getPlayerState();
      if(state===0){loopHeroNow();return;}
      if(duration>5&&current>=duration-1.25){loopHeroNow();}
    }catch(error){}
  },500);
}
function attachHeroPlayer(){
  if(!window.YT||!YT.Player){setTimeout(attachHeroPlayer,120);return;}
  try{
    heroPlayer=new YT.Player('heroVideo',{
      events:{
        onReady:event=>{heroPlayerReady=true;event.target.mute();event.target.playVideo();hero.classList.add('video-ready');startHeroWatch();},
        onStateChange:event=>{if(event.data===YT.PlayerState.ENDED)loopHeroNow();},
        onError:()=>{hero.classList.remove('video-ready');setTimeout(hardRestartHero,1200);}
      }
    });
  }catch(error){setTimeout(attachHeroPlayer,250);}
}
function startHero(){paused=false;document.getElementById('pauseBg').textContent='Ⅱ';hardRestartHero();}
window.onYouTubeIframeAPIReady=()=>{if(heroVideo.src&&heroVideo.src!=='about:blank')attachHeroPlayer();};
if(!document.querySelector('script[data-youtube-iframe-api]')){
  const api=document.createElement('script');
  api.src='https://www.youtube.com/iframe_api';
  api.dataset.youtubeIframeApi='';
  document.head.appendChild(api);
}
window.addEventListener('pageshow',startHero);
document.getElementById('restartBg').addEventListener('click',startHero);
document.getElementById('pauseBg').addEventListener('click',e=>{
  if(!paused){
    paused=true;
    clearHeroWatch();
    try{heroPlayer?.pauseVideo();}catch(error){}
    hero.classList.remove('video-ready');
    e.currentTarget.textContent='▶';
  }else{
    paused=false;
    e.currentTarget.textContent='Ⅱ';
    try{
      if(heroPlayer&&heroPlayerReady){heroPlayer.mute();heroPlayer.playVideo();hero.classList.add('video-ready');startHeroWatch();}
      else{hardRestartHero();}
    }catch(error){hardRestartHero();}
  }
});
"""

s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('patched', p)
