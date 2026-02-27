const slots = document.querySelectorAll(".slot");

window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (!event.ctrlKey) return;
  if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "0") {
    event.preventDefault();
  }
});

window.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

window.addEventListener("gesturechange", (event) => {
  event.preventDefault();
});

window.addEventListener("gestureend", (event) => {
  event.preventDefault();
});

const CLICK_SOUNDS = Array.from({ length: 15 }, (_, i) => `sounds/${i + 1}.mp3`);
const DEATH_SOUNDS = ["deathSounds/death1.mp3"];
const MASTER_VOLUME = 0.5;
const backgroundMusic = new Audio("backgroundSounds/instrumental.mp3");
const backgroundMusicDanger = new Audio("backgroundSounds/instrumental2.mp3");
const backgroundMusicCritical = new Audio("backgroundSounds/dmol3.mp3");

backgroundMusic.loop = true;
backgroundMusicDanger.loop = true;
backgroundMusicCritical.loop = true;
backgroundMusic.volume = MASTER_VOLUME;
backgroundMusicDanger.volume = MASTER_VOLUME;
backgroundMusicCritical.volume = MASTER_VOLUME;

let activeBackgroundTrack = 1;

function playBackgroundTrack(trackNumber) {
  const getTrackByNumber = (n) => {
    if (n === 3) return backgroundMusicCritical;
    if (n === 2) return backgroundMusicDanger;
    return backgroundMusic;
  };

  const nextTrack = getTrackByNumber(trackNumber);
  const currentTrack = getTrackByNumber(activeBackgroundTrack);

  if (currentTrack !== nextTrack) {
    currentTrack.pause();
    currentTrack.currentTime = 0;
  }

  nextTrack.currentTime = 0;

  nextTrack.play().catch(() => {});
  activeBackgroundTrack = trackNumber;
}

function playRandomClickSound() {
  const randomSrc = CLICK_SOUNDS[Math.floor(Math.random() * CLICK_SOUNDS.length)];
  const audio = new Audio(randomSrc);
  audio.volume = MASTER_VOLUME;
  audio.play().catch(() => {});
}

function playRandomDeathSound() {
  if (!DEATH_SOUNDS.length) return;
  const randomSrc = DEATH_SOUNDS[Math.floor(Math.random() * DEATH_SOUNDS.length)];
  const audio = new Audio(randomSrc);
  audio.volume = MASTER_VOLUME;
  audio.play().catch(() => {});
}

playBackgroundTrack(3);
window.addEventListener("pointerdown", () => {
  const currentTrack = activeBackgroundTrack === 3
    ? backgroundMusicCritical
    : activeBackgroundTrack === 2
      ? backgroundMusicDanger
      : backgroundMusic;
  if (currentTrack.paused) currentTrack.play().catch(() => {});
}, { once: true, passive: true });

const pressures = new Array(slots.length).fill(0);
const dead = new Array(slots.length).fill(false);
const respawnLeft = new Array(slots.length).fill(0);

// CONSTIPATION state
const constipated = new Array(slots.length).fill(false);
const holdMs = new Array(slots.length).fill(0);

const MAX = 100;
const UNDERFLOW_DEATH_THRESHOLD = -20;
const BASE_SPEED = 10;       // osnovna brzina rasta (po sekundi)
const CLICK_REDUCTION = 20;
const RESPAWN_SECONDS = 5;

const DEATH_LIMIT = 5;
const SIMULTANEOUS_DEAD_LIMIT = 3;
let totalDeaths = 0;
let totalFarts = 0;
let gameOver = false;
let deathBurstTimers = []; // track pending death-burst timeouts
let canDismissModal = false; // prevent accidental backdrop tap closing modal

const deathStatusEl = document.getElementById("deathStatus");
const middleGasFillEl = document.getElementById("middleGasFill");
const middleDeathsValueEl = document.getElementById("middleDeathsValue");
const timerEl = document.getElementById("gameTimer");
const fartCounterEl = document.getElementById("fartCounter");
const headerEl = document.querySelector("header");
const headerRightEl = document.querySelector(".header-right");
const mobileStatsHostEl = document.getElementById("mobileStatsHost");

