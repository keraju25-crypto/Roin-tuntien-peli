"use strict";

/* ==========================================================================
   MINI GAME BATTLE — script.js  (Stage 1)
   --------------------------------------------------------------------------
   Big picture:
     index.html holds every screen and element we need.
     style.css styles them.
     script.js brings it to life with ONE state object (gameState)
     and small functions that each do exactly one job.

   Game states: menu -> instructions -> ready -> playing -> minigame
                -> roundResult -> (back to playing, next player's turn)
                -> gameOver (after 5 minutes)
   ========================================================================== */

/* ------------------------------------------------------------------ *
 * 1. Constants
 * ------------------------------------------------------------------ */
const BOARD_SIZE = 12;          // tiles on the board
const MATCH_DURATION_MS = 5 * 60 * 1000;  // the global match lasts 5 minutes
const MINIGAME_SECONDS = 10;    // each minigame normally lasts 10 seconds
const GLOBAL_TICK_MS = 250;     // how often the global timer display updates
const MINIGAME_TICK_MS = 100;   // how often the minigame timer updates
const MOVE_STEP_MS = 260;       // pause between movement steps (animation)
const DICE_FLIP_MS = 70;        // dice animation speed
const DICE_FLIPS = 8;           // random faces shown before the result

/* ------------------------------------------------------------------ *
 * 2. Central game state — the single source of truth
 * ------------------------------------------------------------------ */
const gameState = {
  state: 'menu',                // menu | instructions | ready | playing | minigame | roundResult | gameOver
  players: [
    { name: 'Player 1', score: 0, position: 0 },   // position 0 = tile 1
    { name: 'Player 2', score: 0, position: 0 },
  ],
  currentPlayerIndex: 0,
  board: [],                    // 12 minigame IDs, e.g. ['testGame', ...]
  lapsSinceShuffle: [0, 0],     // laps finished per player since last shuffle
  diceValue: 0,
  rolling: false,               // is the dice animation running?
  moving: false,                // is a player walking between tiles?
  matchOver: false,             // true once time ran out — blocks all scoring
  activeMinigameId: null,
  roundStartScore: 0,           // score when the current minigame started
  diceTimerId: null,            // ids of background processes (for cleanup)
  moveTimerId: null,
  globalTimerId: null,          // the 5-minute match timer
  globalEndAt: 0,               // timestamp when the 5 minutes are over
  minigameTimerId: null,        // the 10-second minigame timer
  boardNoteTimerId: null,
  minigameTimeouts: new Set(),  // timeouts created by the current minigame
  minigameListeners: [],        // listeners created by the current minigame
};

// DOM elements are looked up once, in cacheDom().
const dom = {};

/* ------------------------------------------------------------------ *
 * 3. Small utilities
 * ------------------------------------------------------------------ */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

function currentPlayer() {
  return gameState.players[gameState.currentPlayerIndex];
}

function formatClock(ms) {
  // 300000 -> "5:00", 65000 -> "1:05"
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function formatDelta(delta) {
  if (delta > 0) return '+' + delta + (delta === 1 ? ' point' : ' points');
  if (delta < 0) return delta + (delta === -1 ? ' point' : ' points');
  return 'No points this round';
}

/* ------------------------------------------------------------------ *
 * 4. Screens — only one .screen has the class .active at a time
 * ------------------------------------------------------------------ */
const SCREENS = {
  menu: 'screen-menu',
  instructions: 'screen-instructions',
  ready: 'screen-ready',
  playing: 'screen-game',
  minigame: 'screen-minigame',
  roundResult: 'screen-round-result',
  gameOver: 'screen-game-over',
};

function showScreen(stateName) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(function (screen) {
    screen.classList.remove('active');
  });
  const id = SCREENS[stateName];
  const target = id ? document.getElementById(id) : null;
  if (target) target.classList.add('active');
}

/* ------------------------------------------------------------------ *
 * 5. HUD — scores and whose turn it is
 * ------------------------------------------------------------------ */
