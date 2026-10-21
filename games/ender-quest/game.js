// Ender Quest: a browser port of the 2020 C++ console game (v0.3.2).
// The rules were recovered from the original EnderQuest_0.3.2.exe; the levels, dialogue and
// ASCII art are the game's own text files in text/. Function names in comments (fn_xxxxxx)
// point at the routine in the exe each piece mirrors.
import { OTHIM_SCRIPT, FINAL_SCRIPT } from "./scripts.js";

const ROWS = 5, COLS = 6, CELL_W = 15, CELL_H = 5;
const PLAYER = 100, DARK_PLAYER = 101, QUEEN_AND_PLAYER = 125;
const T = { DARK: 0, LIGHT: 1, BRIGHT: 2, ULTIMATE: 3, TELE: 4, GEN: 13, CANNON: 14, COUNTDOWN: 15, QUESTION: 16 };
// Pushers 5..12 push one cell: up, down, left, right, up-left, up-right, down-left, down-right.
const PUSH = { 5: [-1, 0], 6: [1, 0], 7: [0, -1], 8: [0, 1], 9: [-1, -1], 10: [-1, 1], 11: [1, -1], 12: [1, 1] };
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const QUESTION_CHOICES = [1, 2, 3, 9, 10, 11, 12, 14];

const CHAPTER_NAMES = ["Road of Beginnings", "At Centry's Gate", "Roadside Circus", "Centrian Laboratory",
  "Royal Training Grounds", "King's Palace", "Inner Sanctum", "Fate of Zarkolth"];
const ACHIEVEMENTS = [
  ["Dragon Tamer", "Finish Chapter 1"], ["Knight Fencing", "Finish Chapter 2"],
  ["Teleporting Master", "Finish Chapter 3"], ["Electrical Surge", "Finish Chapter 4"],
  ["Dark Pulser", "Finish Chapter 5"], ["Light Defender", "Finish Chapter 6"],
  ["King of Kings", "Finish Chapter 7"], ["Ender's Wish", "Finish Chapter 8"],
  ["Hail Zarkolth", "Side with Zarkolth in Chapter 8"], ["Hail Othim", "Side with Othim in Chapter 8"],
  ["Invincibility", "Finish the game without dying to an enemy or failing a level"],
  ["Firerama's Challenge", "Finish the game without closing the game"],
];

// --- data ---------------------------------------------------------------------------------

const DATA = {};

async function loadText(name) {
  const r = await fetch(`text/${name}.txt`);
  if (!r.ok) throw new Error(`Couldn't load text/${name}.txt`);
  return (await r.text()).replace(/\r/g, "").split("\n");
}

function parseSprites(lines) {
  const sprites = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("*") || lines[i] === "*End") continue;
    const art = [];
    for (let j = 1; j <= CELL_H; j++) art.push((lines[i + j] || "").padEnd(CELL_W).slice(0, CELL_W));
    sprites.push({ name: lines[i].slice(1).replace(/_/g, " "), art });
    i += CELL_H;
  }
  return sprites;
}

// Chapter files are sections separated by lines starting with ';'.
function parseSections(lines) {
  const sections = [[]];
  for (const line of lines) {
    if (line.startsWith(";")) sections.push([]);
    else if (line.trim()) sections[sections.length - 1].push(line.trim());
  }
  return sections;
}

async function loadData() {
  const [obstacles, characters] = await Promise.all([loadText("obstacles"), loadText("characters")]);
  DATA.obstacles = parseSprites(obstacles);
  DATA.characters = parseSprites(characters);
  DATA.levels = {};
  DATA.quotes = {};
  await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (ch) => {
    DATA.levels[ch] = parseSections(await loadText(`chapter${ch}levels`));
    DATA.quotes[ch] = parseSections(await loadText(`chapter${ch}quotes`)).map((sec) => sec.map((l) => {
      const m = l.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { turn: +m[1], speaker: +m[2], text: m[3] } : null;
    }).filter(Boolean));
  }));
}

// --- save -----------------------------------------------------------------------------------

const SAVE_KEY = "enderquest-save-v1";
// chapter/level = the furthest unlocked level, as in the original save file.
const game = { chapter: 1, level: 1, queen: 0, neverFailed: true, achievements: Array(12).fill(false), challengeRun: false };

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) Object.assign(game, s);
  } catch { /* fresh save */ }
  // "Finish the game without closing the game" only counts from a brand-new save.
  game.challengeRun = game.chapter === 1 && game.level === 1;
}

function save() {
  try {
    const { chapter, level, queen, neverFailed, achievements } = game;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ chapter, level, queen, neverFailed, achievements }));
  } catch { /* storage unavailable: progress lasts for this visit only */ }
}

function resetSave() {
  Object.assign(game, { chapter: 1, level: 1, queen: 0, neverFailed: true, achievements: Array(12).fill(false), challengeRun: true });
  save();
}

const levelOpen = (ch, lvl) => ch < game.chapter || (ch === game.chapter && lvl <= game.level);

// --- input ------------------------------------------------------------------------------------

const keyQueue = [];
let keyWaiter = null;

function pushKey(k) {
  if (keyWaiter) { const w = keyWaiter; keyWaiter = null; w(k); } else if (keyQueue.length < 4) keyQueue.push(k);
}

function nextKey() {
  if (keyQueue.length) return Promise.resolve(keyQueue.shift());
  return new Promise((res) => { keyWaiter = res; });
}

async function waitSpace() {
  while ((await nextKey()) !== "space");
}

const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right", " ": "space", Enter: "space" };

