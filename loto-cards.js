"use strict";
/* REDX Live Loto — 90-ball ticket helpers (shared by HTTP and WebSocket server). */
const crypto = require("crypto");

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function colOf(number) {
  return number === 90 ? 8 : Math.floor(number / 10);
}

function colRange(c) {
  return c === 8 ? [80, 90] : [c === 0 ? 1 : c * 10, c * 10 + 9];
}

/* Build a valid 3x9 90-ball ticket grid. Each row has 5 numbers,
   every column has 1-3 numbers and values stay in their decade. */
function makeTicket() {
  let rows = null;
  for (let attempt = 0; attempt < 500; attempt++) {
    const candidate = [0, 1, 2].map(() => shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5).sort((a, b) => a - b));
    const counts = Array.from({ length: 9 }, (_, c) => candidate.filter(r => r.includes(c)).length);
    if (counts.every(n => n >= 1 && n <= 3)) { rows = candidate; break; }
  }
  if (!rows) {
    rows = [
      [0, 1, 2, 3, 4],
      [2, 3, 4, 5, 6],
      [4, 5, 6, 7, 8],
    ];
  }

  const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
  for (let c = 0; c < 9; c++) {
    const owners = [0, 1, 2].filter(r => rows[r].includes(c));
    const [lo, hi] = colRange(c);
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    const picked = shuffle(pool).slice(0, owners.length).sort((a, b) => a - b);
    owners.forEach((r, i) => { grid[r][c] = picked[i]; });
  }

  const numbers = grid.flat().filter(n => n !== null).sort((a, b) => a - b);
  return { grid, numbers };
}

/* Rebuild the visual 3x9 grid from 15 stored numbers. */
function gridFromNumbers(numbers) {
  const nums = [...new Set((numbers || []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 90))];
  if (nums.length !== 15) return makeTicket().grid;

  const cols = Array.from({ length: 9 }, () => []);
  for (const n of nums) cols[colOf(n)].push(n);
  cols.forEach(list => list.sort((a, b) => a - b));
  if (cols[8].length > 3) return makeTicket().grid;

  const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
  const rowCount = [0, 0, 0];
  const order = [...Array(9).keys()].sort((a, b) => cols[b].length - cols[a].length);

  const combos = (length) => {
    const all = [];
    const pick = (start, cur) => {
      if (cur.length === length) { all.push(cur.slice()); return; }
      for (let r = start; r < 3; r++) { cur.push(r); pick(r + 1, cur); cur.pop(); }
    };
    pick(0, []);
    return all;
  };

  const place = (idx) => {
    if (idx === order.length) return rowCount.every(n => n === 5);
    const c = order[idx];
    const list = cols[c];
    if (!list.length) return place(idx + 1);
    for (const rows of combos(list.length)) {
      if (rows.some(r => rowCount[r] >= 5)) continue;
      rows.forEach((r, i) => { grid[r][c] = list[i]; rowCount[r]++; });
      if (place(idx + 1)) return true;
      rows.forEach(r => { grid[r][c] = null; rowCount[r]--; });
    }
    return false;
  };

  if (!place(0)) return makeTicket().grid;
  return grid;
}

function rowComplete(grid, marked) {
  return grid.map(row => row.filter(n => n !== null).every(n => marked.has(n)));
}

function ticketState(grid, markedSet) {
  const marked = markedSet instanceof Set ? markedSet : new Set(markedSet || []);
  const rows = rowComplete(grid, marked);
  const completeRows = rows.filter(Boolean).length;
  const total = grid.flat().filter(n => n !== null).length;
  const markedTotal = grid.flat().filter(n => n !== null && marked.has(n)).length;
  return {
    rows,
    completeRows,
    markedTotal,
    total,
    line: completeRows >= 1,
    two: completeRows >= 2,
    full: markedTotal === total && total === 15,
  };
}

module.exports = { makeTicket, gridFromNumbers, ticketState, colOf };