function cacheDom() {
  const ids = [
    'board', 'board-note', 'dice', 'btn-roll', 'dice-hint',
    'current-player-name', 'score-card-0', 'score-card-1',
    'player-score-0', 'player-score-1',
    'minigame-name', 'minigame-instruction', 'minigame-area', 'minigame-timer',
    'result-game-name', 'result-summary', 'result-delta',
    'result-score-0', 'result-score-1', 'btn-continue-round',
    'final-heading', 'final-scores', 'winner-text',
  ];
  ids.forEach(function (id) {
    dom[id] = document.getElementById(id);
  });
}

function updateScoreDisplay() {
  gameState.players.forEach(function (player, index) {
    const el = dom['player-score-' + index];
    if (el) el.textContent = String(player.score);
  });
}

function updateHud() {
  dom['current-player-name'].textContent = currentPlayer().name;
  [0, 1].forEach(function (index) {
    const card = dom['score-card-' + index];
    if (!card) return;
    card.classList.toggle('score-card--active', index === gameState.currentPlayerIndex);
  });
  updateScoreDisplay();
}

function updateGlobalTimerDisplay(msLeft) {
  // Updates EVERY element that shows the global timer (several screens).
  const text = formatClock(msLeft);
  document.querySelectorAll('.js-global-timer').forEach(function (el) {
    el.textContent = text;
  });
}

function updateMinigameTimerDisplay(secondsLeft) {
  if (dom['minigame-timer']) dom['minigame-timer'].textContent = String(secondsLeft);
}

/* ------------------------------------------------------------------ *
 * 6. Board — built from minigame IDs only (never game logic)
 * ------------------------------------------------------------------ */
function generateBoardLayout() {
  // Fill 12 tiles from MINIGAME_IDS, then shuffle.
  // (Stage 3: with 6 minigames each one appears exactly twice.)
  const pool = [];
  let i = 0;
  while (pool.length < BOARD_SIZE) {
    pool.push(MINIGAME_IDS[i % MINIGAME_IDS.length]);
    i += 1;
  }
  return shuffleArray(pool);
}

function renderBoard() {
  dom.board.innerHTML = '';
  gameState.board.forEach(function (gameId, index) {
    const def = MINIGAME_REGISTRY[gameId];
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = String(index);
    tile.title = def ? def.name : 'Unknown';

    // Serpentine path: rows of 4; every second row runs right-to-left.
    const row = Math.floor(index / 4);
    const posInRow = index % 4;
    const column = row % 2 === 0 ? posInRow + 1 : 4 - posInRow;
    tile.style.gridRow = String(row + 1);
    tile.style.gridColumn = String(column);

    const number = document.createElement('span');
    number.className = 'tile__number';
    number.textContent = String(index + 1);

    const icon = document.createElement('span');
    icon.className = 'tile__icon';
    icon.textContent = def ? def.icon : '❔';

    const label = document.createElement('span');
    label.className = 'tile__label';
    label.textContent = def ? def.name : 'Unknown';

    const tokens = document.createElement('span');
    tokens.className = 'tile__tokens';

    tile.appendChild(number);
    tile.appendChild(icon);
    tile.appendChild(label);
    tile.appendChild(tokens);
    dom.board.appendChild(tile);
  });
  renderPlayers();
}

function renderPlayers() {
  // Clear every tile, then place one token per player on their tile.
  dom.board.querySelectorAll('.tile__tokens').forEach(function (box) {
    box.innerHTML = '';
  });
  gameState.players.forEach(function (player, index) {
    const tile = dom.board.querySelector('.tile[data-index="' + player.position + '"]');
    if (!tile) return;
    const token = document.createElement('span');
    token.className = 'token token--p' + (index + 1);
    token.textContent = 'P' + (index + 1);
    token.title = player.name;
    tile.querySelector('.tile__tokens').appendChild(token);
  });
}

function maybeShuffleBoard() {
  // New layout only when BOTH players have finished a lap.
  // Called from safe moments only (after a minigame has ended),
  // so a minigame is never changed while someone is playing it.
  const bothLapped = gameState.lapsSinceShuffle.every(function (laps) {
    return laps >= 1;
  });
  if (!bothLapped) return false;
  gameState.board = generateBoardLayout();
  gameState.lapsSinceShuffle = [0, 0];
  renderBoard();
  showBoardNote('🔄 New minigame layout — scores stay the same!');
  return true;
}