function setupInput() {
  window.addEventListener("keydown", (e) => {
    const k = KEYMAP[e.key];
    if (!k || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (!e.repeat || k !== "space") pushKey(k);
  });
  for (const b of document.querySelectorAll("[data-key]")) {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); pushKey(b.dataset.key); });
  }
}

// --- screen -------------------------------------------------------------------------------------

const screenEl = document.getElementById("screen");

// A screen is a list of rows; each row is a list of [text, cssClass] runs.
class Screen {
  constructor() { this.rows = []; }
  line(text = "", cls = "") { this.rows.push([[text, cls]]); return this; }
  runs(runs) { this.rows.push(runs); return this; }
  blank(n = 1) { for (let i = 0; i < n; i++) this.line(); return this; }
  show() {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    screenEl.innerHTML = this.rows.map((runs) =>
      runs.map(([t, c]) => (c ? `<span class="${c}">${esc(t)}</span>` : esc(t))).join("")).join("\n");
  }
}

function tileClass(t) {
  if (t === T.DARK) return "dk";
  if (t <= T.ULTIMATE) return "lt";
  if (t === T.TELE) return "tp";
  if (t <= 12) return "ps";
  return { 13: "gn", 14: "cn", 15: "cd", 16: "qm" }[t] || "lt";
}

function overlayClass(id) {
  if (id >= 114 && id <= 117) return "bm";
  if (id === 119) return "dk";
  if (id === 106) return "fb";
  return "en";
}

// --- board ---------------------------------------------------------------------------------------

const grid = (v) => Array.from({ length: ROWS }, () => Array(COLS).fill(v));
const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const eachCell = (f) => { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) f(r, c); };

class Board {
  constructor(chapter, level) {
    this.chapter = chapter; this.level = level;
    this.tiles = grid(T.LIGHT);
    this.over = grid(0);       // enemies, beams and darkness drawn over the tiles; touching one kills
    this.actors = grid(0);     // the player: 100 while choosing a start, 101 while playing, 125 with the Queen
    this.tele = grid(0);       // teleporter pair ids
    this.count = grid(0);      // countdown tiles' remaining turns
    this.wallH = grid(false);  // wall below a cell
    this.wallV = grid(false);  // wall right of a cell
    this.cursor = null;        // highlighted cell while aiming a darkness cannon
    this.bossFlags = 0;
    this.kevin = false;
  }

  playerPos() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const a = this.actors[r][c];
      if (a === PLAYER || a === DARK_PLAYER || a === QUEEN_AND_PLAYER) return [r, c];
    }
    return [-1, -1];
  }

  allDark() { return this.tiles.every((row) => row.every((t) => t === T.DARK)); }

  playerHit() {
    const [r, c] = this.playerPos();
    return r >= 0 && this.over[r][c] !== 0;
  }

  // fn_40c760: apply a level section on top of the current board.
  load(chapter, level) {
    for (const line of DATA.levels[chapter][level - 1] || []) {
      const p = line.split(/\s+/);
      if (p[0] === "wallH" || p[0] === "wallV") {
        (p[0] === "wallH" ? this.wallH : this.wallV)[+p[1]][+p[2]] = true;
        continue;
      }
      const n = p.map(Number);
      if (p.length === 4 && n[0] === T.TELE) { this.tiles[n[2]][n[3]] = T.TELE; this.tele[n[2]][n[3]] = n[1]; continue; }
      if (p.length === 4 && n[0] === T.COUNTDOWN) { this.tiles[n[2]][n[3]] = T.COUNTDOWN; this.count[n[2]][n[3]] = n[1]; continue; }
      if (p.length === 1) {
        const id = n[0];
        if (id >= 102 && id <= 105) this.bossFlags |= 1;
        else if (id >= 108 && id <= 110) this.bossFlags |= 2;
        else if (id >= 111 && id <= 113) { this.bossFlags |= 4; this.kevin = true; }
        else if (id === 118) this.bossFlags |= 8;
        else if (id === 120) this.bossFlags |= 16;
        else if (id === 122) this.bossFlags |= 32;
        else if (id === 123) this.bossFlags |= 64;
        continue;
      }
      const [id, r, c] = n;
      if (!inBounds(r, c)) continue;
      if (id >= 114 && id <= 117) this.over[r][c] = id;
      else if (id > 99) this.actors[r][c] = id;
      else this.tiles[r][c] = id;
    }
  }

  // fn_410ac0
  canMove(dr, dc) {
    const [r, c] = this.playerPos();
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) return false;
    if (dr && !dc && (dr < 0 ? this.wallH[nr][c] : this.wallH[r][c])) return false;
    if (dc && !dr && (dc < 0 ? this.wallV[r][nc] : this.wallV[r][c])) return false;
    const t = this.tiles[nr][nc];
    return t !== T.DARK && t !== T.COUNTDOWN;
  }

  moveActor(dr, dc, id = DARK_PLAYER) {
    const [r, c] = this.playerPos();
    this.actors[r][c] = 0;
    this.actors[r + dr][c + dc] = id;
  }

  // fn_40f2d0: beams only stay lit next to a light generator.
  cleanupBeams() {
    const gen = (r, c) => inBounds(r, c) && this.tiles[r][c] === T.GEN;
    eachCell((r, c) => {
      const o = this.over[r][c];
      const keep = o === 114 ? gen(r, c + 1) || gen(r, c - 1)
        : o === 115 ? gen(r + 1, c) || gen(r - 1, c)
        : o === 116 ? gen(r + 1, c - 1) || gen(r - 1, c + 1)
        : o === 117 ? gen(r + 1, c + 1) || gen(r - 1, c - 1)
        : true;
      if (!keep) this.over[r][c] = 0;
    });
  }

  // fn_40f3d0: countdown tiles turn into light when they run out.
  tickCountdowns() {
    eachCell((r, c) => {
      if (this.count[r][c] === 1) this.tiles[r][c] = T.LIGHT;
      if (this.count[r][c] > 0) this.count[r][c]--;
    });
  }
}

