'use strict';
// ZERO HOUR — FPS Game Engine
// Built with Three.js r160

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const G       = 22;       // gravity m/s²
const PH      = 1.75;     // player eye height
const PR      = 0.38;     // player radius
const JFORCE  = 8.5;      // jump velocity
const SENS    = 0.0022;   // mouse sensitivity
const MAXPITCH= Math.PI/2 - 0.06;
const FSTEP   = 0.42;     // footstep interval (seconds)

// Segment-vs-AABB occlusion test (slab method).
// from/to are world points; boxes have min/max Vector3s.
function segmentBlocked(from, to, boxes) {
  const dx = to.x-from.x, dy = to.y-from.y, dz = to.z-from.z;
  for (const b of boxes) {
    let tmin = 0, tmax = 1;
    let ok = true;
    const axes = [[dx, from.x, b.min.x, b.max.x],
                  [dy, from.y, b.min.y, b.max.y],
                  [dz, from.z, b.min.z, b.max.z]];
    for (const [d, o, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok) return true;
  }
  return false;
}

// Difficulty presets (enemy hp / enemy damage / score multiplier)
const DIFFICULTY = {
  easy:   { label:'Easy',   hp:0.7, dmg:0.6, score:0.75 },
  normal: { label:'Normal', hp:1.0, dmg:1.0, score:1.0  },
  hard:   { label:'Hard',   hp:1.5, dmg:1.5, score:1.5  },
};

// ═══════════════════════════════════════════════════════════
//  SETTINGS  (persisted in localStorage)
// ═══════════════════════════════════════════════════════════
class Settings {
  constructor() {
    this._d = { sensitivity:1.0, volume:0.45, quality:'auto' };
    try { Object.assign(this._d, JSON.parse(localStorage.getItem('zh_s')||'{}')); } catch(e) {}
  }
  get(k) { return this._d[k]; }
  set(k,v) { this._d[k]=v; try { localStorage.setItem('zh_s', JSON.stringify(this._d)); } catch(e) {} }

  detectQuality() {
    if (this._d.quality !== 'auto') return this._d.quality;
    const mobile   = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const mem      = navigator.deviceMemory || 4;
    const cores    = navigator.hardwareConcurrency || 4;
    if (mobile || mem <= 2 || cores <= 2) return 'low';
    if (mem <= 4 || cores <= 4) return 'medium';
    return 'high';
  }
}

// ═══════════════════════════════════════════════════════════
//  TOUCH INPUT
// ═══════════════════════════════════════════════════════════
class TouchInput {
  constructor() {
    this.active = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.joy    = { tid:-1, sx:0, sy:0, x:0, y:0, R:55 };
    this.look   = { tid:-1, lx:0, ly:0 };
    this._mdx=0; this._mdy=0;
    this._fire=false; this._fireJust=false;
    this._ads=false;
    this._keys = {};
    this._wdir = 0;
    if (this.active) this._bind();
  }

  _bind() {
    if (typeof document === 'undefined') return;
    document.body.classList.add('touch');

    const jzone = document.getElementById('jzone');
    const knob  = document.getElementById('jknob');

    // Joystick zone
    jzone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this.joy.tid !== -1) return;
      this.joy.tid = t.identifier;
      this.joy.sx  = t.clientX;
      this.joy.sy  = t.clientY;
      this.joy.x   = 0; this.joy.y = 0;
      const base = document.getElementById('jbase');
      base.style.left = (t.clientX - 55)+'px';
      base.style.bottom = (window.innerHeight - t.clientY - 55)+'px';
    }, {passive:false});

    // Look zone — drag to look, tap = fire
    const lzone = document.getElementById('lzone');
    lzone.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.look.tid !== -1) continue;
        this.look.tid = t.identifier;
        this.look.lx  = t.clientX;
        this.look.ly  = t.clientY;
        this._fire = true;
        this._fireJust = true;
      }
    }, {passive:false});

    // Global move
    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.tid) {
          const dx  = t.clientX - this.joy.sx;
          const dy  = t.clientY - this.joy.sy;
          const len = Math.sqrt(dx*dx+dy*dy);
          const R   = this.joy.R;
          const ang = Math.atan2(dy, dx);
          const clamped = Math.min(len, R);
          this.joy.x = Math.cos(ang)*clamped/R;
          this.joy.y = Math.sin(ang)*clamped/R;
          knob.style.left = (32 + Math.cos(ang)*clamped*0.72)+'px';
          knob.style.top  = (32 + Math.sin(ang)*clamped*0.72)+'px';
        }
        if (t.identifier === this.look.tid) {
          this._mdx += (t.clientX - this.look.lx) * 1.8;
          this._mdy += (t.clientY - this.look.ly) * 1.8;
          this.look.lx = t.clientX;
          this.look.ly = t.clientY;
        }
      }
    }, {passive:true});

    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.tid) {
          this.joy.tid=-1; this.joy.x=0; this.joy.y=0;
          knob.style.left='32px'; knob.style.top='32px';
        }
        if (t.identifier === this.look.tid) {
          this.look.tid=-1; this._fire=false;
        }
      }
    };
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);

    // Dedicated buttons
    this._btn('t-fire',   v => { this._fire=v; if(v) this._fireJust=true; });
    this._btn('t-jump',   v => this._keys.Space=v);
    this._btn('t-crouch', v => this._keys.KeyC=v);
    this._btn('t-ads',    v => { this._ads=v; document.getElementById('t-ads').classList.toggle('ads-active',v); });
    this._btn('t-reload', v => { if(v){ this._keys.KeyR=true; setTimeout(()=>this._keys.KeyR=false,120); }});
    this._btn('t-prev',   v => { if(v) this._wdir=-1; });
    this._btn('t-next',   v => { if(v) this._wdir=1;  });
    this._btn('t-pause',  v => { if(v) window._game?._pause(); });
    document.getElementById('pausebtn')?.addEventListener('click', () => window._game?._pause());
  }

  _btn(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); fn(true); }, {passive:false});
    el.addEventListener('touchend',   () => fn(false));
    el.addEventListener('touchcancel',() => fn(false));
  }

  getMouse(sensMult=1) {
    const dx = this._mdx * sensMult, dy = this._mdy * sensMult;
    this._mdx=0; this._mdy=0;
    const fj = this._fireJust; this._fireJust=false;
    return { dx, dy, left:this._fire, leftJustPressed:fj, right:this._ads };
  }

  getKeys() {
    const {x,y} = this.joy;
    return { ...this._keys,
      KeyW: y < -0.2, KeyS: y > 0.2, KeyA: x < -0.2, KeyD: x > 0.2,
      ShiftLeft: Math.sqrt(x*x+y*y) > 0.85 };
  }

  consumeWdir() { const d=this._wdir; this._wdir=0; return d; }

  show() { document.getElementById('tc')?.classList.remove('hidden'); }
  hide() { document.getElementById('tc')?.classList.add('hidden'); }
}