function showBoardNote(text) {
  dom['board-note'].textContent = text;
  if (gameState.boardNoteTimerId !== null) clearTimeout(gameState.boardNoteTimerId);
  gameState.boardNoteTimerId = setTimeout(function () {
    dom['board-note'].textContent = '';
    gameState.boardNoteTimerId = null;
  }, 4000);
}

/* ------------------------------------------------------------------ *
 * 7. Shared minigame helpers
 *    Every minigame uses THESE functions. A minigame never changes
 *    gameState by itself — that keeps the games, board, dice and
 *    turns independent from each other.
 * ------------------------------------------------------------------ */
function isMatchActive() {
  // The match counts as active until the 5 minutes are over.
  return !gameState.matchOver;
}

function addPoints(delta) {
  // The only way points are ever changed: +1 correct, -1 wrong, floor at 0.
  if (gameState.state !== 'minigame') return false;
  const player = currentPlayer();
  player.score = Math.max(0, player.score + delta);
  updateScoreDisplay();
  return true;
}

function bindEvent(target, type, handler) {
  // addEventListener + remembering it, so it can be removed automatically.
  target.addEventListener(type, handler);
  gameState.minigameListeners.push({ target: target, type: type, handler: handler });
}

function removeAllMinigameListeners() {
  gameState.minigameListeners.forEach(function (item) {
    item.target.removeEventListener(item.type, item.handler);
  });
  gameState.minigameListeners = [];
}

function scheduleMinigameTimeout(callback, delayMs) {
  // A timeout that dies automatically when the minigame ends.
  const id = setTimeout(function () {
    gameState.minigameTimeouts.delete(id);
    if (gameState.state === 'minigame') callback();
  }, delayMs);
  gameState.minigameTimeouts.add(id);
  return id;
}

function clearMinigameTimeouts() {
  gameState.minigameTimeouts.forEach(function (id) { clearTimeout(id); });
  gameState.minigameTimeouts.clear();
}

function showFloat(container, text, isCorrect) {
  // Small +1 / -1 popup for immediate visual feedback.
  const float = document.createElement('span');
  float.className = 'float-score ' + (isCorrect ? 'is-correct' : 'is-wrong');
  float.textContent = text;
  float.style.left = (20 + Math.random() * 60) + '%';
  float.style.top = '50%';
  container.appendChild(float);
  scheduleMinigameTimeout(function () {
    if (float.parentNode) float.parentNode.removeChild(float);
  }, 700);
}

/* --- global 5-minute timer ---------------------------------------- *
 * Deadline-based: we remember WHEN the match ends and always compare
 * with Date.now(), so a slow computer cannot make the match longer.
 * The tick only refreshes the display; endMatch() does the real work.
 * The interval keeps running through dice rolls, movement, minigames
 * and result screens — exactly as the rules require.
 * ------------------------------------------------------------------ */
function globalTimeLeft() {
  if (gameState.globalEndAt === 0) return MATCH_DURATION_MS;
  return Math.max(0, gameState.globalEndAt - Date.now());
}

function tickGlobalTimer() {
  if (gameState.matchOver) return;
  const left = globalTimeLeft();
  updateGlobalTimerDisplay(left);
  if (left <= 0) endMatch();   // time ran out — from ANY screen or state
}

function startGlobalTimer() {
  stopGlobalTimer();           // never two timers at once
  gameState.globalEndAt = Date.now() + MATCH_DURATION_MS;
  updateGlobalTimerDisplay(MATCH_DURATION_MS);
  gameState.globalTimerId = setInterval(tickGlobalTimer, GLOBAL_TICK_MS);
}

function stopGlobalTimer() {
  if (gameState.globalTimerId !== null) {
    clearInterval(gameState.globalTimerId);
    gameState.globalTimerId = null;
  }
}