// fn_40f0b0 / fn_412f40: draw the board, 15x5 characters per cell.
function drawBoard(scr, b) {
  const width = COLS * CELL_W + COLS + 1;
  scr.line("_".repeat(width), "wl");
  for (let r = 0; r < ROWS; r++) {
    const cells = [];
    for (let c = 0; c < COLS; c++) cells.push(cellArt(b, r, c));
    for (let l = 0; l < CELL_H; l++) {
      const runs = [["|", "wl"]];
      for (let c = 0; c < COLS; c++) {
        runs.push(...cells[c][l]);
        if (c < COLS - 1) runs.push([b.wallV[r][c] ? "#" : "|", b.wallV[r][c] ? "wall" : "wl"]);
      }
      runs.push(["|", "wl"]);
      scr.runs(runs);
    }
    const runs = [["|", "wl"]];
    for (let c = 0; c < COLS; c++) {
      runs.push(b.wallH[r][c] ? ["#".repeat(CELL_W), "wall"] : ["_".repeat(CELL_W), "wl"]);
      if (c < COLS - 1) runs.push([b.wallV[r][c] ? "#" : "|", b.wallV[r][c] ? "wall" : "wl"]);
    }
    runs.push(["|", "wl"]);
    scr.runs(runs);
  }
}

function cellArt(b, r, c) {
  const t = b.tiles[r][c];
  const chars = [], cls = [];
  const base = (DATA.obstacles[t] || DATA.obstacles[1]).art;
  for (let l = 0; l < CELL_H; l++) { chars.push(base[l].split("")); cls.push(Array(CELL_W).fill(tileClass(t))); }
  const num = t === T.TELE ? b.tele[r][c] : b.count[r][c] > 0 ? b.count[r][c] : 0;
  if (num) String(num).split("").forEach((d, i) => { chars[2][7 + i] = d; });
  const stamp = (id, k) => {
    const s = DATA.characters[id - 100];
    if (!s) return;
    for (let l = 0; l < CELL_H; l++) for (let x = 0; x < CELL_W; x++) {
      if (s.art[l][x] !== " ") { chars[l][x] = s.art[l][x]; cls[l][x] = k; }
    }
  };
  if (b.over[r][c]) stamp(b.over[r][c], overlayClass(b.over[r][c]));
  if (b.actors[r][c]) stamp(b.actors[r][c], "pl");
  const hl = b.cursor && b.cursor[0] === r && b.cursor[1] === c;
  return chars.map((row, l) => {
    const runs = [];
    for (let x = 0; x < CELL_W; x++) {
      const k = (hl ? "cur " : "") + cls[l][x];
      if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][0] += row[x];
      else runs.push([row[x], k]);
    }
    return runs;
  });
}

// fn_414050: the line of dialogue for this turn, with the speaker's portrait.
function drawQuote(scr, chapter, level, turn) {
  const q = (DATA.quotes[chapter][level - 1] || []).find((x) => x.turn === turn);
  drawSpeech(scr, q ? q.speaker : null, q ? q.text : "");
}

function drawSpeech(scr, speaker, text, art) {
  const pic = art || (speaker != null && DATA.characters[speaker - 100] ? DATA.characters[speaker - 100].art : null);
  for (let l = 0; l < CELL_H; l++) {
    if (!pic) { scr.line(); continue; }
    scr.runs([[pic[l], "pl"], [l === 2 && text ? ": " + text : "", "say"]]);
  }
}

// With ?debug in the URL the board being shown is exposed as window.eqBoard for testing.
const DEBUG = new URLSearchParams(location.search).has("debug");

function boardScreen(b) {
  if (DEBUG) window.eqBoard = b;
  const s = new Screen(); drawBoard(s, b); s.line(); return s;
}

const hint = (s, text) => s.line(text, "hint");

// --- bosses ---------------------------------------------------------------------------------------

// fn_4081c0 / fn_40a380 / fn_4067c0: scripted frames stored after the boss level (section 11 + turn).
function applyFrames(b, chapter, turn, onPlace) {
  for (const line of DATA.levels[chapter][turn + 11] || []) {
    const [id, r, c] = line.split(/\s+/).map(Number);
    if (!inBounds(r, c)) continue;
    b.over[r][c] = id;
    if (onPlace) onPlace(id, r, c);
  }
}

// fn_4067c0: Grimel's light armour sends a beam into each neighbouring cell.
function grimelArmour(b) {
  eachCell((r, c) => {
    if (b.over[r][c] !== 118) return;
    const put = (nr, nc, beam) => {
      if (!inBounds(nr, nc)) return;
      const o = b.over[nr][nc];
      if (o <= 101 || o >= 107) b.over[nr][nc] = beam;
    };
    put(r, c - 1, 114); put(r, c + 1, 114); put(r - 1, c, 115); put(r + 1, c, 115);
  });
}