// Tube fill elements (map slotIndex → fill element)
const tubeFills = [];
document.querySelectorAll('.tube-row-top .tube').forEach((tube, i) => {
  tubeFills[i] = tube.querySelector('.tube-fill');
});
document.querySelectorAll('.tube-row-bottom .tube').forEach((tube, i) => {
  tubeFills[i + 4] = tube.querySelector('.tube-fill');
});

function updateTubeFill(slotIndex, pressure) {
  const fill = tubeFills[slotIndex];
  if (!fill) return;
  const pct = Math.max(0, Math.min(100, pressure));
  fill.style.height = pct + '%';

  const ratio = pct / MAX;
  const hue = 120 - (120 * ratio);
  const c1 = `hsl(${hue}, 78%, 40%)`;
  const c2 = `hsl(${hue}, 92%, 58%)`;

  if (slotIndex < 4) {
    fill.style.background = `linear-gradient(to bottom, ${c2}, ${c1})`;
  } else {
    fill.style.background = `linear-gradient(to top, ${c2}, ${c1})`;
  }
}

function placeStatusByViewport() {
  if (!headerEl || !headerRightEl || !mobileStatsHostEl) return;

  if (window.matchMedia("(max-width: 720px)").matches) {
    if (headerRightEl.parentElement !== mobileStatsHostEl) {
      mobileStatsHostEl.appendChild(headerRightEl);
    }
    return;
  }

  if (headerRightEl.parentElement !== headerEl) {
    headerEl.appendChild(headerRightEl);
  }
}

window.addEventListener("resize", placeStatusByViewport);
placeStatusByViewport();

// popup DOM (ako ga imaš)
const gameOverBackdrop = document.getElementById("gameOverBackdrop");
const restartBtn = document.getElementById("restartBtn");
const exitBtn = document.getElementById("exitBtn");
const finalTimeEl = document.getElementById("finalTime");
const finalFartsEl = document.getElementById("finalFarts");

// TIMER
let elapsedSec = 0;
let timerAcc = 0;

