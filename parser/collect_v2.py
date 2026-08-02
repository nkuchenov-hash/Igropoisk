#!/usr/bin/env python3
from __future__ import annotations

import argparse, hashlib, html, json, re, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import requests
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from source_registry import REGISTRY

ROOT = Path(__file__).resolve().parents[1]
S = requests.Session()
S.headers.update({"User-Agent":"Mozilla/5.0 IgropoiskBot/2.0","Accept-Language":"en-US,en;q=.8,ru;q=.7"})
TIMEOUT=25

def now(): return datetime.now(timezone.utc).isoformat()
def slugify(s): return re.sub(r"[^a-z0-9]+","-",s.lower()).strip("-")
def clean(s): return re.sub(r"\s+"," ",BeautifulSoup(html.unescape(s or ""),"html.parser").get_text(" ")).strip()
def host(u): return urlparse(u).netloc.lower().removeprefix("www.")
def fp(u): return hashlib.sha256(u.encode()).hexdigest()[:16]

def get_json(url,params=None):
    r=S.get(url,params=params,timeout=TIMEOUT); r.raise_for_status(); return r.json()

def ddg(query,limit=8):
    try:
        r=S.get("https://html.duckduckgo.com/html/",params={"q":query},timeout=TIMEOUT); r.raise_for_status()
        soup=BeautifulSoup(r.text,"html.parser"); out=[]
        for a in soup.select("a.result__a"):
            u=a.get("href","")
            if "uddg=" in u: u=unquote(parse_qs(urlparse(u).query).get("uddg",[u])[0])
            if u.startswith("http") and u not in out: out.append(u)
            if len(out)>=limit: break
        return out
    except Exception: return []

def resolve_steam(title):
    data=get_json("https://store.steampowered.com/api/storesearch/",{"term":title,"l":"english","cc":"us"})
    best=None
    for x in data.get("items",[]):
        sc=fuzz.token_set_ratio(title,x.get("name",""))
        if sc>=75 and (not best or sc>best[0]): best=(sc,int(x["id"]))
    return best[1] if best else None

def steam_data(appid):
    p=get_json("https://store.steampowered.com/api/appdetails",{"appids":appid,"l":"english","cc":"us"})
    n=p.get(str(appid),{}); d=n.get("data",{}) if n.get("success") else {}
    if not d:return {}
    vids=[]
    for m in d.get("movies") or []:
        u=(m.get("mp4") or {}).get("max") or (m.get("webm") or {}).get("max")
        if u: vids.append({"title":m.get("name") or "Official video","url":u,"source":f"https://store.steampowered.com/app/{appid}/"})
    return {"appid":appid,"title":d.get("name", ""),"short":clean(d.get("short_description")),"about":clean(d.get("about_the_game")),"release":(d.get("release_date") or {}).get("date", ""),"developers":d.get("developers") or [],"publishers":d.get("publishers") or [],"genres":[g.get("description") for g in d.get("genres") or [] if g.get("description")],"categories":[g.get("description") for g in d.get("categories") or [] if g.get("description")],"platforms":[k.title() for k,v in (d.get("platforms") or {}).items() if v],"cover":d.get("header_image", ""),"hero":d.get("background_raw") or d.get("background", ""),"screenshots":[x.get("path_full") for x in d.get("screenshots") or [] if x.get("path_full")],"videos":vids,"metacritic":(d.get("metacritic") or {}).get("score"),"official":d.get("website", ""),"store":f"https://store.steampowered.com/app/{appid}/"}

def page_meta(url,adapter,title):
    try:
        r=S.get(url,timeout=TIMEOUT,allow_redirects=True)
        if r.status_code>=400 or "text/html" not in r.headers.get("content-type",""): return None
        final=r.url; h=host(final)
        if adapter.domain and not (h==adapter.domain or h.endswith("."+adapter.domain)): return None
        soup=BeautifulSoup(r.text[:1_800_000],"html.parser")
        ttl=clean((soup.title.string if soup.title and soup.title.string else ""))
        desc=""
        for attrs in ({"property":"og:description"},{"name":"description"}):
            t=soup.find("meta",attrs)
            if t and t.get("content"): desc=clean(t["content"]); break
        score=max(fuzz.token_set_ratio(title,ttl),fuzz.token_set_ratio(title,desc[:300]))
        if score<52:return None
        pub=""
        for attrs in ({"property":"article:published_time"},{"name":"date"},{"itemprop":"datePublished"}):
            t=soup.find("meta",attrs)
            if t and t.get("content"): pub=t["content"]; break
        return {"url":final,"domain":h,"source_name":adapter.name,"title":ttl,"description":desc[:1400],"published_at":pub,"checked_at":now(),"type":adapter.kind,"trust":adapter.trust,"supports":["identity","editorial_reference"],"fingerprint":fp(final),"match_score":score}
    except Exception:return None