// fn_4061e0: Prince Harriot hops between posts and fires his darkness cannons every fifth turn.
const HARRIOT_POSTS = [[3, 2], [1, 0], [3, 4], [0, 5], [3, 0], [2, 3], [4, 5], [1, 2], [0, 0]];
const HARRIOT_SHOTS = [[[2, 3]], [[0, 1], [3, 1]], [[4, 2], [0, 5], [4, 5]], [[1, 0], [1, 2], [1, 4], [3, 4]],
  [[0, 3], [2, 0], [2, 2], [2, 5], [3, 3]]];

function harriot(b, st) {
  eachCell((r, c) => {
    if (b.over[r][c] === 120) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (inBounds(r + dr, c + dc) && b.actors[r + dr][c + dc] === DARK_PLAYER) {
          st.counter = 0; st.hits++; b.over[r][c] = 0;
        }
      }
    }
    if (b.over[r][c] === 121) { st.hits++; b.over[r][c] = 0; }
  });
  const firing = st.counter === 4;
  st.counter++;
  const post = HARRIOT_POSTS[st.hits];
  if (post) b.over[post[0]][post[1]] = firing ? 121 : 120;
  if (st.counter === 5) {
    for (const [r, c] of HARRIOT_SHOTS[st.shots] || []) b.tiles[r][c] = T.DARK;
    st.counter = 0; st.shots++;
  }
}

// fn_409930: Queen Mogolyda holds one cell; each attempt that leaves only her cell lit wears her down.
function queen(b, turn) {
  let lit = 0;
  eachCell((r, c) => { if (b.tiles[r][c] === T.LIGHT) lit++; });
  if (lit === 1 && game.queen < 30) { game.queen++; save(); }
  if (turn === 1 && game.queen !== 30) b.over[Math.floor(game.queen / 6)][game.queen % 6] = 122;
}

function applyScript(b, writes) {
  for (const [g, r, c, v] of writes || []) (g === "t" ? b.tiles : b.over)[r][c] = v;
}

// fn_408500: King Othim's light floods the board in a fixed pattern; until he tires (turn 44)
// the cell you stand on lights back up.
function othim(b, turn) {
  eachCell((r, c) => { if (b.actors[r][c] === DARK_PLAYER && turn < 44) b.tiles[r][c] = T.LIGHT; });
  applyScript(b, OTHIM_SCRIPT[turn]);
}

function runBosses(b, turn, st, withQueen = true) {
  if (b.bossFlags & 1) applyFrames(b, 1, turn);
  if (b.bossFlags & 2) applyFrames(b, 2, turn, (id, r, c) => { if (id === 110) b.tiles[r][c]++; });
  if (b.bossFlags & 8) { applyFrames(b, 4, turn); grimelArmour(b); }
  if (b.bossFlags & 16) harriot(b, st);
  if (withQueen && (b.bossFlags & 32)) queen(b, turn);
  if (b.bossFlags & 64) othim(b, turn);
}

// --- tile effects -------------------------------------------------------------------------------

// fn_411ba0: what happens when you land on a tile.
async function landOn(b) {
  const [r, c] = b.playerPos();
  const t = b.tiles[r][c];
  if (t === T.LIGHT || t === T.GEN) { b.tiles[r][c] = T.DARK; return; }
  if (t === T.BRIGHT || t === T.ULTIMATE) { b.tiles[r][c] = t - 1; return; }
  if (t === T.TELE) {
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      const [pr, pc] = b.playerPos();
      if (b.tiles[rr][cc] === T.TELE && (rr !== pr || cc !== pc) && b.tele[rr][cc] === b.tele[pr][pc]) {
        b.tiles[pr][pc] = T.DARK; b.tele[pr][pc] = 0; b.tiles[rr][cc] = T.DARK; b.tele[rr][cc] = 0;
        b.actors[pr][pc] = 0; b.actors[rr][cc] = DARK_PLAYER;
      }
    }
    return;
  }
  if (PUSH[t]) {
    b.tiles[r][c] = T.DARK;
    const [dr, dc] = PUSH[t];
    if (b.canMove(dr, dc)) b.moveActor(dr, dc);
    return landOn(b);
  }
  if (t === T.CANNON) { await fireCannon(b); b.tiles[r][c] = T.DARK; return; }
  if (t === T.QUESTION) { b.tiles[r][c] = await pickQuestion(b); return landOn(b); }
}

// fn_40a9b0: aim the darkness cannon at any cell.
async function fireCannon(b) {
  b.cursor = [0, 0];
  for (;;) {
    const s = boardScreen(b);
    hint(s, "Darkness cannon: choose a cell to darken, then press Space.");
    s.show();
    const k = await nextKey();
    if (k === "space") break;
    const [dr, dc] = DIRS[k];
    b.cursor = [Math.min(ROWS - 1, Math.max(0, b.cursor[0] + dr)), Math.min(COLS - 1, Math.max(0, b.cursor[1] + dc))];
  }
  const [r, c] = b.cursor;
  b.cursor = null;
  if (b.tele[r][c]) eachCell((rr, cc) => { if ((rr !== r || cc !== c) && b.tele[rr][cc] === b.tele[r][c]) b.tiles[rr][cc] = T.LIGHT; });
  b.tiles[r][c] = T.DARK; b.over[r][c] = 0; b.count[r][c] = 0;
}

