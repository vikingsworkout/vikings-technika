// Obrazovky Techniky vo vzhľade appky Viking's Workout (?vw=1) podľa návrhu „Technika vo Viking's Workout“:
// Výber cviku, Natoč, Nahrávanie, Analýza a Video analýzy. Logika je v app.js, tu sú len šablóny.

export const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="8" r="1.6"/><path d="M12 10v4.5M9 12.2l3-1.2 3 1.2M12 14.5l-2.2 3.3M12 14.5l2.2 3.3"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5.5 15l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg>',
  tripod: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v9M12 12l-6 9M12 12l6 9M12 12v9"/><rect x="8" y="2" width="8" height="5" rx="1.5"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h3l2-3h8l2 3h3v12H3z"/><path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2"/><path d="M14 9v2h2M10 17v-2H8"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2.2v14H6zM19 5.5v13L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.8 5H18v14h-2.2zM5 5.5v13l9.5-6.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>',
};

// Natoč: rámik záberu okolo postavy (prerušovaný obdĺžnik + oranžové rohy ako v návrhu)
export function frameSvg(x, y, w, h) {
  const r = Math.min(16, w / 4, h / 4), L = Math.min(10, w / 6, h / 6), f = (n) => n.toFixed(1);
  const X = x + w, Y = y + h;
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2" stroke-dasharray="7 6"/>`
    + `<path d="M${f(x)} ${f(y + r + L)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}H${f(x + r + L)}`
    + `M${f(X - r - L)} ${f(y)}H${f(X - r)}A${f(r)} ${f(r)} 0 0 1 ${f(X)} ${f(y + r)}V${f(y + r + L)}`
    + `M${f(X)} ${f(Y - r - L)}V${f(Y - r)}A${f(r)} ${f(r)} 0 0 1 ${f(X - r)} ${f(Y)}H${f(X - r - L)}`
    + `M${f(x + r + L)} ${f(Y)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(Y - r)}V${f(Y - r - L)}" fill="none" stroke="#FF7A45" stroke-width="4" stroke-linecap="round"/>`;
}

// ---------- Natoč (sekcia vNew) ----------
export const NEW_HTML = `
  <h1 class="sh-h1" id="newTitle">Natoč cvik</h1>
  <p class="sh-sub" id="newSub"></p>
  <p class="sh-quota" id="newQuota" hidden></p>
  <div class="sh-prev" id="shPrev"></div>
  <section class="vw-card sh-tips" id="shTips"></section>
  <div class="vw-cap" id="shCapChecks">ČO SKONTROLUJEM</div>
  <div class="sh-chips" id="shChecks"></div>
  <details class="sh-100" id="sh100" hidden><summary><span class="sh-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg></span><span class="s1t"><b>Čo treba na 100 bodov</b><span>Podľa toho rozbor hodnotí</span></span></summary><ul id="sh100l"></ul></details>
  <div class="vw-bottom">
    <div class="vw-card sh-limit" id="newLimit" hidden></div>
    <button class="btn pri sh-rec" id="btnRec"><span class="dot"></span>Nahrávať</button>
    <label class="btn ghost" for="inFile" id="lblFile">Vybrať video z galérie</label>
  </div>
  <input type="file" id="inCam" accept="video/*" capture="environment" hidden>
  <input type="file" id="inFile" accept="video/*" hidden>`;

// ---------- Výber cviku (sekcia vPick) ----------
export const PICK_HTML = `
  <h1 class="pk-h1">Čo natočíš?</h1>
  <button class="pk-ai" id="pkAuto">
    <span class="pk-ai-ic">${IC.ai}</span>
    <span class="pk-ai-t"><b>Rozpoznať automaticky</b><span>Appka sama spozná cvik aj výdrž – stojku, L-sit, plank…</span></span>
    <span class="pk-ai-ch">${IC.chev}</span>
  </button>
  <div id="pkDay"></div>
  <div class="vw-cap">NAVRHOVANÉ CVIKY</div>
  <div class="pk-grid" id="pkGrid"></div>
  <div class="vw-bottom pk-bottom">
    <label class="pk-gal" for="inFilePick">${IC.gallery}Vybrať video z galérie</label>
  </div>
  <input type="file" id="inFilePick" accept="video/*" hidden>`;