function formatMMSS(totalSeconds){
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateDeathStatus() {
  if (deathStatusEl) {
    deathStatusEl.textContent = `Status: ${totalDeaths} / ${DEATH_LIMIT} deaths`;
  }

  if (middleDeathsValueEl) {
    middleDeathsValueEl.textContent = `${totalDeaths} / ${DEATH_LIMIT}`;
  }

  if (middleGasFillEl) {
    const fillPercent = Math.max(0, Math.min(100, (totalDeaths / DEATH_LIMIT) * 100));
    middleGasFillEl.style.width = `${fillPercent}%`;
    // Shift hue from green (120) to red (0) as deaths increase
    const hue = 120 - (fillPercent / 100) * 120;
    const colorStart = `hsl(${hue}, 70%, 35%)`;
    const colorEnd   = `hsl(${hue}, 70%, 50%)`;
    middleGasFillEl.style.background = `linear-gradient(90deg, ${colorStart}, ${colorEnd})`;
    // Update wave color to match the gas end color exactly
    const waveEl = middleGasFillEl.querySelector('.middle-gas-wave');
    if (waveEl) waveEl.style.background = colorEnd;
  }
}
updateDeathStatus();
if (timerEl) timerEl.textContent = "00:00";

// -----------------------------
// CONSTIPATION CONFIG
// -----------------------------
const CONST_START_AFTER_SEC = 0;   // odmah na pocetku
const CONST_CHECK_MIN_SEC = 2;     // na 10-20s proverava
const CONST_CHECK_MAX_SEC = 10;
const CONST_HOLD_TO_CURE_MS = 1000; // hold 1s
const CONST_CURE_PRESSURE = 10;     // posle cure pressure = 30%

function rand(a, b){ return a + Math.random() * (b - a); }

let nextConstipationCheck = CONST_START_AFTER_SEC + rand(CONST_CHECK_MIN_SEC, CONST_CHECK_MAX_SEC);

// -----------------------------
// SPEEDS
// -----------------------------
function makeSpeed() {
  return {
    base: BASE_SPEED * (0.7 + Math.random() * 0.8),     // 0.7x .. 1.5x
    waveAmp: 0.25 + Math.random() * 0.35,               // 25%..60%
    waveFreq: 0.15 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    drift: 1,
    driftTarget: 0.7 + Math.random() * 1.0,
  };
}
const speeds = Array.from({ length: slots.length }, () => makeSpeed());

// -----------------------------
// OVERLAYS (dead + constipation)
// -----------------------------
slots.forEach((slot) => {
  // DEAD overlay (🪦 + countdown)
  const characterSrc = slot.querySelector(".character")?.getAttribute("src") || "";
  const deadOv = document.createElement("div");
  deadOv.className = "dead-overlay";
  deadOv.style.display = "none";
  deadOv.innerHTML = `
    <div class="grave">
      <img src="UI/images/grave.png" alt="grave" />
      ${characterSrc ? `<img class="grave-icon" src="${characterSrc}" alt="" aria-hidden="true" />` : ""}
    </div>
    <div class="countdown">5</div>
  `;
  slot.appendChild(deadOv);

  // CONSTIPATION overlay (with pulsing character)
  const constOv = document.createElement("div");
  constOv.className = "constipation-overlay";
  constOv.style.display = "none";
  constOv.innerHTML = `
    <div class="constipation-timer-top">0.0s</div>
    <img class="constipation-hand" src="UI/images/hand-press.png" alt="Hold to cure" />
  `;
  slot.appendChild(constOv);
});

function setGasHeight(slot, value01to100) {
  const gas = slot.querySelector(".gas");
  if (!gas) return;
  const visualValue = Math.max(0, Math.min(MAX, value01to100));
  gas.style.height = visualValue + "%";

  const ratio = visualValue / MAX;
  const hue = 120 - (120 * ratio);
  const colorBottom = `hsl(${hue}, 78%, 40%)`;
  const colorTop = `hsl(${hue}, 92%, 58%)`;
  gas.style.background = `linear-gradient(to top, ${colorBottom}, ${colorTop})`;

  // Update wave color to match gas surface
  const wave = gas.querySelector(".gas-wave");
  if (wave) wave.style.background = colorTop;
}

// DEAD overlay helpers
function showDeadOverlay(slot, secondsLeft) {
  const overlay = slot.querySelector(".dead-overlay");
  if (!overlay) return;
  const cd = overlay.querySelector(".countdown");
  overlay.style.display = "flex";
  if (cd) cd.textContent = String(Math.ceil(secondsLeft));
}
function hideDeadOverlay(slot) {
  const overlay = slot.querySelector(".dead-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
}

// Constipation alert banners
const constAlertTop = document.getElementById('constAlertTop');
const constAlertBottom = document.getElementById('constAlertBottom');

function positionConstipationAlert(i) {
  const isTop = i < 4;
  const alert = isTop ? constAlertTop : constAlertBottom;
  const otherAlert = isTop ? constAlertBottom : constAlertTop;

  if (otherAlert) otherAlert.classList.remove('active');
  if (!alert) return;

  alert.classList.add('active');

  // Position arrow to point at the center of the constipated slot
  const slot = slots[i];
  const arrow = alert.querySelector('.constipation-alert-arrow');
  if (slot && arrow) {
    const slotRect = slot.getBoundingClientRect();
    const alertRect = alert.getBoundingClientRect();
    const slotCenter = slotRect.left + slotRect.width / 2;
    const alertCenter = alertRect.left + alertRect.width / 2;
    const offset = slotCenter - alertCenter;
    arrow.style.transform = `translateX(${offset}px)`;
  }
}

function hideConstipationAlert() {
  if (constAlertTop) constAlertTop.classList.remove('active');
  if (constAlertBottom) constAlertBottom.classList.remove('active');
}

// CONST overlay helpers
function showConstipation(i) {
  const slot = slots[i];
  const overlay = slot.querySelector(".constipation-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  slot.classList.add("constipated");
  updateConstipationProgress(i);
  positionConstipationAlert(i);
}
function hideConstipation(i) {
  const slot = slots[i];
  const overlay = slot.querySelector(".constipation-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  slot.classList.remove("constipated");
  hideConstipationAlert();
}
function updateConstipationProgress(i) {
  const slot = slots[i];
  const overlay = slot.querySelector(".constipation-overlay");
  if (!overlay) return;

  const elapsed = (holdMs[i] / 1000).toFixed(1);
  const target = (CONST_HOLD_TO_CURE_MS / 1000).toFixed(1);

  const timerEl = overlay.querySelector(".constipation-timer-top");
  if (timerEl) timerEl.textContent = `${elapsed}s`;
}

function triggerConstipation() {
  // samo jedan constipation u isto vreme (po spec-u)
  if (constipated.some(v => v)) return;

  // odaberi random slot koji je aktivan (nije dead i nije disabled)
  const eligible = [];
  for (let i = 0; i < slots.length; i++) {
    if (!dead[i] && !constipated[i]) eligible.push(i);
  }
  if (!eligible.length) return;

  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  constipated[pick] = true;
  holdMs[pick] = 0;
  showConstipation(pick);
}

function cureConstipation(i) {
  constipated[i] = false;
  holdMs[i] = 0;
  hideConstipation(i);

  pressures[i] = CONST_CURE_PRESSURE;
  setGasHeight(slots[i], pressures[i]);
}

// -----------------------------
// GAME OVER POPUP
// -----------------------------
function openGameOverPopup({ explosion = false } = {}) {
  if (!gameOverBackdrop) return;
  if (finalTimeEl) finalTimeEl.textContent = formatMMSS(elapsedSec);
  if (finalFartsEl) finalFartsEl.textContent = totalFarts;

  // High score check (based on time survived)
  const badge = document.getElementById("highscoreBadge");
  const prevBest = parseInt(localStorage.getItem("fartFactory_highScore") || "0", 10);
  if (elapsedSec > prevBest) {
    localStorage.setItem("fartFactory_highScore", String(elapsedSec));
    if (badge) badge.style.display = "block";
  } else {
    if (badge) badge.style.display = "none";
  }

  // Remove all entrance classes first
  const modal = document.querySelector('.gameover-modal');
  if (modal) {
    modal.classList.remove('popup-fade-in', 'explosion-enter');
    if (explosion) {
      modal.classList.add('explosion-enter');
      setTimeout(() => modal.classList.remove('explosion-enter'), 900);
    } else {
      modal.classList.add('popup-fade-in');
      setTimeout(() => modal.classList.remove('popup-fade-in'), 400);
    }
  }
  gameOverBackdrop.classList.add("active");
  canDismissModal = false;
  setTimeout(() => { canDismissModal = true; }, 600);
}
function closeGameOverPopup() {
  if (!gameOverBackdrop) return;
  gameOverBackdrop.classList.remove("active");
}


function triggerExplosionSequence({ isGameOver = false } = {}) {
  // Middle container shake
  const middle = document.getElementById('middleDeathsContainer');
  if (middle) {
    middle.classList.add('exploding-shake');
    setTimeout(() => middle.classList.remove('exploding-shake'), 800);
  }

  // Show explosion overlay
  const overlay = document.getElementById('explosionOverlay');
  const flash = document.getElementById('explosionFlash');
  if (overlay) {
    overlay.innerHTML = '';
    overlay.classList.add('active');
    // Generate particles from center of middle container
    const rect = middle ? middle.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 100, height: 60 };
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    const colors = [
      '#fbbf24', '#f97316', '#fde68a', '#f87171', '#facc15', '#f472b6', '#a3e635', '#22d3ee', '#38bdf8', '#fff'
    ];
    for (let i = 0; i < 22; i++) {
      const angle = (Math.PI * 2) * (i / 22) + Math.random() * 0.2;
      const dist = 120 + Math.random() * 60;
      const ex = Math.cos(angle) * dist;
      const ey = Math.sin(angle) * dist;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const particle = document.createElement('div');
      particle.className = 'explosion-particle';
      particle.style.left = `${cx - 9}px`;
      particle.style.top = `${cy - 9}px`;
      particle.style.background = color;
      particle.style.setProperty('--ex', `${ex}px`);
      particle.style.setProperty('--ey', `${ey}px`);
      particle.style.animation = `explodeParticle 0.7s cubic-bezier(0.22,1,0.36,1) forwards`;
      overlay.appendChild(particle);
    }
    // Remove overlay after animation
    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.innerHTML = '';
    }, 800);
  }
  // Flash only if not game over (to avoid double flash)
  if (flash && !isGameOver) {
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 600);
  }

  // If game over, show popup after explosion (no flash)
  if (isGameOver) {
    setTimeout(() => {
      if (!gameOverBackdrop.classList.contains('active')) {
        openGameOverPopup({ explosion: true });
      }
    }, 650);
  }
}