// fn_413b90: the "?" tile lets you choose what it becomes.
async function pickQuestion(b) {
  let i = 0;
  for (;;) {
    const s = boardScreen(b);
    const box = (k) => (k >= 0 && k < QUESTION_CHOICES.length ? DATA.obstacles[QUESTION_CHOICES[k]].art : null);
    for (let l = 0; l < CELL_H; l++) {
      const runs = [];
      for (const k of [i - 1, i, i + 1]) {
        const art = box(k);
        runs.push([art ? "   |" + art[l] + "|   " : " ".repeat(CELL_W + 8), k === i ? "lt" : "dim"]);
      }
      s.runs(runs);
    }
    s.line(" ".repeat(CELL_W + 8 + 10) + "/|\\", "say");
    hint(s, "Choose what this tile becomes: Left / Right, then Space.");
    s.show();
    const k = await nextKey();
    if (k === "space") return QUESTION_CHOICES[i];
    if (k === "left" && i > 0) i--;
    if (k === "right" && i < QUESTION_CHOICES.length - 1) i++;
  }
}

// --- level loop ---------------------------------------------------------------------------------

// fn_412cd0: pick a starting cell.
async function chooseStart(b) {
  let r = 0, c = 0, bad = false;
  for (;;) {
    b.actors[r][c] = PLAYER;
    const s = boardScreen(b);
    s.line(bad ? "You can't start there." : "<Choose where to start>", bad ? "warn" : "say");
    hint(s, "Arrow keys to move, Space to start. Every cell has to be filled with darkness.");
    s.show();
    const k = await nextKey();
    b.actors[r][c] = 0;
    bad = false;
    if (k === "space") {
      if (b.tiles[r][c] !== T.DARK) break;
      bad = true;
      continue;
    }
    const [dr, dc] = DIRS[k];
    r = Math.min(ROWS - 1, Math.max(0, r + dr));
    c = Math.min(COLS - 1, Math.max(0, c + dc));
  }
  b.actors[r][c] = DARK_PLAYER;
  await landOn(b);
}

// Pause menu (Continue / Restart / Quit, or Continue / Quit in the finale).
async function pauseMenu(b, options) {
  let sel = 0;
  for (;;) {
    const s = boardScreen(b);
    s.runs(options.map((o, i) => [`   ${o}${i === sel ? " <--" : "    "}   `, i === sel ? "say" : "dim"]));
    hint(s, "Left / Right to choose, Space to confirm.");
    s.show();
    const k = await nextKey();
    if (k === "space") return options[sel];
    if (k === "left" && sel > 0) sel--;
    if (k === "right" && sel < options.length - 1) sel++;
  }
}

// fn_40ff50: one player turn. Returns "move", "Restart" or "Quit".
async function playerTurn(b, quoteCh, quoteLvl, turn, menu = ["Continue", "Restart", "Quit"]) {
  for (;;) {
    const s = boardScreen(b);
    drawQuote(s, quoteCh, quoteLvl, turn);
    hint(s, "Arrow keys to move, Space for the menu.");
    s.show();
    const k = await nextKey();
    if (k === "space") {
      const choice = await pauseMenu(b, menu);
      if (choice === "Continue") continue;
      return choice;
    }
    const [dr, dc] = DIRS[k];
    if (!b.canMove(dr, dc)) continue;
    b.moveActor(dr, dc);
    return "move";
  }
}

async function afterMove(b) {
  await landOn(b);
  b.cleanupBeams();
  b.tickCountdowns();
}

async function killedScreen(b) {
  const s = boardScreen(b);
  s.line("You were killed by the enemy!", "warn");
  hint(s, "Press Space.");
  s.show();
  await waitSpace();
}

// fn_4125a0. Returns "win", "fail" or "restart".
async function playLevel(b) {
  await chooseStart(b);
  const harriotState = { hits: 0, counter: 0, shots: 0 };
  let turn = 1, quit = false, restart = false;
  for (;;) {
    if (b.allDark() || quit || restart) {
      runBosses(b, turn, harriotState, false);
      if (b.playerHit()) { await killedScreen(b); return "fail"; }
      if (restart) return "restart";
      if (quit) return "fail";
      for (let i = 0; i < 7; i++) if (b.bossFlags & (1 << i)) game.achievements[i] = true;
      return "win";
    }
    runBosses(b, turn, harriotState);
    if (b.playerHit()) { await killedScreen(b); return "fail"; }
    const res = await playerTurn(b, b.chapter, b.level, turn);
    if (res === "Restart") restart = true;
    if (res === "Quit") quit = true;
    await afterMove(b);
    turn++;
  }
}

// fn_409eb0: Kevin stalls you before his level.
async function kevinScene(b) {
  const kevin = DATA.characters[11].art, raised = DATA.characters[12].art, snap = DATA.characters[13].art;
  b.over[2][3] = 111;
  const lines = [[kevin, "You are quite early."], [kevin, "If you are here then you must've defeated the guard."],
    [kevin, "I have no chance to beat you, so would you be so kind as to wait until Greenwald's return?"],
    [raised, "And in the meantime, how about some..."], [snap, "And in the meantime, how about some... magic?"]];
  for (const [art, text] of lines) {
    const s = boardScreen(b);
    drawSpeech(s, null, text, art);
    hint(s, "Press Space.");
    s.show();
    await waitSpace();
  }
  b.over[2][3] = 0;
}

// fn_40c5c0
async function runLevel(chapter, level) {
  let result, b;
  do {
    b = new Board(chapter, level);
    b.load(chapter, level);
    if (b.kevin) await kevinScene(b);
    result = await playLevel(b);
  } while (result === "restart");
  const s = boardScreen(b);
  if (result === "win") {
    s.line(`You passed Chapter ${chapter} Level ${level}!`, "say");
    if (chapter === game.chapter && level === game.level) {
      game.level++;
      if (game.level === 13) { game.chapter++; game.level = 1; }
    }
  } else {
    s.line("Level failed...", "warn");
    game.neverFailed = false;
  }
  save();
  hint(s.blank(), "Press Space.");
  s.show();
  await waitSpace();
}