/* --- minigame timer (10 seconds per game) -------------------------- */
function startMinigameTimer(seconds) {
  stopMinigameTimer();
  const endAt = Date.now() + seconds * 1000;
  updateMinigameTimerDisplay(seconds);
  gameState.minigameTimerId = setInterval(function () {
    if (gameState.state !== 'minigame') { stopMinigameTimer(); return; }
    const left = endAt - Date.now();   // recalculated from the clock each tick
    if (left <= 0) {
      stopMinigameTimer();
      updateMinigameTimerDisplay(0);
      endMinigame({ summary: "Time's up!" });
    } else {
      updateMinigameTimerDisplay(Math.ceil(left / 1000));
    }
  }, MINIGAME_TICK_MS);
}

function stopMinigameTimer() {
  if (gameState.minigameTimerId !== null) {
    clearInterval(gameState.minigameTimerId);
    gameState.minigameTimerId = null;
  }
}

function startMinigame(gameId) {
  const def = MINIGAME_REGISTRY[gameId];
  if (!def) {
    // Safety net: unknown ID → skip the game, keep the match going.
    console.warn('Unknown minigame id:', gameId);
    showRoundResult({ name: 'Empty tile', summary: 'No minigame here.', delta: 0 });
    return;
  }
  gameState.state = 'minigame';
  gameState.activeMinigameId = gameId;
  gameState.roundStartScore = currentPlayer().score;

  dom['minigame-name'].textContent = def.name;
  dom['minigame-instruction'].textContent = def.instruction;
  dom['minigame-area'].innerHTML = '';
  showScreen('minigame');
  startMinigameTimer(MINIGAME_SECONDS);   // every minigame gets 10 seconds

  // The "toolbox" every minigame receives — this is what makes games pluggable.
  def.start({
    container: dom['minigame-area'],
    addPoints: addPoints,
    endMinigame: endMinigame,
    bindEvent: bindEvent,
    scheduleTimeout: scheduleMinigameTimeout,
    isMatchActive: isMatchActive,
  });
}

function stopActiveMinigame() {
  // Stops the current minigame completely: timer, timeouts, listeners, cleanup.
  stopMinigameTimer();
  clearMinigameTimeouts();
  const def = gameState.activeMinigameId ? MINIGAME_REGISTRY[gameState.activeMinigameId] : null;
  if (def && typeof def.cleanup === 'function') def.cleanup();
  removeAllMinigameListeners();
  if (dom['minigame-area']) dom['minigame-area'].innerHTML = '';
  gameState.activeMinigameId = null;
}

function endMinigame(result) {
  // The one and only way a minigame finishes — either the game calls
  // ctx.endMinigame() itself, or its 10-second timer calls it for you.
  if (gameState.state !== 'minigame') return;   // double calls are ignored
  const def = MINIGAME_REGISTRY[gameState.activeMinigameId];
  const delta = currentPlayer().score - gameState.roundStartScore;
  stopActiveMinigame();   // stops timer + timeouts + listeners + cleanup
  showRoundResult({
    name: def ? def.name : 'Minigame',
    summary: (result && result.summary) || '',
    delta: delta,
  });
}

function showRoundResult(info) {
  // Shown after every minigame. The global match timer keeps running!
  if (gameState.matchOver) return;   // time ran out — endMatch takes over
  gameState.state = 'roundResult';
  dom['result-game-name'].textContent = info.name;
  dom['result-summary'].textContent = info.summary;
  const deltaEl = dom['result-delta'];
  deltaEl.textContent = formatDelta(info.delta);
  deltaEl.classList.remove('is-correct', 'is-wrong');
  if (info.delta > 0) deltaEl.classList.add('is-correct');
  if (info.delta < 0) deltaEl.classList.add('is-wrong');
  dom['result-score-0'].textContent = gameState.players[0].name + ': ' + gameState.players[0].score;
  dom['result-score-1'].textContent = gameState.players[1].name + ': ' + gameState.players[1].score;
  const nextIndex = 1 - gameState.currentPlayerIndex;
  dom['btn-continue-round'].textContent = 'Continue — ' + gameState.players[nextIndex].name + "'s turn";
  showScreen('roundResult');
}

