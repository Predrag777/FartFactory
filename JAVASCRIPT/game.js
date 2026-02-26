const slots = document.querySelectorAll(".slot");

const pressures = new Array(slots.length).fill(0);
const dead = new Array(slots.length).fill(false);
const respawnLeft = new Array(slots.length).fill(0);

const MAX = 100;
const BASE_SPEED = 10;       // osnovna brzina rasta (po sekundi)
const CLICK_REDUCTION = 20;
const RESPAWN_SECONDS = 5;

const DEATH_LIMIT = 5;
let totalDeaths = 0;
let gameOver = false;

const deathStatusEl = document.getElementById("deathStatus");
const timerEl = document.getElementById("gameTimer");

// popup DOM
const gameOverBackdrop = document.getElementById("gameOverBackdrop");
const restartBtn = document.getElementById("restartBtn");
const finalTimeEl = document.getElementById("finalTime");
const finalDeathsEl = document.getElementById("finalDeaths");

let elapsedSec = 0;
let timerAcc = 0;

function formatMMSS(totalSeconds){
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateDeathStatus() {
  if (!deathStatusEl) return;
  deathStatusEl.textContent = `Status: ${totalDeaths} / ${DEATH_LIMIT} deaths`;
}

updateDeathStatus();
if (timerEl) timerEl.textContent = "00:00";

// -----------------------------
// SPEEDS (random po slotu)
// -----------------------------
function makeSpeed() {
  return {
    base: BASE_SPEED * (0.7 + Math.random() * 0.8),     // 0.7x .. 1.5x
    waveAmp: 0.25 + Math.random() * 0.35,               // 25%..60%
    waveFreq: 0.15 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    drift: 1,
    driftTarget: 0.7 + Math.random() * 1.0,             // 0.7..1.7
  };
}

const speeds = Array.from({ length: slots.length }, () => makeSpeed());

// -----------------------------
// DEAD OVERLAY per slot (🪦 + countdown)
// -----------------------------
slots.forEach((slot) => {
  const overlay = document.createElement("div");
  overlay.className = "dead-overlay";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="grave">🪦</div>
    <div class="countdown">5</div>
  `;
  slot.appendChild(overlay);
});

function setGasHeight(slot, value01to100) {
  const gas = slot.querySelector(".gas");
  if (!gas) return;
  gas.style.height = value01to100 + "%";
}

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

// -----------------------------
// GAME OVER POPUP
// -----------------------------
function openGameOverPopup() {
  if (!gameOverBackdrop) return;

  if (finalTimeEl) finalTimeEl.textContent = formatMMSS(elapsedSec);
  if (finalDeathsEl) finalDeathsEl.textContent = `${totalDeaths} / ${DEATH_LIMIT}`;

  gameOverBackdrop.classList.add("active");
}

function closeGameOverPopup() {
  if (!gameOverBackdrop) return;
  gameOverBackdrop.classList.remove("active");
}

function triggerGameOver() {
  gameOver = true;

  // stop input
  slots.forEach(s => s.disabled = true);

  // status update
  if (deathStatusEl) {
    deathStatusEl.textContent = `Status: ${totalDeaths} / ${DEATH_LIMIT} deaths • GAME OVER`;
  }

  openGameOverPopup();
}

// -----------------------------
// KILL / REVIVE
// -----------------------------
function killSlot(i) {
  if (dead[i] || gameOver) return;

  dead[i] = true;
  respawnLeft[i] = RESPAWN_SECONDS;

  totalDeaths += 1;
  updateDeathStatus();

  // reset fill
  pressures[i] = 0;
  setGasHeight(slots[i], 0);

  // disable klik
  slots[i].disabled = true;
  showDeadOverlay(slots[i], respawnLeft[i]);

  if (totalDeaths >= DEATH_LIMIT) {
    triggerGameOver();
  }
}

function reviveSlot(i) {
  if (gameOver) return;

  dead[i] = false;
  respawnLeft[i] = 0;

  slots[i].disabled = false;
  hideDeadOverlay(slots[i]);
}

// -----------------------------
// RESTART
// -----------------------------
function restartGame() {
  // reset states
  gameOver = false;
  totalDeaths = 0;
  updateDeathStatus();

  elapsedSec = 0;
  timerAcc = 0;
  if (timerEl) timerEl.textContent = "00:00";

  // reset slots + overlays + pressures
  slots.forEach((slot, i) => {
    pressures[i] = 0;
    dead[i] = false;
    respawnLeft[i] = 0;

    slot.disabled = false;
    hideDeadOverlay(slot);
    setGasHeight(slot, 0);
  });

  // reroll speeds (novi run)
  for (let i = 0; i < speeds.length; i++) {
    speeds[i] = makeSpeed();
  }

  // reset time param
  t = 0;

  closeGameOverPopup();
}

if (restartBtn) {
  restartBtn.addEventListener("click", restartGame);
}

// -----------------------------
// MAIN LOOP
// -----------------------------
let t = 0; // “game time” u sekundama
let lastTime = performance.now();

function update(dt) {
  // ako je game over -> stopiraj sve (nema timer, nema gas, nema respawn)
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

    // drift target povremeno menja
    if (Math.random() < dt / 3.5) {
      s.driftTarget = 0.6 + Math.random() * 1.2;
    }

    // drift ka targetu
    s.drift += (s.driftTarget - s.drift) * (dt * 0.6);

    // talas
    const wave = 1 + s.waveAmp * Math.sin((t * 2 * Math.PI * s.waveFreq) + s.phase);

    // final speed
    const growSpeed = s.base * s.drift * wave;

    pressures[i] += growSpeed * dt;

    if (pressures[i] >= MAX) {
      pressures[i] = MAX;
      killSlot(i);
      return;
    }

    if (pressures[i] < 0) pressures[i] = 0;

    setGasHeight(slot, pressures[i]);
  });
}

function loop(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  update(dt);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// klik smanjuje gas
slots.forEach((slot, i) => {
  slot.addEventListener("click", () => {
    if (dead[i] || gameOver) return;

    pressures[i] -= CLICK_REDUCTION;
    if (pressures[i] < 0) pressures[i] = 0;

    setGasHeight(slot, pressures[i]);
  });
});