// --- chapter 8: fn_4023e0 -------------------------------------------------------------------

function fill(g, v) { eachCell((r, c) => { g[r][c] = v; }); }

async function scene(b, level, steps, before) {
  for (let i = 0; i < steps; i++) {
    if (before && (await before(i)) === "stop") return "stop";
    const s = boardScreen(b);
    drawQuote(s, 8, level, i);
    hint(s, "Press Space.");
    s.show();
    await waitSpace();
  }
}

// A finale stage: play until the board is dark (or turnLimit turns pass). Returns false if you quit.
async function finaleStage(b, quoteLvl, state, turnLimit = Infinity, script = null) {
  for (;;) {
    if (b.allDark() || state.quit || state.turn >= turnLimit) break;
    if (script) script(state.turn);
    if (b.playerHit()) { await killedScreen(b); return false; }
    const res = await playerTurn(b, 8, quoteLvl, state.turn, ["Continue", "Quit"]);
    if (res === "Quit") state.quit = true;
    await afterMove(b);
    state.turn++;
  }
  boardScreen(b).show();
  if (b.playerHit()) { await killedScreen(b); return false; }
  return !state.quit;
}

async function darknessTakesOver() {
  const s = new Screen();
  for (let i = 0; i < 40; i++) s.line("#".repeat(97), "dk");
  s.show();
  await waitSpace();
}

