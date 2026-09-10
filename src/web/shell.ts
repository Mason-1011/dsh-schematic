/** Stable application shell. Feature renderers mount into these named surfaces. */
export function appShell(t: (key: string) => string): string {
  return `
  <header class="appHeader">
    <a class="brand" href="/schematic" aria-label="dsh schematic">
      <span class="brandMark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span><b>schematic</b><small>LIVE COMPOSITION</small></span>
    </a>
    <nav class="spaceNav" aria-label="${t('navLabel')}">
      <button class="spaceBtn" data-space="system" aria-current="page">${t('navSystem')}</button>
      <button class="spaceBtn" data-space="blueprints">${t('navBlueprints')}</button>
      <button class="spaceBtn" data-space="activity">${t('navActivity')}</button>
    </nav>
    <div class="liveReadout"><span class="liveBeacon"></span><span class="stats">${t('loading')}</span><span class="trans"></span></div>
    <div class="appTools">
      <select class="sessSel" title="${t('sessSelTitle')}"></select>
      <label class="searchWrap"><span aria-hidden="true">⌕</span><input type="search" class="search" placeholder="${t('searchPh')}" aria-label="${t('searchPh')}"></label>
      <button class="helpBtn" title="${t('helpTitle')}" aria-label="${t('helpTitle')}">?</button>
      <button class="langToggle" title="${t('langTitle')}">中</button>
      <button class="themeToggle" title="${t('themeTitle')}" aria-label="${t('themeTitle')}">◐</button>
    </div>
    <div class="legacyControls" aria-hidden="true">
      <span class="tabs"><button class="tabBtn" data-tab="journey">${t('tabJourney')}</button><button class="tabBtn" data-tab="domains">${t('tabDomains')}</button><button class="tabBtn" data-tab="table">${t('tabTable')}</button></span>
      <button class="crumb">${t('overview')}</button><span class="chip pChipBtn"></span><button class="editBtn">✎</button>
    </div>
  </header>
  <div class="editBanner"></div>
  <div class="driftBanner" role="status"></div>
  <section class="contextBar">
    <div class="systemContext">
      <div class="viewSwitch" role="group" aria-label="${t('systemViews')}"><button class="systemView" data-view="domains" aria-pressed="true">${t('systemTopology')}</button><button class="systemView" data-view="table" aria-pressed="false">${t('systemInventory')}</button></div>
      <span class="contextRule"></span><span class="contextLabel">${t('systemLive')}</span>
    </div>
    <div class="blueprintContext"><span>${t('blueprintKicker')}</span><b class="blueprintContextName">${t('blueprintNone')}</b></div>
    <div class="activityContext"><span>${t('activityKicker')}</span><b>${t('activityNow')}</b></div>
  </section>
  <div class="filters"></div>
  <main class="systemWorkspace">
    <div class="journey"></div>
    <div class="stage"><div class="graphGrid" aria-hidden="true"></div><svg class="graph" xmlns="http://www.w3.org/2000/svg"><g class="world"></g></svg></div>
    <div class="tableView"></div><aside class="detail"><p class="empty">${t('emptyDetail')}</p></aside>
  </main>
  <section class="blueprintWorkspace" aria-label="${t('navBlueprints')}"></section>
  <section class="activityIntro"><span>${t('activityEyebrow')}</span><h2>${t('activityTitle')}</h2><p>${t('activityDesc')}</p></section>
  <div class="actbar">
    <div class="actHead"><span class="runDot"></span><b class="actSess">—</b><span class="actState"></span><span class="recv"></span><span class="spacer" style="flex:1"></span><button class="chip subBtn" aria-pressed="false" title="${t('actSubTitle')}">${t('actSub')}</button><button class="chip svcBtn" aria-pressed="false" title="${t('actSvcTitle')}">${t('actSvc')}</button><button class="chip repBtn" aria-pressed="false" title="${t('actRepTitle')}">${t('actRep')}</button><button class="chip statBtn" aria-pressed="false" title="${t('actStatsTitle')}">${t('actStats')}</button><span class="legend">${t('actLiveHint')}</span><button class="actFold" aria-pressed="true">▾</button></div>
    <div class="actList"></div>
  </div>
  <footer><span class="meta"></span><span class="spacer" style="flex:1"></span><button class="zoomOut" aria-label="${t('zoomOut')}">−</button><button class="zoomIn" aria-label="${t('zoomIn')}">+</button><button class="zoomFit">${t('fit')}</button><button class="expBtn" aria-pressed="false" title="${t('expAllTitle')}">${t('expandAll')}</button><button class="autoBtn" aria-pressed="true" title="${t('autoTitle')}">⏸</button><button class="refresh" title="${t('refreshTitle')}">⟳</button></footer>
  <div class="toast" role="status" aria-live="polite"></div><div class="tooltip"></div><div class="schPop"></div><div class="editScrim"></div><aside class="editDrawer"></aside>
  <div class="tourLayer" hidden><div class="tourSpot" aria-hidden="true"></div><section class="tourCard" role="dialog" aria-modal="false" aria-labelledby="tourTitle"><span class="tourStep"></span><h2 id="tourTitle"></h2><p></p><div class="tourHint"></div><button class="tourSkip"></button></section></div>`
}