function handleContinueRound() {
  // The Continue button on the round-result screen.
  if (gameState.state !== 'roundResult') return;
  if (gameState.matchOver) return;

  // Safe moment for the reshuffle rule — no minigame is running here.
  maybeShuffleBoard();

  // Next player's turn.
  gameState.currentPlayerIndex = 1 - gameState.currentPlayerIndex;
  gameState.state = 'playing';
  showScreen('playing');
  updateHud();
  dom['dice-hint'].textContent = currentPlayer().name + ", it's your turn. Roll the dice!";
  setRollEnabled(true);
}

/* ==================================================================
   MINIGAME REGISTRY — THE place where minigames are added or removed.
   ------------------------------------------------------------------
   The board stores only ID strings. Each entry needs:
     id          – unique string used by the board
     name        – shown on the tile and on the minigame screen
     icon        – emoji shown on the tile
     instruction – one short sentence shown before playing
     start(ctx)  – builds the game into ctx.container and binds input
     cleanup()   – drops its own temporary state (called automatically)

   A minigame scores ONLY through ctx.addPoints(+1 / -1) and finishes
   ONLY through ctx.endMinigame(). It must never touch gameState
   directly — that is what keeps the board, dice, turns and scoring
   independent from individual games.

   To ADD a minigame:
     1. add its object below
     2. add its id to MINIGAME_IDS (the board's game pool)
   To REPLACE one: swap the id inside MINIGAME_IDS. Nothing else changes.
   ================================================================== */

const MINIGAME_IDS = ['testGame'];   // Stage 3: six real minigames instead

const MINIGAME_REGISTRY = {

  /* Temporary Stage 1 test game: click the target (+1),
     click the empty field (-1). Removed in Stage 3. */
  testGame: {
    id: 'testGame',
    name: 'Target Tap',
    icon: '🎯',
    instruction: 'Click the target for +1 point. Click the empty field for -1 point.',
    _state: null,

    start: function (ctx) {
      const self = this;
      this._state = { targetHit: false, roundPoints: 0 };

      const wrap = document.createElement('div');
      wrap.className = 'tap-wrap';

      const field = document.createElement('div');
      field.className = 'tap-field';

      const target = document.createElement('button');
      target.type = 'button';
      target.className = 'tap-target';
      target.textContent = '+';
      target.setAttribute('aria-label', 'Target');

      const endRow = document.createElement('div');
      endRow.className = 'test-end-row';
      const pointsLabel = document.createElement('span');
      pointsLabel.className = 'test-points';
      const endBtn = document.createElement('button');
      endBtn.type = 'button';
      endBtn.className = 'btn btn--ghost';
      endBtn.textContent = 'Finish Round';

      field.appendChild(target);
      endRow.appendChild(pointsLabel);
      endRow.appendChild(endBtn);
      wrap.appendChild(field);
      wrap.appendChild(endRow);
      ctx.container.appendChild(wrap);

      function updatePointsLabel() {
        pointsLabel.textContent = 'This round: ' + self._state.roundPoints + ' points';
      }

      function showTarget() {
        if (self._state === null) return;
        target.style.left = (12 + Math.random() * 76) + '%';
        target.style.top = (12 + Math.random() * 76) + '%';
        target.classList.add('is-visible');
        self._state.targetHit = false;    // the next hit may score again
      }

      // +1: clicking the target. One hit = one point (hit lock).
      ctx.bindEvent(target, 'click', function (event) {
        event.stopPropagation();          // the field must not see this click
        if (self._state === null || !ctx.isMatchActive()) return;
        if (self._state.targetHit) return;
        self._state.targetHit = true;
        ctx.addPoints(1);
        self._state.roundPoints += 1;
        updatePointsLabel();
        showFloat(field, '+1', true);
        target.classList.remove('is-visible');
        ctx.scheduleTimeout(showTarget, 350);   // new target shortly after
      });

      // -1: clicking the empty field.
      ctx.bindEvent(field, 'click', function () {
        if (self._state === null || !ctx.isMatchActive()) return;
        ctx.addPoints(-1);
        self._state.roundPoints -= 1;
        updatePointsLabel();
        showFloat(field, '-1', false);
      });

      ctx.bindEvent(endBtn, 'click', function () {
        if (self._state === null) return;
        ctx.endMinigame();
      });

      updatePointsLabel();
      showTarget();
    },

    cleanup: function () {
      // Timeouts and listeners are cleared automatically by the system;
      // the game only drops its own state here.
      this._state = null;
    },
  },
};

