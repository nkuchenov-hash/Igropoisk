#!/usr/bin/env node
import fs from 'node:fs';

const file='scripts/build-game-source-knowledge.mjs';
let text=fs.readFileSync(file,'utf8');
const replacements=[
  [
    "const action=/\\b(?:player|players|you|your|gameplay|play|control|create|build|craft|explor|combat|fight|manage|custom|editor|design|collect|choose|move|attack|charm|survive|игрок|игров|управ|созда|стро|исслед|бой|сраж|редактор|собира|выбира|атак|выжив)\\w*/i;",
    "const action=/\\b(?:player|players|you|your|gameplay|play|control|create|build|craft|explor|combat|fight|manage|custom|editor|design|collect|choose|move|attack|charm|survive|interact|inspect|examine|talk|speak|dialog|conversation|use|combine|solve|investigat|search|drive|shoot|stealth|sneak|command|select|navigate|trade|quest|игрок|игров|управ|созда|стро|исслед|бой|сраж|редактор|собира|выбира|атак|выжив|взаимод|осматр|изуча|говор|диалог|использ|комбинир|реша|головолом|расслед|искать|поиск|водить|стрел|скрыт|краст|команд|выбира|навигац|торгов|задан)\\w*/i;"
  ],
  [
    "const progression=/\\b(?:object of the game|goal|objective|start(?:s|ing)? with|from .+ to|progress|stage|phase|level|evol|advance|develop|cell|creature|tribe|civilization|spacefar|interstellar|начина|цель|развит|этап|фаз|уров|эволюц|клет|существ|плем|цивилизац|космос|межзв)\\w*/i;",
    "const progression=/\\b(?:object of the game|goal|objective|start(?:s|ing)? with|from .+ to|progress|stage|phase|level|evol|advance|develop|cell|creature|tribe|civilization|spacefar|interstellar|chapter|mission|case|episode|act|quest|story|plot|investigation|mystery|campaign|assignment|начина|цель|развит|этап|фаз|уров|эволюц|клет|существ|плем|цивилизац|космос|межзв|глав|мисси|дело|эпизод|акт|квест|сюжет|истори|расслед|тайн|кампан|задан)\\w*/i;"
  ],
  [
    "const world=/\\b(?:world|universe|planet|galaxy|species|city|base|starship|мир|вселен|планет|галак|вид|город|баз|корабл)\\w*/i;",
    "const world=/\\b(?:world|universe|planet|galaxy|species|city|base|starship|location|area|room|house|mansion|island|street|district|station|ship|castle|town|village|space|мир|вселен|планет|галак|вид|город|баз|корабл|локац|мест|комнат|дом|особняк|остров|улиц|район|станц|замок|городок|деревн|космос)\\w*/i;"
  ],
  [
    "const mechanics=/\\b(?:editor|create|build|custom|body part|vehicle|building|creature|combat|attack|charm|collect|resource|редактор|созда|стро|част.*тел|транспорт|здан|существ|бой|атак|собира|ресурс)\\w*/i;",
    "const mechanics=/\\b(?:editor|create|build|custom|body part|vehicle|building|creature|combat|attack|charm|collect|resource|puzzle|inventory|item|object|dialog|conversation|choice|decision|point[- ]and[- ]click|interface|camera|weapon|shoot|stealth|driving|vehicle|squad|party|ability|skill|cover|exploration|investigation|clue|quest|редактор|созда|стро|част.*тел|транспорт|здан|существ|бой|атак|собира|ресурс|головолом|инвентар|предмет|объект|диалог|разговор|выбор|решен|интерфейс|камер|оруж|стрел|скрыт|вожд|отряд|групп|способност|навык|укрыт|исслед|расслед|улик|квест)\\w*/i;"
  ]
];
let changed=0;
for(const [from,to] of replacements){
  if(text.includes(from)){text=text.replace(from,to);changed++;}
  else if(!text.includes(to)) throw new Error(`Expected vocabulary definition not found: ${from.slice(0,70)}…`);
}
if(changed)fs.writeFileSync(file,text,'utf8');
console.log(JSON.stringify({file,changed,vocabulary:'genre-neutral-v1'},null,2));
