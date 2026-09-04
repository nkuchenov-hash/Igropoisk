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
  ],
  [
    "roles:[...new Set([...(old.roles||[]),...(raw.roles||[])])],semantic:",
    "roles:[...new Set([...(old.roles||[]),...(raw.roles||[]),...[raw.role,raw.type].map(r=>({structured_fact_source:'facts',professional_review:'review',official_source:'facts',store_source:'description'}[String(r||'')]||String(r||'')).trim()).filter(Boolean)])],semantic:"
  ]
];
let changed=0;
for(const [from,to] of replacements){
  if(text.includes(from)){text=text.replace(from,to);changed++;}
  else if(!text.includes(to)) throw new Error(`Expected game-knowledge definition not found: ${from.slice(0,90)}…`);
}
if(changed)fs.writeFileSync(file,text,'utf8');

const packFile='scripts/build-editorial-benchmark-pack.mjs';
let packText=fs.readFileSync(packFile,'utf8');
const packReplacements=[
  [
    "const readable=prioritized.slice(0,8).map(s=>({id:s.id,name:s.name,title:s.title,url:s.url,resolved_url:s.resolved_url,kind:s.kind,professional:Boolean(s.professional),roles:s.roles||[],evidence:(s.evidence||[]).slice(0,4),text:String(s.text||'').slice(0,1200)}));",
    "const readable=prioritized.slice(0,6).map(s=>({id:s.id,name:s.name,title:s.title,kind:s.kind,professional:Boolean(s.professional),roles:s.roles||[],evidence:(s.evidence||[]).slice(0,3),text:String(s.text||'').slice(0,650)}));"
  ],
  [
    "const accepted=(matrix.accepted||reviews.reviews||[]).map(s=>({id:s.id,publication:s.publication,title:s.title,url:s.resolved_url||s.url,source_kind:s.source_kind,score:s.score,scale:s.scale,grade:s.grade,matched_identity_alias:s.matched_identity_alias,identity_evidence:s.identity_evidence,validation:s.validation}));",
    "const accepted=(matrix.accepted||reviews.reviews||[]).slice(0,12).map(s=>({id:s.id,publication:s.publication||s.source,title:s.title||'',source_kind:s.source_kind,score:s.score,scale:s.scale,grade:s.grade}));"
  ],
  [
    "audience_profile:audienceProfile||{},audience_evidence:{descriptors:audienceEvidence?.descriptors||{},review_signals:audienceEvidence?.review_signals||[],explicit_age_rating:audienceEvidence?.explicit_age_rating||null,content_descriptors:audienceEvidence?.content_descriptors||[]},professional_review_corpus:accepted,readable_source_material:readable,ratings:{status:ratings?.status||null,calculation:ratings?.calculation||null,sources:(ratings?.sources||[]).slice(0,30)}};",
    "audience_profile:{confidence:audienceProfile?.confidence||'low',tone:audienceProfile?.tone||audienceProfile?.editorial_tone||null,style:audienceProfile?.style||audienceProfile?.writing_style||null,guidance:audienceProfile?.guidance||audienceProfile?.writing_guidance||null},audience_evidence:{descriptors:audienceEvidence?.descriptors||{},review_signals:(audienceEvidence?.review_signals||[]).slice(0,4),explicit_age_rating:audienceEvidence?.explicit_age_rating||null,content_descriptors:(audienceEvidence?.content_descriptors||[]).slice(0,8)},professional_review_corpus:accepted,readable_source_material:readable,ratings:{status:ratings?.status||null,calculation:ratings?.calculation||null,sources:(ratings?.sources||[]).slice(0,12).map(s=>({publication:s.publication||s.source,score:s.score,scale:s.scale,grade:s.grade}))}};"
  ]
];
let packChanged=0;
for(const [from,to] of packReplacements){
  if(packText.includes(from)){packText=packText.replace(from,to);packChanged++;}
  else if(!packText.includes(to)) throw new Error(`Expected benchmark pack definition not found: ${from.slice(0,100)}…`);
}
if(packChanged)fs.writeFileSync(packFile,packText,'utf8');
console.log(JSON.stringify({file,changed,vocabulary:'genre-neutral-v1',role_compatibility:'role-and-roles-v1',pack_file:packFile,pack_changed:packChanged,free_tier_payload:'compact-v1'},null,2));
