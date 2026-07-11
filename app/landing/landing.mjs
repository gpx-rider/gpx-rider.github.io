// Landing-page hero replay.
//
// Plays a looping cinematic replay of one route (Ještěd) over the same Google
// Photorealistic 3D map the app uses, with a faked HUD, then a summit orbit,
// then a fade back to the start. It reuses the app's Maps-key resolution (a
// visitor's saved key wins over the deploy-time key in config.mjs) and, when no
// map is available, gracefully falls back to a still image so the page still
// reads. This is the public front page (app/index.html); "Launch GPX Rider"
// links to app.html.
//
// Ported from the original Claude Design (x-dc) prototype to plain no-build JS:
// every tunable now lives in LANDING_HERO (tuning.mjs) instead of design props,
// and the route comes from landing-route.mjs instead of a global.
import { LANDING_HERO as H } from "../core/tuning.mjs";
import { LANDING_ROUTE_POINTS } from "./landing-route.mjs";
import { deployedMapsApiKey } from "../config.mjs";

const MAPS_API_KEY_STORAGE_KEY = "gpx-rider:maps-api-key";

// Signalled by Google's auth-failure callback (invalid/unauthorised key) so the
// hero can fall back to the still image instead of a blank map.
window.gm_authFailure = function () {
  window.__GPXR_MAP_FAIL = true;
};

