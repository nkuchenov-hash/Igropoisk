#!/usr/bin/env node
import fs from 'node:fs';

const file='scripts/build-game-page.mjs';
let text=fs.readFileSync(file,'utf8');
const replacements=[
  ["- short_description: ровно 2 русских предложения, 100–240 символов; сразу объясни центральную идею игры и путь игрока;", "- short_description: 100–320 символов; сразу объясни центральную идею игры и путь игрока; количество предложений не фиксировано — используй столько коротких фраз, сколько нужно для лёгкого чтения; обычно 2–4, но не склеивай мысли ради формального числа;"],
  ["short_description:bound(sanitizeRussianText(merged.short_description),80,270)", "short_description:bound(sanitizeRussianText(merged.short_description),80,340)"],
  ["if(c.short_description.length<90||splitSentences(c.short_description).length<2)failed.add('short_description');", "if(c.short_description.length<90||c.short_description.length>340)failed.add('short_description');"],
  ["short_description: два естественных русских предложения минимум 90 символов", "short_description: компактный естественный русский текст 100–320 символов; количество предложений свободное, приоритет — короткие читаемые фразы"]
];
let changed=0;
for(const [from,to] of replacements){
  if(!text.includes(from)) throw new Error(`Expected contract fragment not found: ${from}`);
  text=text.replace(from,to);changed++;
}
fs.writeFileSync(file,text);
console.log(JSON.stringify({file,changed,policy:'100-320 chars; sentence count free; readability first'},null,2));
