// Drives the real orchestrator like one UI session (no mocks). replies() = events sent to that session by the last send;
// arrive(id) = the adapter reports robot id at its current target.
const O=require('../../data/lib/orchestrator');
const seed=require('../../data/site.demo.json');
module.exports=function harness(site=structuredClone(seed)) {
  let now=1e12, last={ui:[]};
  const st=O.init(site,now);
  return {st, get site(){return site;},
    send(data){const r=O.handle(st,site,{source:'ui',data:{by:'test',...data},session:'test',seed},now);
      if(r.site)site=r.site;return last=r;},
    replies(){return last.ui.filter(u=>u.session==='test').map(u=>JSON.parse(u.payload)).filter(p=>p.type==='event');},
    tick(ms){now+=ms;return O.handle(st,site,{source:'adapter',data:{event:'telemetry',robots:[]}},now);},
    arrive(id){return O.handle(st,site,{source:'adapter',data:{event:'arrived',robot:id,token:st.robots[id].token}},now);}
  };
};