// ═══════════════════════════════════════════════════════════
//  GAMEPAD INPUT
// ═══════════════════════════════════════════════════════════
class GamepadInput {
  constructor() {
    this._idx = -1;
    this._prevFire = false;
    window.addEventListener('gamepadconnected',    e => { this._idx = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', e => { if(e.gamepad.index===this._idx) this._idx=-1; });
  }

  poll() {
    if (this._idx === -1) return null;
    const gp = navigator.getGamepads()[this._idx];
    if (!gp) return null;
    const ax = gp.axes, bt = gp.buttons;
    const fire = !!(bt[7]?.pressed || bt[5]?.pressed);
    const just = fire && !this._prevFire;
    this._prevFire = fire;
    return {
      keys: {
        KeyW: ax[1] < -.25, KeyS: ax[1] > .25, KeyA: ax[0] < -.25, KeyD: ax[0] > .25,
        Space:     !!(bt[0]?.pressed),
        KeyC:      !!(bt[1]?.pressed),
        ShiftLeft: !!(bt[10]?.pressed) || Math.hypot(ax[0],ax[1]) > .85,
        KeyR:      !!(bt[2]?.pressed),
      },
      mouse: { dx: ax[2]*9, dy: ax[3]*9, left:fire, leftJustPressed:just, right:!!(bt[6]?.pressed||bt[4]?.pressed) },
      wdir: bt[4]?.pressed ? -1 : bt[5]?.pressed ? 1 : 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════
//  AUDIO ENGINE  (procedural Web Audio API)
// ═══════════════════════════════════════════════════════════
class AudioEngine {
  constructor() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      this.ok = true;
    } catch(e) { this.ok = false; }
    this._noiseBufs = {};
  }

  resume() { if (this.ok && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noise(dur) {
    const k = Math.round(dur*100);
    if (this._noiseBufs[k]) return this._noiseBufs[k];
    const n = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random()*2-1;
    return (this._noiseBufs[k] = buf);
  }

  _osc(type,freq,freqEnd,dur,vol,startAt=0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + startAt;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq,t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t+dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+dur);
  }

  _nse(dur,vol,filterFreq=1000,startAt=0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + startAt;
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t);
  }

  shot(type) {
    if (!this.ok) return;
    switch(type) {
      case 'pistol':
        this._osc('sawtooth',180,45,.14,.7);
        this._nse(.1,.4,1800); break;
      case 'rifle':
        this._osc('square',260,70,.09,.6);
        this._nse(.07,.3,2400); break;
      case 'shotgun':
        this._nse(.32,1.4,600);
        this._osc('sawtooth',80,20,.32,.9); break;
      case 'sniper':
        this._osc('sawtooth',420,90,.22,1.0);
        this._nse(.15,.5,3000); break;
      case 'rocket':
        this._osc('sawtooth',110,28,.6,1.1);
        this._nse(.5,.6,400); break;
    }
  }
  reload() {
    this._osc('square',750,600,.05,.25);
    this._osc('square',550,440,.05,.2,.28);
    this._osc('square',900,700,.05,.15,.55);
  }
  explosion() {
    this._nse(1.1,2.0,450);
    this._osc('sawtooth',60,18,.8,1.2);
  }
  hit(kill=false) {
    if (kill) { this._osc('sine',1200,600,.12,.25); }
    else { this._osc('sine',900,800,.06,.18); }
  }
  pain() { this._osc('sawtooth',280,90,.3,.35); }
  pickup() {
    [400,600,800].forEach((f,i) => this._osc('sine',f,f+100,.12,.22,i*.09));
  }
  levelDone() {
    [523,659,784,1047].forEach((f,i) => this._osc('sine',f,f,.22,.35,i*.16));
  }
  footstep() { this._nse(.06,.12,180); }
  empty() { this._osc('square',140,100,.05,.15); }
  enemyGrowl() { this._osc('sawtooth',80,40,.3,.2); }
}

// ═══════════════════════════════════════════════════════════
//  PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════
class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = [];
  }

  _emit(count, pos, color, spread, speed, life, size=0.06, grav=false) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count*3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i*3]   = pos.x;
      positions[i*3+1] = pos.y;
      positions[i*3+2] = pos.z;
      velocities.push(new THREE.Vector3(
        (Math.random()-.5)*spread, (Math.random()-.5)*spread+(grav?speed*.6:0),
        (Math.random()-.5)*spread
      ).multiplyScalar(speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    const mat = new THREE.PointsMaterial({color, size, transparent:true, opacity:1, depthWrite:false, sizeAttenuation:true});
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.pools.push({pts, velocities, life, maxLife:life, count, grav});
  }

  muzzleFlash(pos, dir) {
    this._emit(12, pos, 0xffaa22, 1.2, 6, 0.08);
    // add a brief point light
    const pl = new THREE.PointLight(0xffaa44, 8, 6);
    pl.position.copy(pos).addScaledVector(dir, .8);
    this.scene.add(pl);
    setTimeout(() => this.scene.remove(pl), 50);
  }

  blood(pos, count=18) {
    this._emit(count, pos, 0xaa0000, 2.5, 5, 0.35, 0.07, true);
  }

  spark(pos, count=10) {
    this._emit(count, pos, 0xffdd55, 1.8, 7, 0.25, 0.05);
  }

  explosion(pos) {
    this._emit(40, pos, 0xff6600, 5, 9, 0.6, 0.12, true);
    this._emit(25, pos, 0xff2200, 3, 6, 0.8, 0.08, true);
    this._emit(20, pos, 0xffcc00, 2, 12, 0.4, 0.1);
    const pl = new THREE.PointLight(0xff6600, 20, 18);
    pl.position.copy(pos);
    this.scene.add(pl);
    setTimeout(() => this.scene.remove(pl), 200);
  }

  update(dt) {
    for (let i = this.pools.length-1; i >= 0; i--) {
      const p = this.pools[i];
      p.life -= dt;
      const t = p.life / p.maxLife;
      p.pts.material.opacity = Math.max(0, t*t);

      const pos = p.pts.geometry.attributes.position;
      for (let j = 0; j < p.count; j++) {
        if (p.grav) p.velocities[j].y -= G * dt * 0.3;
        pos.array[j*3]   += p.velocities[j].x * dt;
        pos.array[j*3+1] += p.velocities[j].y * dt;
        pos.array[j*3+2] += p.velocities[j].z * dt;
      }
      pos.needsUpdate = true;

      if (p.life <= 0) {
        this.scene.remove(p.pts);
        p.pts.geometry.dispose();
        p.pts.material.dispose();
        this.pools.splice(i,1);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  FLOATING DAMAGE NUMBERS  (DOM, projected from 3D)
// ═══════════════════════════════════════════════════════════
class DamageNumbers {
  constructor(camera) {
    this.camera = camera;
    this.cont   = document.getElementById('dnums');
    this.items  = [];
    this._v     = new THREE.Vector3();
  }

  spawn(pos, val, headshot) {
    if (this.items.length > 28) { this.items[0].el.remove(); this.items.shift(); }
    const el = document.createElement('div');
    el.className = 'dn' + (headshot ? ' hs' : '');
    el.textContent = val;
    this.cont.appendChild(el);
    this.items.push({ el, pos: pos.clone(), life: 0.8 });
  }

  update(dt) {
    for (let i = this.items.length-1; i >= 0; i--) {
      const d = this.items[i];
      d.life -= dt;
      d.pos.y += 1.6 * dt;
      if (d.life <= 0) { d.el.remove(); this.items.splice(i,1); continue; }
      this._v.copy(d.pos).project(this.camera);
      if (this._v.z > 1) { d.el.style.display = 'none'; continue; }
      d.el.style.display = 'block';
      d.el.style.left    = ((this._v.x*0.5+0.5) * innerWidth) + 'px';
      d.el.style.top     = ((-this._v.y*0.5+0.5) * innerHeight) + 'px';
      d.el.style.opacity = Math.min(1, d.life/0.3);
    }
  }

  clear() {
    this.items.forEach(d => d.el.remove());
    this.items = [];
  }
}

// ═══════════════════════════════════════════════════════════
//  WEAPON DATA
// ═══════════════════════════════════════════════════════════
const WEAPONS = {
  pistol:  { name:'Pistol',           dmg:28,  rate:.32, mag:12,  res:96,  reload:1.4, spread:.018, range:120, type:'hitscan', snd:'pistol',  auto:false, pellets:1, splash:0 },
  rifle:   { name:'Assault Rifle',    dmg:18,  rate:.09, mag:30,  res:240, reload:2.1, spread:.03,  range:100, type:'hitscan', snd:'rifle',   auto:true,  pellets:1, splash:0 },
  shotgun: { name:'Shotgun',          dmg:22,  rate:.75, mag:8,   res:64,  reload:2.8, spread:.14,  range:40,  type:'hitscan', snd:'shotgun', auto:false, pellets:9, splash:0 },
  sniper:  { name:'Sniper Rifle',     dmg:150, rate:.9,  mag:5,   res:40,  reload:2.5, spread:.002, range:500, type:'hitscan', snd:'sniper',  auto:false, pellets:1, splash:0, ads:true, zoom:4 },
  rocket:  { name:'Rocket Launcher',  dmg:120, rate:1.1, mag:4,   res:24,  reload:3.0, spread:.01,  range:200, type:'rocket',  snd:'rocket',  auto:false, pellets:1, splash:5 },
};

// ═══════════════════════════════════════════════════════════
//  WEAPON CLASS
// ═══════════════════════════════════════════════════════════
class Weapon {
  constructor(id, camera) {
    this.id = id;
    this.d  = WEAPONS[id];
    this.camera = camera;
    this.mag    = this.d.mag;
    this.res    = this.d.res;
    this.cooldown  = 0;
    this.reloading = false;
    this.reloadT   = 0;
    this.ads       = false;
    this.recoilT   = 0;
    this.model     = this._buildModel();
  }

  _buildModel() {
    const g = new THREE.Group();
    // Generic gun shapes per type
    const mat = new THREE.MeshPhongMaterial({color:0x222222});
    const mat2 = new THREE.MeshPhongMaterial({color:0x111111});
    switch(this.id) {
      case 'pistol': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(.12,.14,.3), mat);
        const brl  = new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.22), mat2);
        brl.position.set(0,.04,.26);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(.1,.18,.1), mat);
        grip.position.set(0,-.14,.05);
        g.add(body,brl,grip);
        break;
      }
      case 'rifle': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.55), mat);
        const brl  = new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.3), mat2);
        brl.position.set(0,.02,.42);
        const mag  = new THREE.Mesh(new THREE.BoxGeometry(.08,.2,.08), mat2);
        mag.position.set(0,-.14,.05);
        const stk  = new THREE.Mesh(new THREE.BoxGeometry(.09,.08,.2), mat);
        stk.position.set(0,-.02,-.3);
        g.add(body,brl,mag,stk);
        break;
      }
      case 'shotgun': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(.12,.1,.6), mat);
        const brl  = new THREE.Mesh(new THREE.BoxGeometry(.1,.06,.35), mat2);
        brl.position.set(0,.04,.47);
        const stk  = new THREE.Mesh(new THREE.BoxGeometry(.1,.12,.25), mat);
        stk.position.set(0,-.02,-.35);
        g.add(body,brl,stk);
        break;
      }
      case 'sniper': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(.08,.1,.7), mat);
        const brl  = new THREE.Mesh(new THREE.BoxGeometry(.04,.04,.45), mat2);
        brl.position.set(0,.02,.57);
        const scope= new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.22,8), new THREE.MeshPhongMaterial({color:0x333344}));
        scope.rotation.z = Math.PI/2; scope.position.set(0,.1,-.05);
        const stk  = new THREE.Mesh(new THREE.BoxGeometry(.07,.1,.28), mat);
        stk.position.set(0,-.02,-.4);
        g.add(body,brl,scope,stk);
        break;
      }
      case 'rocket': {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.7,10), mat);
        tube.rotation.z = Math.PI/2;
        const tip  = new THREE.Mesh(new THREE.ConeGeometry(.1,.18,10), new THREE.MeshPhongMaterial({color:0x884422}));
        tip.rotation.z = -Math.PI/2; tip.position.set(.44,0,0);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(.08,.2,.1), mat2);
        grip.position.set(0,-.2,.1);
        g.add(tube,tip,grip);
        break;
      }
    }
    // Default position offset on camera
    g.position.set(.28,-.24,.5);
    return g;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this._finishReload();
    }
    // Recoil recovery
    if (this.recoilT > 0) {
      this.recoilT -= dt;
      const k = this.recoilT / .15;
      this.model.rotation.x = -k * .25;
      this.model.position.z = .5 + k * .12;
    } else {
      this.model.rotation.x *= 0.82;
      this.model.position.z += (.5 - this.model.position.z) * 0.2;
    }
    // ADS lerp
    const targetX = this.ads ? -.28 : .28;
    const targetY = this.ads ? -.2  : -.24;
    this.model.position.x += (targetX - this.model.position.x) * .2;
    this.model.position.y += (targetY - this.model.position.y) * .2;
  }

  canFire() {
    return this.cooldown <= 0 && !this.reloading && this.mag > 0;
  }

  fire() {
    this.cooldown = this.d.rate;
    this.mag--;
    this.recoilT = .15;
    if (this.mag === 0 && this.res > 0) this.startReload();
  }

  startReload() {
    if (this.reloading || this.mag === this.d.mag || this.res === 0) return false;
    this.reloading = true;
    this.reloadT   = this.d.reload;
    return true;
  }

  _finishReload() {
    const need = this.d.mag - this.mag;
    const take = Math.min(need, this.res);
    this.mag += take;
    this.res -= take;
    this.reloading = false;
  }

  addAmmo(amount) {
    this.res = Math.min(this.res + amount, this.d.res * 2);
  }
}

// ═══════════════════════════════════════════════════════════
//  PLAYER
// ═══════════════════════════════════════════════════════════
class Player {
  constructor(camera, scene, audio) {
    this.camera   = camera;
    this.scene    = scene;
    this.audio    = audio;

    this.pos      = new THREE.Vector3(0, PH, 8);
    this.vel      = new THREE.Vector3();
    this.yaw      = 0;
    this.pitch    = 0;

    this.hp       = 100;
    this.maxHp    = 100;
    this.armor    = 0;
    this.maxArmor = 100;
    this.stamina  = 1;

    this.onGround    = false;
    this.crouching   = false;
    this.sprinting   = false;
    this.stepTimer   = 0;
    this.bobT        = 0;
    this.isDead      = false;
    this.deathTimer  = 0;
    this.damageCooldown = 0;

    // Speed modifiers (perks)
    this.speedMult  = 1;
    this.dmgMult    = 1;
    this.fireMult   = 1;
    this.regenRate  = 0;

    // Weapons
    this.weapons   = [];
    this.weaponIdx = 0;
    this._addDefaultWeapons(scene);

    // Raycaster for shooting
    this.raycaster = new THREE.Raycaster();

    // Screen shake
    this.shakeAmt  = 0;
    this.shakeOff  = new THREE.Vector3();

    camera.rotation.order = 'YXZ';
    camera.rotation.z = 0;   // clear death-cam roll from a previous run
    camera.fov = 75;
    camera.updateProjectionMatrix();

    // Rockets in flight
    this.rockets = [];
  }

