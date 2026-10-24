importScripts('./data.js','./engine.js');
self.onmessage = function(event) {
  const m=event.data, E=PUBG_ENGINE, D=PUBG_DATA;
  try {
    if(m.type==='page') {
      const weapon=D.weapons.find(w=>w.id===m.weaponId), ctx=E.context(weapon,m.state,D);
      const page=E.pageCombinations(ctx,m.n,m.offset,m.limit,m.state.countMode);
      self.postMessage({type:'page',id:m.id,weaponId:m.weaponId,n:m.n,...page});
      return;
    }
    const selected=D.weapons.find(w=>w.id===m.weaponId);
    const ctx=E.context(selected,m.state,D), counts=[];
    for(let n=1;n<=m.state.maxStk;n++) counts.push(E.countCombinations(ctx,n,m.state.countMode));
    self.postMessage({type:'selected',id:m.id,weaponId:m.weaponId,counts});
    const comparison=[];
    for(const weapon of D.weapons) {
      const context=E.context(weapon,m.state,D);
      comparison.push({id:weapon.id,count:context ? E.countCombinations(context,m.state.compareStk,m.state.countMode) : null});
    }
    self.postMessage({type:'summary',id:m.id,counts,comparison});
  } catch(error) { self.postMessage({type:'error',id:m.id,message:String(error?.message||error)}); }
};