// ---------- Nahrávanie (sekcia vRec, cez celú obrazovku) ----------
export const REC_HTML = `
  <div class="rc" id="rcRoot">
    <video id="recVideo" playsinline muted autoplay></video>
    <div class="rc-shade"></div>
    <canvas class="rc-cv" id="recCanvas" aria-hidden="true"></canvas>
    <div class="rc-top">
      <button class="rc-glass rc-x" id="btnRecX" aria-label="Zrušiť nahrávanie">${IC.x}</button>
      <span class="rc-time" id="recBadge" hidden><i></i><span id="recTime">0:00</span></span>
      <button class="rc-glass rc-x" id="btnFlip" aria-label="Prepnúť kameru">${IC.flip}</button>
    </div>
    <span class="rc-name" id="recName"></span>
    <div class="rc-count" id="recCount" hidden><b id="recCountN">0</b><span id="recCountL">OPAKOVANÍ</span></div>
    <div class="rc-cd" id="recCd" hidden><div><span id="recCdNum">5</span><small>Priprav sa</small></div></div>
    <div class="rc-bot">
      <span class="rc-status" id="recStatus"><i></i><span id="recStatusT">Zapínam kameru…</span></span>
      <button class="rc-btn" id="btnRecBig" aria-label="Spustiť nahrávanie"><span></span></button>
      <span class="rc-hint" id="recHint">Ťukni a máš 5 sekúnd na prípravu</span>
    </div>
  </div>`;

// ---------- Analýza (sekcia vWork) ----------
export const WORK_HTML = `
  <div class="an-kick"><span class="kick" id="workKick">${IC.kick}<span>TECHNIKA</span></span></div>
  <div class="an-card" id="workCard">
    <canvas id="workCanvas" aria-label="Natočená séria"></canvas>
    <div class="an-fade"></div>
    <div class="an-band" id="workBand"></div>
    <span class="an-pill" id="workPill" hidden></span>
  </div>
  <div class="an-head">
    <h1 id="workTitle">Analyzujem tvoju sériu</h1>
    <span id="workSub">Zvyčajne to trvá do minúty</span>
  </div>
  <section class="vw-card an-steps" id="workSteps"></section>
  <p class="an-note" id="workStatus" hidden></p>
  <div class="card err" id="workErr" hidden>
    <p id="workErrText" style="margin:0 0 12px"></p>
    <div id="codeBox" hidden>
      <p class="small mu">Zadaj prístupový kód, ktorý si dostal od trénera. Zapamätá sa v tomto zariadení.</p>
      <input type="password" id="codeInput" placeholder="Prístupový kód" autocomplete="off" style="margin-bottom:10px">
    </div>
    <div class="row"><button class="btn pri" id="btnErrPro" hidden>Odomknúť Pro</button><button class="btn pri" id="btnRetry">Pokračovať</button><button class="btn sec" id="btnBack">Späť</button></div>
  </div>
  <div class="vw-bottom an-bottom" id="workBottom">
    <span>Rozbor sa uloží k cviku aj do profilu.</span>
    <button class="btn sec" id="btnWorkBg">Pokračovať v tréningu</button>
  </div>`;

// ---------- Video analýzy (prehrávač) ----------
export const PLAYER_HTML = `
  <div class="vp-top">
    <button class="vp-glass vp-x" id="btnPlayerClose" aria-label="Zavrieť">${IC.x}</button>
    <span class="vp-tt"><b>Video analýzy</b><span id="pSub"></span></span>
    <button class="vp-speed" id="pSpeed" aria-label="Rýchlosť prehrávania">1×</button>
  </div>
  <div class="vp-stage" id="pStage">
    <canvas id="pCanvas"></canvas>
    <span class="vp-pts"><i></i>Kostra tela</span>
    <div class="vp-err" id="pErr" hidden><b>Video sa nepodarilo načítať</b><span>Rozbor platí aj tak. Snímky s kostrou nájdeš v celom rozbore pod skóre.</span></div>
    <div class="vp-tip" id="pTip" hidden><b id="pTipT"></b><span id="pTipD"></span></div>
  </div>
  <div class="vp-ctl">
    <div class="vp-tl">
      <span class="vp-track"></span>
      <span class="vp-prob" id="pProb" hidden></span>
      <span class="vp-fill" id="pFill"></span>
      <span class="vp-thumb" id="pThumb"></span>
      <input type="range" id="pRange" min="0" max="1000" value="0" aria-label="Posun vo videu">
    </div>
    <div class="vp-reps" id="pReps"></div>
    <div class="vp-row">
      <span class="vp-time" id="pTime">0:00</span>
      <div class="vp-btns">
        <button class="vp-glass vp-nav" id="pPrev" aria-label="Predchádzajúce opakovanie">${IC.prev}</button>
        <button class="vp-play" id="pPlay" aria-label="Prehrať"><span id="pIcoPlay">${IC.play}</span><span id="pIcoPause" hidden>${IC.pause}</span></button>
        <button class="vp-glass vp-nav" id="pNext" aria-label="Ďalšie opakovanie">${IC.next}</button>
      </div>
      <span class="vp-lbl" id="pRepLbl"></span>
    </div>
  </div>`;
