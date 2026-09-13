/* ============================================================
   FLYKICK input — keyboard + click-to-possess.
   WASD/Arrows move, Space kick (hold=charge), Q release.
   Click any fly → possess it (either team, any time).
   ============================================================ */

const Input = {
  keys:{}, up:false, down:false, left:false, right:false,
  kick:false, kickRelease:false,

  init(){
    window.addEventListener('keydown',e=>{
      if(e.repeat) return this.update();
      this.keys[e.code]=true;
      if(e.code==='Space') { this.kick=true; e.preventDefault(); }
      if(e.code==='KeyQ') Engine.release();
      this.update();
    });
    window.addEventListener('keyup',e=>{
      this.keys[e.code]=false;
      if(e.code==='Space') { this.kick=false; this.kickRelease=true; }
      this.update();
    });
    document.getElementById('pitch').addEventListener('pointerdown',e=>{
      if(Engine.state!=='play' && Engine.state!=='kickoff') return;
      const rect=Render.canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      // find nearest fly to click (in world coords)
      let best=null, bd=1e9;
      Engine.flies.forEach(f=>{
        const d=Math.hypot(Render.wx(f.x)-mx, Render.wy(f.y)-my);
        if(d<bd){bd=d;best=f;}
      });
      if(best && bd < 34){ Engine.possess(best); AUDIO.buzz(); }
    });
  },
  update(){
    this.up    = this.keys['KeyW']||this.keys['ArrowUp']||false;
    this.down  = this.keys['KeyS']||this.keys['ArrowDown']||false;
    this.left  = this.keys['KeyA']||this.keys['ArrowLeft']||false;
    this.right = this.keys['KeyD']||this.keys['ArrowRight']||false;
  },
  frame(){ // returns snapshot; clears one-shot flags after engine step
    const s={up:this.up,down:this.down,left:this.left,right:this.right,kick:this.kick,kickRelease:this.kickRelease};
    this.kickRelease=false;
    return s;
  },
};
