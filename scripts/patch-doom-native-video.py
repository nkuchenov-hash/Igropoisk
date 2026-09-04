from pathlib import Path

page = Path('preview/doom-dark-ages-alt/index.html')
text = page.read_text(encoding='utf-8')

old_iframe = '<iframe class="hero__video" id="heroVideo" title="DOOM: The Dark Ages — Official Launch Trailer" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe>'
new_video = '''<video class="hero__video" id="heroVideo" autoplay muted loop playsinline preload="auto" poster="/Igropoisk/assets/covers/popular/doom-the-dark-ages.jpg" aria-hidden="true">
<source src="https://video.fastly.steamstatic.com/store_trailers/3017860/1768853770/2b6ad8e1a92a17da1e2a2900aef053ae14e73074/1748584906/microtrailer.mp4" type="video/mp4">
</video>'''
if old_iframe not in text:
    raise SystemExit('Hero iframe marker not found')
text = text.replace(old_iframe, new_video, 1)

start = text.find("const VIDEO_ID='S7IEg0_qNXs';")
end = text.find("document.querySelectorAll('.tab').forEach", start)
if start < 0 or end < 0:
    raise SystemExit('Hero video script markers not found')

native_script = r'''const VIDEO_ID='S7IEg0_qNXs';
const hero=document.getElementById('hero');
const heroVideo=document.getElementById('heroVideo');
const pauseBg=document.getElementById('pauseBg');
let paused=false;
function hideHeroVideo(){hero.classList.remove('video-ready');}
function revealHeroVideo(){if(!paused)hero.classList.add('video-ready');}
async function playHero(){
  if(paused)return;
  heroVideo.muted=true;
  try{
    await heroVideo.play();
    if(heroVideo.readyState>=3)revealHeroVideo();
  }catch(error){hideHeroVideo();}
}
heroVideo.addEventListener('playing',revealHeroVideo);
heroVideo.addEventListener('canplay',()=>{if(!paused)playHero();});
heroVideo.addEventListener('waiting',hideHeroVideo);
heroVideo.addEventListener('stalled',hideHeroVideo);
heroVideo.addEventListener('error',hideHeroVideo);
window.addEventListener('pageshow',()=>{
  paused=false;
  pauseBg.textContent='Ⅱ';
  hideHeroVideo();
  try{heroVideo.currentTime=0;}catch(error){}
  playHero();
});
document.getElementById('restartBg').addEventListener('click',()=>{
  paused=false;
  pauseBg.textContent='Ⅱ';
  hideHeroVideo();
  try{heroVideo.currentTime=0;}catch(error){}
  playHero();
});
pauseBg.addEventListener('click',e=>{
  if(!paused){
    paused=true;
    heroVideo.pause();
    hideHeroVideo();
    e.currentTarget.textContent='▶';
  }else{
    paused=false;
    e.currentTarget.textContent='Ⅱ';
    playHero();
  }
});
'''
text = text[:start] + native_script + text[end:]

if 'youtube.com/iframe_api' in text:
    raise SystemExit('YouTube background API remained')
if '<video class="hero__video"' not in text:
    raise SystemExit('Native hero video was not installed')
if 'video.fastly.steamstatic.com/store_trailers/3017860/' not in text:
    raise SystemExit('Steam trailer URL missing')

page.write_text(text, encoding='utf-8')
print('Patched DOOM preview to native Steam background video.')
