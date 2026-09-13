/* ============================================================
   FLYKICK audio — procedural match soundscape.
   Crowd bed (filtered noise), kick thumps, whistle, goal fanfare,
   wing buzz for the possessed fly. Zero audio files.
   ============================================================ */

const AUDIO = {
  ctx:null, on:false, master:null, crowdGain:null, crowdSrc:null,

  ensure(){
    if (!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value=.55;
      const comp=this.ctx.createDynamicsCompressor(); comp.threshold.value=-20; comp.ratio.value=6;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      // long noise buffer for the crowd
      const len=this.ctx.sampleRate*2;
      this.crowdBuf=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
      const d=this.crowdBuf.getChannelData(0);
      let l=0;
      for(let i=0;i<len;i++){ l=l*.97+(Math.random()*2-1)*.03; d[i]=l*3; } // brown-ish murmur
    }
    if(this.ctx.state==='suspended') this.ctx.resume();
  },
  toggle(){
    this.on=!this.on;
    if(this.on){ this.ensure(); this.startCrowd(); } else this.stopCrowd();
    return this.on;
  },
  startCrowd(){
    if(!this.on||this.crowdSrc) return;
    this.crowdSrc=this.ctx.createBufferSource();
    this.crowdSrc.buffer=this.crowdBuf; this.crowdSrc.loop=true;
    this.crowdFilter=this.ctx.createBiquadFilter(); this.crowdFilter.type='bandpass';
    this.crowdFilter.frequency.value=520; this.crowdFilter.Q.value=.6;
    this.crowdGain=this.ctx.createGain(); this.crowdGain.gain.value=.045;
    this.crowdSrc.connect(this.crowdFilter); this.crowdFilter.connect(this.crowdGain);
    this.crowdGain.connect(this.master); this.crowdSrc.start();
  },
  stopCrowd(){ if(this.crowdSrc){try{this.crowdSrc.stop()}catch(e){} this.crowdSrc=null;} },
  crowdSwell(amount=.3){ // excitement rises
    if(!this.on||!this.crowdGain) return;
    const t=this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setValueAtTime(this.crowdGain.gain.value,t);
    this.crowdGain.gain.linearRampToValueAtTime(.045+amount,t+.15);
    this.crowdGain.gain.linearRampToValueAtTime(.045,t+2.2);
  },

  kick(charge=0){
    if(!this.on) return;
    const t=this.ctx.currentTime, p=.5+charge*.5;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(120*p,t);
    o.frequency.exponentialRampToValueAtTime(46,t+.1);
    g.gain.setValueAtTime(.5*p,t); g.gain.exponentialRampToValueAtTime(.001,t+.14);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+.15);
    // click transient
    const n=this.ctx.createBufferSource(); n.buffer=this.noise();
    const ng=this.ctx.createGain(); ng.gain.setValueAtTime(.25*p,t);
    ng.gain.exponentialRampToValueAtTime(.001,t+.05);
    n.connect(ng); ng.connect(this.master); n.start(t);
    this.crowdSwell(.15);
  },
  wall(){ if(!this.on)return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type='triangle';o.frequency.setValueAtTime(300,t);o.frequency.exponentialRampToValueAtTime(140,t+.08);
    g.gain.setValueAtTime(.14,t);g.gain.exponentialRampToValueAtTime(.001,t+.09);
    o.connect(g);g.connect(this.master);o.start(t);o.stop(t+.1); },

  whistle(n=1){
    if(!this.on) return;
    for(let i=0;i<n;i++){
      const t=this.ctx.currentTime+i*.45;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type='square'; o.frequency.setValueAtTime(2350,t);
      o.frequency.setValueAtTime(2280,t+.12);
      g.gain.setValueAtTime(.11,t); g.gain.setValueAtTime(.11,t+.24);
      g.gain.exponentialRampToValueAtTime(.001,t+.32);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t+.33);
    }
  },
  goal(){
    if(!this.on) return;
    this.crowdSwell(.55);
    const t=this.ctx.currentTime;
    // rising fanfare arpeggio
    [392,494,587,784].forEach((f,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type='triangle'; o.frequency.value=f;
      const st=t+i*.09;
      g.gain.setValueAtTime(.0,st); g.gain.linearRampToValueAtTime(.22,st+.02);
      g.gain.exponentialRampToValueAtTime(.001,st+.5);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st+.55);
    });
  },
  buzz(){ // possessed fly wing hum — short
    if(!this.on) return;
    const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(170,t);
    g.gain.setValueAtTime(.0,t); g.gain.linearRampToValueAtTime(.05,t+.05);
    g.gain.linearRampToValueAtTime(.0,t+.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+.32);
  },
  _noiseBuf:null,
  noise(){
    if(!this._noiseBuf){
      const len=this.ctx.sampleRate*.1;
      this._noiseBuf=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
      const d=this._noiseBuf.getChannelData(0);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
    }
    return this._noiseBuf;
  },
};