function triggerGameOver() {
  if (gameOver) return; // prevent double-trigger
  gameOver = true;
  slots.forEach(s => s.disabled = true);

  backgroundMusic.pause();
  backgroundMusic.currentTime = 0;
  backgroundMusicDanger.pause();
  backgroundMusicDanger.currentTime = 0;
  backgroundMusicCritical.pause();
  backgroundMusicCritical.currentTime = 0;

  if (deathStatusEl) {
    deathStatusEl.textContent = `Status: ${totalDeaths} / ${DEATH_LIMIT} deaths • GAME OVER`;
  }
  triggerExplosionSequence({ isGameOver: true });
}

// -----------------------------
// KILL / REVIVE
// -----------------------------
function killSlot(i) {
  if (dead[i] || gameOver) return;

  // ako je constipated slot umro, skini constipation stanje
  if (constipated[i]) {
    constipated[i] = false;
    holdMs[i] = 0;
    hideConstipation(i);
  }

  dead[i] = true;
  respawnLeft[i] = RESPAWN_SECONDS;
  playRandomDeathSound();

  totalDeaths += 1;

  pressures[i] = 0;
  setGasHeight(slots[i], 0);

  // Death burst: fill tube to 100% in 0.3s
  const deathFill = tubeFills[i];
  if (deathFill) {
    deathFill.classList.add('death-burst');
    deathFill.style.height = '100%';
    const c1 = `hsl(0, 78%, 40%)`;
    const c2 = `hsl(0, 92%, 58%)`;
    if (i < 4) {
      deathFill.style.background = `linear-gradient(to bottom, ${c2}, ${c1})`;
    } else {
      deathFill.style.background = `linear-gradient(to top, ${c2}, ${c1})`;
    }

    // After tube fills (0.3s) → update central container, then instantly clear tube
    const burstTimer = setTimeout(() => {
      if (gameOver && !dead[i]) return; // stale timeout after restart
      updateDeathStatus();
      deathFill.classList.remove('death-burst');
      deathFill.style.transition = 'none';
      deathFill.style.height = '0%';
      deathFill.style.background = 'transparent';
      // Force reflow so the instant reset is applied before restoring transition
      deathFill.offsetHeight;
      deathFill.style.transition = '';
      deathFill.style.background = '';
    }, 300);
    deathBurstTimers.push(burstTimer);
  } else {
    updateDeathStatus();
  }

  slots[i].disabled = true;
  showDeadOverlay(slots[i], respawnLeft[i]);

  const deadSlotsNow = dead.reduce((count, isDead) => count + (isDead ? 1 : 0), 0);

  if (totalDeaths >= DEATH_LIMIT) {
    triggerGameOver();
  } else if (deadSlotsNow >= 3) {
    // If 3 or more dead at once, treat as game over
    if (!gameOver) {
      gameOver = true;
      slots.forEach(s => s.disabled = true);
      backgroundMusic.pause();
      backgroundMusic.currentTime = 0;
      backgroundMusicDanger.pause();
      backgroundMusicDanger.currentTime = 0;
      backgroundMusicCritical.pause();
      backgroundMusicCritical.currentTime = 0;
      if (deathStatusEl) {
        deathStatusEl.textContent = `Status: ${totalDeaths} / ${DEATH_LIMIT} deaths • GAME OVER`;
      }
      triggerExplosionSequence({ isGameOver: true });
    }
  }
}