  _addDefaultWeapons(scene) {
    ['pistol','rifle'].forEach(id => this._equip(id, scene));
  }

  _equip(id, scene) {
    if (this.weapons.find(w => w.id === id)) return;
    const w = new Weapon(id, this.camera);
    this.camera.add(w.model);
    w.model.visible = false;
    this.weapons.push(w);
    if (this.weapons.length === 1) this._activate(0);
  }

  addWeapon(id, scene) {
    const existing = this.weapons.find(w => w.id === id);
    if (existing) { existing.addAmmo(existing.d.res); return; }
    this._equip(id, scene);
  }

  _activate(i) {
    if (i < 0 || i >= this.weapons.length) return;
    if (this.weapons[this.weaponIdx]) this.weapons[this.weaponIdx].model.visible = false;
    this.weaponIdx = i;
    this.weapons[i].model.visible = true;
    this.weapons[i].ads = false;
    this.weapons[i].reloading = false;
    this.weapons[i].reloadT   = 0;
    this.weapons[i].cooldown  = 0;
  }

  switchWeapon(i) { this._activate(Math.min(i, this.weapons.length-1)); }

  scrollWeapon(dir) {
    let i = (this.weaponIdx + dir + this.weapons.length) % this.weapons.length;
    this._activate(i);
  }

  get currentWeapon() { return this.weapons[this.weaponIdx]; }

  update(dt, keys, mouse, walls, enemies, pickups, scene, particles, game) {
    if (this.isDead) {
      this.deathTimer -= dt;
      // Death camera: tilt and sink toward the ground
      this.camera.rotation.z += (0.55 - this.camera.rotation.z) * Math.min(1, dt*3);
      this.camera.position.y += ((this.pos.y + 0.4) - this.camera.position.y) * Math.min(1, dt*3);
      return;
    }

    this.damageCooldown -= dt;

    // ── Mouse look
    this.yaw   -= mouse.dx * SENS;
    this.pitch -= mouse.dy * SENS;
    this.pitch  = Math.max(-MAXPITCH, Math.min(MAXPITCH, this.pitch));
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // ── Movement
    const spd = (this.crouching ? 2.8 : (keys.ShiftLeft && this.stamina > 0.05 ? 9*this.speedMult : 5.5*this.speedMult));
    this.sprinting = keys.ShiftLeft && !this.crouching && this.stamina > 0.05;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * .28);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * .18);
    }

    const fwd  = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rgt  = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (keys.KeyW) move.addScaledVector(fwd, 1);
    if (keys.KeyS) move.addScaledVector(fwd,-1);
    if (keys.KeyA) move.addScaledVector(rgt,-1);
    if (keys.KeyD) move.addScaledVector(rgt, 1);
    if (move.lengthSq() > 0) move.normalize();

    this.vel.x = move.x * spd;
    this.vel.z = move.z * spd;

    // Crouch
    this.crouching = !!keys.KeyC;

    // Jump
    if (keys.Space && this.onGround) {
      this.vel.y = JFORCE;
      this.onGround = false;
    }

    // Gravity
    if (!this.onGround) this.vel.y -= G * dt;

    // Move with collision
    this._moveAndCollide(dt, walls);

    // Eye height
    const eyeH  = this.crouching ? 1.1 : PH;
    const eyeY  = this.pos.y + eyeH;
    this.camera.position.x = this.pos.x + this.shakeOff.x;
    this.camera.position.y = eyeY + this.shakeOff.y;
    this.camera.position.z = this.pos.z + this.shakeOff.z;

    // Head bob
    const moving = move.lengthSq() > 0.01;
    if (moving && this.onGround) {
      this.bobT += dt * (this.sprinting ? 10 : 6);
      this.camera.position.y += Math.sin(this.bobT) * (this.sprinting ? .06 : .032);
      this.camera.position.x += Math.sin(this.bobT*.5) * .02;
    }

    // Footsteps
    if (moving && this.onGround) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.audio.footstep();
        this.stepTimer = FSTEP * (this.sprinting ? .55 : 1);
      }
    }

    // Screen shake decay
    if (this.shakeAmt > 0) {
      this.shakeAmt -= dt * 8;
      if (this.shakeAmt < 0) this.shakeAmt = 0;
      this.shakeOff.set(
        (Math.random()-.5)*this.shakeAmt,
        (Math.random()-.5)*this.shakeAmt,
        (Math.random()-.5)*this.shakeAmt
      );
    } else {
      this.shakeOff.set(0,0,0);
    }

    // Regen (perk)
    if (this.regenRate > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
    }

    // Weapon update
    const w = this.currentWeapon;
    if (w) w.update(dt);

    // ADS / zoom
    const adsWeapon = w && w.d.ads;
    if (mouse.right) {
      if (w) w.ads = true;
      if (adsWeapon) {
        this.camera.fov = 75 / (w.d.zoom || 2);
        this.camera.updateProjectionMatrix();
        document.getElementById('scope').classList.add('on');
        document.getElementById('xhair').classList.add('snipe');
      } else {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
        document.getElementById('xhair').classList.add('ads');
        document.getElementById('scope').classList.remove('on');
      }
    } else {
      if (w) w.ads = false;
      // Slight FOV kick while sprinting for a sense of speed
      const targetFov = (this.sprinting && moving) ? 82 : 75;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt*10);
      this.camera.updateProjectionMatrix();
      document.getElementById('scope').classList.remove('on');
      document.getElementById('xhair').classList.remove('ads','snipe');
    }

    // Reload key
    if (keys.KeyR && w && !w.reloading) { if(w.startReload()) this.audio.reload(); }

    // Fire (auto weapons fire every frame held; semi-auto fire once per press handled by mousedown)
    if (mouse.left && w) {
      if (w.d.auto || mouse.leftJustPressed) {
        this._tryFire(enemies, scene, particles, game, w);
      }
    }
    mouse.leftJustPressed = false;

    // Rockets
    this._updateRockets(dt, enemies, walls, scene, particles, game);

    // Pickup collection
    this._checkPickups(pickups, scene, game);
  }

  _tryFire(enemies, scene, particles, game, w) {
    if (!w.canFire()) {
      if (w.mag === 0 && !w.reloading) {
        this.audio.empty();
        if (w.res > 0) { w.startReload(); this.audio.reload(); }
      }
      return;
    }

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    if (w.d.type === 'rocket') {
      this._fireRocket(dir, scene, particles, w);
    } else {
      for (let p = 0; p < w.d.pellets; p++) {
        const sd = w.ads ? w.d.spread * .4 : w.d.spread;
        const d2 = dir.clone();
        const rgt = new THREE.Vector3(); rgt.crossVectors(d2, new THREE.Vector3(0,1,0)).normalize();
        const up  = new THREE.Vector3(); up.crossVectors(rgt, d2).normalize();
        d2.addScaledVector(rgt,(Math.random()-.5)*sd*2);
        d2.addScaledVector(up, (Math.random()-.5)*sd*2);
        d2.normalize();
        this._hitscan(d2, w, enemies, scene, particles, game);
      }
    }

    particles.muzzleFlash(this.camera.position, dir);
    this.audio.shot(w.d.snd);
    w.fire();
  }

  _hitscan(dir, w, enemies, scene, particles, game) {
    this.raycaster.set(this.camera.position, dir);
    this.raycaster.far = w.d.range;

    // Level geometry occlusion — bullets stop at the first wall
    const occluders = game.level ? game.level.objects : [];
    const wallHits  = this.raycaster.intersectObjects(occluders);
    const wallDist  = wallHits.length ? wallHits[0].distance : Infinity;

    // Enemies
    const meshes = [];
    const meshMap = new Map();
    enemies.forEach(e => {
      if (!e.isDead && e.mesh) {
        e.mesh.traverse(m => { if (m.isMesh) { meshes.push(m); meshMap.set(m, e); }});
      }
    });

    const hits = this.raycaster.intersectObjects(meshes);
    if (hits.length > 0 && hits[0].distance < wallDist) {
      const h = hits[0];
      const enemy = meshMap.get(h.object);
      if (enemy) {
        const relY = (h.point.y - enemy.pos.y) / enemy.height;
        const hs   = relY > 0.62;
        const dmg  = Math.round((hs ? w.d.dmg*2 : w.d.dmg) * this.dmgMult);
        const killed = enemy.takeDamage(dmg, h.point, particles);
        this.audio.hit(hs || killed);
        game.onHit(enemy, killed, hs, dmg, h.point);
        particles.blood(h.point, hs ? 28 : 14);
        return;
      }
    }

    // Bullet stopped by geometry — spark at the impact point
    if (wallHits.length) particles.spark(wallHits[0].point, 6);
  }

  _fireRocket(dir, scene, particles, w) {
    const rkt = {
      pos:  this.camera.position.clone().addScaledVector(dir, 0.8),
      vel:  dir.clone().multiplyScalar(28),
      mesh: this._buildRocketMesh(scene),
      life: 8,
    };
    rkt.mesh.position.copy(rkt.pos);
    scene.add(rkt.mesh);
    this.rockets.push(rkt);
  }

  _buildRocketMesh(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.5,8), new THREE.MeshPhongMaterial({color:0x888888}));
    body.rotation.z = Math.PI/2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.05,.15,8), new THREE.MeshPhongMaterial({color:0xcc4400}));
    tip.rotation.z = -Math.PI/2; tip.position.x = .32;
    g.add(body, tip);
    return g;
  }

  _updateRockets(dt, enemies, walls, scene, particles, game) {
    for (let i = this.rockets.length-1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);

      let exploded = false;

      // Check enemies
      enemies.forEach(e => {
        if (!e.isDead && r.pos.distanceTo(e.pos) < 2.5 + e.size) {
          exploded = true;
        }
      });

      // World collision: floor, ceiling, walls
      if (!exploded) {
        if (r.pos.y < 0.05 || r.pos.y > 4.95) exploded = true;
        else for (const w of walls) {
          if (r.pos.x > w.min.x && r.pos.x < w.max.x &&
              r.pos.y > w.min.y && r.pos.y < w.max.y &&
              r.pos.z > w.min.z && r.pos.z < w.max.z) { exploded = true; break; }
        }
      }

      // Splash damage
      if (exploded || r.life <= 0) {
        particles.explosion(r.pos);
        this.audio.explosion();
        this.shakeAmt = 0.4;

        const splashR = this.weapons[this.weaponIdx].d.splash + (this.splashBonus||0);
        enemies.forEach(e => {
          if (e.isDead) return;
          const dist = r.pos.distanceTo(e.pos);
          if (dist < splashR) {
            const dmg = Math.round(this.weapons[this.weaponIdx].d.dmg * (1 - dist/splashR) * this.dmgMult * (this.expMult||1));
            const killed = e.takeDamage(dmg, e.pos.clone(), particles);
            game.onHit(e, killed, false, dmg, new THREE.Vector3(e.pos.x, e.height*0.8, e.pos.z));
          }
        });

        // Self damage
        const selfDist = r.pos.distanceTo(this.pos);
        if (selfDist < splashR * 1.5) {
          const selfDmg = Math.round(60 * (1 - selfDist/(splashR*1.5)));
          if (selfDmg > 0) this.takeDamage(selfDmg, r.pos);
        }

        scene.remove(r.mesh);
        this.rockets.splice(i,1);
      }
    }
  }

  _checkPickups(pickups, scene, game) {
    for (let i = pickups.length-1; i >= 0; i--) {
      const p = pickups[i];
      if (this.pos.distanceTo(p.pos) < 1.4) {
        game.collectPickup(p, i);
      }
    }
  }

  _moveAndCollide(dt, walls) {
    // X axis
    this.pos.x += this.vel.x * dt;
    if (this._wallCheck(walls)) this.pos.x -= this.vel.x * dt;

    // Z axis
    this.pos.z += this.vel.z * dt;
    if (this._wallCheck(walls)) this.pos.z -= this.vel.z * dt;

    // Y axis
    this.pos.y += this.vel.y * dt;
    if (this.pos.y - (this.crouching ? 0.8 : PH*.5) <= 0) {
      this.pos.y = this.crouching ? 0.8 : PH*.5;
      this.vel.y = 0;
      this.onGround = true;
    } else if (!this._ceilCheck()) {
      this.onGround = false;
    }

    // Boundary clamp
    const b = 58;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));
  }

  _wallCheck(walls) {
    for (const w of walls) {
      if (this.pos.x > w.min.x - PR && this.pos.x < w.max.x + PR &&
          this.pos.y > w.min.y      && this.pos.y < w.max.y + .1  &&
          this.pos.z > w.min.z - PR && this.pos.z < w.max.z + PR) {
        return true;
      }
    }
    return false;
  }

  _ceilCheck() { return false; }

  takeDamage(amount, fromPos) {
    if (this.isDead || this.damageCooldown > 0) return;
    this.damageCooldown = 0.08;

    // Armor absorbs 50%
    if (this.armor > 0) {
      const absorbed = Math.min(amount * 0.5, this.armor);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    this.shakeAmt = Math.min(0.35, amount * 0.005);
    this.audio.pain();

    // Screen flash
    const dmg = document.getElementById('dmgvfx');
    dmg.classList.add('on');
    setTimeout(() => dmg.classList.remove('on'), 120);

    // Damage direction indicator (attacker bearing relative to view)
    if (fromPos) {
      const a   = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
      const deg = -((a - this.yaw + Math.PI) * 180 / Math.PI);
      const el  = document.getElementById('dmgdir');
      el.style.transform = `rotate(${deg}deg)`;
      el.style.opacity = '1';
      clearTimeout(this._ddT);
      this._ddT = setTimeout(() => { el.style.opacity = '0'; }, 500);
    }

    if (this.hp <= 0) { this.hp = 0; this.isDead = true; this.deathTimer = 1.5; }
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }
  addArmor(amount) { this.armor = Math.min(this.maxArmor, this.armor + amount); }
}

