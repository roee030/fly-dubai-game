"use strict";

// Arcade game: "הצלת את הטיסה". Vanilla canvas + requestAnimationFrame, fully offline.

(() => {
  const W = 960;
  const H = 540;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const loadingEl = document.getElementById("loading");
  const titleEl = document.getElementById("title");
  const startBtn = document.getElementById("startBtn");

  // ---------------------------------------------------------------------------
  // Assets (all from ./assets)
  // ---------------------------------------------------------------------------
  const ASSET_FILES = {
    sky: "background-aircraft-in-sky.png",
    runwayMove: "background-aircraft-on-ground-runway.png",
    takeoff: "keyed/flydubai-takeoff-variants-animation-sheet.png",
    cabin: "passenger-cabin-wide-passengers-only-matched.png",
    runner0: "keyed/runner-frame-0.png",
    runner1: "keyed/runner-frame-1.png",
    runner2: "keyed/runner-frame-2.png",
    runner3: "keyed/runner-frame-3.png",
    yoke: "consistent-hero-yoke-pull-animation.png",
    doorBg: "door-bg-clean.png",
    cockpitBg: "gallery_image_20261003_231821-pixel-art-16-bit-side-view-of-an-airliner-cockpit.jpg",
    doorPanel0: "keyed/door/door-0.png",
    doorPanel1: "keyed/door/door-1.png",
    doorPanel2: "keyed/door/door-2.png",
    doorPanel3: "keyed/door/door-3.png",
    doorPanel4: "keyed/door/door-4.png",
    doorPanel5: "keyed/door/door-5.png",
    doorHero0: "keyed/door/hero-0.png",
    doorHero1: "keyed/door/hero-1.png",
    doorHero2: "keyed/door/hero-2.png",
    doorHero3: "keyed/door/hero-3.png",
    doorHero4: "keyed/door/hero-4.png",
    doorHero5: "keyed/door/hero-5.png",
    fightBg: "gallery_image_20261003_231821-pixel-art-16-bit-side-view-of-an-airliner-cockpit.jpg",
    hero0: "keyed/fight/hero-0.png",
    hero1: "keyed/fight/hero-1.png",
    hero2: "keyed/fight/hero-2.png",
    hero3: "keyed/fight/hero-3.png",
    hero4: "keyed/fight/hero-4.png",
    hero5: "keyed/fight/hero-5.png",
    pilot0: "keyed/fight/pilot3-0.png",
    pilot1: "keyed/fight/pilot3-1.png",
    pilot2: "keyed/fight/pilot3-2.png",
    pilot3: "keyed/fight/pilot3-3.png",
    pilot4: "keyed/fight/pilot3-4.png",
  };

  // Every frame is drawn at the same on-screen height (BOX_H), so the picture never changes
  // scale between frames or stages. Each cell stores its own scale factor `s`.
  const BOX_H = 540;

  // Builds a grid of frames: `centers` = horizontal center of each column, `ys` = top of each
  // row, all cells cropped to the same size (wMax x hMax) so the frames line up.
  // `mult` (optional, per cell) corrects small differences in how big the hero is drawn in each
  // generated frame, so the hero keeps the same size from one hit to the next.
  function gridCells(src, centers, ys, wMax, hMax, mult) {
    return ys.map((y, r) =>
      centers.map((cx, c) => ({
        src,
        x: Math.round(cx - wMax / 2),
        y,
        w: wMax,
        h: hMax,
        s: (BOX_H / hMax) * (mult ? mult[r][c] : 1),
      }))
    );
  }

  // Takeoff sheet: airborne plane only (no runway strip).
  // The large sheets (takeoff, yoke, cabin) were downsized to 1280px wide for faster loading.
  // Their crop coordinates below were measured on the original 2688px sheets, so they are scaled here.
  const SS = 1280 / 2688;
  const sc = (v) => Math.round(v * SS);
  const PLANE = {
    level: { sx: sc(34), sy: sc(54), sw: sc(632), sh: sc(184) }, // frame 1: level, crop above the runway strip
    shallow: { sx: sc(2003), sy: sc(368), sw: sc(644), sh: sc(190) }, // frame 8: shallow climb, used for the sky
  };

  // Runner sheet: 4 equal frames across. Figure occupies rows ~384..1024.
  // Each running frame is its own uncut image (keyed/runner-frame-N.png), drawn so the feet sit
  // on the cabin floor line. All frames share one scale, so the runner's size never changes.
  const RUNNER_FEET_Y = 497; // cabin floor line on screen
  const RUNNER_SCALE = 300 / 630; // figure is about 630px tall in the sheet
  const ALARM_DELAY = 0.15; // the runner waits a moment after the alarm before coming in
  const ALARM_INTRO = 0.7; // seconds for the runner to slide in after that

  // Door breach: the door and the hero are separate sprites on the corridor background. Each SPACE
  // press is one kick; the kick lands and the door breaks one more step.
  const DOOR = {
    panelX: 0.80, // door center, fraction of the screen width
    doorway: { x: 0.645, y: 0.12, w: 0.31, h: 0.73 }, // the opening in the wall (fractions)
    panelFloor: 0.85, // where the door meets the floor, fraction of the screen height
    panelH: 0.73, // door height as a fraction of the screen height
    panelFeetFrac: 0.95, // door bottom inside its sprite (fraction of sprite height)
    heroX: 0.38,
    heroFloor: 0.93,
    heroH: 0.66,
    heroFeetFrac: 0.9,
    lunge: 0.22, // hero steps toward the door so the kick reaches it
    hitAt: 0.26,
    kickEnd: 0.5,
    kickFrames: [1, 2, 3, 4, 5], // hero frames used for the kick
    kickEnds: [0.08, 0.16, 0.26, 0.36, 0.5],
  };
  const DOOR_HITS = 4; // kicks until the door is destroyed
  const DOOR_PANEL_BY_HIT = [0, 1, 2, 3, 5]; // door sprite shown after 0..4 kicks
  // Opaque bounds of each door sprite (x0, y0, x1, y1) inside its 456 x 912 frame.
  const DOOR_BOX = [
    [34, 37, 428, 877],
    [23, 38, 432, 877],
    [30, 37, 435, 877],
    [28, 37, 425, 877],
    [21, 38, 456, 875],
    [0, 37, 435, 881],
  ];

  // Pilot fight: the cockpit is the background, and the hero and pilot are separate sprites that
  // move on their own. Each sprite is drawn bottom-center on an anchor point, at one shared scale.
  const FIGHT = {
    heroAnchor: { x: 0.42, y: 0.93 }, // fractions of the screen
    pilotAnchor: { x: 0.74, y: 0.93 },
    heroH: 0.66, // hero height as a fraction of the screen height
    pilotH: 0.62,
    lunge: 0.12, // how far the hero steps toward the pilot, so the punch reaches him
    hitAt: 0.14, // seconds into a punch when it lands
    punchEnd: 0.5,
    punchFrames: [1, 2, 3, 4, 5], // hero frames played during a punch
    punchEnds: [0.07, 0.14, 0.2, 0.32, 0.5],
    // Pilot reaction per hit: [frame, seconds] segments, the last frame holds.
    reactions: [
      [[1, 0.14], [2, 0.6]],
      [[3, 0.5]],
      [[4, 0.6]],
    ],
  };
  const PILOT_HITS = FIGHT.reactions.length;

  // Yoke sheet: 8 panels (2 rows x 4), progressively more strain.
  const YOKE_CELLS = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    YOKE_CELLS.push({ src: "yoke", x: sc([34, 704, 1374, 2044][col]), y: sc([74, 614][row]), w: sc(603), h: sc(451), s: BOX_H / 451 });
  }

  // Cabin sheet: two stacked states, measured from the image content. Both are 454px tall.
  const CABIN_NORMAL_TOP = sc(135);
  const CABIN_EMERGENCY_TOP = sc(627);
  const CABIN_STACK_H = sc(454);

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------
  const IMG = {};

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load " + file));
      // ?v= forces browsers to fetch the current versions of the resized files, not cached old ones.
      img.src = "assets/" + encodeURI(file) + "?v=2";
    });
  }

  // The plane and runner sheets in assets/keyed/ are copies with the white background made
  // transparent, generated ahead of time because browsers block pixel reads over file://.
  // Loads every asset and moves the loading bar as each one finishes.
  function loadAll() {
    const entries = Object.entries(ASSET_FILES);
    const fill = document.getElementById("loadingFill");
    let done = 0;
    return Promise.all(
      entries.map(([key, file]) =>
        loadImage(file).then((img) => {
          IMG[key] = img;
          done++;
          fill.style.width = `${Math.round((done / entries.length) * 100)}%`;
        })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const input = { rightHeld: false, rightTaps: 0, spaceTaps: 0 };

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowRight") {
      e.preventDefault();
      input.rightHeld = true;
      if (!e.repeat) input.rightTaps++;
    } else if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) input.spaceTaps++;
    } else if (e.code === "Enter" && S.name === "win") {
      go("takeoff");
    } else if ((e.code === "Enter" || e.code === "Space") && S.name === "title") {
      e.preventDefault();
      startGame();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowRight") input.rightHeld = false;
  });

  window.addEventListener("blur", () => { input.rightHeld = false; });

  // Touch buttons (phones and tablets). NEXT = run right (hold), ACTION = tap.
  const btnNext = document.getElementById("btnNext");
  const btnAction = document.getElementById("btnAction");

  function holdButton(el, onDown, onUp) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.classList.add("pressed");
      onDown();
    });
    const release = () => {
      el.classList.remove("pressed");
      if (onUp) onUp();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
  }

  holdButton(
    btnNext,
    () => {
      input.rightHeld = true;
      input.rightTaps++;
    },
    () => { input.rightHeld = false; }
  );

  holdButton(btnAction, () => {
    if (S.name === "win") {
      go("takeoff");
      return;
    }
    input.spaceTaps++;
  });

  // Each stage shows the button it uses: NEXT while running in the cabin, ACTION elsewhere.
  // RUN shows in the cabin, ACTION shows in the door, fight and yoke stages, and neither shows
  // during the takeoff or on the win screen.
  function syncButtons() {
    // RUN appears only once the runner is in the cabin and able to move.
    const running = S.name === "cabin" && S.alarm && S.alarmT >= ALARM_DELAY + ALARM_INTRO;
    const acting = S.name === "door" || S.name === "fight" || S.name === "yoke";
    btnNext.classList.toggle("hidden", !running);
    btnAction.classList.toggle("hidden", !acting);
  }

  // Best effort: lock to landscape where the browser allows it (needs a user gesture).
  document.addEventListener("pointerdown", () => {
    const o = screen.orientation;
    if (o && o.lock) o.lock("landscape").catch(() => {});
  }, { once: true });

  function consumeTaps() {
    const r = input.rightTaps;
    const s = input.spaceTaps;
    input.rightTaps = 0;
    input.spaceTaps = 0;
    return { right: r, space: s };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeIn = (x) => x * x;

  // Frame player: a segment is a list of [cell, seconds]. Segments run in order, one at a time.
  function makePlayer() {
    return { queue: [], cur: null, t: 0 };
  }

  function playerQueue(p, frames) {
    p.queue.push(frames);
  }

  function playerBusy(p) {
    return !!p.cur || p.queue.length > 0;
  }

  function playerUpdate(p, dt) {
    if (p.cur) {
      p.t += dt;
      const total = p.cur.reduce((sum, f) => sum + f[1], 0);
      if (p.t >= total) p.cur = null;
    }
    if (!p.cur && p.queue.length) {
      p.cur = p.queue.shift();
      p.t = 0;
    }
  }

  function playerCell(p, idle) {
    if (!p.cur) return idle;
    let acc = 0;
    for (const [cell, dur] of p.cur) {
      acc += dur;
      if (p.t < acc) return cell;
    }
    return p.cur[p.cur.length - 1][0];
  }

  // Short crossfade between consecutive cells, so frame-to-frame changes don't look like cuts.
  function makeFade() {
    return { last: null, prev: null, k: 1 };
  }

  function fadeStep(f, cell, dt) {
    if (cell !== f.last) {
      f.prev = f.last;
      f.last = cell;
      f.k = f.prev ? 0 : 1;
    }
    f.k = Math.min(1, f.k + dt / 0.1);
  }

  function fadeDraw(f) {
    if (!f.last) return;
    if (f.prev && f.k < 1) drawCell(f.prev);
    ctx.save();
    ctx.globalAlpha = f.k;
    drawCell(f.last);
    ctx.restore();
  }

  // Scene frames are stretched over the whole screen as well.
  function drawCell(r) {
    ctx.drawImage(IMG[r.src], r.x, r.y, r.w, r.h, 0, 0, W, H);
  }

  // Backgrounds are stretched over the whole screen. `pan` (0..1) moves a window across the image.
  function drawCover(img, r, pan = 0.5, alpha = 1) {
    const vw = r.sw * 0.6;
    const sx = r.sx + clamp(pan, 0, 1) * (r.sw - vw);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, r.sy, vw, r.sh, 0, 0, W, H);
    ctx.restore();
  }

  // Cabin background: cover fit in real screen pixels, so the passengers keep their proportions
  // even though the canvas itself is stretched to the screen.
  function drawCoverKeep(img, r, pan = 0.5) {
    const rect = canvas.getBoundingClientRect();
    const dW = rect.width;
    const dH = rect.height;
    const kx = dW / W;
    const ky = dH / H;
    const scale = Math.max(dW / r.sw, dH / r.sh);
    const dw = r.sw * scale;
    const dh = r.sh * scale;
    const dx = -(dw - dW) * clamp(pan, 0, 1);
    const dy = (dH - dh) / 2;
    ctx.save();
    ctx.scale(1 / kx, 1 / ky);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawSprite(img, r, cx, cy, width, angle = 0) {
    const h = (width * r.sh) / r.sw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, -width / 2, -h / 2, width, h);
    ctx.restore();
  }

  function text(str, x, y, size, color = "#fff", stroke = "#000") {
    ctx.save();
    ctx.direction = "rtl";
    ctx.font = `bold ${size}px 'Courier New', Courier, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 4);
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function bar(x, y, w, h, ratio, color, label) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 3, y + 3, Math.max(0, (w - 6) * clamp(ratio, 0, 1)), h - 6);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    if (label) text(label, x + w / 2, y + h / 2, Math.max(12, h - 8), "#fff", "#000");
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------
  const S = { name: "takeoff", t: 0, next: null, outT: 0, blackA: 0 };

  // Scene changes go through a black fade: fade out, switch scene, fade back in.
  const FADE_TIME = 0.6;

  function transitionTo(name) {
    if (S.next) return;
    S.next = name;
    S.outT = 0;
  }

  function go(name) {
    S.name = name;
    S.t = 0;
    consumeTaps();
    switch (name) {
      case "takeoff":
        S.plane = { x: 150, y: H * 0.72, angle: 0 };
        break;
      case "cabin":
        S.x = 60;
        S.speed = 0;
        S.anim = 0;
        S.alarm = false;
        S.alarmT = 0;
        break;
      case "door":
        S.hits = 0;
        S.progress = 0;
        S.atk = null;
        S.hitStop = 0;
        S.flash = 0;
        S.finishing = false;
        S.endT = 0;
        S.t = 0;
        break;
      case "fight":
        S.hits = 0;
        S.hp = 100;
        S.atk = null; // current punch: { t, n, landed }
        S.hitStop = 0; // seconds frozen on impact
        S.pilotSeg = null; // { hit, t } pilot reaction in progress
        S.knock = 0;
        S.flash = 0;
        S.finishing = false;
        S.endT = 0;
        S.t = 0;
        break;
      case "yoke":
        S.progress = 0;
        S.won = false;
        S.pull = 0;
        S.wonT = 0;
        S.shake = 0;
        break;
      case "win":
        S.shake = 0;
        break;
    }
  }

  // The title screen waits for START GAME (button, Enter or Space).
  function startGame(stage = "takeoff") {
    if (S.name !== "title") return;
    enterFullscreen();
    titleEl.hidden = true;
    go(stage);
  }

  // Testing: with ?debug in the address, the title screen shows a stage picker.
  document.querySelectorAll("#stagePick button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startGame(btn.dataset.stage);
    });
  });

  // Browsers only allow fullscreen after a user gesture, so it is requested on the first tap.
  function enterFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
  document.addEventListener("pointerdown", enterFullscreen);
  startBtn.addEventListener("click", () => startGame());

  // ---------------------------------------------------------------------------
  // Updates
  // ---------------------------------------------------------------------------
  // Takeoff: roll, lift off, climb into the sky, level out and fly for a moment, then transition.
  function updateTakeoff(dt) {
    const t = S.t;
    // Roll along the runway, then nose up while climbing, then level out in the middle of the sky.
    const accel = easeIn(clamp((t - 1.2) / 3.2, 0, 1));
    S.plane.x = 150 + accel * 330;
    const climb = clamp((t - 3.6) / 2, 0, 1);
    const level = clamp((t - 5.5) / 1.5, 0, 1);
    // The gentle hover fades in, so nothing jumps when the plane levels off.
    S.plane.y = H * 0.72 - climb * H * 0.3 + Math.sin(t * 2) * 4 * clamp((t - 6) / 0.6, 0, 1);
    S.plane.angle = -0.3 * clamp((t - 3.6) / 1.2, 0, 1) * (1 - level);
    if (t >= 9) transitionTo("cabin");
  }

  function updateCabin(dt) {
    S.t += dt;
    if (!S.alarm && S.t >= 2) {
      S.alarm = true;
      S.alarmT = 0;
    }
    if (S.alarm) S.alarmT += dt;

    // Controls unlock only once the runner has slid in after the alarm.
    const ready = S.alarm && S.alarmT >= ALARM_DELAY + ALARM_INTRO;
    const taps = consumeTaps();
    if (ready) {
      if (input.rightHeld) S.speed += 520 * dt;
      S.speed += taps.right * 90;
    }
    S.speed = Math.min(S.speed, 460) * Math.exp(-2.2 * dt);

    S.x = clamp(S.x + S.speed * dt, 40, W);
    S.anim += S.speed * dt * 0.02;

    if (S.x >= W - 150) transitionTo("door");
  }

  // One kick per SPACE press. The kick lands at DOOR.hitAt, the frame freezes for a moment, and the
  // door steps to its next damage state. The door is never reset.
  function updateDoor(dt) {
    S.t += dt;
    const taps = consumeTaps();
    if (!S.atk && !S.finishing && S.hits < DOOR_HITS && taps.space > 0) {
      S.atk = { t: 0, landed: false };
    }
    if (S.hitStop > 0) {
      S.hitStop -= dt;
    } else if (S.atk) {
      S.atk.t += dt;
      if (!S.atk.landed && S.atk.t >= DOOR.hitAt) {
        S.atk.landed = true;
        S.hitStop = 0.07;
        S.hits++;
        S.flash = 1;
      }
      if (S.atk.t >= DOOR.kickEnd) S.atk = null;
    }
    S.flash = Math.max(0, S.flash - dt / 0.18);
    S.progress = S.hits / DOOR_HITS;

    if (!S.atk && S.hits >= DOOR_HITS && !S.finishing) S.finishing = true;
    if (S.finishing && !S.atk) {
      S.endT += dt;
      if (S.endT > 1.0) transitionTo("fight");
    }
  }

  // Hero frame during the kick.
  function doorHeroFrame() {
    if (!S.atk) return 0;
    const i = DOOR.kickEnds.findIndex((end) => S.atk.t < end);
    return DOOR.kickFrames[i === -1 ? DOOR.kickFrames.length - 1 : i];
  }

  // Hero steps toward the door during the kick and returns.
  function doorHeroLunge() {
    if (!S.atk) return 0;
    const t = S.atk.t;
    if (t < DOOR.hitAt) return DOOR.lunge * W * (1 - Math.pow(1 - t / DOOR.hitAt, 2));
    return DOOR.lunge * W * clamp(1 - (t - DOOR.hitAt) / (DOOR.kickEnd - DOOR.hitAt), 0, 1);
  }

  // One punch per SPACE press. The punch lands at FIGHT.hitAt, freezes the frame for a moment
  // (hit-stop), and the pilot reacts. Presses during a punch are ignored, so punches never overlap.
  function updateFight(dt) {
    S.t += dt;
    const taps = consumeTaps();
    if (!S.atk && !S.finishing && S.hits < PILOT_HITS && taps.space > 0) {
      S.hits++;
      S.atk = { t: 0, n: S.hits, landed: false };
      S.hp = Math.max(0, 100 - (S.hits / PILOT_HITS) * 100);
    }

    if (S.hitStop > 0) {
      S.hitStop -= dt;
    } else if (S.atk) {
      S.atk.t += dt;
      if (!S.atk.landed && S.atk.t >= FIGHT.hitAt) {
        S.atk.landed = true;
        S.hitStop = 0.07;
        S.knock = 0.04 * W;
        S.flash = 1;
        S.pilotSeg = { hit: S.atk.n, t: 0 };
      }
      if (S.atk.t >= FIGHT.punchEnd) S.atk = null;
    }

    if (S.pilotSeg && S.hitStop <= 0) S.pilotSeg.t += dt;
    S.knock *= Math.exp(-10 * dt);
    S.flash = Math.max(0, S.flash - dt / 0.18);

    if (!S.atk && S.hits >= PILOT_HITS && !S.finishing) S.finishing = true;
    if (S.finishing && !S.atk) {
      S.endT += dt;
      if (S.endT > 1.2) transitionTo("yoke");
    }
  }

  // Frame index of the hero's punch at the current time.
  function heroFrame() {
    if (!S.atk) return 0;
    const i = FIGHT.punchEnds.findIndex((end) => S.atk.t < end);
    return FIGHT.punchFrames[i === -1 ? FIGHT.punchFrames.length - 1 : i];
  }

  // Hero step toward the pilot during the punch, and back.
  function heroLunge() {
    if (!S.atk) return 0;
    const t = S.atk.t;
    if (t < FIGHT.hitAt) return FIGHT.lunge * W * (1 - Math.pow(1 - t / FIGHT.hitAt, 2));
    return FIGHT.lunge * W * clamp(1 - (t - FIGHT.hitAt) / (FIGHT.punchEnd - FIGHT.hitAt), 0, 1);
  }

  // Pilot frame for the current reaction. Holds the last frame of the reaction.
  function pilotFrame() {
    if (!S.pilotSeg) return 0;
    const seg = FIGHT.reactions[S.pilotSeg.hit - 1];
    let acc = 0;
    for (const [frame, dur] of seg) {
      acc += dur;
      if (S.pilotSeg.t < acc) return frame;
    }
    return seg[seg.length - 1][0];
  }

  function updateYoke(dt) {
    S.t += dt;
    const taps = consumeTaps();
    S.pull = Math.max(0, S.pull - dt * 4);
    if (!S.won) {
      if (taps.space > 0) S.pull = 1;
      S.progress = clamp(S.progress - 6 * dt + taps.space * 8, 0, 100);
      if (S.progress >= 100) S.won = true;
    } else {
      S.wonT += dt;
      if (S.wonT > 1.6) transitionTo("win");
    }
    // Rattle only while the plane is still in trouble; stop once it is stabilized.
    S.shake = !S.won && S.progress > 60 ? ((S.progress - 60) / 40) * 6 : 0;
  }

  function updateWin(dt) {
    S.t += dt;
  }

  function update(dt) {
    syncButtons();
    if (S.name === "title") return;
    if (S.next) {
      S.outT += dt;
      S.blackA = Math.min(1, S.outT / FADE_TIME);
      if (S.outT >= FADE_TIME) {
        const name = S.next;
        S.next = null;
        go(name);
        S.blackA = 1;
      }
    } else if (S.blackA > 0) {
      S.blackA = Math.max(0, S.blackA - dt / FADE_TIME);
    }

    switch (S.name) {
      case "takeoff": S.t += dt; updateTakeoff(dt); break;
      case "cabin": updateCabin(dt); break;
      case "door": updateDoor(dt); break;
      case "fight": updateFight(dt); break;
      case "yoke": updateYoke(dt); break;
      case "win": updateWin(dt); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Renders
  // ---------------------------------------------------------------------------
  function renderTakeoff() {
    const t = S.t;
    // One runway image for the whole roll: it starts still and speeds up smoothly (no swap).
    const tau = Math.max(0, t - 1.2);
    let pan = tau <= 3.2 ? (0.35 * tau * tau * tau) / (3 * 3.2 * 3.2) : 0.373 + 0.35 * (tau - 3.2);
    pan = pan % 2;
    pan = pan > 1 ? 2 - pan : pan; // ping-pong across the image
    drawCover(IMG.runwayMove, { sx: 0, sy: 0, sw: IMG.runwayMove.width, sh: IMG.runwayMove.height }, pan);
    // Crossfade into the cruising sky while the plane climbs.
    const skyAlpha = clamp((t - 3.8) / 2.6, 0, 1);
    if (skyAlpha > 0) {
      drawCover(IMG.sky, { sx: 0, sy: 0, sw: IMG.sky.width, sh: IMG.sky.height }, 0.5, skyAlpha);
    }

    drawSprite(IMG.takeoff, PLANE.level, S.plane.x, S.plane.y, 300, S.plane.angle);
  }

  function renderCabin() {
    const img = IMG.cabin;
    const p = clamp(S.x / W, 0, 1);
    // Both stacks are the same height and aligned to their measured content bands, so the
    // normal and emergency cabins line up when the alarm switches them.
    const sheet = S.alarm
      ? { sx: 0, sy: CABIN_EMERGENCY_TOP, sw: img.width, sh: CABIN_STACK_H }
      : { sx: 0, sy: CABIN_NORMAL_TOP, sw: img.width, sh: CABIN_STACK_H };
    // Alarm: the whole screen shakes a little.
    if (S.alarm) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    drawCoverKeep(img, sheet, p);

    if (S.alarm) {
      const pulse = 0.25 + 0.2 * Math.sin(S.alarmT * 8);
      ctx.fillStyle = `rgba(255,0,0,${pulse})`;
      ctx.fillRect(0, 0, W, H);
      text("🚨 אזעקת חירום! 🚨", W / 2, 40, 34, "#ff5555");
    }

    // Runner: hidden until the alarm, then slides in and fades up.
    if (S.alarm) {
      const k = clamp((S.alarmT - ALARM_DELAY) / ALARM_INTRO, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      const img = IMG["runner" + (Math.floor(S.anim) % 4)];
      const w = img.width * RUNNER_SCALE;
      const h = img.height * RUNNER_SCALE;
      ctx.save();
      ctx.globalAlpha = e;
      ctx.drawImage(img, S.x - (1 - e) * 140 - w / 2, RUNNER_FEET_Y - h, w, h);
      ctx.restore();
      if (k >= 1) text("החזק [→] או הקש מהר לריצה!", W / 2, H - 28, 22, "#ffcc33");
    }
  }

  // Draws a sprite so that `feetFrac` of its height lands on the floor point (x, floorY).
  function drawSpriteFeet(img, x, floorY, scale, feetFrac) {
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, x - w / 2, floorY - feetFrac * h, w, h);
  }

  function renderDoor() {
    const panelScale = (DOOR.panelH * H) / (IMG.doorPanel0.height * DOOR.panelFeetFrac);
    const heroScale = (DOOR.heroH * H) / (IMG.doorHero0.height * DOOR.heroFeetFrac);
    const panelX = DOOR.panelX * W;
    const panelFloor = DOOR.panelFloor * H;
    // Damage only goes up: the panel sprite for each kick count, from the sealed look of the second
    // frame onward (the first frame uses the same sprite, so the edges never show).
    const panelIdx = DOOR_PANEL_BY_HIT[Math.min(S.hits, DOOR_PANEL_BY_HIT.length - 1)];

    ctx.drawImage(IMG.doorBg, 0, 0, W, H);
    // The cockpit shows through the doorway only once the door starts to break, so an intact door
    // stays sealed at its edges.
    const reveal = clamp((S.hits - 2) / 2, 0, 1);
    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.beginPath();
    ctx.rect(DOOR.doorway.x * W, DOOR.doorway.y * H, DOOR.doorway.w * W, DOOR.doorway.h * H);
    ctx.clip();
    ctx.drawImage(IMG.cockpitBg, 0, 0, W, H);
    ctx.restore();
    // Each door sprite's own panel (its opaque bounds) is fitted to the doorway, so every state of
    // the door has the same size and place in the wall.
    const [bx0, by0, bx1, by1] = DOOR_BOX[panelIdx];
    ctx.drawImage(
      IMG["doorPanel" + panelIdx],
      bx0,
      by0,
      bx1 - bx0,
      by1 - by0,
      DOOR.doorway.x * W,
      DOOR.doorway.y * H,
      DOOR.doorway.w * W,
      DOOR.doorway.h * H
    );

    const heroX = DOOR.heroX * W + doorHeroLunge();
    drawSpriteFeet(IMG["doorHero" + doorHeroFrame()], heroX, DOOR.heroFloor * H, heroScale, DOOR.heroFeetFrac);

    if (S.flash > 0) {
      ctx.save();
      ctx.globalAlpha = S.flash * 0.4;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(panelX - 0.1 * W, panelFloor - 0.5 * H, 0.12 * W, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    text("לחץ [SPACE] במהירות לפריצת הדלת!", W / 2, 40, 30, "#ffcc33");
    bar(W / 2 - 300, H - 60, 600, 36, S.hits / DOOR_HITS, "#ff8800", `${Math.round((S.hits / DOOR_HITS) * 100)}%`);
  }

  // Draws a sprite bottom-center at (x, bottom) at the given scale. All frames of a character use
  // the same scale, so the character never changes size between frames.
  function drawSpriteAt(img, x, bottom, k) {
    const w = img.width * k;
    const h = img.height * k;
    ctx.drawImage(img, x - w / 2, bottom - h, w, h);
  }

  function renderFight() {
    const hH = FIGHT.heroH * H;
    const pH = FIGHT.pilotH * H;
    const pilotX = FIGHT.pilotAnchor.x * W + S.knock;
    const pilotBottom = FIGHT.pilotAnchor.y * H;
    const heroX = FIGHT.heroAnchor.x * W + heroLunge();
    const heroBottom = FIGHT.heroAnchor.y * H;
    const breathe = S.atk ? 0 : Math.sin(S.t * 3) * 3;

    ctx.drawImage(IMG.fightBg, 0, 0, W, H);
    // The pilot's sprite frames are untouched cells; the floor point sits at 93% of the cell height.
    const pilotScale = pH / (IMG.pilot0.height * 0.77);
    drawSpriteFeet(IMG["pilot" + pilotFrame()], pilotX, pilotBottom, pilotScale, 0.93);
    if (S.flash > 0) {
      ctx.save();
      ctx.globalAlpha = S.flash * 0.45;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pilotX, pilotBottom - pH * 0.8, pH * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawSpriteAt(IMG["hero" + heroFrame()], heroX, heroBottom + breathe, hH / IMG.hero0.height);

    text("הכרע את המחבל! [SPACE]", W / 2, 40, 30, "#ffcc33");
    bar(W - 300, 80, 260, 26, S.hp / 100, "#e33", "HP");
  }

  // Attitude indicator (artificial horizon), the classic flight instrument. The horizon starts
  // well below the aircraft symbol (nose down, in trouble) and rises to level as the pull works.
  function drawAttitude(cx, cy, r, progress, pull) {
    const p = progress / 100;
    const pitch = (1 - p) * 26; // degrees nose-down: 26 at 0%, level at 100%
    const pxPerDeg = r / 30;
    const horizonY = cy + pitch * pxPerDeg;

    ctx.save();
    // Housing
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.fillStyle = "#15181f";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = pull > 0 ? `rgba(255,220,80,${0.4 + pull * 0.6})` : "#596275";
    ctx.stroke();

    // Sky and ground, clipped to the dial
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#2f7fd1";
    ctx.fillRect(cx - r, cy - r, r * 2, horizonY - (cy - r));
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(cx - r, horizonY, r * 2, cy + r - horizonY);
    // Horizon line
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - r, horizonY - 1, r * 2, 2);
    // Pitch ladder
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    for (const deg of [-20, -10, 10, 20]) {
      const y = horizonY - deg * pxPerDeg;
      ctx.beginPath();
      ctx.moveTo(cx - 22, y);
      ctx.lineTo(cx + 22, y);
      ctx.stroke();
    }
    ctx.restore();

    // Fixed aircraft symbol
    ctx.save();
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy);
    ctx.lineTo(cx - r * 0.12, cy);
    ctx.lineTo(cx, cy + 8);
    ctx.lineTo(cx + r * 0.12, cy);
    ctx.lineTo(cx + r * 0.45, cy);
    ctx.stroke();
    ctx.restore();

    const alt = Math.round(50 + progress * 9.5);
    const color = progress < 40 ? "#ff6b6b" : progress < 80 ? "#ffd166" : "#7dff7d";
    text(`${alt} ft`, cx, cy + r + 30, 22, color);
    ctx.restore();
  }

  function renderYoke() {
    const p = S.progress / 100;
    const idx = Math.min(YOKE_CELLS.length - 1, Math.floor(p * YOKE_CELLS.length));
    const shakeX = S.shake > 0 ? (Math.random() - 0.5) * 2 * S.shake : 0;
    const shakeY = S.shake > 0 ? (Math.random() - 0.5) * 2 * S.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.fillStyle = "#000";
    ctx.fillRect(-20, -20, W + 40, H + 40);
    drawCell(YOKE_CELLS[idx]);
    ctx.restore();

    drawAttitude(150, 150, 90, S.progress, S.pull || 0);

    text("משוך את ההגה חזק! [SPACE]", W / 2, 40, 30, "#ffcc33");
    bar(W / 2 - 300, H - 60, 600, 36, S.progress / 100, "#55aaff", `${Math.round(S.progress)}%`);
  }

  function renderWin() {
    drawCover(IMG.sky, { sx: 0, sy: 0, sw: IMG.sky.width, sh: IMG.sky.height });
    // Same plane as the takeoff, flying level.
    const bob = Math.sin(S.t * 2) * 6;
    drawSprite(IMG.takeoff, PLANE.level, W / 2, H * 0.42 + bob, 300, -0.05);

    text("כל הכבוד! הצלת את הטיסה! ✈️🏆", W / 2, H - 110, 34, "#ffcc33");
    text("בהשראת תושייתו וגבורתו של יניב חיון.", W / 2, H - 60, 22, "#ffffff");
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    switch (S.name) {
      case "takeoff": renderTakeoff(); break;
      case "cabin": renderCabin(); break;
      case "door": renderDoor(); break;
      case "fight": renderFight(); break;
      case "yoke": renderYoke(); break;
      case "win": renderWin(); break;
    }
    ctx.restore();

    if (S.blackA > 0) {
      ctx.fillStyle = `rgba(0,0,0,${S.blackA})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = 0;

  function frame(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadAll()
    .then(() => {
      loadingEl.remove();
      S.name = "title";
      titleEl.hidden = false;
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      document.getElementById("loadingText").textContent = "שגיאה בטעינה: " + err.message;
      loadingEl.classList.add("error");
    });
})();
