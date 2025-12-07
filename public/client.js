const socket = io();

// ===== UI elements =====
const landingScreen = document.getElementById("landing-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const gameoverScreen = document.getElementById("gameover-screen");

const singleModeBtn = document.getElementById("single-mode-btn");
const multiModeBtn = document.getElementById("multi-mode-btn");

const singleForm = document.getElementById("single-form");
const hostForm = document.getElementById("host-form");
const joinForm = document.getElementById("join-form");

const singleNameInput = document.getElementById("single-name-input");
const singleDifficultySelect = document.getElementById(
  "single-difficulty-select"
);
const startSingleBtn = document.getElementById("start-single-btn");

const hostNameInput = document.getElementById("host-name-input");
const difficultySelect = document.getElementById("difficulty-select");
const startLobbyBtn = document.getElementById("start-lobby-btn");

const joinInfo = document.getElementById("join-info");
const joinNameInput = document.getElementById("join-name-input");
const joinLobbyBtn = document.getElementById("join-lobby-btn");

const landingError = document.getElementById("landing-error");

const lobbyDifficulty = document.getElementById("lobby-difficulty");
const lobbyCountdown = document.getElementById("lobby-countdown");
const lobbyPlayersList = document.getElementById("lobby-players");

// “Start now” button on lobby screen (host only)
const startNowBtn = document.getElementById("start-now-btn");

const roundInfo = document.getElementById("round-info");
const statusMessage = document.getElementById("status-message");
const gamePlayersList = document.getElementById("game-players");

const pads = Array.from(document.querySelectorAll(".pad"));
const simonImage = document.getElementById("simon-image");

const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNumberEl = document.getElementById("countdown-number");

const leaderboardBody = document.getElementById("leaderboard-body");
const backToHomeBtn = document.getElementById("back-to-home-btn");

const eliminationPill = document.getElementById("elimination-pill");
const giveUpBtn = document.getElementById("give-up-btn");

// ===== Local state =====
const COLORS = ["green", "red", "yellow", "blue"];
const MAX_NAME_LENGTH = 12;

let mode = "single"; // "single" or "multi"
let isHost = false; // are we the host in this lobby?

let currentRoomId = null;
let myName = "";

// multiplayer state
let inputEnabled = false;
let playingSequence = false;

// single-player state
const singleDifficultyConfig = {
  easy: { onTime: 800, offTime: 400 },
  medium: { onTime: 600, offTime: 300 },
  hard: { onTime: 400, offTime: 200 },
  insane: { onTime: 300, offTime: 150 },
  impossible: { onTime: 220, offTime: 120 }
};

let spDifficulty = "easy";
let spSequence = [];
let spRound = 0;
let spInputIndex = 0;
let spGameOver = false;
let spStartTime = 0;

// fixed tone length so sound feels consistent on all speeds
const BASE_TONE_DURATION_MS = 260;

// ===== Image mapping for lights =====
const IMAGE_MAP = {
  green: "/images/02_simon_green_light_on.png",
  red: "/images/03_simon_red_light_on.png",
  blue: "/images/04_simon_blue_lights_on.png",
  yellow: "/images/05_simon_yellow_lights_on.png",
  off: "/images/01_simon_no_lights.png"
};

// Preload all images into memory to avoid lag on first flash
const preloadedImages = {};
Object.values(IMAGE_MAP).forEach((src) => {
  const img = new Image();
  img.src = src;
  preloadedImages[src] = img;
});

// ===== External audio files =====
const countdownAudio = new Audio("/media/321.mp3");
const wrongAudio = new Audio("/media/wrong_sound_effect.mp3");

// ===== Web Audio for tones =====
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

const TONE_MAP = {
  red: 440, // A4
  yellow: 554, // C#5
  green: 659, // E5
  blue: 330 // E4
};

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
}