function resolveMapsApiKey() {
  return (localStorage.getItem(MAPS_API_KEY_STORAGE_KEY) || "") || deployedMapsApiKey();
}

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=beta`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the Google Maps JavaScript API."));
    document.head.append(script);
  });
}

class HeroReplay {
  constructor() {
    this.$ = (id) => document.getElementById(id);
  }

  start() {
    this.applyAppFx();
    this.setupData();
    this.startClock();
    this.initMap();
  }

  // --- Background-app treatment (dim + blur + scrim) --------------------------
  applyAppFx() {
    const fx = `blur(${H.app_blur_px}px) brightness(${(1 - H.app_dim).toFixed(3)})`;
    const map = this.$("gpxr-map");
    if (map) map.style.filter = fx;
    const hud = this.$("gpxr-hud");
    if (hud) hud.style.filter = fx;
    const scrim = this.$("gpxr-scrim");
    if (scrim) {
      const s = H.headline_scrim;
      const top = Math.min(0.5, s * 0.8);
      scrim.style.background =
        `linear-gradient(180deg, rgba(10,11,13,${top.toFixed(3)}) 0%, rgba(10,11,13,0) 24%, ` +
        `rgba(10,11,13,0) 40%, rgba(10,11,13,${(s * 0.92).toFixed(3)}) 74%, rgba(10,11,13,${s.toFixed(3)}) 100%)`;
    }
  }

  // --- Route model ------------------------------------------------------------
  setupData() {
    const points = (LANDING_ROUTE_POINTS && LANDING_ROUTE_POINTS.length >= 2)
      ? LANDING_ROUTE_POINTS
      : [[50.687647, 15.090709, 538], [50.732718, 14.984132, 1009]];
    this.pts = points.map((p) => ({ lat: p[0], lng: p[1], ele: p[2] }));
    const n = this.pts.length;
    this.cumDist = new Array(n).fill(0);
    this.cumAsc = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      this.cumDist[i] = this.cumDist[i - 1] + this.haversine(this.pts[i - 1], this.pts[i]);
      const d = this.pts[i].ele - this.pts[i - 1].ele;
      this.cumAsc[i] = this.cumAsc[i - 1] + (d > 0 ? d : 0);
    }
    this.total = this.cumDist[n - 1] || 1;
    this.totalAsc = this.cumAsc[n - 1] || 1;
    // Detected climbs (start/end distance in meters). Configured spans, with the
    // end clamped to the route length (Infinity means "to the summit").
    this.climbs = H.climb_spans_meters.map((span, i) => {
      const s = span[0];
      const e = Math.min(this.total, span[1]);
      const ascent = this.ascAt(e) - this.ascAt(s);
      const peak = this.interp(e).ele;
      const avgGrade = (ascent / Math.max(1, e - s)) * 100;
      return { s, e, ascent, peak, avgGrade, n: i + 1 };
    });
    this.climbCount = this.climbs.length;
  }

  // --- Geodesy / interpolation ------------------------------------------------
  haversine(a, b) {
    const R = 6371000, t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const la1 = a.lat * t, la2 = b.lat * t;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  bearing(a, b) {
    const t = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * t) * Math.cos(b.lat * t);
    const x = Math.cos(a.lat * t) * Math.sin(b.lat * t) - Math.sin(a.lat * t) * Math.cos(b.lat * t) * Math.cos((b.lng - a.lng) * t);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  indexAt(s) {
    const c = this.cumDist;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < s) lo = mid + 1; else hi = mid; }
    return Math.max(1, lo);
  }
  interp(s) {
    s = Math.max(0, Math.min(this.total, s));
    const i = this.indexAt(s);
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cumDist[i] - this.cumDist[i - 1] || 1;
    const f = (s - this.cumDist[i - 1]) / seg;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, ele: a.ele + (b.ele - a.ele) * f, i };
  }
  ascAt(s) {
    const i = this.indexAt(s);
    const seg = this.cumDist[i] - this.cumDist[i - 1] || 1;
    const f = (s - this.cumDist[i - 1]) / seg;
    return this.cumAsc[i - 1] + (this.cumAsc[i] - this.cumAsc[i - 1]) * f;
  }
  gradeAt(s) {
    const w = 30;
    const a = this.interp(Math.max(0, s - w)), b = this.interp(Math.min(this.total, s + w));
    const run = Math.max(1, this.haversine(a, b));
    return Math.max(-15, Math.min(20, (b.ele - a.ele) / run * 100));
  }
  headingAt(s) {
    const a = this.interp(Math.max(0, s - 6)), b = this.interp(Math.min(this.total, s + 24));
    return this.bearing(a, b);
  }
  camHeadingAt(s) {
    // Forward travel direction. A short baseline gives a stable "current heading";
    // camLookaheadMeters extends how far ahead the camera aims into the turn.
    const look = H.cam_lookahead_meters;
    const base = 12;
    const a = this.interp(Math.max(0, s - base * 0.5));
    const b = this.interp(Math.min(this.total, s + base * 0.5 + look));
    if (Math.abs(b.lat - a.lat) < 1e-9 && Math.abs(b.lng - a.lng) < 1e-9) {
      return this.camHeading != null ? this.camHeading : this.headingAt(s);
    }
    return this.bearing(a, b);
  }
  hrShownVal(now) {
    // heart rate refreshes at most once per second, like a real sensor
    if (this._hrShown == null || now - (this._hrShownAt || 0) >= 1000) {
      this._hrShown = Math.round(this.hrDisp);
      this._hrShownAt = now;
    }
    return this._hrShown;
  }
  ring(c, r, altVal) {
    const out = [], latM = 111320, lngM = 111320 * Math.cos(c.lat * Math.PI / 180);
    const av = (altVal != null) ? altVal : (c.ele != null ? c.ele : 4);
    for (let i = 0; i <= 18; i++) {
      const a = i / 18 * 2 * Math.PI;
      out.push({ lat: c.lat + r * Math.cos(a) / latM, lng: c.lng + r * Math.sin(a) / lngM, altitude: av });
    }
    return out;
  }
  currentClimb(s) {
    for (const c of this.climbs) { if (s <= c.e) return c; }
    return this.climbs[this.climbs.length - 1];
  }

  startClock() {
    const tick = () => {
      const d = new Date();
      const p = (x) => (x < 10 ? "0" : "") + x;
      const el = this.$("v-clock");
      if (el) el.textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    };
    tick();
    this._clock = setInterval(tick, 1000);
  }

  // --- Map ---------------------------------------------------------------------
  async initMap() {
    try {
      if (window.__GPXR_MAP_FAIL) throw new Error("auth");
      const apiKey = resolveMapsApiKey();
      if (!apiKey) throw new Error("no-key");
      await loadGoogleMaps(apiKey);
      let tries = 0;
      while (!(window.google && google.maps && google.maps.importLibrary) && tries < 120) {
        await new Promise((r) => setTimeout(r, 100));
        tries++;
      }
      if (!(window.google && google.maps && google.maps.importLibrary)) throw new Error("api");
      const maps3d = await google.maps.importLibrary("maps3d");
      if (window.__GPXR_MAP_FAIL) throw new Error("auth");
      const { Map3DElement, Polyline3DElement, Model3DElement, AltitudeMode, MapMode } = maps3d;
      this.Poly = Polyline3DElement; this.Alt = AltitudeMode; this.Model = Model3DElement;
      const s0 = this.pts[0];
      this.map = new Map3DElement({
        center: { lat: s0.lat, lng: s0.lng, altitude: s0.ele },
        range: 650, tilt: 62, heading: this.headingAt(0),
        mode: MapMode ? MapMode.SATELLITE : undefined,
        defaultUIDisabled: true,
      });
      const mount = this.$("gpxr-map");
      if (mount) mount.appendChild(this.map);
      this.buildRoute();
      this.mapReady = true;
    } catch (e) {
      console.warn("[GPX Rider] map unavailable:", e && e.message);
      this.mapReady = false;
      const fb = this.$("gpxr-fallback");
      if (fb && H.fallback_image_path) { fb.src = H.fallback_image_path; fb.style.opacity = "1"; }
      this.set("v-mode", "Preview");
    }
    this.startLoop();
  }

  gradeColor(g) {
    if (g < 1) return "#8b949e";
    if (g < 4) return "#57b877";
    if (g < 7) return "#e8b74e";
    if (g < 10) return "#e8823c";
    return "#d9542f";
  }
  buildRoute() {
    // App-faithful vertical: route line sits ~2m above the terrain, rider on it.
    const alt = this.Alt && this.Alt.RELATIVE_TO_GROUND;
    // route colored by per-segment grade, like the app
    const colors = this.pts.map((_, i) => this.gradeColor(this.gradeAt(this.cumDist[i])));
    this.segs = [];
    let runStart = 0;
    const n = this.pts.length;
    for (let i = 1; i < n; i++) {
      const last = i === n - 1;
      if (colors[i] !== colors[runStart] || last) {
        const end = i;
        const path = [];
        for (let k = runStart; k <= end; k++) path.push({ lat: this.pts[k].lat, lng: this.pts[k].lng, altitude: 2 });
        if (path.length >= 2) {
          const seg = new this.Poly({
            altitudeMode: alt, path, strokeColor: colors[runStart], strokeWidth: 13,
            outerColor: "rgba(255,255,255,0.5)", outerWidth: 0.3,
          });
          this.map.append(seg); this.segs.push(seg);
        }
        runStart = i;
      }
    }
    // rider: 3D disc model on the terrain (fallback to a ring where unavailable)
    const p0 = { lat: this.pts[0].lat, lng: this.pts[0].lng, altitude: 0 };
    if (this.Model) {
      try {
        this.rider = new this.Model({
          src: H.rider_model_path, position: p0, altitudeMode: alt,
          orientation: { heading: 0, tilt: 90, roll: 0 }, scale: 9,
        });
        this.map.append(this.rider);
      } catch (e) { this.rider = null; }
    }
    if (!this.rider) {
      this.dot = new this.Poly({
        altitudeMode: alt, path: this.ring(this.pts[0], 8, 2), strokeColor: "#f6a52c",
        strokeWidth: 10, outerColor: "rgba(90,58,18,0.9)", outerWidth: 0.5,
      });
      this.map.append(this.dot);
    }
  }

  rideStartS() {
    const v = H.finale_speed_kmh / 3.6;
    const secs = H.finale_seconds;
    return Math.max(0, this.total - Math.min(this.total, v * secs));
  }

  startLoop() {
    this.phase = "ride"; this.s = this.rideStartS(); this.orbitT = 0; this.fadeT = 0; this.rideTime = 0;
    this.camHeading = this.headingAt(this.s); this.orbitHeading = this.camHeading;
    this.powDisp = 60; this.hrDisp = 92; this.dsThisFrame = 0; this.camVel = 0;
    this.lastT = performance.now(); this.lastHud = 0;
    this._raf = requestAnimationFrame(this.frame);
  }

  setFade(o) { const f = this.$("gpxr-fade"); if (f) f.style.opacity = String(o); }

  frame = (now) => {
    if (this._stop) return;
    const dt = Math.min(0.05, (now - this.lastT) / 1000); this.lastT = now;

    if (this.phase === "ride" || this.phase === "ridein") {
      // constant ride speed; start point is placed so load→summit takes
      // finaleSeconds at this speed
      const v = H.finale_speed_kmh / 3.6;
      const ds = v * dt; this.s += ds; this.dsThisFrame = ds; this.rideTime += dt;
      if (this.s >= this.total) {
        this.s = this.total;
        if (this.phase === "ride") {
          this.phase = "orbit"; this.orbitT = 0; this.orbitHeading = this.camHeading;
          this.orbitFrom = { tilt: H.chase_tilt_degrees, range: H.chase_range_meters };
          this.powDisp = 0; this.hrAtFinish = this.hrDisp;
        }
      }
    }

    if (this.phase === "ride") {
      this.updateRide(dt, now);
    } else if (this.phase === "orbit") {
      this.orbitT += dt;
      this.orbitHeading = (this.orbitHeading + dt * (360 / H.orbit_seconds_per_rev)) % 360;
      this.updateOrbit(dt, now);
      if (this.orbitT >= H.orbit_seconds) { this.phase = "fadeout"; this.fadeT = 0; }
    } else if (this.phase === "fadeout") {
      this.fadeT += dt; const o = Math.min(1, this.fadeT / 0.7); this.setFade(o);
      this.orbitHeading = (this.orbitHeading + dt * (360 / H.orbit_seconds_per_rev)) % 360;
      this.updateOrbit(dt, now);
      if (o >= 1) {
        this.s = this.rideStartS(); this.rideTime = 0; this.camHeading = this.headingAt(this.s);
        this.powDisp = 60; this.resetLines(); this.phase = "ridein"; this.fadeT = 0;
      }
    } else if (this.phase === "ridein") {
      this.fadeT += dt; const o = 1 - Math.min(1, this.fadeT / 0.7); this.setFade(o);
      this.updateRide(dt, now);
      if (o <= 0) { this.phase = "ride"; }
    }
    this._raf = requestAnimationFrame(this.frame);
  };

  moveRider(pos) {
    if (this.rider) {
      try {
        this.rider.position = { lat: pos.lat, lng: pos.lng, altitude: 0 };
        this.rider.orientation = { heading: this.headingAt(this.s), tilt: 90, roll: 0 };
      } catch (e) {}
    } else if (this.dot) {
      try { this.dot.path = this.ring(pos, 8, 2); } catch (e) {}
    }
  }
  resetLines() {
    if (!this.mapReady) return;
    this.moveRider(this.interp(this.rideStartS()));
  }

  stepSim(dt) {
    const gradeNow = this.gradeAt(this.s);
    const avg = H.avg_speed_kmh;
    const ridingKmh = Math.max(8, avg - Math.max(0, gradeNow) * 0.9);
    const ridingMps = ridingKmh / 3.6;
    // power from grade-aware physics
    const m = 82, g = 9.81, Crr = 0.006, rho = 1.225, CdA = 0.42, drive = 0.97;
    const v = ridingMps, slope = gradeNow / 100;
    const Pg = m * g * v * slope;
    const Pr = m * g * Crr * v;
    const Pa = 0.5 * rho * CdA * v * v * v;
    const Ptar = Math.max(0, (Pg + Pr + Pa) / drive);
    this.powDisp += (Ptar - this.powDisp) * (1 - Math.exp(-dt / 1.2));
    // hr follows power intensity with configurable lag/delay
    const FTP = 273, rest = 60, hrmax = 182;
    const intensity = Math.min(1.06, this.powDisp / (FTP * 1.05));
    const hrTar = rest + (hrmax - rest) * Math.max(0.14, intensity);
    const lag = H.hr_lag_seconds;
    this.hrDisp += (hrTar - this.hrDisp) * (1 - Math.exp(-dt / lag));
    return gradeNow;
  }

  fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => (x < 10 ? "0" : "") + x;
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
  }
  powerZone(p) {
    const b = [150, 204, 245, 286, 327, 409];
    const nm = ["Z1 ACTIVE REC", "Z2 ENDURANCE", "Z3 TEMPO", "Z4 THRESHOLD", "Z5 VO2 MAX", "Z6 ANAEROBIC", "Z7 NEURO"];
    let i = 0; while (i < b.length && p > b[i]) i++; return nm[i];
  }
  hrZone(h) {
    const b = [132, 144, 156, 168];
    const nm = ["Z1 RECOVERY", "Z2 ENDURANCE", "Z3 TEMPO", "Z4 THRESHOLD", "Z5 MAX"];
    let i = 0; while (i < b.length && h > b[i]) i++; return nm[i];
  }
  cat(gr) {
    if (gr < 4) return ["GENTLE", "#57b877"];
    if (gr < 7) return ["MODERATE", "#e8b74e"];
    if (gr < 10) return ["STEEP", "#e8823c"];
    return ["BRUTAL", "#d9542f"];
  }
  set(id, v) { const el = this.$(id); if (el) el.textContent = v; }
  width(id, pct) { const el = this.$(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%"; }
  mark(id, pct) { const el = this.$(id); if (el) el.style.left = Math.max(0, Math.min(100, pct)) + "%"; }

  updateRide(dt, now) {
    const grade = this.stepSim(dt);
    const pos = this.interp(this.s);
    const tgt = this.camHeadingAt(this.s);
    // Smooth pan: velocity eases in/out (limited acceleration) and slows as it
    // nears the rider's heading, capped at the max turn rate.
    let d = ((tgt - this.camHeading + 540) % 360) - 180;
    const maxRate = H.cam_turn_rate_deg_per_sec;
    const maxAccel = H.cam_turn_accel_deg_per_sec2;
    const sign = d < 0 ? -1 : 1;
    // never exceed the speed from which we can still brake to a stop before the target
    const brakeVel = Math.sqrt(2 * maxAccel * Math.abs(d));
    const desiredVel = sign * Math.min(maxRate, brakeVel);
    const dv = Math.max(-maxAccel * dt, Math.min(maxAccel * dt, desiredVel - this.camVel));
    this.camVel += dv;
    let step = this.camVel * dt;
    // hard guarantee against discrete-step overshoot: never pass the target in one frame
    if (Math.abs(step) >= Math.abs(d)) { step = d; this.camVel = 0; }
    this.camHeading = (this.camHeading + step + 360) % 360;
    if (this.mapReady) {
      try {
        this.map.center = { lat: pos.lat, lng: pos.lng, altitude: pos.ele };
        this.map.heading = this.camHeading;
        this.map.tilt = H.chase_tilt_degrees;
        this.map.range = H.chase_range_meters;
      } catch (e) {}
      this.moveRider(pos);
    }
    if (now - this.lastHud > 180) { this.lastHud = now; this.hudRide(pos, grade, now); }
  }

  updateOrbit(dt, now) {
    const sum = this.pts[this.pts.length - 1];
    // power dropped to 0 at the finish; HR holds for the lag, then eases to 80
    this.powDisp = 0;
    const lag = H.hr_lag_seconds;
    const span = Math.max(1, H.orbit_seconds);
    const from = (this.hrAtFinish != null) ? this.hrAtFinish : this.hrDisp;
    const p = Math.max(0, Math.min(1, (this.orbitT - lag) / span));
    const eased = p * p * (3 - 2 * p);
    this.hrDisp = from + (80 - from) * eased;
    if (this.mapReady) {
      try {
        // ease tilt + range from the exact chase values into orbit values so
        // there is no abrupt switch
        const fromCam = this.orbitFrom || { tilt: H.chase_tilt_degrees, range: H.chase_range_meters };
        const k = Math.min(1, this.orbitT / 3.2);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const r = fromCam.range + (H.orbit_range_meters - fromCam.range) * ease;
        const tilt = fromCam.tilt + (H.orbit_tilt_degrees - fromCam.tilt) * ease;
        this.map.center = { lat: sum.lat, lng: sum.lng, altitude: sum.ele };
        this.map.heading = this.orbitHeading;
        this.map.tilt = tilt;
        this.map.range = r;
      } catch (e) {}
    }
    if (now - this.lastHud > 180) { this.lastHud = now; this.hudOrbit(now); }
  }

  hudRide(pos, grade, now) {
    const c = this.currentClimb(this.s);
    const pow = Math.round(this.powDisp);
    const hr = this.hrShownVal(now);
    // metrics + zones + markers
    this.set("v-pow", pow);
    this.set("v-powzone", this.powerZone(pow));
    this.mark("v-powmark", pow / 430 * 100);
    this.set("v-hr", hr);
    this.set("v-hrzone", this.hrZone(hr));
    this.mark("v-hrmark", (hr - 95) / (185 - 95) * 100);
    this.set("v-grd", grade.toFixed(1));
    const gc = this.cat(grade);
    this.set("v-grdzone", gc[0]); const gz = this.$("v-grdzone"); if (gz) gz.style.color = gc[1];
    this.mark("v-grdmark", (grade + 6) / 16 * 100);
    // stats chip
    this.set("v-elapsed", this.fmtTime(this.rideTime));
    this.set("v-dist2", (this.s / 1000).toFixed(2) + " km");
    this.set("v-asc2", Math.round(this.ascAt(this.s)) + " m");
    // climb banner (scoped to the current climb)
    const cc = this.cat(c.avgGrade);
    this.set("v-bnum", "CLIMB " + c.n + " OF " + this.climbCount);
    this.set("v-cat", cc[0]); const ce = this.$("v-cat"); if (ce) ce.style.background = cc[1];
    const toTop = Math.max(0, c.e - this.s);
    const ascInClimb = Math.max(0, this.ascAt(this.s) - this.ascAt(c.s));
    const toGoAsc = Math.max(0, c.ascent - ascInClimb);
    this.set("v-btop", (toTop / 1000).toFixed(1));
    this.set("v-bgo", Math.round(toGoAsc));
    this.set("v-bcur", Math.round(pos.ele));
    this.set("v-bgl", (toGoAsc / Math.max(1, toTop) * 100).toFixed(1));
    this.width("v-bdistbar", (this.s - c.s) / Math.max(1, c.e - c.s) * 100);
    this.width("v-bascbar", ascInClimb / Math.max(1, c.ascent) * 100);
    this.set("v-mode", this.mapReady ? "Ride replay" : "Preview");
  }

  hudOrbit(now) {
    const pow = Math.round(this.powDisp), hr = this.hrShownVal(now);
    const sumEle = Math.round(this.pts[this.pts.length - 1].ele);
    this.set("v-pow", pow); this.set("v-powzone", this.powerZone(pow)); this.mark("v-powmark", pow / 430 * 100);
    this.set("v-hr", hr); this.set("v-hrzone", this.hrZone(hr)); this.mark("v-hrmark", (hr - 95) / (185 - 95) * 100);
    this.set("v-grd", "0.0"); this.set("v-grdzone", "SUMMIT");
    const gz = this.$("v-grdzone"); if (gz) gz.style.color = "#ff8a52"; this.mark("v-grdmark", 37.5);
    this.set("v-elapsed", this.fmtTime(this.rideTime));
    this.set("v-dist2", (this.total / 1000).toFixed(2) + " km");
    this.set("v-asc2", Math.round(this.totalAsc) + " m");
    const c = this.climbs[this.climbs.length - 1]; const cc = this.cat(c.avgGrade);
    this.set("v-cat", cc[0]); const ce = this.$("v-cat"); if (ce) ce.style.background = cc[1];
    this.set("v-bnum", "CLIMB " + c.n + " OF " + this.climbCount);
    this.set("v-btop", "0.0"); this.set("v-bgo", "0"); this.set("v-bcur", sumEle); this.set("v-bgl", "0.0");
    this.width("v-bdistbar", 100); this.width("v-bascbar", 100);
    this.set("v-mode", "Summit orbit");
  }
}

const hero = new HeroReplay();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => hero.start());
} else {
  hero.start();
}