async function finale() {
  const b = new Board(8, 1);
  b.over[2][3] = 123;
  await scene(b, 1, 13, (i) => {
    if (i === 5) {
      // Greenwald, the Queen, Harriot, Augustus, Kevin and Grimel arrive.
      for (const [r, c, v] of [[2, 4, 102], [2, 5, 103], [1, 3, 122], [3, 3, 120], [1, 4, 108], [3, 4, 111], [1, 5, 118]]) b.over[r][c] = v;
    }
    if (i === 6) fill(b.tiles, T.BRIGHT);
    if (i === 7) fill(b.tiles, T.ULTIMATE);
    if (i === 8) b.tiles[2][1] = T.DARK;
    if (i === 9) b.over[2][1] = 124;
    if (i === 11) for (let r = 0; r < ROWS; r++) { b.over[r][0] = 119; if (r !== 2) b.over[r][1] = 119; b.over[r][2] = 119; }
  });

  // Choose a side.
  let side = 0;
  for (;;) {
    const s = boardScreen(b);
    s.runs([["                Zarkolth        Othim", "say"]]);
    s.line(side === 0 ? "                   /|\\" : "                                /|\\", "say");
    s.line(side === 0 ? "                    |" : "                                 |", "say");
    hint(s, "Left / Right to choose a side, Space to confirm.");
    s.show();
    const k = await nextKey();
    if (k === "space") break;
    if (k === "left") side = 0;
    if (k === "right") side = 1;
  }

  if (side === 0) {
    game.achievements[8] = true; save();
    const r = await scene(b, 2, 13, (i) => {
      if (i === 0) { b.tiles[3][1] = T.DARK; b.over[3][1] = 0; b.actors[3][1] = DARK_PLAYER; }
      if (i === 3) fill(b.tiles, T.DARK);
      if (i === 4) fill(b.over, 119);
      if (i === 5) return "stop";
    });
    if (r === "stop") await darknessTakesOver();
    return;
  }

  game.achievements[9] = true; save();
  await scene(b, 3, 9, (i) => { if (i === 0) b.actors[3][5] = PLAYER; });
  fill(b.over, 0); fill(b.tiles, T.LIGHT);
  b.actors[3][5] = DARK_PLAYER;
  const state = { turn: 1, quit: false };

  // 1. Zarkolth walls off a corner so the board can't be finished.
  b.load(8, 1);
  b.tiles[3][5] = T.DARK;
  await scene(b, 4, 3, (i) => {
    if (i === 1) { b.wallH[0][5] = true; b.wallV[0][4] = true; }
    if (i === 2) b.tiles[3][1] = T.DARK;
  });
  if (!(await finaleStage(b, 5, state, 28))) return;
  // 2. Greenwald breaks the wall.
  await scene(b, 6, 3, (i) => { if (i === 1) { b.wallV[0][4] = false; b.over[0][5] = 104; b.over[0][4] = 105; } });
  b.wallH[0][5] = false; b.over[0][5] = 0; b.over[0][4] = 0; b.tiles[0][5] = T.LIGHT; b.tiles[0][4] = T.LIGHT;
  if (!(await finaleStage(b, 7, state))) return;

  const relight = (lvl) => {
    fill(b.tiles, T.LIGHT);
    const [r, c] = b.playerPos();
    b.tiles[r][c] = T.DARK;
    b.load(8, lvl);
    b.tiles[r][c] = T.DARK;
    state.turn = 0;
  };
  // 3. Walls, bright light and countdowns.
  relight(2);
  await scene(b, 8, 6, (i) => {
    if (i === 2) { b.wallH[2][4] = b.wallH[2][5] = b.wallV[0][3] = b.wallV[2][3] = b.wallV[4][0] = true; }
    if (i === 4) { b.tiles[1][4] = T.BRIGHT; b.tiles[3][0] = T.BRIGHT; }
    if (i === 5) { b.tiles[2][1] = T.COUNTDOWN; b.count[2][1] = 25; b.tiles[4][3] = T.COUNTDOWN; b.count[4][3] = 25; }
  });
  if (!(await finaleStage(b, 9, state))) return;
  b.wallH[2][4] = b.wallH[2][5] = b.wallV[0][3] = b.wallV[2][3] = b.wallV[4][0] = false;
  // 4. A wall down the middle; Kevin snaps a teleporter across it.
  relight(3);
  await scene(b, 10, 5, (i) => {
    if (i === 1) for (let r = 0; r < ROWS; r++) b.wallV[r][2] = true;
    if (i === 3) { b.tiles[2][2] = T.TELE; b.tele[2][2] = 1; b.tiles[2][3] = T.TELE; b.tele[2][3] = 1; }
  });
  if (!(await finaleStage(b, 11, state))) return;
  // 5. Grimel's beams fill everything but the top-left corner.
  fill(b.tiles, T.LIGHT);
  for (let r = 0; r < ROWS; r++) b.wallV[r][2] = false;
  state.turn = 0;
  b.load(8, 4);
  for (let i = 0; i < 5; i++) {
    if (i === 2) {
      fill(b.tiles, T.LIGHT); fill(b.over, 0);
      for (let r = 1; r < ROWS; r++) b.over[r][0] = 114;
      for (let c = 1; c < COLS; c++) b.over[0][c] = 115;
      for (let r = 1; r < ROWS; r++) for (let c = 1; c < COLS; c++) b.over[r][c] = 117;
    }
    if (i === 3) b.cleanupBeams();
    const s = boardScreen(b);
    if (b.playerHit()) { await killedScreen(b); return; }
    drawQuote(s, 8, 12, i);
    hint(s, "Press Space.");
    s.show();
    await waitSpace();
  }
  { const [r, c] = b.playerPos(); b.tiles[r][c] = T.DARK; }
  if (!(await finaleStage(b, 13, state, 28))) return;
  // 6. Harriot's shot; the Queen calls you over.
  await scene(b, 14, 4, (i) => {
    if (i === 2) b.over[2][1] = 119;
    if (i === 3) { b.over[2][1] = 0; b.tiles[2][1] = T.DARK; }
  });
  if (!b.allDark()) {
    const r = await scene(b, 15, 13, (i) => {
      if (i === 2) fill(b.over, 119);
      if (i === 3) return "stop";
    });
    if (r === "stop") await darknessTakesOver();
    return;
  }
  for (let i = 0; i < 10; i++) {
    if (i === 3) fill(b.over, 119);
    if (i === 4) {
      b.over[2][2] = 0;
      const [r, c] = b.playerPos();
      if (r === 2 && c === 2) b.actors[2][2] = QUEEN_AND_PLAYER; else b.over[2][2] = 122;
      if (b.playerHit()) { await killedScreen(b); return; }
    }
    const s = boardScreen(b);
    drawQuote(s, 8, 16, i);
    hint(s, "Press Space.");
    s.show();
    await waitSpace();
  }
  // 7. Walk with the Queen; her light follows you.
  state.turn = 0;
  { const [r, c] = b.playerPos(); b.tiles[r][c] = T.LIGHT; }
  while (state.turn < 7) {
    const s = boardScreen(b);
    drawQuote(s, 8, 17, state.turn);
    hint(s, "Arrow keys to move with the Queen, Space for the menu.");
    s.show();
    const k = await nextKey();
    if (k === "space") {
      if ((await pauseMenu(b, ["Continue", "Quit"])) === "Quit") return;
      continue;
    }
    const [dr, dc] = DIRS[k];
    const [r, c] = b.playerPos();
    if (!inBounds(r + dr, c + dc)) continue;
    b.moveActor(dr, dc, QUEEN_AND_PLAYER);
    const [nr, nc] = b.playerPos();
    b.over[nr][nc] = 0; b.tiles[nr][nc] = T.LIGHT;
    b.cleanupBeams(); b.tickCountdowns();
    state.turn++;
  }
  await scene(b, 18, 4);
  fill(b.over, 0);
  // 8. The final fight against Zarkolth.
  state.turn = 0;
  const ok = await finaleStage(b, 19, state, Infinity, (turn) => {
    applyScript(b, FINAL_SCRIPT[turn]);
    if (turn === 8 && !state.band) {
      state.band = true;
      eachCell((r, c) => { if (r + c >= 3 && r + c <= 6) b.over[r][c] = 0; });
      eachCell((r, c) => { if (c === r || c === r + 1) b.over[r][c] = 119; });
    }
  });
  if (!ok) return;
  fill(b.over, 0);
  await scene(b, 20, 7, (i) => { if (i === 6) fill(b.tiles, T.LIGHT); });
  { const [r, c] = b.playerPos(); b.tiles[r][c] = T.DARK; }
  state.turn = 0;
  if (!(await finaleStage(b, 21, state))) return;
  // Ending.
  fill(b.tiles, T.LIGHT); fill(b.actors, 0);
  const ending = {
    0: [[2, 1, 126], [2, 3, 123], [3, 3, 120], [1, 3, 118], [2, 4, 108], [1, 4, 111]],
    2: [[3, 3, 0], [3, 2, 120]], 7: [[2, 3, 0], [2, 2, 123]], 12: [[2, 1, 0], [2, 2, 126], [2, 3, 123]],
    13: [[2, 2, 0], [2, 3, 126], [2, 4, 123], [3, 4, 108]], 14: [[2, 3, 0], [2, 4, 126], [2, 5, 123]],
    15: [[2, 4, 0], [2, 5, 126]], 16: [[2, 5, 0]], 17: [[2, 2, 120], [3, 2, 0]], 18: [[2, 3, 120], [2, 2, 0]],
    19: [[2, 4, 120], [2, 3, 0]], 20: [[2, 5, 120], [2, 4, 0]],
    21: [[2, 5, 0], [1, 4, 118], [1, 3, 0], [3, 5, 108], [3, 4, 0], [1, 5, 111]], 22: [[1, 5, 118], [1, 4, 0], [3, 5, 0]],
    23: [[1, 5, 0]], 24: [[2, 2, 127], [2, 3, 128]],
  };
  await scene(b, 22, 25, (i) => { for (const [r, c, v] of ending[i] || []) b.over[r][c] = v; });
  game.achievements[7] = true;
  if (game.neverFailed) game.achievements[10] = true;
  if (game.challengeRun) game.achievements[11] = true;
  save();
}