function playTone(color, durationMs) {
  const freq = TONE_MAP[color];
  if (!freq) return;

  ensureAudioContext();

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  const now = audioCtx.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(
    0.0001,
    now + durationMs / 1000 - 0.02
  );

  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

// Wrong answer sound using external file
function playWrongSfx() {
  try {
    wrongAudio.currentTime = 0;
    wrongAudio.play();
  } catch (e) {
    console.warn("Could not play wrong sound effect:", e);
  }
}

// ===== helpers =====
function showScreen(target) {
  [landingScreen, lobbyScreen, gameScreen, gameoverScreen].forEach((s) =>
    s.classList.remove("active")
  );
  target.classList.add("active");
}

function setPadInteractivity(enabled) {
  inputEnabled = enabled;
  pads.forEach((pad) => {
    if (enabled) {
      pad.classList.remove("disabled");
    } else {
      pad.classList.add("disabled");
    }
  });
}

function flashPad(color, visualDurationOverride) {
  const visualDuration = visualDurationOverride || BASE_TONE_DURATION_MS;

  simonImage.src = IMAGE_MAP[color];
  playTone(color, BASE_TONE_DURATION_MS);

  setTimeout(() => {
    simonImage.src = IMAGE_MAP.off;
  }, visualDuration);
}

// Plays a normal sequence (for actual round play)
function playSequence(sequence, onTime, offTime) {
  playingSequence = true;
  setPadInteractivity(false);
  statusMessage.textContent = "Watch the pattern…";

  sequence.forEach((color, index) => {
    const t = index * (onTime + offTime);
    setTimeout(() => {
      flashPad(color, onTime);
    }, t);
  });

  const totalTime = sequence.length * (onTime + offTime);
  setTimeout(() => {
    playingSequence = false;
    setPadInteractivity(true);
    statusMessage.textContent = "Your turn! Repeat the pattern.";
  }, totalTime + 50);
}

// Plays a sequence only for review (no input re-enabled afterwards)
function playSequencePassive(sequence, onTime, offTime, done) {
  playingSequence = true;
  setPadInteractivity(false);
  statusMessage.textContent = "Watch the correct pattern…";

  sequence.forEach((color, index) => {
    const t = index * (onTime + offTime);
    setTimeout(() => {
      flashPad(color, onTime);
    }, t);
  });

  const totalTime = sequence.length * (onTime + offTime);
  setTimeout(() => {
    playingSequence = false;
    if (typeof done === "function") done();
  }, totalTime + 60);
}

// 3-2-1 countdown overlay, then callback (e.g. start first round)
function runCountdown(onDone) {
  if (!countdownOverlay || !countdownNumberEl) {
    if (onDone) onDone();
    return;
  }

  let count = 3;
  countdownNumberEl.textContent = count.toString();
  countdownOverlay.classList.remove("hidden");

  try {
    countdownAudio.currentTime = 0;
    countdownAudio.play();
  } catch (e) {
    console.warn("Could not play countdown audio:", e);
  }

  setTimeout(() => {
    count = 2;
    countdownNumberEl.textContent = count.toString();
  }, 1000);

  setTimeout(() => {
    count = 1;
    countdownNumberEl.textContent = count.toString();
  }, 2000);

  setTimeout(() => {
    countdownOverlay.classList.add("hidden");
    countdownNumberEl.textContent = "";

    if (typeof onDone === "function") {
      setTimeout(() => {
        onDone();
      }, 500);
    }
  }, 3000);
}

// Show "Peter is out of the game (Round 5)" pill
function showEliminationPill(name, roundsSurvived) {
  if (!eliminationPill) return;

  const roundText =
    typeof roundsSurvived === "number" && roundsSurvived > 0
      ? ` (Round ${roundsSurvived})`
      : "";

  eliminationPill.textContent = `${name} is out of the game${roundText}`;

  eliminationPill.classList.remove("hidden");
  eliminationPill.style.animation = "none";
  void eliminationPill.offsetWidth;
  eliminationPill.style.animation = "";
  eliminationPill.style.animation = "pillSlideUp 0.4s ease-out";

  setTimeout(() => {
    eliminationPill.classList.add("hidden");
  }, 2000);
}

// ===== Name sanitiser (client-side) =====
function sanitizeNameInput(inputEl, fallback) {
  let name = (inputEl.value || "").trim();
  if (!name) name = fallback;
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH);
    inputEl.value = name; // reflect truncation in the UI
  }
  return name;
}

