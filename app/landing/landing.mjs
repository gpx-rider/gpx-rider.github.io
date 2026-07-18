// Landing-page hero replay.
//
// Plays a looping replay of one route (Ještěd) over the same top-down
// Leaflet/OpenStreetMap the app uses, with a faked HUD, then a whole-route
// overview hold, then a fade back to the start. No API key is needed (OSM
// tiles are free and anonymous); if the tiles fail to load for any reason it
// gracefully falls back to a still image so the page still reads. This is the
// public front page (app/index.html); "Launch GPX Rider" links to app.html.
//
// Ported from the original Claude Design (x-dc) prototype to plain no-build JS:
// every tunable now lives in LANDING_HERO (tuning.mjs) instead of design props,
// and the route comes from landing-route.mjs instead of a global.
import { LANDING_HERO as H } from "../core/tuning.mjs";
import { LANDING_ROUTE_POINTS } from "./landing-route.mjs";
import {
  MAP_ATTRIBUTION,
  MAP_MAX_ZOOM,
  MAP_TILE_SUBDOMAINS,
  MAP_TILE_URL,
  RIDER_MARKER_COLOR,
  RIDER_MARKER_RING_COLOR,
  RIDER_MARKER_SIZE_PIXELS,
} from "../core/tuning.mjs";

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
    return (this.bearing(a, b) + 360) % 360;
  }
  hrShownVal(now) {
    // heart rate refreshes at most once per second, like a real sensor
    if (this._hrShown == null || now - (this._hrShownAt || 0) >= 1000) {
      this._hrShown = Math.round(this.hrDisp);
      this._hrShownAt = now;
    }
    return this._hrShown;
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
  initMap() {
    try {
      const mount = this.$("gpxr-map");
      if (!mount || typeof L === "undefined") throw new Error("no-leaflet");
      this.map = L.map(mount, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      L.tileLayer(MAP_TILE_URL, {
        subdomains: MAP_TILE_SUBDOMAINS,
        maxZoom: MAP_MAX_ZOOM,
        attribution: MAP_ATTRIBUTION,
      }).addTo(this.map);
      const s0 = this.pts[0];
      this.map.setView([s0.lat, s0.lng], H.chase_zoom, { animate: false });
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
  riderIcon() {
    return L.divIcon({
      className: "rider-marker",
      html:
        `<div class="rider-marker-ring" style="--rider-color:${RIDER_MARKER_COLOR};--rider-ring:${RIDER_MARKER_RING_COLOR}">` +
        `<div class="rider-marker-arrow"></div></div>`,
      iconSize: [RIDER_MARKER_SIZE_PIXELS, RIDER_MARKER_SIZE_PIXELS],
      iconAnchor: [RIDER_MARKER_SIZE_PIXELS / 2, RIDER_MARKER_SIZE_PIXELS / 2],
    });
  }
  buildRoute() {
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
        for (let k = runStart; k <= end; k++) path.push([this.pts[k].lat, this.pts[k].lng]);
        if (path.length >= 2) {
          const seg = L.polyline(path, { color: colors[runStart], weight: 5 });
          seg.addTo(this.map);
          this.segs.push(seg);
        }
        runStart = i;
      }
    }
    this.rider = L.marker([this.pts[0].lat, this.pts[0].lng], {
      icon: this.riderIcon(),
      zIndexOffset: 1000,
      interactive: false,
    }).addTo(this.map);
  }

  rideStartS() {
    const v = H.finale_speed_kmh / 3.6;
    const secs = H.finale_seconds;
    return Math.max(0, this.total - Math.min(this.total, v * secs));
  }

  startLoop() {
    this.phase = "ride"; this.s = this.rideStartS(); this.overviewT = 0; this.fadeT = 0; this.rideTime = 0;
    this.powDisp = 60; this.hrDisp = 92; this.dsThisFrame = 0;
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
          this.phase = "overview"; this.overviewT = 0;
          this.powDisp = 0; this.hrAtFinish = this.hrDisp;
          this.enterOverview();
        }
      }
    }

    if (this.phase === "ride") {
      this.updateRide(dt, now);
    } else if (this.phase === "overview") {
      this.overviewT += dt;
      this.updateOverview(now);
      if (this.overviewT >= H.overview_seconds) { this.phase = "fadeout"; this.fadeT = 0; }
    } else if (this.phase === "fadeout") {
      this.fadeT += dt; const o = Math.min(1, this.fadeT / 0.7); this.setFade(o);
      this.updateOverview(now);
      if (o >= 1) {
        this.s = this.rideStartS(); this.rideTime = 0;
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
    if (!this.rider) return;
    this.rider.setLatLng([pos.lat, pos.lng]);
    const arrow = this.rider.getElement()?.querySelector(".rider-marker-arrow");
    if (arrow) arrow.style.transform = `rotate(${this.headingAt(this.s)}deg)`;
  }
  resetLines() {
    if (!this.mapReady) return;
    this.moveRider(this.interp(this.rideStartS()));
    this.map.setView([this.pts[0].lat, this.pts[0].lng], H.chase_zoom, { animate: false });
  }
  enterOverview() {
    if (!this.mapReady) return;
    const bounds = L.latLngBounds(this.pts.map((p) => [p.lat, p.lng]));
    this.map.fitBounds(bounds, { padding: [40, 40] });
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
    if (this.mapReady) {
      this.map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.3 });
      this.moveRider(pos);
    }
    if (now - this.lastHud > 180) { this.lastHud = now; this.hudRide(pos, grade, now); }
  }

  updateOverview(now) {
    // power dropped to 0 at the finish; HR holds for the lag, then eases to 80
    this.powDisp = 0;
    const lag = H.hr_lag_seconds;
    const span = Math.max(1, H.overview_seconds);
    const from = (this.hrAtFinish != null) ? this.hrAtFinish : this.hrDisp;
    const p = Math.max(0, Math.min(1, (this.overviewT - lag) / span));
    const eased = p * p * (3 - 2 * p);
    this.hrDisp = from + (80 - from) * eased;
    if (now - this.lastHud > 180) { this.lastHud = now; this.hudOverview(now); }
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

  hudOverview(now) {
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
    this.set("v-mode", "Route overview");
  }
}

const hero = new HeroReplay();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => hero.start());
} else {
  hero.start();
}
