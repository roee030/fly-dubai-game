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
    doorStage: "cockpit-door-destruction-6frames.png",
    pilotSeq: "pilot-new-source.png",
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
  const PLANE = {
    level: { sx: 34, sy: 54, sw: 632, sh: 184 }, // frame 1: level, crop above the runway strip
    shallow: { sx: 2003, sy: 368, sw: 644, sh: 190 }, // frame 8: shallow climb, used for the sky
  };

  // Runner sheet: 4 equal frames across. Figure occupies rows ~384..1024.
  // Each running frame is its own uncut image (keyed/runner-frame-N.png), drawn so the feet sit
  // on the cabin floor line. All frames share one scale, so the runner's size never changes.
  const RUNNER_FEET_Y = 497; // cabin floor line on screen
  const RUNNER_SCALE = 300 / 630; // figure is about 630px tall in the sheet
  const ALARM_INTRO = 0.7; // seconds for the runner to slide in after the alarm

  // Door: one row of 6 frames, from the kick to the door being destroyed. Each SPACE press
  // reveals the next frame, so the damage builds up and never resets.
  const DOOR_FRAMES = gridCells("doorStage", [227.5, 669.5, 1117.5, 1565, 2012.5, 2459.5], [319], 426, 498)[0];
  const DOOR_HITS = DOOR_FRAMES.length - 1; // presses needed after the first frame

  // Pilot fight: one 2 x 3 sheet, 6 frames read left to right, top to bottom. Frame 1 is the
  // ready stance; each SPACE press reveals the next frame: punch, kick, the pilot tumbling out of
  // the seat, the hero standing over him, and the pilot down on the cockpit floor.
  const PILOT_FRAMES = gridCells("pilotSeq", [397, 1200, 2000], [0, 854], 778, 790).flat();
  const PILOT_HITS = PILOT_FRAMES.length - 1;

  // Yoke sheet: 8 panels (2 rows x 4), progressively more strain.
  const YOKE_CELLS = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    YOKE_CELLS.push({ src: "yoke", x: [34, 704, 1374, 2044][col], y: [74, 614][row], w: 603, h: 451, s: BOX_H / 451 });
  }

  // Cabin sheet: two stacked states, measured from the image content. Both are 454px tall.
  const CABIN_NORMAL_TOP = 135;
  const CABIN_EMERGENCY_TOP = 627;
  const CABIN_STACK_H = 454;

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------
  const IMG = {};

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load " + file));
      img.src = "assets/" + encodeURI(file);
    });
  }

  // The plane and runner sheets in assets/keyed/ are copies with the white background made
  // transparent, generated ahead of time because browsers block pixel reads over file://.
  function loadAll() {
    return Promise.all(Object.entries(ASSET_FILES).map(([key, file]) => loadImage(file).then((img) => (IMG[key] = img))));
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
  function syncButtons() {
    const playing = S.name !== "title";
    const running = S.name === "cabin";
    btnNext.classList.toggle("hidden", !playing || !running);
    btnAction.classList.toggle("hidden", !playing || running);
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
        S.player = makePlayer();
        S.fade = makeFade();
        S.finishing = false;
        S.doneT = 0;
        break;
      case "fight":
        S.hits = 0;
        S.hp = 100;
        S.player = makePlayer();
        S.fade = makeFade();
        S.finishing = false;
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
  function startGame() {
    if (S.name !== "title") return;
    enterFullscreen();
    titleEl.hidden = true;
    go("takeoff");
  }

  // Browsers only allow fullscreen after a user gesture, so it is requested on the first tap.
  function enterFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
  document.addEventListener("pointerdown", enterFullscreen);
  startBtn.addEventListener("click", startGame);

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
    const ready = S.alarm && S.alarmT >= ALARM_INTRO;
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

  // Each SPACE press reveals the next door frame. The door only moves forward.
  function updateDoor(dt) {
    S.t += dt;
    const taps = consumeTaps();

    if (!S.finishing) {
      for (let i = 0; i < taps.space && S.hits < DOOR_HITS; i++) {
        S.hits++;
        playerQueue(S.player, [[DOOR_FRAMES[S.hits], 0.14]]);
      }
      if (S.hits >= DOOR_HITS) {
        S.finishing = true;
        playerQueue(S.player, [[DOOR_FRAMES[DOOR_HITS], 0.7]]);
      }
    }

    playerUpdate(S.player, dt);
    if (S.finishing && !playerBusy(S.player)) transitionTo("fight");
    fadeStep(S.fade, playerCell(S.player, DOOR_FRAMES[S.hits]), dt);
  }

  // Each SPACE press reveals the next frame of the fight. After the last frame the pilot is down.
  function updateFight(dt) {
    S.t += dt;
    const taps = consumeTaps();
    if (!S.finishing) {
      for (let i = 0; i < taps.space && S.hits < PILOT_HITS; i++) {
        S.hits++;
        playerQueue(S.player, [[PILOT_FRAMES[S.hits], 0.15]]);
      }
      S.hp = Math.max(0, 100 - (S.hits / PILOT_HITS) * 100);
      if (S.hits >= PILOT_HITS) {
        S.finishing = true;
        playerQueue(S.player, [[PILOT_FRAMES[PILOT_HITS], 0.8]]);
      }
    }
    playerUpdate(S.player, dt);
    if (S.finishing && !playerBusy(S.player)) transitionTo("yoke");
    fadeStep(S.fade, playerCell(S.player, PILOT_FRAMES[S.hits]), dt);
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
    drawCover(img, sheet, p);

    if (S.alarm) {
      const pulse = 0.25 + 0.2 * Math.sin(S.alarmT * 8);
      ctx.fillStyle = `rgba(255,0,0,${pulse})`;
      ctx.fillRect(0, 0, W, H);
      text("🚨 אזעקת חירום! 🚨", W / 2, 40, 34, "#ff5555");
    }

    // Runner: hidden until the alarm, then slides in and fades up.
    if (S.alarm) {
      const k = clamp(S.alarmT / ALARM_INTRO, 0, 1);
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

  function renderDoor() {
    ctx.fillStyle = "#1a0d10";
    ctx.fillRect(0, 0, W, H);

    fadeDraw(S.fade);

    text("לחץ [SPACE] במהירות לפריצת הדלת!", W / 2, 40, 30, "#ffcc33");
    bar(W / 2 - 300, H - 60, 600, 36, S.hits / DOOR_HITS, "#ff8800", `${Math.round((S.hits / DOOR_HITS) * 100)}%`);
  }

  function renderFight() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    fadeDraw(S.fade);

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
    text("בהשראת תושייתו וגבורתו של יניב אוחיון.", W / 2, H - 60, 22, "#ffffff");
    text("[ENTER] לשחק שוב", W / 2, H - 22, 16, "#aaaaaa");
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
      loadingEl.textContent = "שגיאה בטעינה: " + err.message;
      loadingEl.classList.add("error");
    });
})();