def discover(title,official=""):
    found=[]; seen=set()
    if official:
        a=REGISTRY[0]; m=page_meta(official,a,title)
        if m: found.append(m); seen.add(m["fingerprint"])
    for a in REGISTRY[1:]:
        best=[]
        for q in a.search_queries(title):
            for u in ddg(q,6):
                m=page_meta(u,a,title)
                if m and m["fingerprint"] not in seen: best.append(m)
            time.sleep(.25)
        best.sort(key=lambda x:x["match_score"],reverse=True)
        for m in best[:2 if a.kind=="editorial" else 1]:
            if m["fingerprint"] not in seen: found.append(m); seen.add(m["fingerprint"])
        if len(found)>=20: break
    return found[:20]

def validate(g):
    e=[]
    checks=[(g["identity"].get("title"),"title"),(g["release"].get("date_text"),"release date"),(g["companies"].get("developers"),"developer"),(g["classification"].get("genres"),"genres"),(g["editorial"].get("short_description"),"short description"),(g["media"].get("cover"),"cover"),(g["media"].get("hero"),"hero")]
    for v,n in checks:
        if not v:e.append("missing "+n)
    if len(g["sources"])<10:e.append(f"only {len(g['sources'])} sources; minimum 10")
    if sum(1 for x in g["sources"] if x["type"]=="editorial")<3:e.append("fewer than 3 editorial sources")
    if len(g["media"].get("screenshots",[]))<6:e.append("fewer than 6 screenshots")
    if len(g["editorial"].get("features",[]))<4:e.append("fewer than 4 features")
    g["publication"].update({"checked_at":now(),"errors":e,"gate_passed":not e,"status":"published" if not e else "review"})

def build(seed):
    appid=resolve_steam(seed); st=steam_data(appid) if appid else {}
    title=st.get("title") or seed
    sources=discover(title,st.get("official", ""))
    store=st.get("store")
    if store and fp(store) not in {x["fingerprint"] for x in sources}:
        sources.insert(0,{"url":store,"domain":"store.steampowered.com","source_name":"Steam","title":title,"description":st.get("short", ""),"published_at":"","checked_at":now(),"type":"store","trust":.98,"supports":["identity","release","companies","classification","media"],"fingerprint":fp(store),"match_score":100})
    reviews=[x for x in sources if x["type"]=="editorial"]
    g={"publication":{"status":"collecting","gate_passed":False,"errors":[]},"identity":{"slug":slugify(title),"title":title,"seed_title":seed,"steam_appid":appid},"release":{"date_text":st.get("release", "")},"companies":{"developers":st.get("developers",[]),"publishers":st.get("publishers",[])},"classification":{"genres":st.get("genres",[]),"categories":st.get("categories",[]),"platforms":st.get("platforms",[])},"editorial":{"short_description":st.get("short", ""),"integrated_description":st.get("about", ""),"features":(st.get("categories") or st.get("genres") or [])[:8]},"media":{"cover":st.get("cover", ""),"hero":st.get("hero", ""),"screenshots":st.get("screenshots",[]),"videos":st.get("videos",[])},"ratings":{"igropoisk":round(st["metacritic"]/10,1) if st.get("metacritic") else None,"users":None,"user_votes":0},"links":{"official":st.get("official", ""),"store":store or ""},"materials":{"reviews":reviews[:8],"news":[],"guides":[]},"sources":sorted(sources,key=lambda x:(x["trust"],x["match_score"]),reverse=True)}
    validate(g); return g

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--limit",type=int,default=50); ap.add_argument("--only"); a=ap.parse_args()
    seeds=json.loads((ROOT/"parser/seeds.json").read_text())
    if a.only: seeds=[x for x in seeds if x.lower()==a.only.lower()]
    seeds=seeds[:a.limit]
    dd=ROOT/"data/drafts"; pd=ROOT/"data/public"; dd.mkdir(parents=True,exist_ok=True); pd.mkdir(parents=True,exist_ok=True)
    public=[]; report={"started_at":now(),"processed":0,"published":0,"review":0,"items":[]}
    for seed in seeds:
        print("Collecting",seed,flush=True); g=build(seed); slug=g["identity"]["slug"]
        (dd/f"{slug}.json").write_text(json.dumps(g,ensure_ascii=False,indent=2))
        report["processed"]+=1; report[g["publication"]["status"]]+=1; report["items"].append({"slug":slug,"status":g["publication"]["status"],"sources":len(g["sources"]),"errors":g["publication"]["errors"]})
        if g["publication"]["gate_passed"]: public.append(g)
    (pd/"games.json").write_text(json.dumps(public,ensure_ascii=False,indent=2)); report["finished_at"]=now(); (ROOT/"data/parser-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=="__main__": main()
