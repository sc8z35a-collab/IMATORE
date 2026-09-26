import * as THREE from 'three';
import { isWalkable, groundHeight, EYE } from './world/layout.js';

// Mobile first-person controls:
//  - left half: floating joystick (move)
//  - right half: drag to look; short tap = pick / interact
//  - optional gyro look (additive, recentred on enable)
//  - two-finger pinch = FOV zoom
//  - auto-travel along a path (fast travel / tap-to-walk)
export class Controls {
  constructor(camera, dom, hud) {
    this.cam = camera; this.dom = dom; this.hud = hud;
    this.pos = new THREE.Vector3(0, 0, 18);
    this.yaw = 0; this.pitch = 0.08;
    this.vel = new THREE.Vector2();
    this.move = new THREE.Vector2();
    this.run = false;
    this.enabled = false;
    this.lookT = null; this.moveT = null;
    this.bob = 0; this.bobAmt = 0;
    this.zoom = 1;
    this.gyro = { on: false, alpha0: null, q: new THREE.Quaternion(), yaw: 0, pitch: 0, base: null };
    this.travel = null;
    this.onTap = null;
    this.joy = document.getElementById('joy');
    this.knob = document.getElementById('joy-knob');
    this._bind();
  }

  _bind() {
    const el = this.dom;
    const opt = { passive: false };
    el.addEventListener('touchstart', (e) => this._start(e), opt);
    el.addEventListener('touchmove', (e) => this._moveEv(e), opt);
    el.addEventListener('touchend', (e) => this._end(e), opt);
    el.addEventListener('touchcancel', (e) => this._end(e), opt);
    // mouse fallback for debugging only
    let md = null;
    el.addEventListener('mousedown', (e) => { md = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; });
    window.addEventListener('mousemove', (e) => {
      if (!md || !this.enabled) return;
      const dx = e.clientX - md.x, dy = e.clientY - md.y;
      md.moved += Math.abs(dx) + Math.abs(dy);
      md.x = e.clientX; md.y = e.clientY;
      this._look(dx, dy);
    });
    window.addEventListener('mouseup', (e) => {
      if (md && md.moved < 8 && this.onTap) this.onTap(e.clientX, e.clientY);
      md = null;
    });
    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.code] = true; this._keys(keys); });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; this._keys(keys); });
  }
  _keys(k) {
    this.move.set((k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0));
    this.run = !!k.ShiftLeft || this.runToggle;
  }

  _start(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.45 && t.clientY > window.innerHeight * 0.3;
      if (left && !this.moveT) {
        this.moveT = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.joy.style.left = t.clientX + 'px'; this.joy.style.top = t.clientY + 'px';
        this.joy.classList.add('on');
        this.knob.style.transform = 'translate(0,0)';
        this.cancelTravel();
      } else if (!this.lookT) {
        this.lookT = { id: t.identifier, x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, t0: performance.now(), moved: 0 };
      } else if (!this.pinch) {
        this.pinch = { id: t.identifier, d0: Math.hypot(t.clientX - this.lookT.x, t.clientY - this.lookT.y), z0: this.zoom };
      }
    }
  }
  _moveEv(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.moveT && t.identifier === this.moveT.id) {
        let dx = t.clientX - this.moveT.x0, dy = t.clientY - this.moveT.y0;
        const R = 52, L = Math.hypot(dx, dy);
        if (L > R) { dx *= R / L; dy *= R / L; }
        this.knob.style.transform = `translate(${dx}px,${dy}px)`;
        this.move.set(dx / R, -dy / R);
        // push beyond ~90% => run
        this.autoRun = L > R * 1.6;
      } else if (this.lookT && t.identifier === this.lookT.id) {
        const dx = t.clientX - this.lookT.x, dy = t.clientY - this.lookT.y;
        this.lookT.x = t.clientX; this.lookT.y = t.clientY;
        this.lookT.moved += Math.abs(dx) + Math.abs(dy);
        if (!this.pinch) this._look(dx, dy);
        else {
          // pinch using the pinch finger position stored separately
        }
      } else if (this.pinch && t.identifier === this.pinch.id) {
        const d = Math.hypot(t.clientX - this.lookT.x, t.clientY - this.lookT.y);
        this.zoom = THREE.MathUtils.clamp(this.pinch.z0 * (d / Math.max(20, this.pinch.d0)), 1, 3.2);
      }
    }
  }
  _end(e) {
    for (const t of e.changedTouches) {
      if (this.moveT && t.identifier === this.moveT.id) {
        this.moveT = null; this.move.set(0, 0); this.autoRun = false;
        this.joy.classList.remove('on');
      } else if (this.lookT && t.identifier === this.lookT.id) {
        const dt = performance.now() - this.lookT.t0;
        if (this.lookT.moved < 12 && dt < 350 && this.onTap && !this.pinch) this.onTap(t.clientX, t.clientY);
        this.lookT = null; this.pinch = null;
      } else if (this.pinch && t.identifier === this.pinch.id) this.pinch = null;
    }
  }
  _look(dx, dy) {
    const k = 0.0042 / this.zoom;
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.2, 1.35);
    if (this.travel) this.travel.userLook = true;
  }

  async enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) { return false; }
    if (!this._gyroBound) {
      this._gyroBound = true;
      window.addEventListener('deviceorientation', (e) => this._orient(e));
    }
    this.gyro.on = true; this.gyro.base = null;
    return true;
  }
  disableGyro() { this.gyro.on = false; }
  _orient(e) {
    if (!this.gyro.on || e.alpha == null) return;
    const deg = THREE.MathUtils.degToRad;
    const orient = deg(screen.orientation ? screen.orientation.angle : window.orientation || 0);
    // device -> world quaternion (three.js DeviceOrientationControls math)
    const euler = new THREE.Euler(deg(e.beta), deg(e.alpha), -deg(e.gamma), 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));
    const eu = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    if (!this.gyro.base) this.gyro.base = { yaw: eu.y, pitch: eu.x, yaw0: this.yaw, pitch0: this.pitch };
    const b = this.gyro.base;
    let dy = eu.y - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.gyro.yaw = dy; this.gyro.pitch = eu.x - b.pitch;
  }

  // walk automatically to target (x,z) then face lookAt
  travelTo(x, z, look, { speed = 18, warp = false } = {}) {
    this.travel = { x, z, look, speed, warp, t: 0, sx: this.pos.x, sz: this.pos.z, userLook: false };
  }
  cancelTravel() { this.travel = null; }

  update(dt) {
    if (!this.enabled) return;
    const run = this.run || this.runToggle || this.autoRun;
    let inX = this.move.x, inY = this.move.y;
    const tr = this.travel;
    let target = new THREE.Vector2();
    if (tr) {
      if (tr.warp) {
        // cinematic dash: ease along straight line (ignores collision)
        tr.t += dt / Math.max(0.9, Math.hypot(tr.x - tr.sx, tr.z - tr.sz) / 80);
        const k = Math.min(1, tr.t);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        this.pos.x = tr.sx + (tr.x - tr.sx) * e;
        this.pos.z = tr.sz + (tr.z - tr.sz) * e;
        this.warpAmt = Math.sin(k * Math.PI);
        if (tr.look && !tr.userLook) this._faceToward(tr.look, dt * 3.5);
        if (k >= 1) { this.travel = null; this.warpAmt = 0; }
      } else {
        const dx = tr.x - this.pos.x, dz = tr.z - this.pos.z;
        const L = Math.hypot(dx, dz);
        if (L < 0.4) { this.travel = null; }
        else {
          target.set(dx / L, dz / L).multiplyScalar(Math.min(tr.speed, L * 3));
          if (tr.look && !tr.userLook) this._faceToward(L < 6 ? tr.look : { x: tr.x, z: tr.z }, dt * 3);
        }
      }
    } else {
      const sp = run ? 9.5 : 4.2;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      target.set(fx * inY + rx * inX, fz * inY + rz * inX).multiplyScalar(sp);
    }
    if (!(tr && tr.warp)) {
      // acceleration smoothing
      const a = 1 - Math.exp(-dt * 8);
      this.vel.lerp(target, a);
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
      if (isWalkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (isWalkable(nx, this.pos.z)) { this.pos.x = nx; this.vel.y *= 0.5; }
      else if (isWalkable(this.pos.x, nz)) { this.pos.z = nz; this.vel.x *= 0.5; }
      else { this.vel.multiplyScalar(0.2); if (tr) this.travel = null; }
    }
    // head bob
    const spd = this.vel.length();
    this.bobAmt += ((spd > 0.3 ? Math.min(1, spd / 6) : 0) - this.bobAmt) * Math.min(1, dt * 6);
    this.bob += dt * (6 + spd * 0.9);
    const gy = groundHeight(this.pos.x, this.pos.z);
    this.eyeY = (this.eyeY ?? gy + EYE) + (gy + EYE - (this.eyeY ?? gy + EYE)) * Math.min(1, dt * 10);
    const cam = this.cam;
    cam.position.set(
      this.pos.x + Math.cos(this.yaw) * Math.sin(this.bob) * 0.03 * this.bobAmt,
      this.eyeY + Math.abs(Math.cos(this.bob)) * 0.06 * this.bobAmt,
      this.pos.z - Math.sin(this.yaw) * Math.sin(this.bob) * 0.03 * this.bobAmt,
    );
    const gyaw = this.gyro.on ? this.gyro.yaw : 0, gpit = this.gyro.on ? this.gyro.pitch : 0;
    cam.rotation.set(THREE.MathUtils.clamp(this.pitch + gpit, -1.4, 1.45), this.yaw + gyaw, Math.sin(this.bob * 0.5) * 0.004 * this.bobAmt);
    const baseFov = cam.userData.baseFov || cam.fov;
    cam.userData.baseFov = baseFov;
    const f = baseFov / this.zoom + (this.warpAmt || 0) * 22 + (run && spd > 6 ? 4 : 0);
    if (Math.abs(cam.fov - f) > 0.05) { cam.fov += (f - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
  }

  _faceToward(p, k) {
    const want = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, k);
    this.pitch += ((p.pitch ?? 0.06) - this.pitch) * Math.min(1, k);
  }
}
