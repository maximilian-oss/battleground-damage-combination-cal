(function () {
  'use strict';
  const D=globalThis.PUBG_DATA, E=globalThis.PUBG_ENGINE;
  const $=id=>document.getElementById(id), fmt=n=>Number(n).toLocaleString('ko-KR');
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaults={distance:100,hp:100,helmet:2,vest:2,weaponId:'m416',maxStk:6,compareStk:5,countMode:'within',model:'auto',zones:D.zones.map(z=>z.id),modeIds:{},rpmOverrides:{},classFilter:'all',compareClass:'all',compareSort:'count',compareSortDirection:'desc',search:'',mapMode:'damage',selectedZone:'chest'};
  let state=structuredClone(defaults), summaryWorker=null, detailWorker=null, taskId=0, detailId=0, timer=null, counts=[], comparison=[], ctx=null, detail=null, lastPage=null, toastTimer;
  const rowColorStorageKey='pubg-stk-lab-row-colors-v1';
  const rowColorNames={red:'빨강',blue:'파랑',green:'초록'};
  let rowColors={},rowColorTarget=null,rowColorAnchor=null;
  try {
    const saved=JSON.parse(localStorage.getItem(rowColorStorageKey)||'{}');
    if(saved&&typeof saved==='object'&&!Array.isArray(saved)) {
      for(const w of D.weapons) if(Object.hasOwn(rowColorNames,saved[w.id])) rowColors[w.id]=saved[w.id];
    }
  } catch(_) {}
  try {
    const saved=JSON.parse(localStorage.getItem('pubg-stk-lab-v1')||'null');
    if(saved) state={...state,...saved};
  }catch(_){}
  const hash=new URLSearchParams(location.hash.slice(1));
  for(const [key,param] of [['distance','d'],['hp','hp'],['helmet','h'],['vest','v'],['maxStk','n'],['compareStk','c']]) if(hash.has(param)) state[key]=Number(hash.get(param));
  if(hash.has('w')) state.weaponId=hash.get('w');
  if(hash.has('mode')) state.countMode=hash.get('mode');
  if(hash.has('z')) state.zones=hash.get('z').split(',');
  if(hash.has('rpm')) state.rpmOverrides[state.weaponId]=Number(hash.get('rpm'));
  if(hash.has('fire')) state.modeIds[state.weaponId]=hash.get('fire');
  if(hash.has('model')) state.model=hash.get('model');
  if(hash.has('sort')) state.compareSort=hash.get('sort');
  if(hash.has('dir')) state.compareSortDirection=hash.get('dir');
  function clamp(v,a,b,fallback=a){return Number.isFinite(Number(v))?Math.max(a,Math.min(b,Math.round(Number(v)))):fallback;}
  state.distance=clamp(state.distance,0,500,100);state.hp=clamp(state.hp,1,100,100);
  state.helmet=clamp(state.helmet,0,3,2);state.vest=clamp(state.vest,0,3,2);
  state.maxStk=clamp(state.maxStk,1,15,6);state.compareStk=clamp(state.compareStk,1,state.maxStk,5);
  state.zones=Array.isArray(state.zones)?state.zones.filter(id=>D.zones.some(z=>z.id===id)):defaults.zones;
  state.countMode=state.countMode==='exact'?'exact':'within';state.model=state.model==='sampled'?'sampled':'auto';
  if(!['count','ratio','ttk'].includes(state.compareSort))state.compareSort='count';
  state.compareSortDirection=state.compareSortDirection==='asc'?'asc':'desc';
  if(!D.weapons.some(w=>w.id===state.weaponId))state.weaponId='m416';
  state.modeIds=state.modeIds||{};state.rpmOverrides=state.rpmOverrides||{};
  for(const k of Object.keys(state.rpmOverrides)){const n=Number(state.rpmOverrides[k]);if(!Number.isFinite(n)||n<1||n>3000)delete state.rpmOverrides[k];}
  function persist(){try{const saved={...state,search:'',classFilter:'all'};localStorage.setItem('pubg-stk-lab-v1',JSON.stringify(saved));}catch(_) {}}
  function weapon(){return D.weapons.find(w=>w.id===state.weaponId);}
  function mode(w=weapon()){return w.rpmModes.find(m=>m.id===state.modeIds[w.id])||w.rpmModes[0];}
  function rpm(w=weapon()){return state.rpmOverrides[w.id]||mode(w).rpm;}
  function time(shots,w=weapon()){return E.ttk(shots,mode(w),state.rpmOverrides[w.id]);}
  function seconds(v){return v===0?'0.000':v.toFixed(3);}
  function timeRange(a,b,w=weapon()){const x=time(a,w),y=time(b,w);return Math.abs(x-y)<1e-9?`${seconds(x)} s`:`${seconds(x)}–${seconds(y)} s`;}
  function bounds(n,w=weapon(),context=ctx){return state.countMode==='exact'?[n,n]:E.globalBounds(context,n);}
  function badge(w=weapon()){return state.model==='sampled'||w.model==='sampled'?'보간 · 추정':'곡선 대조';}
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2500);}
  function saveRowColors(){try{localStorage.setItem(rowColorStorageKey,JSON.stringify(rowColors));}catch(_) {}}
  function applyRowColors(){
    $('comparison-rows').querySelectorAll('tr[data-weapon-id]').forEach(row=>{
      const color=rowColors[row.dataset.weaponId];
      if(color)row.dataset.rowColor=color;else delete row.dataset.rowColor;
    });
  }
  function closeRowColorMenu(restoreFocus=false){
    $('row-color-menu').hidden=true;
    $('comparison-rows').querySelectorAll('.color-menu-target').forEach(row=>row.classList.remove('color-menu-target'));
    if(restoreFocus&&rowColorAnchor?.isConnected)rowColorAnchor.focus({preventScroll:true});
    rowColorTarget=null;rowColorAnchor=null;
  }
  function openRowColorMenu(row,event){
    closeRowColorMenu();
    const w=D.weapons.find(w=>w.id===row.dataset.weaponId);if(!w)return;
    rowColorTarget=w.id;rowColorAnchor=row;row.classList.add('color-menu-target');
    $('row-color-target').textContent=`${w.name} · 행 배경색`;
    const menu=$('row-color-menu');
    menu.querySelectorAll('[data-row-color-choice]').forEach(button=>{
      const selected=rowColors[w.id]===button.dataset.rowColorChoice;
      button.setAttribute('aria-checked',String(selected));button.classList.toggle('active',selected);
    });
    menu.hidden=false;
    const rect=row.getBoundingClientRect(),box=menu.getBoundingClientRect();
    const x=event.clientX||rect.left+Math.min(140,rect.width/2),y=event.clientY||rect.top+Math.min(20,rect.height/2);
    menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-box.width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-box.height-8))}px`;
    menu.querySelector('[data-row-color-choice]').focus({preventScroll:true});
  }
  function syncInputs(){
    $('distance').value=$('distance-number').value=state.distance;$('hp').value=$('hp-number').value=state.hp;
    $('distance').style.setProperty('--progress',state.distance/5+'%');$('hp').style.setProperty('--progress',(state.hp-1)/99*100+'%');
    document.querySelectorAll('[data-distance]').forEach(b=>b.classList.toggle('active',Number(b.dataset.distance)===state.distance));
    document.querySelectorAll('[data-hp]').forEach(b=>b.classList.toggle('active',Number(b.dataset.hp)===state.hp));
    for(const key of ['helmet','vest'])document.querySelectorAll(`[data-${key}]`).forEach(b=>{b.classList.toggle('active',Number(b.dataset[key])===state[key]);b.setAttribute('aria-pressed',String(Number(b.dataset[key])===state[key]));});
    $('armor-note').textContent=`헬멧 ${[0,30,40,55][state.helmet]}% · 조끼 ${[0,30,40,55][state.vest]}% 피해 감소`;
    $('max-stk').value=state.maxStk;
    $('compare-stk').innerHTML=Array.from({length:state.maxStk},(_,i)=>`<option value="${i+1}">${i+1}발</option>`).join('');$('compare-stk').value=state.compareStk;
    $('compare-class').value=state.compareClass;
    document.querySelectorAll('[data-count]').forEach(b=>{b.classList.toggle('active',b.dataset.count===state.countMode);b.setAttribute('aria-pressed',String(b.dataset.count===state.countMode));});
    $('mode-help').textContent=state.countMode==='within'?'N발 구성의 합산 피해가 HP 이상인 모든 조합. 더 일찍 기절하는 구성도 포함합니다.':'N발 합산 피해가 HP 이상이고, 어느 한 발을 빼도 HP 미만인 조합만 셉니다.';
    $('zone-count').textContent=`${state.zones.length} / 13`;
    $('zone-checks').innerHTML=D.zones.map(z=>`<label><input type="checkbox" data-zone-check="${z.id}" ${state.zones.includes(z.id)?'checked':''}>${escape(z.name)}</label>`).join('');
  }
  const gunIcon='<svg viewBox="0 0 76 30" aria-hidden="true"><path d="M1 12h13l5-4h17l2-3h13v3h14v3h10v4H54l-7 3H31l-4 10h-7l2-10h-7l-9 4H1zm30-5h9v-3h-9zm12 12h8l-4 8h-6z"/></svg>';
  function renderWeapons(){
    const q=state.search.toLowerCase().trim();
    const list=D.weapons.filter(w=>(state.classFilter==='all'||w.class===state.classFilter)&&(`${w.name} ${w.ammo}`).toLowerCase().includes(q));
    $('weapon-count').textContent=list.length;
    $('weapon-list').innerHTML=list.length?list.map(w=>`<button class="weapon-item ${w.id===state.weaponId?'active':''}" data-weapon="${w.id}" aria-pressed="${w.id===state.weaponId}"><span class="weapon-icon">${gunIcon}</span><span class="weapon-info"><strong>${escape(w.name)}</strong><small>${escape(w.ammo)} · ${w.baseDamage} DMG</small></span><span class="weapon-class">${w.class}</span></button>`).join(''):'<p class="empty-state">검색한 무기가 없습니다.</p>';
    document.querySelectorAll('[data-class]').forEach(b=>b.classList.toggle('active',b.dataset.class===state.classFilter));
  }
  function renderWeaponMeta(){
    const w=weapon(),m=mode(w);
    $('selected-name').textContent=w.name;$('weapon-category').textContent=`${w.class} · ${w.ammo}`;
    $('method-badge').textContent=badge(w);$('method-badge').classList.toggle('sampled',badge(w).includes('추정'));
    $('base-damage').textContent=ctx?ctx.base.toFixed(3):'—';$('falloff').textContent=ctx?`×${(ctx.base/w.baseDamage).toFixed(3)}`:'—';$('current-rpm').textContent=fmt(Math.round(rpm(w)));
    $('fire-mode').innerHTML=w.rpmModes.map(m=>`<option value="${escape(m.id)}">${escape(m.label)}</option>`).join('');$('fire-mode').value=m.id;
    $('rpm-input').value=Math.round(rpm(w));
    $('rpm-note').textContent=state.rpmOverrides[w.id]?'직접 입력한 RPM · 일정한 발사 간격으로 계산합니다.':m.approximate?'점사 간격에 따른 근사 TTK입니다. 선택한 발사 모드의 가정을 확인하세요.':w.class==='DMR'&&w.id!=='vss'?'단발은 선택한 연사 속도를 유지하는 조건입니다.':'선택한 발사 모드의 RPM을 적용합니다.';
    $('coverage-note').classList.toggle('unavailable',!ctx);
    $('coverage-note').textContent=!ctx?`${w.name}은 0–${w.maxDistance}m까지만 자료가 있습니다. ${state.distance}m의 피해와 조합은 표시하지 않습니다.`:state.model==='sampled'||w.model==='sampled'?`0–${w.maxDistance}m 분석 자료 · 지점 사이의 피해는 보간한 추정값입니다.`:`0–${w.maxDistance}m 대조 범위 · 공개 원본의 보간 방식과 기울기를 적용합니다.`;
  }
  const bodyParts=[
    ['head','<ellipse cx="250" cy="62" rx="33" ry="42"/>'],
    ['neck','<path d="M235 104h30l4 29h-38z"/>'],
    ['clavicle','<path d="M230 129h40l31 10 10 24-20 8-16-13h-50l-16 13-20-8 10-24z"/>'],
    ['chest','<path d="M224 158h52l16 16-7 49h-70l-7-49z"/>'],
    ['upperStomach','<path d="M215 223h70l-2 45h-66z"/>'],
    ['lowerStomach','<path d="M217 268h66l7 43-40 22-40-22z"/>'],
    ['pelvis','<path d="M210 311l40 18 40-18 8 37-35 18-13-13-13 13-35-18z"/>'],
    ['upperArm','<path d="M198 147l14 22-17 67-26-6 8-62zM302 147l-14 22 17 67 26-6-8-62z"/>'],
    ['forearm','<path d="M169 230l26 6-26 70-20-5 9-48zM331 230l-26 6 26 70 20-5-9-48z"/>'],
    ['hand','<path d="M149 301l20 5-6 34-14 9-9-8zM351 301l-20 5 6 34 14 9 9-8z"/>'],
    ['thigh','<path d="M202 348l35 16 10 10-12 73-29-2-9-59zM298 348l-35 16-10 10 12 73 29-2 9-59z"/>'],
    ['calf','<path d="M206 445l29 2-5 57-8 29h-22l-3-40zM294 445l-29 2 5 57 8 29h22l3-40z"/>'],
    ['foot','<path d="M200 533h22l4 22-7 11h-40l-1-11zM300 533h-22l-4 22 7 11h40l1-11z"/>']
  ];
  const callouts={head:[350,49,281,58,'right'],neck:[40,104,235,117,'left'],clavicle:[350,133,297,149,'right'],chest:[40,168,215,192,'left'],upperStomach:[350,210,283,245,'right'],lowerStomach:[40,283,216,287,'left'],pelvis:[350,331,285,332,'right'],upperArm:[40,222,185,212,'left'],forearm:[350,274,334,278,'right'],hand:[40,344,151,327,'left'],thigh:[40,410,216,406,'left'],calf:[350,478,292,486,'right'],foot:[40,549,202,550,'left']};
  function zoneColor(damage){
    const stops=[[0,[65,111,129]],[20,[107,152,139]],[35,[183,163,104]],[55,[211,141,91]],[85,[211,98,81]]];
    for(let i=1;i<stops.length;i++)if(damage<=stops[i][0]){const a=stops[i-1],b=stops[i],t=Math.max(0,Math.min(1,(damage-a[0])/(b[0]-a[0])));return `rgb(${a[1].map((v,j)=>Math.round(v+(b[1][j]-v)*t)).join(',')})`;}
    return 'rgb(211,98,81)';
  }
  function renderMap(){
    const zs=ctx?.zones||D.zones.map(z=>({...z,damage:null,included:state.zones.includes(z.id)}));
    const shapes=bodyParts.map(([id,shape])=>{const z=zs.find(z=>z.id===id);return `<g data-zone="${id}" class="body-part ${state.selectedZone===id?'focused':''} ${z.included?'':'excluded'}" fill="${z.damage===null?'#303846':zoneColor(z.damage)}"><title>${escape(z.name)} ${z.damage===null?'자료 없음':z.damage.toFixed(3)+' HP'}</title>${shape}</g>`;}).join('');
    const labels=zs.map(z=>{const [x,y,tx,ty,side]=callouts[z.id],edge=side==='left'?135:340,middle=side==='left'?177:323;const value=z.damage===null?'—':state.mapMode==='stk'?Math.ceil((state.hp-1e-8)/z.damage):z.damage.toFixed(1);return `<g class="map-label ${state.selectedZone===z.id?'focused':''}" data-zone="${z.id}" tabindex="0" role="button" aria-label="${escape(z.name)} ${value} ${state.mapMode==='stk'?'발':'피해'}"><path class="map-line" d="M${edge} ${y+10}H${middle}L${tx} ${ty}"/><circle class="map-dot" cx="${tx}" cy="${ty}" r="2"/><text x="${x}" y="${y}">${escape(z.name)}</text><text class="zone-number" x="${x}" y="${y+22}">${value}<tspan class="zone-unit" dx="4">${state.mapMode==='stk'?'발':'HP'}</tspan></text></g>`;}).join('');
    $('damage-map').innerHTML=`<svg viewBox="0 0 500 590" role="img" aria-label="${escape(weapon().name)} ${state.distance}미터 부위별 데미지 맵"><defs><pattern id="map-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#536174" stroke-width=".5" opacity=".14"/></pattern></defs><rect x="120" y="12" width="260" height="565" fill="url(#map-grid)" rx="10"/><path d="M250 10V578" stroke="#69778b" stroke-width=".8" stroke-dasharray="2 8" opacity=".25"/><ellipse cx="250" cy="574" rx="68" ry="5" fill="#000" opacity=".16"/>${shapes}${labels}</svg>`;
    document.querySelectorAll('[data-map]').forEach(b=>b.classList.toggle('active',b.dataset.map===state.mapMode));
    renderHitDetail(state.selectedZone);
  }
  function renderHitDetail(id){
    const z=ctx?.zones.find(z=>z.id===id)||D.zones.find(z=>z.id===id);if(!z)return;
    $('hit-detail').innerHTML=`<span>${escape(z.name)}</span><strong>${z.damage!==undefined?z.damage.toFixed(3)+' HP':'자료 없음'}</strong><span>${z.damage!==undefined?`${Math.ceil((state.hp-1e-8)/z.damage)}발 · ${z.armor==='helmet'?'헬멧 적용':z.armor==='vest'?'조끼 적용':'방어구 미적용'}`:'거리를 자료 범위 안으로 조절하세요.'}</span>`;
  }
  function renderStk(pending=false){
    $('stk-rows').innerHTML=Array.from({length:state.maxStk},(_,i)=>{
      const n=i+1,c=counts[i],unavailable=!ctx||!ctx.active.length;const b=bounds(n);
      const countHTML=unavailable?'<span class="count-zero">자료 없음</span>':c===undefined?'<span class="count-zero">계산 중…</span>':c===0?'<span class="count-zero">0개</span>':`<button class="count-button" data-details="${n}" aria-label="${n}발 ${fmt(c)}개 조합 상세 보기">${fmt(c)}<small>개</small><span>›</span></button>`;
      return `<tr><td><span class="mono">${n}</span>발</td><td>${countHTML}</td><td>${!unavailable&&c>0?timeRange(b[0],b[1]):'—'}</td></tr>`;
    }).join('');
    if(!pending){$('calculation-status').classList.remove('busy');$('calculation-status').textContent=!ctx?'해당 거리의 자료가 없습니다.':!state.zones.length?'집계할 명중 부위를 하나 이상 선택하세요.':`${state.zones.length}개 부위 · ${state.maxStk}발 구성 전체 ${fmt(E.choose(state.maxStk+state.zones.length-1,state.maxStk))}개`;} 
  }
  function renderComparison(pending=false){
    closeRowColorMenu();
    const total=state.zones.length?E.choose(state.compareStk+state.zones.length-1,state.compareStk):0;
    const sortNames={count:'성공 조합 수',ratio:'전체 조합 대비',ttk:'기절 TTK 최대값'};
    document.querySelectorAll('[data-compare-sort]').forEach(button=>{
      const active=button.dataset.compareSort===state.compareSort;
      button.closest('th').setAttribute('aria-sort',active?(state.compareSortDirection==='desc'?'descending':'ascending'):'none');
      button.classList.toggle('active',active);
      button.querySelector('.sort-arrow').textContent=active?(state.compareSortDirection==='desc'?'↓':'↑'):'↕';
      const next=active&&state.compareSortDirection==='desc'?'오름차순':'내림차순';
      button.setAttribute('aria-label',`${sortNames[button.dataset.compareSort]} ${next} 정렬`);
    });
    $('comparison-sort-status').textContent=`정렬: ${sortNames[state.compareSort]} · ${state.compareSortDirection==='desc'?'내림차순':'오름차순'}`;
    const list=comparison.map(x=>{
      const w=D.weapons.find(w=>w.id===x.id),wc=E.context(w,state,D),b=bounds(state.compareStk,w,wc);
      return {...x,w,wc,b,ratio:total&&x.count!==null?x.count/total*100:0,ttkMax:x.count>0?time(b[1],w):null};
    }).filter(x=>state.compareClass==='all'||x.w.class===state.compareClass);
    function sortValue(x){
      if(x.count===null)return null;
      return state.compareSort==='ttk'?x.ttkMax:state.compareSort==='ratio'?x.ratio:x.count;
    }
    list.sort((a,b)=>{
      const av=sortValue(a),bv=sortValue(b);
      if(av===null||bv===null){if(av!==bv)return av===null?1:-1;}
      else if(Math.abs(av-bv)>1e-10)return state.compareSortDirection==='desc'?bv-av:av-bv;
      const byCount=(b.count??-1)-(a.count??-1);if(byCount)return byCount;
      if(a.ttkMax!==null&&b.ttkMax!==null&&Math.abs(a.ttkMax-b.ttkMax)>1e-10)return a.ttkMax-b.ttkMax;
      return a.w.name.localeCompare(b.w.name);
    });
    $('comparison-rows').innerHTML=list.length?list.map((x,i)=>{
      const {b,ratio}=x;
      return `<tr class="${x.id===state.weaponId?'selected':''}" data-weapon-id="${x.id}"${rowColors[x.id]?` data-row-color="${rowColors[x.id]}"`:''} tabindex="0" aria-label="${escape(x.w.name)} 비교 행"><td>${String(i+1).padStart(2,'0')}</td><td><button class="gun-select" data-weapon="${x.id}">${escape(x.w.name)}</button><span class="gun-class">${x.w.class}</span></td><td>${x.count===null?'<span class="count-zero">거리 자료 없음</span>':x.count>0?`<button class="count-button" data-comparison-details="${x.id}" aria-label="${escape(x.w.name)} ${state.compareStk}발 ${fmt(x.count)}개 조합 상세 보기">${fmt(x.count)}<small>개</small><span>›</span></button>`:'<span class="count-zero">0개</span>'}</td><td class="ratio-cell"><div class="ratio-wrap"><div class="ratio-track"><div class="ratio-fill" style="width:${ratio}%"></div></div><span class="ratio-number">${x.count===null?'—':ratio.toFixed(2)+'%'}</span></div></td><td>${x.count>0?timeRange(b[0],b[1],x.w):'—'}</td><td>${fmt(Math.round(rpm(x.w)))}</td><td><span class="method-tag ${badge(x.w).includes('추정')?'sampled':''}">${badge(x.w)}</span></td></tr>`;
    }).join(''):`<tr><td colspan="7" class="empty-state">${pending?'총기별 조합을 계산하고 있습니다…':'비교할 무기가 없습니다.'}</td></tr>`;
  }
  function killWorkers(){if(summaryWorker){summaryWorker.terminate();summaryWorker=null;}}
  function runSummary(){
    clearTimeout(timer);killWorkers();const id=++taskId;
    counts=[];comparison=[];renderStk(true);renderComparison(true);
    $('calculation-status').classList.add('busy');$('calculation-status').textContent='명중 조합을 계산하고 있습니다…';
    const payload={type:'summary',id,weaponId:state.weaponId,state:structuredClone(state)};
    function accept(m){if(m.id!==taskId)return;if(m.type==='selected'){counts=m.counts;renderStk(true);}else if(m.type==='summary'){counts=m.counts;comparison=m.comparison;renderStk();renderComparison();}else if(m.type==='error'){showCalculationError(m.message);}}
    try{
      summaryWorker=new Worker('./worker.js');
      summaryWorker.onmessage=e=>accept(e.data);
      summaryWorker.onerror=()=>{killWorkers();fallbackSummary(payload,accept);};
      summaryWorker.postMessage(payload);
    }catch(_){fallbackSummary(payload,accept);}
  }
  function fallbackSummary(payload,accept){
    setTimeout(()=>{try{
      if(payload.id!==taskId)return;
      const w=D.weapons.find(w=>w.id===payload.weaponId),c=E.context(w,payload.state,D);
      const values=Array.from({length:payload.state.maxStk},(_,i)=>E.countCombinations(c,i+1,payload.state.countMode));
      accept({id:payload.id,type:'selected',counts:values});
      const entries=D.weapons.map(w=>{const c=E.context(w,payload.state,D);return {id:w.id,count:c?E.countCombinations(c,payload.state.compareStk,payload.state.countMode):null};});
      accept({id:payload.id,type:'summary',counts:values,comparison:entries});
    }catch(error){showCalculationError(error.message);}},10);
  }
  function showCalculationError(message){$('calculation-status').classList.remove('busy');$('calculation-status').textContent='계산에 문제가 생겼습니다. 조건을 다시 선택해 주세요.';console.error(message);}
  function update(recalculate=true){
    ctx=E.context(weapon(),state,D);syncInputs();renderWeaponMeta();renderMap();persist();
    if(recalculate){if($('details-dialog').open)$('details-dialog').close();clearTimeout(timer);killWorkers();++taskId;counts=[];renderStk(true);$('calculation-status').classList.add('busy');$('calculation-status').textContent='조건을 반영하고 있습니다…';timer=setTimeout(runSummary,110);}
    else{renderStk();renderComparison();if(lastPage&&$('details-dialog').open)renderDetailPage(lastPage);}
  }
  function selectWeapon(id){if(!D.weapons.some(w=>w.id===id))return;state.weaponId=id;renderWeapons();update();}
  function openDetails(n,weaponId=state.weaponId,count){
    const w=D.weapons.find(w=>w.id===weaponId),c=E.context(w,state,D);if(!c)return;
    const total=count??counts[n-1]??E.countCombinations(c,n,state.countMode);if(!total)return;
    detail={weaponId,n,total,page:0,pageSize:40,state:structuredClone(state),ctx:c};lastPage=null;
    $('detail-title').textContent=`${w.name} · ${n}발 ${state.countMode==='within'?'이내':'필요'} 조합`;
    $('detail-summary').innerHTML=`<span class="detail-pill">${state.distance}m</span><span class="detail-pill">${state.hp} HP</span><span class="detail-pill">헬멧 ${state.helmet||'없음'} · 조끼 ${state.vest||'없음'}</span><span class="detail-pill">${state.zones.length}개 부위</span><span class="detail-total">${fmt(total)}<small>개</small></span>`;
    if(!$('details-dialog').open)$('details-dialog').showModal();loadDetailPage();
  }
  function loadDetailPage(){
    if(!detail)return;
    const pages=Math.ceil(detail.total/detail.pageSize);detail.page=clamp(detail.page,0,pages-1,0);
    const id=++detailId,payload={type:'page',id,weaponId:detail.weaponId,state:detail.state,n:detail.n,offset:detail.page*detail.pageSize,limit:detail.pageSize};
    $('detail-rows').innerHTML='<tr><td colspan="5" class="empty-state">조합을 불러오고 있습니다…</td></tr>';
    $('detail-page').textContent=`${fmt(detail.page+1)} / ${fmt(pages)}`;$('detail-page-input').value=detail.page+1;$('detail-page-input').max=pages;
    $('detail-first').disabled=$('detail-prev').disabled=detail.page===0;$('detail-next').disabled=detail.page>=pages-1;
    if(detailWorker)detailWorker.terminate();
    function accept(m){if(m.id!==detailId||!$('details-dialog').open)return;if(m.type==='page'){lastPage=m;renderDetailPage(m);}else if(m.type==='error'){$('detail-rows').innerHTML='<tr><td colspan="5" class="empty-state">조합을 불러오지 못했습니다.</td></tr>';}}
    function fallback(){setTimeout(()=>{if(id!==detailId||!detail)return;const result=E.pageCombinations(detail.ctx,detail.n,payload.offset,payload.limit,detail.state.countMode);accept({type:'page',id,...result});},10);}
    try{detailWorker=new Worker('./worker.js');detailWorker.onmessage=e=>accept(e.data);detailWorker.onerror=fallback;detailWorker.postMessage(payload);}catch(_){fallback();}
  }
  function renderDetailPage(page){
    if(!detail)return;const w=D.weapons.find(w=>w.id===detail.weaponId);
    $('detail-rows').innerHTML=page.rows.map((r,i)=>`<tr><td>${fmt(detail.page*detail.pageSize+i+1)}</td><td>${r.counts.map((n,i)=>n?`<span class="combo-piece">${escape(detail.ctx.active[i].name)}<b>${n}</b></span>`:'').join('')}</td><td>${r.damage.toFixed(3)}</td><td>+${Math.max(0,r.excess).toFixed(3)}</td><td>${timeRange(r.minShots,r.maxShots,w)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">표시할 조합이 없습니다.</td></tr>';
    document.querySelector('.details-scroll').scrollTop=0;
  }
  function renderSources(){
    const w=weapon();
    $('source-content').innerHTML=`<h3>현재 선택한 무기 · ${escape(w.name)}</h3><p>${escape(w.note)}<br>분석 자료 버전 ${escape(w.sourceVersion)} · 계산 가능 범위 0–${w.maxDistance}m</p><p><a href="${escape(w.sourceUrl)}" target="_blank" rel="noopener">총기 분석 자료 ↗</a>${w.rawSourceUrl?` · <a href="${escape(w.rawSourceUrl)}" target="_blank" rel="noopener">공개 원본 곡선 ↗</a>`:''}</p><div class="model-select"><label for="data-model">피해 계산 기준</label><select id="data-model"><option value="auto">대조한 원본 곡선 우선 · 없는 총은 보간</option><option value="sampled">모든 총을 경기 기록 분석 지점으로 보간</option></select></div><h3>거리별 피해</h3><p>곡선 대조: 공개 원본의 선형·곡선 보간 방식과 기울기를 적용하고, 현재 경기 기록 분석 지점과 대조한 모델입니다. 공개 원본은 2023년 자료이므로 최신 게임 파일의 정확한 복제라고 보장하지 않습니다.</p><p>보간·추정: 현재 분석 지점 사이를 선형 보간합니다. 1m 단위 입력은 가능하지만 모든 1m 값이 실제 측정값인 것은 아닙니다. 두 방식 모두 현재 분석 범위 밖은 계산하지 않습니다. 경계의 STK는 작은 피해 오차에 따라 달라질 수 있습니다.</p><h3>중복조합과 STK</h3><p>13개 부위 중 같은 부위를 여러 번 맞힐 수 있습니다. 순서는 구분하지 않습니다. 좌우 상완처럼 동일 부위의 좌우는 합치고, 손과 발처럼 부위 이름이 다르면 피해가 같아도 별개로 셉니다. 부위 수가 k, 탄수가 N일 때 전체 구성은 C(k+N−1, N)개입니다.</p><p><strong>N발 이내:</strong> N발 구성의 피해 합이 HP 이상인 모든 구성. 더 적은 탄수로 이미 기절하는 구성을 포함합니다. 서로 다른 탄수 행의 개수는 합산하지 마세요.<br><strong>정확히 N발 필요:</strong> 피해 합이 HP 이상이고, 어느 한 발을 빼도 HP 미만인 구성. 모든 탄이 기절에 필요한 조합만 셉니다.</p><h3>TTK와 RPM</h3><p>첫 발은 0초에 발사합니다. 일정 RPM일 때 TTK=(필요 탄수−1)×60÷RPM입니다. 비행 시간·반동·재장전은 포함하지 않습니다. N발 이내 조합은 명중 순서에 따라 기절 시점이 달라질 수 있어, 가장 빠른 기절과 가장 늦은 기절 사이를 표시합니다. 순서를 세어 조합 수에 가중하지는 않습니다.</p><p>RPM 첫 옵션은 현재 PUBGIntel의 표기 제원이며 경기 기록 기반 발사 속도도 선택할 수 있습니다. 단발은 클릭 속도 가정입니다. 점사 내부 제원은 점사 사이의 지연을 제외한 이상적 간격이고, 기록 기반 점사 모드는 복원한 간격 패턴을 쓰므로 근사치입니다. RPM을 직접 입력하면 일정 간격으로 계산합니다.</p><h3>공통 조건</h3><p>온전한 헬멧·조끼, 동일 거리, 전탄 명중 기준입니다. 방어구 파괴·관통·회복·기절 후 마무리는 계산하지 않습니다. 총피해는 이론적인 합계로, 남은 체력에서 잘라 표시하지 않습니다. 조합 비율은 실제 발생 확률이 아닙니다.</p><h3>출처</h3><ul>${D.sources.map(s=>`<li><a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.name)} ↗</a></li>`).join('')}</ul><p class="source-note">자료 기준: ${escape(D.sourceDataUpdatedAt||D.updatedAt)} · 분석 페이지 표기 패치 ${escape(D.patch||'43.2')}<br>각 무기의 데이터 수집 버전과 분석 범위는 서로 다릅니다. PUBG / KRAFTON과 관계없는 비공식 분석 도구입니다.</p>`;
    $('data-model').value=state.model;
    $('data-model').addEventListener('change',e=>{state.model=e.target.value;update();renderSources();});
  }
  $('max-stk').innerHTML=Array.from({length:15},(_,i)=>`<option value="${i+1}">${i+1}발까지</option>`).join('');
  $('data-version').textContent=`PATCH ${D.patch||'43.2'} · ${D.weapons.length} WEAPONS`;
  $('footer-meta').textContent=`분석 자료 ${D.sourceDataUpdatedAt||D.updatedAt} · 비공식 도구 · 첫 발 0초 기준`;
  for(const id of ['distance','hp']){
    $(id).addEventListener('input',e=>{state[id]=Number(e.target.value);update();});
    $(id+'-number').addEventListener('input',e=>{if(e.target.value===''||!Number.isFinite(Number(e.target.value)))return;state[id]=clamp(e.target.value,id==='hp'?1:0,id==='hp'?100:500,state[id]);update();});
    $(id+'-number').addEventListener('change',e=>{state[id]=clamp(e.target.value,id==='hp'?1:0,id==='hp'?100:500,state[id]);update();});
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.distance!==undefined){state.distance=Number(b.dataset.distance);update();}
    if(b.dataset.hp!==undefined){state.hp=Number(b.dataset.hp);update();}
    for(const key of ['helmet','vest'])if(b.dataset[key]!==undefined){state[key]=Number(b.dataset[key]);update();}
    if(b.dataset.weapon)selectWeapon(b.dataset.weapon);
    if(b.dataset.class){state.classFilter=b.dataset.class;renderWeapons();}
    if(b.dataset.count){state.countMode=b.dataset.count;update();}
    if(b.dataset.map){state.mapMode=b.dataset.map;renderMap();persist();}
    if(b.dataset.details)openDetails(Number(b.dataset.details));
    if(b.dataset.comparisonDetails){const result=comparison.find(x=>x.id===b.dataset.comparisonDetails);openDetails(state.compareStk,result.id,result.count);}
    if(b.dataset.zonePreset){state.zones=b.dataset.zonePreset==='all'?D.zones.map(z=>z.id):b.dataset.zonePreset==='nohead'?D.zones.filter(z=>z.armor!=='helmet').map(z=>z.id):D.zones.filter(z=>z.armor==='vest').map(z=>z.id);update();}
    if(b.classList.contains('close-dialog'))b.closest('dialog').close();
  });
  $('weapon-search').addEventListener('input',e=>{state.search=e.target.value;renderWeapons();});
  $('max-stk').addEventListener('change',e=>{state.maxStk=Number(e.target.value);state.compareStk=Math.min(state.compareStk,state.maxStk);update();});
  $('compare-stk').addEventListener('change',e=>{state.compareStk=Number(e.target.value);update();});
  $('compare-class').addEventListener('change',e=>{state.compareClass=e.target.value;renderComparison();persist();});
  document.querySelectorAll('[data-compare-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.compareSort;
    if(state.compareSort===key)state.compareSortDirection=state.compareSortDirection==='desc'?'asc':'desc';
    else{state.compareSort=key;state.compareSortDirection='desc';}
    renderComparison(comparison.length===0);persist();
  }));
  $('comparison-rows').addEventListener('contextmenu',event=>{
    const row=event.target.closest('tr[data-weapon-id]');if(!row)return;
    event.preventDefault();event.stopPropagation();openRowColorMenu(row,event);
  });
  $('comparison-rows').addEventListener('keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    const row=event.target.closest('tr[data-weapon-id]');if(!row)return;
    event.preventDefault();openRowColorMenu(row,{clientX:0,clientY:0});
  });
  $('row-color-menu').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!rowColorTarget)return;
    event.stopPropagation();
    if(button.id==='row-color-clear-all')rowColors={};
    else if(Object.hasOwn(rowColorNames,button.dataset.rowColorChoice)){
      const color=button.dataset.rowColorChoice;
      if(rowColors[rowColorTarget]===color)delete rowColors[rowColorTarget];else rowColors[rowColorTarget]=color;
    }else return;
    saveRowColors();applyRowColors();closeRowColorMenu(true);
  });
  $('row-color-menu').addEventListener('contextmenu',event=>event.preventDefault());
  $('row-color-menu').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeRowColorMenu(true);return;}
    if(event.key==='Tab'){closeRowColorMenu();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=[...$('row-color-menu').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus({preventScroll:true});
  });
  document.addEventListener('pointerdown',event=>{if(!$('row-color-menu').hidden&&!$('row-color-menu').contains(event.target))closeRowColorMenu();});
  document.addEventListener('contextmenu',event=>{if(!event.target.closest('#row-color-menu'))closeRowColorMenu();});
  document.addEventListener('scroll',()=>{if(!$('row-color-menu').hidden)closeRowColorMenu();},true);
  window.addEventListener('resize',()=>closeRowColorMenu());
  $('fire-mode').addEventListener('change',e=>{state.modeIds[state.weaponId]=e.target.value;delete state.rpmOverrides[state.weaponId];update(false);});
  $('rpm-input').addEventListener('change',e=>{state.rpmOverrides[state.weaponId]=clamp(e.target.value,1,3000,Math.round(mode().rpm));update(false);});
  $('rpm-input').addEventListener('input',e=>{const n=Number(e.target.value);if(e.target.value===''||!Number.isFinite(n)||n<1||n>3000)return;state.rpmOverrides[state.weaponId]=Math.round(n);update(false);});
  $('rpm-reset').addEventListener('click',()=>{delete state.rpmOverrides[state.weaponId];update(false);});
  $('zone-checks').addEventListener('change',e=>{const id=e.target.dataset.zoneCheck;if(!id)return;state.zones=e.target.checked?[...new Set([...state.zones,id])]:state.zones.filter(x=>x!==id);update();});
  $('damage-map').addEventListener('click',e=>{const z=e.target.closest('[data-zone]');if(z){state.selectedZone=z.dataset.zone;renderMap();}});
  $('damage-map').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const z=e.target.closest('[data-zone]');if(z){e.preventDefault();state.selectedZone=z.dataset.zone;renderMap();}}});
  $('damage-map').addEventListener('mouseover',e=>{const z=e.target.closest('[data-zone]');if(z)renderHitDetail(z.dataset.zone);});
  $('damage-map').addEventListener('mouseleave',()=>renderHitDetail(state.selectedZone));
  $('detail-first').addEventListener('click',()=>{detail.page=0;loadDetailPage();});$('detail-prev').addEventListener('click',()=>{detail.page--;loadDetailPage();});$('detail-next').addEventListener('click',()=>{detail.page++;loadDetailPage();});
  function jump(){if(detail){detail.page=clamp($('detail-page-input').value,1,Math.ceil(detail.total/detail.pageSize))-1;loadDetailPage();}}
  $('detail-go').addEventListener('click',jump);$('detail-page-input').addEventListener('keydown',e=>{if(e.key==='Enter')jump();});
  $('details-dialog').addEventListener('close',()=>{++detailId;if(detailWorker){detailWorker.terminate();detailWorker=null;}lastPage=null;});
  for(const id of ['sources-dialog','details-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  function showSources(){renderSources();$('sources-dialog').showModal();}
  $('source-button').addEventListener('click',showSources);$('footer-source').addEventListener('click',showSources);
  $('reset-button').addEventListener('click',()=>{state=structuredClone(defaults);location.hash='';$('weapon-search').value='';renderWeapons();update();toast('기본 조건으로 돌아왔습니다.');});
  $('share-button').addEventListener('click',async()=>{
    const p=new URLSearchParams({w:state.weaponId,d:state.distance,hp:state.hp,h:state.helmet,v:state.vest,n:state.maxStk,c:state.compareStk,mode:state.countMode,model:state.model,z:state.zones.join(','),sort:state.compareSort,dir:state.compareSortDirection});
    if(state.rpmOverrides[state.weaponId])p.set('rpm',state.rpmOverrides[state.weaponId]);if(state.modeIds[state.weaponId])p.set('fire',state.modeIds[state.weaponId]);
    const url=location.href.split('#')[0]+'#'+p.toString();history.replaceState(null,'','#'+p.toString());
    try{await navigator.clipboard.writeText(url);toast('현재 조건의 링크를 복사했습니다.');}catch(_){toast('주소창에 현재 조건을 반영했습니다. 주소를 복사해 주세요.');}
  });
  renderWeapons();update();
  // Small public surface for deterministic diagnostics, without a server or external API.
  globalThis.STK_LAB={getState:()=>structuredClone(state),getCounts:()=>[...counts],getComparison:()=>structuredClone(comparison)};
})();