function reviveSlot(i) {
  if (gameOver) return;

  dead[i] = false;
  respawnLeft[i] = 0;

  // Reset tube from death burst
  const reviveFill = tubeFills[i];
  if (reviveFill) {
    reviveFill.classList.remove('death-burst');
    reviveFill.style.height = '0%';
  }

  slots[i].disabled = false;
  hideDeadOverlay(slots[i]);
}

// -----------------------------
// RESTART (ako koristiš popup)
// -----------------------------
function restartGame() {
  // Clear any pending death-burst timeouts
  deathBurstTimers.forEach(t => clearTimeout(t));
  deathBurstTimers = [];

  gameOver = false;
  totalDeaths = 0;
  totalFarts = 0;
  if (fartCounterEl) fartCounterEl.textContent = '💨 0';
  updateDeathStatus();

  elapsedSec = 0;
  timerAcc = 0;
  if (timerEl) timerEl.textContent = "00:00";

  // reset constipation scheduler
  nextConstipationCheck = CONST_START_AFTER_SEC + rand(CONST_CHECK_MIN_SEC, CONST_CHECK_MAX_SEC);

  slots.forEach((slot, i) => {
    pressures[i] = 0;
    dead[i] = false;
    respawnLeft[i] = 0;

    constipated[i] = false;
    holdMs[i] = 0;
    hideConstipation(i);

    slot.disabled = false;
    hideDeadOverlay(slot);
    setGasHeight(slot, 0);

    // Reset tube (remove death burst if active)
    const resetFill = tubeFills[i];
    if (resetFill) {
      resetFill.classList.remove('death-burst');
    }
    updateTubeFill(i, 0);
  });

  for (let i = 0; i < speeds.length; i++) speeds[i] = makeSpeed();

  t = 0;
  lastTime = performance.now(); // reset so first frame doesn't get huge dt
  pointerDown = null;            // clear stale pointer state
  playBackgroundTrack(3);
  closeGameOverPopup();
}
if (restartBtn) restartBtn.addEventListener("click", restartGame);
if (exitBtn) exitBtn.addEventListener("click", () => {
  closeGameOverPopup();
  window.close();
  // fallback: go to a blank page if window.close() is blocked
  window.location.href = "about:blank";
});