// ===== Leaderboard render with slide-in animation =====
function renderLeaderboard(rows) {
  if (!leaderboardBody) return;

  leaderboardBody.innerHTML = "";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    const tdRank = document.createElement("td");
    tdRank.textContent = String(index + 1);

    const tdName = document.createElement("td");
    tdName.textContent = row.name || "Player";

    const tdCorrect = document.createElement("td");
    tdCorrect.textContent =
      typeof row.correct === "number" ? row.correct.toString() : "0";

    const tdTime = document.createElement("td");
    if (typeof row.timeSeconds === "number") {
      tdTime.textContent = `${row.timeSeconds.toFixed(1)}s`;
    } else {
      tdTime.textContent = "–";
    }

    tdRank.classList.add("col-rank");
    tdName.classList.add("col-name");
    tdCorrect.classList.add("col-correct");
    tdTime.classList.add("col-time");

    tr.appendChild(tdRank);
    tr.appendChild(tdName);
    tr.appendChild(tdCorrect);
    tr.appendChild(tdTime);

    // slide-in animation per row, staggered from the first
    tr.classList.add("leaderboard-row-animate");
    tr.style.animationDelay = `${index * 0.08}s`;

    leaderboardBody.appendChild(tr);
  });
}

// ===== mode switching =====
function setMode(newMode) {
  mode = newMode;
  landingError.textContent = "";

  if (newMode === "single") {
    isHost = false;
    if (startNowBtn) startNowBtn.classList.add("hidden");

    singleModeBtn.classList.add("mode-btn-active");
    multiModeBtn.classList.remove("mode-btn-active");

    singleForm.classList.remove("hidden");
    hostForm.classList.add("hidden");
    joinForm.classList.add("hidden");
  } else {
    singleModeBtn.classList.remove("mode-btn-active");
    multiModeBtn.classList.add("mode-btn-active");

    singleForm.classList.add("hidden");
    socket.emit("checkActiveLobby");
  }
}

// ===== Single-player logic =====
function startSingleGameWithCountdown(name, difficulty) {
  mode = "single";
  myName = name || "You";
  spDifficulty = difficulty;
  spSequence = [];
  spRound = 0;
  spInputIndex = 0;
  spGameOver = false;
  spStartTime = Date.now();

  showScreen(gameScreen);
  gamePlayersList.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `🟢 ${myName}`;
  gamePlayersList.appendChild(li);

  setPadInteractivity(false);
  simonImage.src = IMAGE_MAP.off;

  runCountdown(() => {
    nextSingleRound();
  });
}

function nextSingleRound() {
  if (spGameOver) return;

  spRound += 1;
  roundInfo.textContent = `Round ${spRound}`;
  statusMessage.textContent = `Round ${spRound}. Watch the pattern…`;

  const nextColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  spSequence.push(nextColor);

  const cfg =
    singleDifficultyConfig[spDifficulty] || singleDifficultyConfig.easy;
  playSequence(spSequence, cfg.onTime, cfg.offTime);

  const totalTime = spSequence.length * (cfg.onTime + cfg.offTime);
  setTimeout(() => {
    if (!spGameOver) {
      spInputIndex = 0;
      setPadInteractivity(true);
      statusMessage.textContent = "Your turn! Repeat the pattern.";
    }
  }, totalTime + 60);
}