/* ------------------------------------------------------------------ *
 * 8. Dice, movement, turns
 * ------------------------------------------------------------------ */
function setRollEnabled(enabled) {
  dom['btn-roll'].disabled = !enabled;
}

function rollDice() {
  if (gameState.state !== 'playing') return;          // only on the board
  if (gameState.rolling || gameState.moving) return;  // no double rolls

  gameState.rolling = true;
  setRollEnabled(false);
  dom.dice.classList.add('dice--rolling');
  dom['dice-hint'].textContent = 'Rolling…';

  let flips = 0;
  gameState.diceTimerId = setInterval(function () {
    dom.dice.textContent = String(randomInt(1, 6));
    flips += 1;
    if (flips >= DICE_FLIPS) {
      clearInterval(gameState.diceTimerId);
      gameState.diceTimerId = null;
      dom.dice.classList.remove('dice--rolling');
      const value = randomInt(1, 6);
      gameState.diceValue = value;
      dom.dice.textContent = String(value);
      dom['dice-hint'].textContent = value + ' — moving…';
      gameState.rolling = false;
      moveCurrentPlayer(value);
    }
  }, DICE_FLIP_MS);
}

function stopDiceAnimation() {
  if (gameState.diceTimerId !== null) {
    clearInterval(gameState.diceTimerId);
    gameState.diceTimerId = null;
  }
  gameState.rolling = false;
  dom.dice.classList.remove('dice--rolling');
}

function moveCurrentPlayer(steps) {
  gameState.moving = true;
  setRollEnabled(false);
  let stepsDone = 0;

  function stepOnce() {
    if (!gameState.moving) return;    // stopped (e.g. player returned to menu)
    const player = currentPlayer();
    const oldPosition = player.position;
    player.position = (player.position + 1) % BOARD_SIZE;   // wrap: tile 12 → 1

    if (oldPosition === BOARD_SIZE - 1) {
      // A full lap is finished — remembered for the reshuffle rule.
      gameState.lapsSinceShuffle[gameState.currentPlayerIndex] += 1;
    }

    renderPlayers();
    stepsDone += 1;

    if (stepsDone < steps) {
      gameState.moveTimerId = setTimeout(stepOnce, MOVE_STEP_MS);
    } else {
      gameState.moveTimerId = null;
      gameState.moving = false;
      landOnCurrentTile();
    }
  }

  stepOnce();   // the first step happens immediately, the rest animate
}

function stopMovement() {
  if (gameState.moveTimerId !== null) {
    clearTimeout(gameState.moveTimerId);
    gameState.moveTimerId = null;
  }
  gameState.moving = false;
}

function landOnCurrentTile() {
  const tileIndex = currentPlayer().position;
  const gameId = gameState.board[tileIndex];   // the board stores only IDs
  startMinigame(gameId);
}

/* ------------------------------------------------------------------ *
 * 9. Menu navigation & match setup
 * ------------------------------------------------------------------ */
function openInstructions() {
  gameState.state = 'instructions';
  showScreen('instructions');
}

function openReady() {
  gameState.state = 'ready';
  showScreen('ready');
}

function startNewMatch() {
  // Full reset, so "Play" and "Play Again" always start a clean match.
  stopGlobalTimer();
  stopDiceAnimation();
  stopMovement();
  stopActiveMinigame();     // (this also stops the minigame timer)
  if (gameState.boardNoteTimerId !== null) {
    clearTimeout(gameState.boardNoteTimerId);
    gameState.boardNoteTimerId = null;
  }
  dom['board-note'].textContent = '';
  gameState.players.forEach(function (player) {
    player.score = 0;
    player.position = 0;
  });
  gameState.currentPlayerIndex = 0;
  gameState.lapsSinceShuffle = [0, 0];
  gameState.board = generateBoardLayout();
  gameState.diceValue = 0;
  gameState.roundStartScore = 0;
  gameState.matchOver = false;      // a new match may be scored again
  gameState.globalEndAt = 0;

  gameState.state = 'playing';
  showScreen('playing');
  renderBoard();
  updateHud();
  dom.dice.textContent = '?';
  dom['dice-hint'].textContent = gameState.players[0].name + ', roll the dice!';
  setRollEnabled(true);
  updateGlobalTimerDisplay(MATCH_DURATION_MS);
  startGlobalTimer();               // the 5 minutes start NOW
}