// -----------------------------
// TAP vs HOLD (pointer events)
// - tap <= 200ms smanjuje pressure (osim ako je constipated)
// - hold radi samo ako je constipated (mora 1s)
// -----------------------------
const TAP_MAX_MS = 200;
let pointerDown = null; // { id, i, t0 }

function slotIndexFromTarget(target){
  const btn = target.closest(".slot");
  if (!btn) return null;
  const raw = Number(btn.dataset.slot);
  if (!Number.isFinite(raw)) return null;
  const idx = raw - 1; // data-slot 1..8 -> index 0..7
  if (idx < 0 || idx >= slots.length) return null;
  return idx;
}

window.addEventListener("pointerdown", (e) => {
  if (gameOver) return;
  const i = slotIndexFromTarget(e.target);
  if (i === null) return;
  if (dead[i]) return; // disabled ionako blokira

  // Tap animation — restart on every press so spamming works
  const slotEl = slots[i];
  slotEl.classList.remove("tap-anim");
  void slotEl.offsetWidth; // force reflow to restart animation
  slotEl.classList.add("tap-anim");

  pointerDown = { id: e.pointerId, i, t0: performance.now() };
}, { passive: true });

window.addEventListener("pointerup", (e) => {
  if (!pointerDown) return;
  if (e.pointerId !== pointerDown.id) return;

  const { i, t0 } = pointerDown;
  pointerDown = null;

  if (gameOver || dead[i]) return;

  const dtMs = performance.now() - t0;
  playRandomClickSound();

  // ako je constipated: tap ne radi; ako je pustio pre 1s, reset progres
  if (constipated[i]) {
    if (dtMs < CONST_HOLD_TO_CURE_MS) {
      holdMs[i] = 0;
      updateConstipationProgress(i);
    }
    return;
  }

  // normal: tap <= 200ms
  if (dtMs <= TAP_MAX_MS) {
    pressures[i] -= CLICK_REDUCTION;
    totalFarts++;
    if (fartCounterEl) fartCounterEl.textContent = `💨 ${totalFarts}`;

    if (pressures[i] < UNDERFLOW_DEATH_THRESHOLD) {
      killSlot(i);
      return;
    }

    setGasHeight(slots[i], pressures[i]);
  }
}, { passive: true });