// ═══════════════════════════════════════════════════════════
//  ENEMY DATA
// ═══════════════════════════════════════════════════════════
const ENEMY_TYPES = {
  grunt:  { name:'Grunt',    hp:100,  spd:3.2, dmg:12,  atkRange:20,  atkRate:1.5,  col:0xaa2222, acol:0xff4444, sz:1.0, h:1.8, score:100 },
  heavy:  { name:'Heavy',    hp:420,  spd:1.7, dmg:28,  atkRange:18,  atkRate:2.4,  col:0x223388, acol:0x4466cc, sz:1.3, h:2.0, score:350 },
  scout:  { name:'Scout',    hp:55,   spd:6.5, dmg:8,   atkRange:25,  atkRate:.75,  col:0x2a5c26, acol:0x44aa44, sz:0.8, h:1.6, score:175 },
  boss:   { name:'COMMANDER',hp:2500, spd:2.8, dmg:45,  atkRange:35,  atkRate:.9,   col:0x880000, acol:0xff0000, sz:2.0, h:3.0, score:2000 },
};

// ═══════════════════════════════════════════════════════════
//  ENEMY CLASS
// ═══════════════════════════════════════════════════════════
class Enemy {
  constructor(type, position, scene, audio, particles) {
    this.type      = type;
    const d        = ENEMY_TYPES[type];
    this.name      = d.name;
    this.hp        = d.hp;
    this.maxHp     = d.hp;
    this.spd       = d.spd;
    this.dmg       = d.dmg;
    this.atkRange  = d.atkRange;
    this.atkRate   = d.atkRate;
    this.size      = d.sz;
    this.height    = d.h;
    this.score     = d.score;
    this.scene     = scene;
    this.audio     = audio;
    this.particles = particles;

    this.pos       = position.clone();
    this.pos.y     = 0;
    this.vel       = new THREE.Vector3();

    this.isDead    = false;
    this.justDied  = false;
    this.deathTimer= 0;
    this.atkTimer  = Math.random() * this.atkRate;
    this.state     = 'idle'; // idle, chase, attack, dead
    this.lastKnown = null;
    this.patrolT   = 0;
    this.patrolDir = new THREE.Vector3(Math.random()-.5,0,Math.random()-.5).normalize();
    this.hitFlash  = 0;
    this.alertTimer= 0;

    this.mesh = this._buildMesh(d);
    this.mesh.position.copy(this.pos);
    this.mesh.position.y = 0;
    scene.add(this.mesh);
  }

  _buildMesh(d) {
    const g    = new THREE.Group();
    const mat  = new THREE.MeshPhongMaterial({color:d.col});
    const emat = new THREE.MeshPhongMaterial({color:d.acol, emissive:d.acol, emissiveIntensity:.3});
    const s = d.sz;

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(.55*s,.65*s,.35*s), mat);
    torso.position.y = .9*s + .325*s;
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(.38*s,.38*s,.38*s), mat);
    head.position.y = .9*s + .65*s + .19*s;
    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(.08*s,.08*s,.08*s), emat);
    eyeL.position.set(-.1*s, .9*s+.65*s+.22*s, .2*s);
    const eyeR = eyeL.clone(); eyeR.position.x = .1*s;
    // Legs
    const legL = new THREE.Mesh(new THREE.BoxGeometry(.22*s,.65*s,.22*s), mat);
    legL.position.set(-.16*s, .325*s, 0);
    const legR = legL.clone(); legR.position.x = .16*s;
    // Arms
    const armL = new THREE.Mesh(new THREE.BoxGeometry(.18*s,.55*s,.18*s), mat);
    armL.position.set(-.39*s, .9*s+.15*s, 0);
    const armR = armL.clone(); armR.position.x = .39*s;
    // Gun
    const gun = new THREE.Mesh(new THREE.BoxGeometry(.06*s,.06*s,.3*s), new THREE.MeshPhongMaterial({color:0x111111}));
    gun.position.set(-.39*s, .9*s+.12*s, -.24*s);

    g.add(torso,head,eyeL,eyeR,legL,legR,armL,armR,gun);

    // HP bar (visible in world)
    const hpGeo = new THREE.PlaneGeometry(0.8*s, 0.08*s);
    const hpMat = new THREE.MeshBasicMaterial({color:0x00ff44, depthTest:false, transparent:true});
    this.hpBar = new THREE.Mesh(hpGeo, hpMat);
    this.hpBar.position.y = d.h + .2;
    g.add(this.hpBar);

    g.castShadow = true;
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  update(dt, playerPos, walls, player) {
    if (this.isDead) {
      this.deathTimer -= dt;
      this.mesh.rotation.x += dt * 2.5;
      const fade = this.mesh.children[0]?.material;
      if (fade) fade.opacity = Math.max(0, this.deathTimer);
      return;
    }

    const dist = this.pos.distanceTo(playerPos);
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos).normalize();
    const hasLOS   = this._checkLOS(playerPos, walls);

    // State machine
    if (hasLOS && dist < 50) {
      this.state = 'attack';
      this.lastKnown = playerPos.clone();
      this.alertTimer = 5;
    } else if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.state = dist > 3 ? 'chase' : 'idle';
    } else {
      this.state = 'idle';
    }

    // Move
    if (this.state === 'attack' && dist > this.atkRange * .4) {
      this._moveToward(toPlayer, dt, walls, .8);
    } else if (this.state === 'chase' && this.lastKnown) {
      const toLast = new THREE.Vector3().subVectors(this.lastKnown, this.pos);
      if (toLast.length() > 1.5) {
        this._moveToward(toLast.normalize(), dt, walls, 1);
      }
    } else if (this.state === 'idle') {
      this.patrolT -= dt;
      if (this.patrolT <= 0) {
        this.patrolDir.set(Math.random()-.5,0,Math.random()-.5).normalize();
        this.patrolT = 2 + Math.random()*3;
      }
      this._moveToward(this.patrolDir, dt, walls, .4);
    }

    // Attack
    if (this.state === 'attack' && dist < this.atkRange) {
      this.atkTimer -= dt;
      if (this.atkTimer <= 0) {
        this._attack(player, dist);
        this.atkTimer = this.atkRate;
      }
    }

    // Face player
    if (hasLOS || this.state !== 'idle') {
      const angle = Math.atan2(toPlayer.x, toPlayer.z);
      this.mesh.rotation.y = angle;
    }

    // Leg animation
    if (this.vel.lengthSq() > 0.01) {
      const walkCycle = Math.sin(performance.now() * 0.01 * (this.spd/3));
      this.mesh.children[4].rotation.x =  walkCycle * .4;
      this.mesh.children[5].rotation.x = -walkCycle * .4;
    }

    this.mesh.position.copy(this.pos);
    this.mesh.position.y = 0;

    // HP bar
    if (this.hpBar) {
      const ratio = this.hp / this.maxHp;
      this.hpBar.scale.x = ratio;
      this.hpBar.material.color.setHex(ratio > .5 ? 0x00ff44 : ratio > .25 ? 0xffaa00 : 0xff2200);
      this.hpBar.lookAt(playerPos.x, this.hpBar.getWorldPosition(new THREE.Vector3()).y, playerPos.z);
    }

    // Hit flash
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.mesh.traverse(m => { if (m.isMesh && m !== this.hpBar) m.material.emissive?.setHex(0xffffff); });
    } else {
      this.mesh.traverse(m => { if (m.isMesh && m !== this.hpBar) m.material.emissive?.setHex(0x000000); });
    }
  }

  _moveToward(dir, dt, walls, speedFactor) {
    const speed = this.spd * speedFactor;
    const nx = this.pos.x + dir.x * speed * dt;
    const nz = this.pos.z + dir.z * speed * dt;
    const testPos = new THREE.Vector3(nx, .5, this.pos.z);
    let blocked = false;
    for (const w of walls) {
      if (nx > w.min.x-.4 && nx < w.max.x+.4 && .5 > w.min.y && .5 < w.max.y && this.pos.z > w.min.z-.4 && this.pos.z < w.max.z+.4) { blocked=true; break; }
    }
    if (!blocked) this.pos.x = nx;
    blocked = false;
    for (const w of walls) {
      if (this.pos.x > w.min.x-.4 && this.pos.x < w.max.x+.4 && .5 > w.min.y && .5 < w.max.y && nz > w.min.z-.4 && nz < w.max.z+.4) { blocked=true; break; }
    }
    if (!blocked) this.pos.z = nz;

    // Boundary
    this.pos.x = Math.max(-57, Math.min(57, this.pos.x));
    this.pos.z = Math.max(-57, Math.min(57, this.pos.z));
    this.vel.set(dir.x*speed, 0, dir.z*speed);
  }

  _checkLOS(playerPos, walls) {
    const dist = this.pos.distanceTo(playerPos);
    if (dist >= 45) return false;
    const from = this.pos.clone(); from.y = this.height * 0.85;   // enemy eye
    const to   = playerPos.clone(); to.y = playerPos.y + 1.4;     // player chest/head
    return !segmentBlocked(from, to, walls);
  }

  _attack(player, dist) {
    // Accuracy drops at range
    const acc = Math.max(0, 1 - dist/this.atkRange * .7);
    if (Math.random() < acc * .65) {
      player.takeDamage(this.dmg, this.pos);
    }
    this.audio.enemyGrowl();
  }

  takeDamage(amount, hitPoint, particles) {
    if (this.isDead) return false;
    this.hp -= amount;
    this.hitFlash = .1;
    if (this.hp <= 0) {
      this.hp = 0;
      this._die(hitPoint, particles);
      return true;
    }
    return false;
  }

  _die(pos, particles) {
    this.isDead    = true;
    this.justDied  = true;
    this.deathTimer= .9;
    particles.blood(pos || this.pos.clone().add(new THREE.Vector3(0,1,0)), 30);
    this.mesh.traverse(m => {
      if (m.isMesh && m.material) {
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.opacity = 1;
      }
    });
  }

  remove(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  }
}