function handleSingleInput(color) {
  if (spGameOver) return;
  const expected = spSequence[spInputIndex];

  if (color !== expected) {
    spGameOver = true;
    setPadInteractivity(false);
    statusMessage.textContent = "Wrong! Watch the correct pattern.";
    playWrongSfx();

    const cfg =
      singleDifficultyConfig[spDifficulty] || singleDifficultyConfig.easy;

    playSequencePassive(spSequence, cfg.onTime, cfg.offTime, () => {
      const survived = Math.max(spRound - 1, 0);
      const timeSec =
        spStartTime > 0 ? (Date.now() - spStartTime) / 1000 : null;

      renderLeaderboard([
        {
          name: myName,
          correct: survived,
          timeSeconds: timeSec
        }
      ]);

      setTimeout(() => {
        showScreen(gameoverScreen);
      }, 600);
    });

    return;
  }

  spInputIndex += 1;
  if (spInputIndex === spSequence.length) {
    statusMessage.textContent = "Round complete!";
    setPadInteractivity(false);
    setTimeout(() => {
      nextSingleRound();
    }, 600);
  }
}

function handleSingleGiveUp() {
  if (spGameOver) return;
  spGameOver = true;
  setPadInteractivity(false);
  statusMessage.textContent = "You gave up!";

  const roundDisplay = spRound > 0 ? spRound : 1;
  const survived = Math.max(roundDisplay - 1, 0);
  const timeSec =
    spStartTime > 0 ? (Date.now() - spStartTime) / 1000 : null;

  renderLeaderboard([
    {
      name: myName,
      correct: survived,
      timeSeconds: timeSec
    }
  ]);

  setTimeout(() => {
    showScreen(gameoverScreen);
  }, 600);
}

// ===== initial setup =====
showScreen(landingScreen);
setMode("single");

// ===== event listeners =====
singleModeBtn.addEventListener("click", () => setMode("single"));
multiModeBtn.addEventListener("click", () => setMode("multi"));

startSingleBtn.addEventListener("click", () => {
  const name = sanitizeNameInput(singleNameInput, "You");
  const difficulty = singleDifficultySelect.value;
  startSingleGameWithCountdown(name, difficulty);
});

startLobbyBtn.addEventListener("click", () => {
  landingError.textContent = "";
  const name = sanitizeNameInput(hostNameInput, "Host");
  const difficulty = difficultySelect.value;
  myName = name;

  isHost = true;
  socket.emit("createLobby", { name, difficulty });
});

joinLobbyBtn.addEventListener("click", () => {
  landingError.textContent = "";
  const name = sanitizeNameInput(joinNameInput, "Player");
  myName = name;
  isHost = false;
  socket.emit("joinLobby", { name });
});

// Host “start now” button → ask server to skip countdown
if (startNowBtn) {
  startNowBtn.addEventListener("click", () => {
    if (!isHost) return;
    socket.emit("hostStartEarly");
  });
}

giveUpBtn.addEventListener("click", () => {
  if (mode === "single") {
    handleSingleGiveUp();
  } else {
    socket.emit("giveUp");
  }
});

// Pad clicks
pads.forEach((pad) => {
  pad.addEventListener("click", () => {
    if (!inputEnabled || playingSequence) return;

    const color = pad.dataset.color;
    flashPad(color, 220);

    if (mode === "single") {
      handleSingleInput(color);
    } else {
      socket.emit("playerInput", { color });
    }
  });
});

backToHomeBtn.addEventListener("click", () => {
  window.location.reload();
});

// ===== Socket events (multiplayer) =====
socket.on("lobbyStatus", (payload) => {
  if (mode !== "multi") return;

  // We are not the existing host in this flow
  isHost = false;
  if (startNowBtn) startNowBtn.classList.add("hidden");

  if (payload.hasActiveLobby) {
    hostForm.classList.add("hidden");
    joinForm.classList.remove("hidden");
    showScreen(landingScreen);

    const label = payload.difficultyLabel || payload.difficulty;
    joinInfo.textContent = `An active lobby is waiting. Difficulty: ${label}. Game starts in about ${payload.timeLeft}s. Enter your name to join.`;
  } else {
    hostForm.classList.remove("hidden");
    joinForm.classList.add("hidden");
    showScreen(landingScreen);
  }
});