window.addEventListener("pointercancel", () => {
  pointerDown = null;
}, { passive: true });

// -----------------------------
// MAIN LOOP
// -----------------------------
let t = 0;
let lastTime = performance.now();

function update(dt) {
  if (gameOver) return;

  // TIMER
  timerAcc += dt;
  if (timerAcc >= 1) {
    const add = Math.floor(timerAcc);
    timerAcc -= add;
    elapsedSec += add;
    if (timerEl) timerEl.textContent = formatMMSS(elapsedSec);
  }

  t += dt;

  // CONSTIPATION scheduling
  if (t >= nextConstipationCheck) {
    if (t >= CONST_START_AFTER_SEC) triggerConstipation();
    nextConstipationCheck = t + rand(CONST_CHECK_MIN_SEC, CONST_CHECK_MAX_SEC);
  }

  // HOLD progress ako je pointer down na constipated slotu
  if (pointerDown) {
    const i = pointerDown.i;
    if (constipated[i] && !dead[i]) {
      holdMs[i] += dt * 1000;
      updateConstipationProgress(i);
      slots[i].classList.add('healing');

      if (holdMs[i] >= CONST_HOLD_TO_CURE_MS) {
        slots[i].classList.remove('healing');
        cureConstipation(i);
        // ostavi pointerDown aktivan, ali više nema efekta
      }
    }
  } else {
    // remove healing from all slots when not holding
    slots.forEach(s => s.classList.remove('healing'));
  }

  slots.forEach((slot, i) => {
    // dead slot: countdown
    if (dead[i]) {
      respawnLeft[i] -= dt;

      if (respawnLeft[i] <= 0) {
        reviveSlot(i);
      } else {
        showDeadOverlay(slot, respawnLeft[i]);
      }
      return;
    }

    const s = speeds[i];

    if (Math.random() < dt / 3.5) {
      s.driftTarget = 0.6 + Math.random() * 1.2;
    }

    s.drift += (s.driftTarget - s.drift) * (dt * 0.6);

    const wave = 1 + s.waveAmp * Math.sin((t * 2 * Math.PI * s.waveFreq) + s.phase);
    const growSpeed = s.base * s.drift * wave;

    pressures[i] += growSpeed * dt;

    if (pressures[i] >= MAX) {
      pressures[i] = MAX;
      killSlot(i);
      return;
    }

    if (pressures[i] < UNDERFLOW_DEATH_THRESHOLD) {
      killSlot(i);
      return;
    }

    if (gameOver) return; // stop processing if game over triggered by another slot this frame

    setGasHeight(slot, pressures[i]);
  });
}

function loop(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;

  // Cap dt to prevent huge spikes (e.g. tab switch, game over screen)
  if (dt > 0.1) dt = 0.1;

  update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);