// ═══════════════════════════════════════════════════════════
//  LEVEL DATA
// ═══════════════════════════════════════════════════════════
const LEVELS = [
  {
    name:'The Warehouse',
    fog:{ color:0x1a0a00, near:25, far:80 },
    ambient:0x332211,
    sky:0x080400,
    floor:0x3a3028,
    wall:0x4a3c2c,
    accent:0xcc5500,
    lightColor:0xff8833,
    walls:[
      // outer perimeter
      {x:0,  y:.5, z:-30, w:60,h:4,d:1},
      {x:0,  y:.5, z:30,  w:60,h:4,d:1},
      {x:-30,y:.5, z:0,   w:1, h:4,d:60},
      {x:30, y:.5, z:0,   w:1, h:4,d:60},
      // interior walls
      {x:-12,y:.5, z:-10, w:1, h:4,d:20},
      {x:12, y:.5, z:-10, w:1, h:4,d:20},
      {x:-12,y:.5, z:16,  w:14,h:4,d:1},
      {x:12, y:.5, z:16,  w:14,h:4,d:1},
      // crates / cover
      {x:-20,y:.5, z:-20, w:3,h:2,d:3},
      {x:20, y:.5, z:-20, w:3,h:2,d:3},
      {x:-20,y:.5, z:5,   w:3,h:2,d:3},
      {x:20, y:.5, z:5,   w:3,h:2,d:3},
      {x:0,  y:.5, z:-15, w:4,h:2,d:2},
      {x:-6, y:.5, z:5,   w:2,h:2,d:4},
      {x:6,  y:.5, z:5,   w:2,h:2,d:4},
    ],
    spawns:[
      {x:-22,z:-22},{x:22,z:-22},{x:-22,z:22},{x:22,z:22},
      {x:0,z:-27},{x:-15,z:0},{x:15,z:0}
    ],
    waves:[
      {enemies:['grunt','grunt','grunt','grunt','grunt','grunt','grunt','grunt']},
      {enemies:['grunt','grunt','grunt','heavy','grunt','scout','grunt','grunt','heavy']},
      {enemies:['heavy','grunt','scout','scout','grunt','grunt','heavy','scout','grunt','grunt','grunt']},
    ],
    pickups:[
      {x:0,z:0,type:'health'},{x:-18,z:18,type:'ammo'},{x:18,z:18,type:'armor'},
      {x:0,z:-20,type:'weapon',wid:'shotgun'},{x:-25,z:-5,type:'ammo'},
    ],
  },
  {
    name:'Military Base',
    fog:{color:0x0a1400,near:30,far:90},
    ambient:0x102010,
    sky:0x050a02,
    floor:0x2a3020,
    wall:0x3c4830,
    accent:0x44aa22,
    lightColor:0x44cc44,
    walls:[
      {x:0,  y:.5, z:-40, w:80,h:5,d:1},
      {x:0,  y:.5, z:40,  w:80,h:5,d:1},
      {x:-40,y:.5, z:0,   w:1, h:5,d:80},
      {x:40, y:.5, z:0,   w:1, h:5,d:80},
      // bunkers
      {x:-25,y:.5, z:-15, w:14,h:3,d:8},
      {x:25, y:.5, z:-15, w:14,h:3,d:8},
      {x:0,  y:.5, z:15,  w:20,h:3,d:8},
      // barriers
      {x:-15,y:.5, z:5,   w:8, h:2,d:1},
      {x:15, y:.5, z:5,   w:8, h:2,d:1},
      {x:-10,y:.5, z:-5,  w:1, h:2,d:6},
      {x:10, y:.5, z:-5,  w:1, h:2,d:6},
      {x:0,  y:.5, z:-25, w:10,h:2,d:2},
    ],
    spawns:[
      {x:-35,z:-35},{x:35,z:-35},{x:-35,z:35},{x:35,z:35},
      {x:0,z:-38},{x:-38,z:0},{x:38,z:0},{x:0,z:38}
    ],
    waves:[
      {enemies:['grunt','grunt','heavy','grunt','scout','grunt','grunt','heavy','grunt']},
      {enemies:['heavy','heavy','scout','scout','grunt','grunt','grunt','scout','grunt','heavy','grunt']},
      {enemies:['boss','grunt','grunt','scout','heavy','grunt','grunt','scout','scout']},
    ],
    pickups:[
      {x:0,z:0,type:'health'},{x:-30,z:30,type:'armor'},{x:30,z:30,type:'ammo'},
      {x:0,z:-35,type:'weapon',wid:'rifle'},{x:20,z:-5,type:'weapon',wid:'sniper'},
      {x:-20,z:-5,type:'ammo'},{x:5,z:20,type:'health'},
    ],
  },
  {
    name:'Research Lab',
    fog:{color:0x000814,near:20,far:70},
    ambient:0x0a1028,
    sky:0x020408,
    floor:0x181c28,
    wall:0x1c2034,
    accent:0x0088ff,
    lightColor:0x4488ff,
    walls:[
      {x:0,  y:.5, z:-35, w:70,h:5,d:1},
      {x:0,  y:.5, z:35,  w:70,h:5,d:1},
      {x:-35,y:.5, z:0,   w:1, h:5,d:70},
      {x:35, y:.5, z:0,   w:1, h:5,d:70},
      // pillars
      {x:-20,y:.5, z:-20, w:3,h:5,d:3},
      {x:20, y:.5, z:-20, w:3,h:5,d:3},
      {x:-20,y:.5, z:20,  w:3,h:5,d:3},
      {x:20, y:.5, z:20,  w:3,h:5,d:3},
      // lab walls
      {x:0,  y:.5, z:-10, w:20,h:4,d:1},
      {x:-10,y:.5, z:5,   w:1, h:4,d:16},
      {x:10, y:.5, z:5,   w:1, h:4,d:16},
      {x:0,  y:.5, z:10,  w:12,h:4,d:1},
      // cover
      {x:-8, y:.5, z:-20, w:4,h:2,d:2},
      {x:8,  y:.5, z:-20, w:4,h:2,d:2},
      {x:0,  y:.5, z:25,  w:8,h:2,d:2},
    ],
    spawns:[
      {x:-32,z:-32},{x:32,z:-32},{x:-32,z:32},{x:32,z:32},
      {x:0,z:-32},{x:-32,z:0},{x:32,z:0},{x:0,z:32},{x:-18,z:0},{x:18,z:0}
    ],
    waves:[
      {enemies:['scout','scout','scout','grunt','scout','heavy','scout','grunt','scout']},
      {enemies:['boss','scout','grunt','heavy','scout','scout','grunt','scout','grunt','heavy']},
      {enemies:['boss','boss','scout','heavy','heavy','scout','scout','grunt','grunt','grunt','scout']},
    ],
    pickups:[
      {x:0,z:0,type:'health'},{x:-25,z:0,type:'armor'},{x:25,z:0,type:'armor'},
      {x:0,z:-28,type:'weapon',wid:'rocket'},{x:0,z:28,type:'weapon',wid:'shotgun'},
      {x:-15,z:25,type:'ammo'},{x:15,z:25,type:'ammo'},
      {x:0,z:20,type:'health'},{x:0,z:-20,type:'ammo'},
    ],
  },
];

// ═══════════════════════════════════════════════════════════
//  LEVEL CLASS
// ═══════════════════════════════════════════════════════════
class Level {
  constructor(data, scene) {
    this.data    = data;
    this.scene   = scene;
    this.objects = [];
    this.walls   = [];  // AABB list
    this.pickups = [];
    this.lights  = [];
  }

  build() {
    const d = this.data;

    // Sky
    this.scene.background = new THREE.Color(d.sky);
    this.scene.fog = new THREE.Fog(d.fog.color, d.fog.near, d.fog.far);

    // Ambient
    const amb = new THREE.AmbientLight(d.ambient, 1);
    this.scene.add(amb);
    this.lights.push(amb);

    // Sun / main light
    const sun = new THREE.DirectionalLight(d.lightColor, 0.9);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = .5; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
    this.scene.add(sun);
    this.lights.push(sun);

    // Accent point lights
    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight(d.accent, 1.5, 20);
      pl.position.set(
        (Math.random()-.5)*50,
        3.5,
        (Math.random()-.5)*50
      );
      this.scene.add(pl);
      this.lights.push(pl);
    }

    // Floor
    const floorGeo = new THREE.PlaneGeometry(120, 120);
    const floorMat = new THREE.MeshPhongMaterial({color: d.floor});
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.objects.push(floor);

    // Ceiling
    const ceil = floor.clone();
    ceil.rotation.x = Math.PI/2;
    ceil.position.y = 5;
    ceil.receiveShadow = false;
    this.scene.add(ceil);
    this.objects.push(ceil);

    // Walls + crates
    for (const w of d.walls) {
      const geo = new THREE.BoxGeometry(w.w, w.h, w.d);
      const mat = new THREE.MeshPhongMaterial({color: d.wall});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(w.x, w.y + w.h/2 - .5, w.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.objects.push(mesh);

      // AABB
      this.walls.push({
        min: new THREE.Vector3(w.x - w.w/2, 0,          w.z - w.d/2),
        max: new THREE.Vector3(w.x + w.w/2, w.h + w.y,  w.z + w.d/2),
      });
    }
  }