socket.on("errorMessage", (msg) => {
  if (mode !== "multi") {
    landingError.textContent = msg;
  }
});

socket.on("lobbyCreated", ({ roomId, difficulty, difficultyLabel }) => {
  if (mode !== "multi") return;
  currentRoomId = roomId;
  lobbyDifficulty.textContent = difficultyLabel || difficulty;
  lobbyCountdown.textContent = "30";
  lobbyPlayersList.innerHTML = "";
  showScreen(lobbyScreen);

  isHost = true;
  if (startNowBtn) startNowBtn.classList.remove("hidden");
});

socket.on("joinedLobby", ({ roomId, difficulty, difficultyLabel }) => {
  if (mode !== "multi") return;
  currentRoomId = roomId;
  lobbyDifficulty.textContent = difficultyLabel || difficulty;
  lobbyPlayersList.innerHTML = "";
  showScreen(lobbyScreen);

  isHost = false;
  if (startNowBtn) startNowBtn.classList.add("hidden");
});

socket.on(
  "lobbyUpdate",
  ({ roomId, difficulty, difficultyLabel, timeLeft, players }) => {
    if (mode !== "multi") return;
    if (!currentRoomId) currentRoomId = roomId;
    lobbyDifficulty.textContent = difficultyLabel || difficulty;
    lobbyCountdown.textContent = timeLeft.toString();

    lobbyPlayersList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      lobbyPlayersList.appendChild(li);
    });
  }
);

socket.on("gameStart", ({ difficultyLabel }) => {
  if (mode !== "multi") return;

  if (startNowBtn) startNowBtn.classList.add("hidden");

  showScreen(gameScreen);
  setPadInteractivity(false);
  roundInfo.textContent = "Round 1";
  statusMessage.textContent = `Difficulty: ${difficultyLabel}. Get ready…`;
  gamePlayersList.innerHTML = "";
  simonImage.src = IMAGE_MAP.off;

  runCountdown(() => {
    statusMessage.textContent = "Watch the pattern…";
  });
});

socket.on("roundStart", ({ round, sequenceLength }) => {
  if (mode !== "multi") return;
  roundInfo.textContent = `Round ${round}`;
  statusMessage.textContent = `Round ${round}. Watch ${sequenceLength} step${
    sequenceLength === 1 ? "" : "s"
  }…`;
});

socket.on("playSequence", ({ sequence, onTime, offTime }) => {
  if (mode !== "multi") return;
  playSequence(sequence, onTime, offTime);
});

socket.on("startInputPhase", () => {
  if (mode !== "multi") return;
  if (!playingSequence) {
    setPadInteractivity(true);
    statusMessage.textContent = "Your turn! Repeat the pattern.";
  }
});

socket.on("inputResult", ({ success, message }) => {
  if (mode !== "multi") return;

  if (!success) {
    playWrongSfx();
  }

  statusMessage.textContent = message || (success ? "Good job!" : "Wrong!");
});

socket.on("playerEliminated", ({ name, roundsSurvived }) => {
  showEliminationPill(name, roundsSurvived);
});

socket.on("roundSummary", ({ summary }) => {
  if (mode !== "multi") return;

  gamePlayersList.innerHTML = "";
  summary.forEach((p) => {
    const li = document.createElement("li");
    const icon = p.alive ? "🟢" : "🔴";
    li.textContent = `${icon} ${p.name} — survived ${
      p.roundsSurvived
    } round${p.roundsSurvived === 1 ? "" : "s"}`;
    gamePlayersList.appendChild(li);
  });

  setPadInteractivity(false);
});

socket.on("gameOver", ({ leaderboard }) => {
  if (mode !== "multi") return;

  const rows = leaderboard.map((p) => ({
    name: p.name,
    correct: p.roundsSurvived,
    timeSeconds:
      typeof p.timeSeconds === "number" ? p.timeSeconds : null
  }));

  renderLeaderboard(rows);
  showScreen(gameoverScreen);
});
