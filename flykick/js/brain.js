/* ============================================================
   FLYKICK brain — a mini fruit-fly circuit per player.
   Sensory (compound eyes, wind hairs) → optic lobe (T4/T5) →
   central complex (CX steering) + mushroom body (MB memory) →
   wing/leg motor neurons. Each fly has its own firing state;
   the engine reads motor outputs to steer/kick.
   ============================================================ */

const FLY_BRAIN = {
  // id, label, class, region-tag for the brain cam
  neurons: [
    {id:'R1_6',  label:'photoreceptors', cls:'sensory', ax:0.06, ay:0.30},   // sees ball/flies
    {id:'JO',    label:'wind hairs',     cls:'sensory', ax:0.06, ay:0.68},   // feels ball touch/kick
    {id:'T4',    label:'T4 ON-motion',   cls:'relay',   ax:0.28, ay:0.30},
    {id:'T5',    label:'T5 OFF-motion',   cls:'relay',   ax:0.28, ay:0.68},
    {id:'HS',    label:'HS wide-field',  cls:'relay',   ax:0.46, ay:0.42},   // ball heading estimate
    {id:'CX_EB', label:'central complex',cls:'relay',   ax:0.62, ay:0.24},  // steering decisions
    {id:'KC',    label:'kenyon cells',    cls:'learn',   ax:0.55, ay:0.72},  // remembers plays
    {id:'MBON',  label:'MB output',      cls:'learn',   ax:0.70, ay:0.72},
    {id:'DN',    label:'descending',     cls:'relay',   ax:0.80, ay:0.44},  // command channel
    {id:'WING',  label:'wing motor',     cls:'motor',   ax:0.93, ay:0.30},  // propulsion
    {id:'TTM',   label:'leg motor',      cls:'motor',   ax:0.93, ay:0.66},  // kick!
  ],
  // [from, to, weight] — excitation cascade eye→brain→motors
  synapses: [
    ['R1_6','T4',.9], ['R1_6','T5',.7],
    ['JO','T5',.6],
    ['T4','HS',.9], ['T5','HS',.6],
    ['HS','CX_EB',.85], ['HS','MBON',.4],
    ['KC','MBON',.7],
    ['CX_EB','DN',.9], ['MBON','DN',.5],
    ['DN','WING',.95], ['DN','TTM',.7],
  ],
};
FLY_BRAIN.clsColor = {sensory:'#00e5ff', relay:'#7c6cff', learn:'#ffd166', motor:'#3ddc97'};
FLY_BRAIN.byid = Object.fromEntries(FLY_BRAIN.neurons.map(n=>[n.id,n]));

class FlyBrain {
  constructor(){
    this.firing = {};                       // id → 0..1
    this.flash = {};                        // id → 1..0 (visual)
    FLY_BRAIN.neurons.forEach(n=>{ this.firing[n.id]=0; this.flash[n.id]=0; });
    this.history = [];                      // global activity ring
  }
  // sensory trigger: 'see' (visual), 'touch' (ball contact), 'kick' (motor burst)
  sense(kind, strength=1){
    if (kind==='see')  { this.pulse('R1_6', strength); this.pulse('JO', strength*.3); }
    if (kind==='touch'){ this.pulse('JO', strength); }
    if (kind==='kick') { this.pulse('DN', strength); this.pulse('TTM', strength); }
    if (kind==='learn'){ this.pulse('KC', strength); }
  }
  pulse(id, s){
    const n = FLY_BRAIN.byid[id]; if(!n) return;
    this.firing[id] = Math.min(1, (this.firing[id]||0) + s*.8);
    this.flash[id] = 1;
    // propagate
    FLY_BRAIN.synapses.forEach(([from,to,w])=>{
      if (from===id && s*w > .12) {
        this.firing[to] = Math.min(1,(this.firing[to]||0)+s*w*.7);
        this.flash[to] = Math.max(this.flash[to]||0, .8);
      }
    });
  }
  step(dt=16){
    // decay
    FLY_BRAIN.neurons.forEach(n=>{
      this.flash[n.id] = Math.max(0, this.flash[n.id]-dt/320);
      this.firing[n.id] *= Math.pow(.5, dt/200);
    });
    const act = Object.values(this.firing).reduce((a,b)=>a+b,0)/FLY_BRAIN.neurons.length;
    this.history.push(act); if(this.history.length>240) this.history.shift();
    return act;
  }
  motorReadout(){
    return { thrust:this.firing['WING']||0, kick:this.firing['TTM']||0 };
  }
}
window.FLY_BRAIN = FLY_BRAIN;
window.FlyBrain = FlyBrain;
