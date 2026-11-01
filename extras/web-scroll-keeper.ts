/**
 * OpenCode web UI — model list scroll keeper.
 *
 * The model-pricing plugin scrolls long model names by updating them on the
 * server; each update makes the web UI's model list re-render and RESETS its
 * vertical scroll position. The web app offers no plugin surface, so this
 * small browser-side script heals the reset instead: it remembers where you
 * scrolled and restores it whenever a re-render drops the list back to the top.
 *
 * With this installed, the marquee can run continuously server-side
 * ("scrollPauseMs": 0) without disturbing browsing.
 *
 * Install (pick one):
 *  - Userscript: add to a userscript manager (Tampermonkey / Userscripts app)
 *    with a match rule for your OpenCode web origin.
 *  - Bookmarklet: save the minified form below as a bookmark and tap it once
 *    after the web UI loads.
 *
 * javascript:(function(){if(window.__ocScrollKeeper)return;window.__ocScrollKeeper=true;const saved=new Map();const sig=(e)=>e.tagName+"."+[...(e.classList||[])].join(".");const targets=()=>{const out=[];if(document.scrollingElement&&document.scrollingElement.scrollTop>0)out.push(document.scrollingElement);for(const[e]of saved)if(e.isConnected)out.push(e);for(const el of document.querySelectorAll("*")){const s=getComputedStyle(el);if(/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+4)out.push(el);}return[...new Set(out)];};const snap=()=>{for(const el of targets()){if(el===document.scrollingElement){if(window.scrollY>0)saved.set(el,{top:window.scrollY,h:innerHeight,sig:"document.scrollingElement"});continue;}if(el.scrollTop>0)saved.set(el,{top:el.scrollTop,h:el.clientHeight,sig:sig(el)});}};const restore=()=>{for(const[el,rec]of[...saved]){const cur=el===document.scrollingElement?window.scrollY:el.scrollTop;if(cur>0)continue;if(el.isConnected||el===document.scrollingElement){if(el===document.scrollingElement)window.scrollTo(0,rec.top);else el.scrollTop=rec.top;continue;}for(const cand of document.querySelectorAll(rec.sig)){if(Math.abs(cand.clientHeight-rec.h)<=2&&cand.scrollTop===0&&cand.scrollHeight>cand.clientHeight){cand.scrollTop=rec.top;saved.set(cand,rec);saved.delete(el);break;}}}};addEventListener("scroll",snap,true);new MutationObserver(()=>requestAnimationFrame(restore)).observe(document.body,{childList:true,subtree:true,characterData:true});})();
 *
 * The script only ever restores a position that got reset to the top while
 * you were scrolled somewhere; it never moves a list you are scrolling now.
 */

;(() => {
  if (window.__ocScrollKeeper) return
  window.__ocScrollKeeper = true

  /** element -> { top, h, sig } for anything the user has scrolled. */
  const saved = new Map()

  const sig = (el: Element) => el.tagName + "." + [...(el.classList ?? [])].join(".")

  function scrollables(): Element[] {
    const out: Element[] = []
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el)
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) out.push(el)
    }
    return out
  }

  function snap(): void {
    if (window.scrollY > 0) {
      saved.set(document.scrollingElement ?? document.body, { top: window.scrollY, h: innerHeight, sig: "document.scrollingElement" })
    }
    for (const el of scrollables()) {
      if (el.scrollTop > 0) saved.set(el, { top: el.scrollTop, h: el.clientHeight, sig: sig(el) })
    }
  }

  function restore(): void {
    for (const [el, rec] of [...saved]) {
      const current = el === (document.scrollingElement ?? document.body) ? window.scrollY : (el as HTMLElement).scrollTop
      if (current > 0) continue // user is somewhere — leave it alone
      if (el.isConnected) {
        if (rec.sig === "document.scrollingElement") window.scrollTo(0, rec.top)
        else (el as HTMLElement).scrollTop = rec.top
        continue
      }
      // The element was remounted: find its look-alike at the top and restore.
      for (const cand of document.querySelectorAll(rec.sig)) {
        if (
          Math.abs(cand.clientHeight - rec.h) <= 2 &&
          cand.scrollTop === 0 &&
          cand.scrollHeight > cand.clientHeight
        ) {
          ;(cand as HTMLElement).scrollTop = rec.top
          saved.set(cand, rec)
          saved.delete(el)
          break
        }
      }
    }
  }

  addEventListener("scroll", snap, true)
  let frame = 0
  new MutationObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(restore)
  }).observe(document.body, { childList: true, subtree: true, characterData: true })
})()