// --- menus -------------------------------------------------------------------------------------

const TITLE = [
  " ####  #   #  ####   ####  ####       ###   #   #  ####   ####  #####",
  " #     ##  #  #   #  #     #   #     #   #  #   #  #     #        #  ",
  " ###   # # #  #   #  ###   ####      #   #  #   #  ###    ###     #  ",
  " #     #  ##  #   #  #     #  #      #  ##  #   #  #         #    #  ",
  " ####  #   #  ####   ####  #   #      ####   ###   ####  ####     #  ",
];

async function menu(title, options, footer = "", start = 0) {
  let sel = start;
  for (;;) {
    const s = new Screen().blank();
    if (title === "TITLE") { for (const l of TITLE) s.line(l, "title"); s.line("_".repeat(70), "wl"); }
    else s.line(title, "say").line("_".repeat(40), "wl");
    s.blank();
    options.forEach((o, i) => s.line(`   ${o.label}${i === sel ? "  <--" : ""}`, o.locked ? "dim" : i === sel ? "say" : ""));
    s.blank();
    if (footer) for (const l of [].concat(footer(sel))) s.line(l, "hint");
    hint(s, "Up / Down to choose, Space to select.");
    s.show();
    const k = await nextKey();
    if (k === "space") return sel;
    if ((k === "up" || k === "left") && sel > 0) sel--;
    if ((k === "down" || k === "right") && sel < options.length - 1) sel++;
  }
}

async function chapterSelect() {
  let sel = 0;
  for (;;) {
    const opts = [{ label: "Back" }].concat(CHAPTER_NAMES.map((n, i) => {
      const ch = i + 1, open = ch <= game.chapter;
      return { label: open ? `Chapter ${ch}: ${n}` : `Chapter ${ch}: Locked`, locked: !open };
    }));
    sel = await menu("Levels", opts, "", sel);
    if (sel === 0) return;
    if (opts[sel].locked) continue;
    if (sel === 8) { await finale(); continue; }
    await levelSelect(sel);
  }
}

async function levelSelect(ch) {
  let sel = 1;
  for (;;) {
    const opts = [{ label: "Back" }];
    for (let l = 1; l <= 12; l++) {
      const open = levelOpen(ch, l);
      opts.push({ label: `Level ${l}${l === 12 ? " (boss)" : ""}${open ? "" : "  (locked)"}`, locked: !open });
    }
    sel = await menu(`Chapter ${ch}: ${CHAPTER_NAMES[ch - 1]}`, opts, "", sel);
    if (sel === 0) return;
    if (opts[sel].locked) continue;
    await runLevel(ch, sel);
    if (sel < 12 && levelOpen(ch, sel + 1)) sel++;
  }
}

async function achievementsScreen() {
  const opts = [{ label: "Back" }].concat(ACHIEVEMENTS.map(([n], i) => ({ label: `${game.achievements[i] ? "[x]" : "[ ]"} ${n}` })));
  for (;;) {
    const sel = await menu("Achievements", opts, (s) => (s ? [`Objective: ${ACHIEVEMENTS[s - 1][1]}`] : []));
    if (sel === 0) return;
  }
}

async function credits() {
  const s = new Screen().blank();
  for (const l of TITLE) s.line(l, "title");
  s.blank().line("Programmer: Firerama", "say").line("Playtester: You?", "say").blank()
    .line("Originally a Windows console game (2020). Ported to the browser from the original program.", "hint")
    .blank();
  hint(s, "Press Space.");
  s.show();
  await waitSpace();
}

async function extras() {
  for (;;) {
    const sel = await menu("Extras", [{ label: "Reset Game" }, { label: "Back" }]);
    if (sel === 1) return;
    const yes = await menu("Are you sure you want to erase ALL saved data? (It cannot be undone)", [{ label: "Yes" }, { label: "No" }], "", 1);
    if (yes === 0) resetSave();
  }
}

async function main() {
  setupInput();
  loadSave();
  try {
    await loadData();
  } catch (e) {
    new Screen().line("Couldn't load the game files.", "warn").line(String(e.message || e), "hint").show();
    return;
  }
  let sel = 0;
  for (;;) {
    sel = await menu("TITLE", [{ label: "Levels" }, { label: "Achievements" }, { label: "Credits" }, { label: "Extras" }, { label: "Exit" }], "", sel);
    if (sel === 0) await chapterSelect();
    if (sel === 1) await achievementsScreen();
    if (sel === 2) await credits();
    if (sel === 3) await extras();
    if (sel === 4) { location.href = "../../#games"; return; }
  }
}

main();