function returnToMenu() {
  // Stops every running process, then goes back to the menu.
  stopGlobalTimer();
  stopDiceAnimation();
  stopMovement();
  stopActiveMinigame();
  if (gameState.boardNoteTimerId !== null) {
    clearTimeout(gameState.boardNoteTimerId);
    gameState.boardNoteTimerId = null;
  }
  dom['board-note'].textContent = '';
  gameState.matchOver = false;   // the menu is always a clean starting point
  gameState.state = 'menu';
  showScreen('menu');
}

/* ------------------------------------------------------------------ *
 * 10. Game over — when the 5 minutes are finished
 * ------------------------------------------------------------------ */
function endMatch() {
  // Called by the global timer when time runs out — from ANY screen.
  if (gameState.matchOver) return;      // never end the same match twice
  gameState.matchOver = true;           // blocks every future score

  // Stop everything that could still affect the game.
  stopGlobalTimer();
  stopMinigameTimer();
  stopDiceAnimation();
  stopMovement();
  if (gameState.state === 'minigame') stopActiveMinigame();  // cleanup + listeners
  if (gameState.boardNoteTimerId !== null) {
    clearTimeout(gameState.boardNoteTimerId);
    gameState.boardNoteTimerId = null;
  }
  dom['board-note'].textContent = '';

  updateGlobalTimerDisplay(0);
  renderFinalResults();
  gameState.state = 'gameOver';
  showScreen('gameOver');
}

function renderFinalResults() {
  const p1 = gameState.players[0];
  const p2 = gameState.players[1];

  dom['final-scores'].innerHTML = '';
  gameState.players.forEach(function (player, index) {
    const row = document.createElement('div');
    row.className = 'final-score-row final-score-row--p' + (index + 1);
    const name = document.createElement('span');
    name.textContent = player.name;
    const value = document.createElement('strong');
    value.textContent = player.score + ' points';
    row.appendChild(name);
    row.appendChild(value);
    dom['final-scores'].appendChild(row);
  });

  if (p1.score > p2.score) {
    dom['final-heading'].textContent = 'Player 1 Wins!';
    dom['winner-text'].textContent = 'Player 1 has the higher score.';
  } else if (p2.score > p1.score) {
    dom['final-heading'].textContent = 'Player 2 Wins!';
    dom['winner-text'].textContent = 'Player 2 has the higher score.';
  } else {
    dom['final-heading'].textContent = "It's a Tie!";
    dom['winner-text'].textContent = 'Both players have the same score.';
  }
}

function wireEvents() {
  // Every core listener is added EXACTLY ONCE, here. No inline HTML handlers.
  document.getElementById('btn-play-with-friend').addEventListener('click', openInstructions);
  document.getElementById('btn-continue').addEventListener('click', openReady);
  document.getElementById('btn-start-game').addEventListener('click', startNewMatch);
  document.getElementById('btn-menu-from-instructions').addEventListener('click', returnToMenu);
  document.getElementById('btn-menu-from-ready').addEventListener('click', returnToMenu);
  document.getElementById('btn-menu-from-game').addEventListener('click', returnToMenu);
  document.getElementById('btn-menu-from-minigame').addEventListener('click', returnToMenu);
  document.getElementById('btn-menu-from-gameover').addEventListener('click', returnToMenu);
  document.getElementById('btn-roll').addEventListener('click', rollDice);
  document.getElementById('btn-continue-round').addEventListener('click', handleContinueRound);
  document.getElementById('btn-play-again').addEventListener('click', startNewMatch);
}

function init() {
  cacheDom();
  gameState.board = generateBoardLayout();
  wireEvents();
  showScreen('menu');
}

document.addEventListener('DOMContentLoaded', init);