  getSpawnPoints() { return this.data.spawns; }

  getWalls() { return this.walls; }

  createPickups(scene) {
    const pickups = [];
    for (const p of this.data.pickups) {
      const colors = {health:0xff2244,ammo:0xffcc00,armor:0x2266ff,weapon:0x44ff88};
      const geo = new THREE.SphereGeometry(.28,8,8);
      const mat = new THREE.MeshPhongMaterial({color:colors[p.type],emissive:colors[p.type],emissiveIntensity:.5,transparent:true,opacity:.9});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, .6, p.z);
      scene.add(mesh);

      // Label
      const pl = new THREE.PointLight(colors[p.type], 1.5, 3);
      pl.position.set(p.x, 1.2, p.z);
      scene.add(pl);

      pickups.push({mesh, pos:new THREE.Vector3(p.x,.6,p.z), type:p.type, wid:p.wid, light:pl});
    }
    return pickups;
  }

  destroy() {
    this.objects.forEach(o => {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.lights.forEach(l => this.scene.remove(l));
    this.objects = [];
    this.lights  = [];
    this.walls   = [];
    this.scene.fog = null;
    this.scene.background = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  PERK SYSTEM
// ═══════════════════════════════════════════════════════════
const PERK_DEFS = [
  { id:'speed',   name:'Speed Demon',     icon:'⚡',  desc:'Move and sprint 30% faster.',           stat:'+30% Speed',        apply: p => p.speedMult += .3 },
  { id:'iron',    name:'Iron Skin',        icon:'🛡',  desc:'Gain 100 extra max health.',            stat:'+100 Max HP',       apply: p => { p.maxHp += 100; p.hp = Math.min(p.hp+60, p.maxHp); } },
  { id:'dtap',    name:'Double Tap',       icon:'🔥',  desc:'All weapons fire 30% faster.',          stat:'+30% Fire Rate',    apply: p => { p.weapons.forEach(w => w.d = {...w.d, rate:w.d.rate*.7}); p.fireMult = .7; } },
  { id:'hpoint',  name:'Hollow Point',     icon:'💥',  desc:'All bullets deal 25% more damage.',     stat:'+25% Damage',       apply: p => p.dmgMult  += .25 },
  { id:'vamp',    name:'Vampiric',         icon:'🩸',  desc:'Heal 8 HP on every kill.',              stat:'+8 HP/Kill',        apply: p => p.vampHeal = (p.vampHeal||0) + 8 },
  { id:'scav',    name:'Scavenger',        icon:'📦',  desc:'Ammo pickups give twice as much.',      stat:'×2 Ammo Pickups',   apply: p => p.ammoMult = (p.ammoMult||1) * 2 },
  { id:'regen',   name:'Field Medic',      icon:'➕',  desc:'Slowly regenerate health over time.',   stat:'+5 HP/sec Regen',   apply: p => p.regenRate += 5 },
  { id:'exp',     name:'Demo Expert',      icon:'💣',  desc:'Explosions deal 50% more damage.',      stat:'+50% Explosive',    apply: p => { p.expMult = (p.expMult||1)*1.5; p.splashBonus = (p.splashBonus||0)+2; } },
  { id:'armor',   name:'Heavy Plating',    icon:'🔩',  desc:'Start with 100 armor.',                 stat:'+100 Armor',        apply: p => p.addArmor(100) },
  { id:'ammo',    name:'Deep Pockets',     icon:'🎒',  desc:'All weapons carry 50% more reserve ammo.',stat:'+50% Reserve Ammo', apply: p => p.weapons.forEach(w => { w.res = Math.min(w.res + Math.floor(w.d.res*.5), w.d.res*2); }) },
];

class PerkSystem {
  constructor() { this.active = []; }

  getRandomOptions(count=3) {
    const shuffled = PERK_DEFS.slice().sort(() => Math.random()-.5);
    return shuffled.slice(0, count);
  }

  apply(perkId, player) {
    const p = PERK_DEFS.find(p => p.id === perkId);
    if (!p) return;
    p.apply(player);
    this.active.push(p);
    document.getElementById('perklist').innerHTML =
      this.active.map(pk => `<div class="pi">${pk.icon} ${pk.name}</div>`).join('');
  }
}

// ═══════════════════════════════════════════════════════════
//  HUD MANAGER
// ═══════════════════════════════════════════════════════════
class HUD {
  constructor() {
    this.mmCtx = document.getElementById('mm').getContext('2d');
    this.hmTimer = 0;
    this.annTimer = 0;
    this.subAnnTimer = 0;
  }

  update(player, levelIdx, waveIdx, kills, score, enemies, dt) {
    const w = player.currentWeapon;
    const hp = player.hp, mhp = player.maxHp;
    const ar = player.armor, mar = player.maxArmor;

    // Health
    document.getElementById('hpfill').style.width = (hp/mhp*100)+'%';
    document.getElementById('hpnum').textContent  = Math.ceil(hp);
    document.getElementById('lowhp').classList.toggle('on', hp < mhp * .25);

    // Armor
    document.getElementById('arfill').style.width = (ar/mar*100)+'%';
    document.getElementById('arnum').textContent  = Math.ceil(ar);

    // Stamina
    document.getElementById('stfill').style.width = (player.stamina*100)+'%';

    // Ammo
    document.getElementById('wname').textContent = w ? w.d.name : '';
    document.getElementById('amcur').textContent = w ? w.mag    : '--';
    document.getElementById('amres').textContent = w ? ' / '+w.res : '';
    document.getElementById('reload').style.display = (w && w.reloading) ? 'block' : 'none';

    // Info
    document.getElementById('lvltxt').textContent = this.lvlLabel || `Level ${levelIdx+1} — ${LEVELS[levelIdx].name}`;
    document.getElementById('wavtxt').textContent = `Wave ${waveIdx+1} / ${this.totalWaves || LEVELS[levelIdx].waves.length}`;
    document.getElementById('ktxt').textContent   = `Kills: ${kills}`;
    document.getElementById('scrtxt').textContent = `Score: ${score}`;

    // Weapon slots
    const ws = document.getElementById('wslots');
    ws.innerHTML = player.weapons.map((ww,i) =>
      `<div class="ws${i===player.weaponIdx?' cur':''}">${i+1} ${ww.d.name}</div>`
    ).join('');

    // Hit marker decay
    if (this.hmTimer > 0) {
      this.hmTimer -= dt;
      if (this.hmTimer <= 0) {
        document.getElementById('hm').style.opacity = '0';
        document.getElementById('hm').classList.remove('kill');
      }
    }

    // Announcements
    if (this.annTimer > 0) {
      this.annTimer -= dt;
      if (this.annTimer <= 0) document.getElementById('ann').classList.remove('on');
    }
    if (this.subAnnTimer > 0) {
      this.subAnnTimer -= dt;
      if (this.subAnnTimer <= 0) document.getElementById('subann').classList.remove('on');
    }
  }

  updateMinimap(player, enemies, level) {
    const ctx = this.mmCtx;
    const W = 160, H = 160;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fillRect(0,0,W,H);

    const scale  = W / 130;
    const cx     = W/2 - player.pos.x * scale;
    const cz     = H/2 - player.pos.z * scale;

    // Walls
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    if (level) {
      level.walls.forEach(w => {
        const wx = (w.min.x+w.max.x)/2, wz = (w.min.z+w.max.z)/2;
        const ww = w.max.x-w.min.x, wd = w.max.z-w.min.z;
        ctx.fillRect(cx+wx*scale - ww*scale/2, cz+wz*scale - wd*scale/2, ww*scale, wd*scale);
      });
    }

    // Enemies
    enemies.forEach(e => {
      if (e.isDead) return;
      const ex = cx + e.pos.x * scale;
      const ez = cz + e.pos.z * scale;
      ctx.fillStyle = e.type==='boss' ? '#ff0' : '#f44';
      ctx.fillRect(ex-3, ez-3, 6, 6);
    });

    // Player dot + direction
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.arc(W/2, H/2, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W/2, H/2);
    ctx.lineTo(W/2 + Math.sin(-player.yaw)*12, H/2 + Math.cos(-player.yaw)*12);
    ctx.stroke();
  }

  showHitMarker(kill=false) {
    const hm = document.getElementById('hm');
    hm.style.opacity = '1';
    hm.classList.toggle('kill', kill);
    this.hmTimer = .15;
  }

  announce(text, subtext='', dur=2.5) {
    const ann = document.getElementById('ann');
    ann.textContent = text;
    ann.classList.add('on');
    this.annTimer = dur;
    if (subtext) {
      const sub = document.getElementById('subann');
      sub.textContent = subtext;
      sub.classList.add('on');
      this.subAnnTimer = dur + .5;
    }
  }

  addKillFeed(text, cls='') {
    const kf = document.getElementById('kf');
    const el = document.createElement('div');
    el.className = 'kfi' + (cls ? ' '+cls : '');
    el.textContent = text;
    kf.appendChild(el);
    setTimeout(() => el.remove(), 3500);
    if (kf.children.length > 5) kf.firstChild.remove();
  }

  flash() {
    const f = document.getElementById('flash');
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 80);
  }

  show() { document.getElementById('hud').classList.remove('hidden'); }
  hide() { document.getElementById('hud').classList.add('hidden'); }
}

// ═══════════════════════════════════════════════════════════
//  MAIN GAME CLASS
// ═══════════════════════════════════════════════════════════
class Game {
  constructor() {
    this.renderer  = null;
    this.scene     = null;
    this.camera    = null;
    this.audio     = new AudioEngine();
    this.particles = null;
    this.player    = null;
    this.enemies   = [];
    this.pickups   = [];
    this.level     = null;
    this.hud       = new HUD();
    this.perks     = new PerkSystem();
    this.settings  = new Settings();
    this.touch     = new TouchInput();
    this.gamepad   = new GamepadInput();

    this.state     = 'MENU';
    this.mode      = 'campaign';   // 'campaign' | 'endless'
    this.levelIdx  = 0;
    this.waveIdx   = 0;
    this.waves     = [];
    this.endlessRound = 0;
    this.kills     = 0;
    this.score     = 0;
    this.combo     = 0;
    this.comboTimer= 0;
    this.diff      = DIFFICULTY.normal;
    this.startTime = 0;

    this.keys  = {};
    this.mouse = { dx:0, dy:0, left:false, right:false, leftJustPressed:false };
    this.raf   = null;
    this.prevT = 0;

    this._enemiesExpected = 0;
    this._enemiesSpawned  = 0;

    this._init();
  }

  _init() {
    // WebGL check
    const testCanvas = document.createElement('canvas');
    if (!testCanvas.getContext('webgl') && !testCanvas.getContext('webgl2')) {
      document.getElementById('nowgl').classList.add('show');
      return;
    }

    // Renderer
    const canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._applyQuality();

    // Scene + Camera
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, .05, 500);
    this.camera.rotation.order = 'YXZ';

    this.particles = new ParticleSystem(this.scene);
    this.dnums     = new DamageNumbers(this.camera);

    // Orientation prompt (mobile portrait)
    const orientWarn = document.getElementById('portrait-warn');
    const checkOrient = () => {
      if (!this.touch.active) return;
      const portrait = window.innerHeight > window.innerWidth;
      orientWarn.style.display = portrait ? 'flex' : 'none';
    };
    window.addEventListener('resize', checkOrient);
    checkOrient();

    // Pause when tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'PLAYING') this._pause();
    });
    window.addEventListener('blur', () => {
      if (this.state === 'PLAYING') this._pause();
    });

    // Events
    window.addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth/innerHeight;
      this.camera.updateProjectionMatrix();
    });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'PLAYING') this._pause();
    });

    document.getElementById('c').addEventListener('click', () => {
      this.audio.resume();
      if (this.state === 'PLAYING') document.getElementById('c').requestPointerLock();
    });

    document.addEventListener('mousemove', e => {
      if (this.state === 'PLAYING') { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    document.addEventListener('mousedown', e => {
      this.audio.resume();
      if (e.button===0) { this.mouse.left = true; this.mouse.leftJustPressed = true; }
      if (e.button===2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', e => {
      if (e.button===0) this.mouse.left  = false;
      if (e.button===2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (this.state === 'PLAYING') {
        if (e.code==='Escape') this._pause();
        if (e.code==='KeyF')   this._toggleFullscreen();
        if (e.code==='Digit1') this.player.switchWeapon(0);
        if (e.code==='Digit2') this.player.switchWeapon(1);
        if (e.code==='Digit3') this.player.switchWeapon(2);
        if (e.code==='Digit4') this.player.switchWeapon(3);
        if (e.code==='Digit5') this.player.switchWeapon(4);
        if (e.code==='KeyR' && this.player) {
          const w = this.player.currentWeapon;
          if (w && !w.reloading && w.mag < w.d.mag && w.res > 0) {
            if (w.startReload()) this.audio.reload();
          }
        }
      }
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    document.addEventListener('wheel', e => {
      if (this.state==='PLAYING') this.player.scrollWeapon(e.deltaY>0?1:-1);
    });

    // UI buttons
    document.getElementById('btnStart').onclick        = () => this._startGame('campaign');
    document.getElementById('btnEndless').onclick      = () => this._startGame('endless');
    document.getElementById('btnControls').onclick     = () => this._showControls();
    document.getElementById('btnSettings').onclick     = () => this._showSettings('MENU');
    document.getElementById('btnRetry').onclick        = () => this._startGame();
    document.getElementById('btnGoMenu').onclick       = () => this._showMenu();
    document.getElementById('btnPlayAgain').onclick    = () => this._startGame();
    document.getElementById('btnWinMenu').onclick      = () => this._showMenu();
    document.getElementById('btnResume').onclick       = () => this._resume();
    document.getElementById('btnPauseSettings').onclick= () => this._showSettings('PAUSED');
    document.getElementById('btnRestart').onclick      = () => this._startGame();
    document.getElementById('btnPauseMenu').onclick    = () => this._showMenu();

    // Settings screen controls
    const ssens = document.getElementById('s-sens');
    const svol  = document.getElementById('s-vol');
    const squal = document.getElementById('s-qual');
    ssens.value = this.settings.get('sensitivity');
    svol.value  = this.settings.get('volume');
    squal.value = this.settings.get('quality');
    this._updateSettingsUI();
    ssens.addEventListener('input', () => { this.settings.set('sensitivity', parseFloat(ssens.value)); this._updateSettingsUI(); });
    svol.addEventListener('input',  () => { this.settings.set('volume', parseFloat(svol.value)); this.audio.master.gain.value = parseFloat(svol.value); this._updateSettingsUI(); });
    squal.addEventListener('change',() => { this.settings.set('quality', squal.value); this._applyQuality(); });
    document.getElementById('s-fs').addEventListener('click', () => this._toggleFullscreen());
    document.getElementById('s-back').addEventListener('click', () => this._hideSettings());

    // Difficulty selector
    const savedDiff = this.settings.get('difficulty') || 'normal';
    document.querySelectorAll('.diffbtn').forEach(b => {
      b.classList.toggle('sel', b.dataset.diff === savedDiff);
      b.addEventListener('click', () => {
        this.settings.set('difficulty', b.dataset.diff);
        document.querySelectorAll('.diffbtn').forEach(x => x.classList.toggle('sel', x === b));
      });
    });

    this._updateBestUI();

    // Start render loop
    this.raf = requestAnimationFrame(t => this._loop(t));
  }

  _startGame(mode) {
    this.mode     = mode || this.mode || 'campaign';
    this.diff     = DIFFICULTY[this.settings.get('difficulty')] || DIFFICULTY.normal;
    this.levelIdx = 0;
    this.waveIdx  = 0;
    this.endlessRound = 0;
    this.kills    = 0;
    this.score    = 0;
    this.combo    = 0;
    this.comboTimer = 0;
    this.startTime= performance.now();

    this.perks = new PerkSystem();
    this._enemiesExpected = 0;
    this._enemiesSpawned  = 0;
    this._waveClearPending= false;
    this.dnums.clear();
    document.getElementById('combo').classList.remove('on');

    document.querySelectorAll('.scr').forEach(s => s.classList.add('hidden'));
    this.hud.show();
    document.getElementById('perklist').innerHTML = '';

    if (this.player) {
      this.player.weapons.forEach(w => this.camera.remove(w.model));
    }
    this.enemies.forEach(e => e.remove(this.scene));
    this.enemies = [];
    this.pickups.forEach(p => { this.scene.remove(p.mesh); this.scene.remove(p.light); });
    this.pickups = [];
    if (this.level) this.level.destroy();

    this.player = new Player(this.camera, this.scene, this.audio);
    this.audio.master.gain.value = this.settings.get('volume');

    this._loadLevel(0);
    this.state = 'PLAYING';

    if (!this.touch.active) {
      document.getElementById('c').requestPointerLock();
    } else {
      this.touch.show();
      try {
        document.documentElement.requestFullscreen().catch(()=>{});
        screen.orientation?.lock?.('landscape').catch(()=>{});
      } catch(e) {}
    }
  }

  _loadLevel(idx) {
    if (this.level) this.level.destroy();
    this.enemies.forEach(e => e.remove(this.scene));
    this.enemies = [];
    this.pickups.forEach(p => { this.scene.remove(p.mesh); this.scene.remove(p.light); });
    this.pickups = [];

    this.levelIdx = idx;
    this.waveIdx  = 0;
    const data = LEVELS[idx];
    this.level = new Level(data, this.scene);
    this.level.build();

    // Waves: campaign uses authored data, endless generates scaled waves
    this.waves = this.mode === 'endless'
      ? this._generateEndlessWaves(this.endlessRound)
      : data.waves;
    this.hud.totalWaves = this.waves.length;
    this.hud.lvlLabel   = this.mode === 'endless'
      ? `Round ${this.endlessRound+1} — ${data.name}`
      : `Level ${idx+1} — ${data.name}`;

    // Reset player position
    this.player.pos.set(0, PH*.5, 8);
    this.player.vel.set(0,0,0);
    this.player.yaw   = 0;
    this.player.pitch = 0;

    // Place pickups
    this.pickups = this.level.createPickups(this.scene);
    this.dnums.clear();

    // Announce level
    const annTitle = this.mode === 'endless' ? `ROUND ${this.endlessRound+1}` : data.name;
    this.hud.announce(annTitle, `${this.waves.length} WAVES`, 3);
    setTimeout(() => {
      if (this.state === 'PLAYING') this._spawnWave(0);
    }, 3200);
  }

  _generateEndlessWaves(round) {
    const pool  = ['grunt','grunt','grunt','scout','heavy'];
    const waves = [];
    for (let w = 0; w < 3; w++) {
      const n  = 6 + round*2 + w*2;
      const es = [];
      for (let i = 0; i < n; i++) es.push(pool[Math.floor(Math.random()*pool.length)]);
      if (w === 2 && round >= 1) es.push('boss');
      if (w === 2 && round >= 4) es.push('boss');
      waves.push({ enemies: es });
    }
    return waves;
  }

  _spawnWave(waveIdx) {
    this._waveClearPending = false;
    this.waveIdx = waveIdx;
    const wave = this.waves[waveIdx];
    if (!wave) return;

    this._enemiesExpected = wave.enemies.length;
    this._enemiesSpawned  = 0;

    // Endless mode ramps enemy strength each round on top of difficulty
    const endlessScale = this.mode === 'endless' ? 1 + this.endlessRound * 0.12 : 1;

    const spawns = this.level.getSpawnPoints();
    wave.enemies.forEach((type, i) => {
      setTimeout(() => {
        if (this.state !== 'PLAYING') return;
        const sp = spawns[i % spawns.length];
        const x  = sp.x + (Math.random()-.5)*5;
        const z  = sp.z + (Math.random()-.5)*5;
        const e  = new Enemy(type, new THREE.Vector3(x,0,z), this.scene, this.audio, this.particles);
        e.hp    = Math.round(e.hp    * this.diff.hp  * endlessScale);
        e.maxHp = e.hp;
        e.dmg   = Math.round(e.dmg   * this.diff.dmg * endlessScale);
        this.enemies.push(e);
        this._enemiesSpawned++;
      }, i * 500);
    });

    setTimeout(() => {
      this.hud.announce(`WAVE ${waveIdx+1}`, wave.enemies.length+' ENEMIES', 2);
    }, 200);
  }

  onHit(enemy, killed, headshot, dmg, point) {
    this.hud.showHitMarker(killed || headshot);
    if (dmg && point) this.dnums.spawn(point, dmg, headshot);
    if (killed) {
      this.kills++;
      this.combo++;
      this.comboTimer = 3;
      const mult = Math.min(1 + (this.combo-1)*0.25, 4);
      this.score += Math.round(enemy.score * mult * this.diff.score);
      if (this.combo >= 2) {
        const c = document.getElementById('combo');
        c.textContent = `×${mult.toFixed(2).replace(/\.?0+$/,'')} COMBO — ${this.combo} KILLS`;
        c.classList.add('on');
      }
      if (this.player.vampHeal) this.player.heal(this.player.vampHeal);
      this.hud.addKillFeed(
        (headshot ? '🎯 HEADSHOT — ' : '⚔ ') + enemy.name + ' eliminated',
        headshot ? 'h' : 'e'
      );
    }
  }

  collectPickup(p, idx) {
    const w = this.player;
    switch(p.type) {
      case 'health': w.heal(40); this.hud.addKillFeed('Health +40'); break;
      case 'armor':  w.addArmor(50); this.hud.addKillFeed('Armor +50'); break;
      case 'ammo':
        const amt = 40 * (w.ammoMult||1);
        w.weapons.forEach(ww => ww.addAmmo(amt));
        this.hud.addKillFeed(`Ammo +${amt}`);
        break;
      case 'weapon':
        w.addWeapon(p.wid, this.scene);
        this.hud.addKillFeed('Weapon: '+WEAPONS[p.wid].name);
        break;
    }
    this.audio.pickup();
    this.scene.remove(p.mesh);
    this.scene.remove(p.light);
    this.pickups.splice(idx, 1);
  }

  _checkWave() {
    if (this._waveClearPending) return;
    if (this._enemiesSpawned < this._enemiesExpected) return; // stagger still in progress
    const alive = this.enemies.filter(e => !e.isDead).length;
    if (alive > 0) return;
    this._waveClearPending = true;

    const nextW = this.waveIdx + 1;

    if (nextW < this.waves.length) {
      // Next wave
      setTimeout(() => {
        if (this.state !== 'PLAYING') return;
        // Clean up dead enemies
        this.enemies.forEach(e => e.remove(this.scene));
        this.enemies = [];
        this._spawnWave(nextW);
      }, 3000);
      this.hud.announce('WAVE CLEAR!', `Next wave in 3 seconds…`, 2.5);
    } else if (this.mode === 'endless') {
      // Endless: always perk up and keep going
      this.hud.announce(`ROUND ${this.endlessRound+1} CLEAR!`, `Score: ${this.score}`, 3);
      this.audio.levelDone();
      setTimeout(() => this._perkSelect(), 3200);
    } else {
      // Campaign level complete
      this.hud.announce('LEVEL COMPLETE!', `+${this.score} points`, 3);
      this.audio.levelDone();
      if (this.levelIdx + 1 >= LEVELS.length) {
        setTimeout(() => this._win(), 3200);
      } else {
        setTimeout(() => this._perkSelect(), 3200);
      }
    }
  }

  _perkSelect() {
    this.state = 'PERK_SELECT';
    document.exitPointerLock();
    if (this.touch.active) this.touch.hide();
    this.hud.hide();

    const options = this.perks.getRandomOptions(3);
    const cont = document.getElementById('perkCards');
    cont.innerHTML = '';
    options.forEach(pk => {
      const card = document.createElement('div');
      card.className = 'pc';
      card.innerHTML = `<span class="pcico">${pk.icon}</span><div class="pcname">${pk.name}</div><div class="pcstat">${pk.stat}</div><div class="pcdesc">${pk.desc}</div>`;
      const choose = () => {
        this.perks.apply(pk.id, this.player);
        document.getElementById('perkscr').classList.add('hidden');
        this.hud.show();
        this.state = 'PLAYING';
        if (this.mode === 'endless') {
          this.endlessRound++;
          this.levelIdx = (this.levelIdx + 1) % LEVELS.length;
        } else {
          this.levelIdx++;
        }
        this._loadLevel(this.levelIdx);
        if (!this.touch.active) {
          document.getElementById('c').requestPointerLock();
        } else {
          this.touch.show();
        }
      };
      card.addEventListener('click', choose);
      card.addEventListener('touchend', e => { e.preventDefault(); choose(); }, {passive:false});
      cont.appendChild(card);
    });
    document.getElementById('perkscr').classList.remove('hidden');
  }

  _applyQuality() {
    const q = this.settings.detectQuality();
    const pr = q === 'low' ? 1 : q === 'medium' ? Math.min(devicePixelRatio,1.5) : Math.min(devicePixelRatio,2);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(()=>{});
    } else {
      document.exitFullscreen().catch(()=>{});
    }
  }

  _showSettings(returnState='MENU') {
    this._settingsReturn = returnState;
    document.querySelectorAll('.scr').forEach(s => s.classList.add('hidden'));
    document.getElementById('settingsscr').classList.remove('hidden');
    if (this.touch.active) this.touch.hide();
  }

  _hideSettings() {
    document.getElementById('settingsscr').classList.add('hidden');
    if (this._settingsReturn === 'PAUSED') {
      document.getElementById('pausescr').classList.remove('hidden');
      if (this.touch.active) this.touch.show();
    } else {
      document.getElementById('menu').classList.remove('hidden');
    }
  }

  _updateSettingsUI() {
    const s = this.settings;
    document.getElementById('sv-sens').textContent = parseFloat(s.get('sensitivity')).toFixed(1)+'×';
    document.getElementById('sv-vol').textContent  = Math.round(s.get('volume')*100)+'%';
  }

  _pause() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    document.exitPointerLock();
    document.getElementById('pausescr').classList.remove('hidden');
    if (this.touch.active) this.touch.hide();
  }

  _resume() {
    this.state = 'PLAYING';
    document.getElementById('pausescr').classList.add('hidden');
    if (!this.touch.active) {
      document.getElementById('c').requestPointerLock();
    } else {
      this.touch.show();
    }
  }

  _showMenu() {
    this.state = 'MENU';
    document.exitPointerLock();
    this.hud.hide();
    if (this.touch.active) this.touch.hide();
    this.dnums.clear();
    document.getElementById('combo').classList.remove('on');
    this._updateBestUI();
    document.querySelectorAll('.scr').forEach(s => s.classList.add('hidden'));
    document.getElementById('menu').classList.remove('hidden');
  }

  _showControls() {
    alert(
`CONTROLS:
WASD — Move         Shift — Sprint
Space — Jump        C — Crouch
LMB — Fire          RMB — ADS / Zoom
1–5 — Switch weapon  Scroll — Cycle weapons
R — Reload          ESC — Pause

TIPS:
• Headshots deal 2× damage
• Rockets deal splash damage (be careful!)
• Collect glowing orbs for health / ammo / armor / new weapons
• Choose perks wisely between levels`
    );
  }

  _recordBest() {
    let best = {};
    try { best = JSON.parse(localStorage.getItem('zh_best') || '{}'); } catch(e) {}
    const cur = best[this.mode] || { score: 0 };
    if (this.score > cur.score) {
      best[this.mode] = {
        score: this.score, kills: this.kills,
        round: this.endlessRound + 1, level: this.levelIdx + 1,
      };
      try { localStorage.setItem('zh_best', JSON.stringify(best)); } catch(e) {}
      this._updateBestUI();
      return true;
    }
    return false;
  }

  _updateBestUI() {
    let best = {};
    try { best = JSON.parse(localStorage.getItem('zh_best') || '{}'); } catch(e) {}
    const lines = [];
    if (best.campaign) lines.push(`Best Campaign: <span>${best.campaign.score}</span> pts · ${best.campaign.kills} kills`);
    if (best.endless)  lines.push(`Best Endless: <span>${best.endless.score}</span> pts · Round ${best.endless.round}`);
    document.getElementById('beststats').innerHTML = lines.join('<br>');
  }

  _win() {
    this.state = 'WIN';
    document.exitPointerLock();
    if (this.touch.active) this.touch.hide();
    this.hud.hide();
    const isNewBest = this._recordBest();
    const elapsed = ((performance.now()-this.startTime)/60000).toFixed(1);
    document.getElementById('winStats').innerHTML =
      (isNewBest ? `<span class="newbest">★ NEW BEST SCORE ★</span><br>` : '') +
      `Total Kills: <span>${this.kills}</span><br>
       Final Score: <span>${this.score}</span><br>
       Difficulty: <span>${this.diff.label}</span><br>
       Time: <span>${elapsed} min</span><br>
       Perks: <span>${this.perks.active.map(p=>p.name).join(', ')||'None'}</span>`;
    document.getElementById('winscreen').classList.remove('hidden');
  }

  _gameOver() {
    this.state = 'GAME_OVER';
    document.exitPointerLock();
    if (this.touch.active) this.touch.hide();
    this.hud.hide();
    const isNewBest = this._recordBest();
    const progress = this.mode === 'endless'
      ? `Round Reached: <span>${this.endlessRound+1}</span>`
      : `Level Reached: <span>${this.levelIdx+1} — ${LEVELS[this.levelIdx].name}</span>`;
    document.getElementById('goStats').innerHTML =
      (isNewBest ? `<span class="newbest">★ NEW BEST SCORE ★</span><br>` : '') +
      `Kills: <span>${this.kills}</span><br>
       Score: <span>${this.score}</span><br>
       Difficulty: <span>${this.diff.label}</span><br>
       ${progress}`;
    document.getElementById('goscreen').classList.remove('hidden');
  }

  _loop(t) {
    this.raf = requestAnimationFrame(ts => this._loop(ts));
    const dt = Math.min((t - this.prevT) / 1000, .05);
    this.prevT = t;

    if (this.state === 'PLAYING') {
      this._update(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    const walls = this.level ? this.level.getWalls() : [];

    // ── Merge all input sources ──
    const sens  = this.settings.get('sensitivity');
    const keys  = { ...this.keys };
    const mouse = { ...this.mouse };

    // Gamepad
    const gp = this.gamepad.poll();
    if (gp) {
      Object.assign(keys, gp.keys);
      mouse.dx += gp.mouse.dx;
      mouse.dy += gp.mouse.dy;
      if (gp.mouse.left)          mouse.left = true;
      if (gp.mouse.leftJustPressed) mouse.leftJustPressed = true;
      if (gp.mouse.right)         mouse.right = true;
      if (gp.wdir && this.player) this.player.scrollWeapon(gp.wdir);
    }

    // Touch
    if (this.touch.active) {
      const tk = this.touch.getKeys();
      const tm = this.touch.getMouse(sens);
      Object.assign(keys, tk);
      mouse.dx += tm.dx;
      mouse.dy += tm.dy;
      if (tm.left)             mouse.left = true;
      if (tm.leftJustPressed)  mouse.leftJustPressed = true;
      if (tm.right)            mouse.right = true;
      const wd = this.touch.consumeWdir();
      if (wd && this.player)   this.player.scrollWeapon(wd);
    } else {
      // Desktop: apply sensitivity to raw mouse
      mouse.dx *= sens;
      mouse.dy *= sens;
    }

    // Player update
    this.player.update(dt, keys, mouse, walls, this.enemies, this.pickups, this.scene, this.particles, this);
    this.mouse.dx             = 0;
    this.mouse.dy             = 0;
    this.mouse.leftJustPressed = false;

    // Enemies
    let anyJustDied = false;
    for (let i = this.enemies.length-1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this.player.pos, walls, this.player, this.scene, this.particles);
      if (e.justDied) { e.justDied = false; anyJustDied = true; }
      if (e.isDead && e.deathTimer <= 0) {
        e.remove(this.scene);
        this.enemies.splice(i,1);
      }
    }

    // Wave check (only after all enemies from wave have spawned)
    if (anyJustDied || (this.enemies.length > 0 && this.enemies.every(e => e.isDead))) {
      this._checkWave();
    }

    // Pickups spin
    const now = performance.now();
    this.pickups.forEach(p => { p.mesh.rotation.y += dt*1.8; p.mesh.position.y = .6 + Math.sin(now*.003)*.08; });

    // Combo timer decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        document.getElementById('combo').classList.remove('on');
      }
    }

    // Particles + damage numbers
    this.particles.update(dt);
    this.dnums.update(dt);

    // HUD
    this.hud.update(this.player, this.levelIdx, this.waveIdx, this.kills, this.score, this.enemies, dt);
    this.hud.updateMinimap(this.player, this.enemies, this.level);

    // Death
    if (this.player.isDead && this.player.deathTimer <= 0) {
      this._gameOver();
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  window._game = new Game();
});
