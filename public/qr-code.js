const VERSION = 4;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 80;
const ECC_CODEWORDS = 20;
const MAX_BYTES = 78;

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
let value = 1;
for (let index = 0; index < 255; index += 1) {
  gfExp[index] = value;
  gfLog[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) gfExp[index] = gfExp[index - 255];

function multiply(left, right) {
  return left === 0 || right === 0 ? 0 : gfExp[gfLog[left] + gfLog[right]];
}

function generator(degree) {
  let polynomial = [1];
  for (let power = 0; power < degree; power += 1) {
    const next = Array(polynomial.length + 1).fill(0);
    for (let index = 0; index < polynomial.length; index += 1) {
      next[index] ^= polynomial[index];
      next[index + 1] ^= multiply(polynomial[index], gfExp[power]);
    }
    polynomial = next;
  }
  return polynomial;
}

function errorCorrection(data) {
  const polynomial = generator(ECC_CODEWORDS);
  const remainder = Array(ECC_CODEWORDS).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let index = 0; index < ECC_CODEWORDS; index += 1) {
      remainder[index] ^= multiply(polynomial[index + 1], factor);
    }
  }
  return remainder;
}

function codewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > MAX_BYTES) throw new RangeError('QR payload is too long.');
  const bits = [];
  const addBits = (number, length) => {
    for (let offset = length - 1; offset >= 0; offset -= 1) bits.push((number >>> offset) & 1);
  };
  addBits(0b0100, 4);
  addBits(bytes.length, 8);
  bytes.forEach((byte) => addBits(byte, 8));
  addBits(0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    data.push(bits.slice(offset, offset + 8).reduce((total, bit) => (total << 1) | bit, 0));
  }
  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  return data.concat(errorCorrection(data));
}

function blankMatrix() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function fill(matrix, row, column, height, width, value) {
  for (let y = row; y < row + height; y += 1) {
    for (let x = column; x < column + width; x += 1) {
      if (y >= 0 && x >= 0 && y < SIZE && x < SIZE) matrix[y][x] = value;
    }
  }
}

function finder(matrix, row, column) {
  fill(matrix, row - 1, column - 1, 9, 9, false);
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      matrix[row + y][column + x] = y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
    }
  }
}

function alignment(matrix, row, column) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      matrix[row + y][column + x] = Math.abs(y) === 2 || Math.abs(x) === 2 || (x === 0 && y === 0);
    }
  }
}

function patterns(matrix) {
  finder(matrix, 0, 0);
  finder(matrix, SIZE - 7, 0);
  finder(matrix, 0, SIZE - 7);
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
    if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
  }
  alignment(matrix, 26, 26);
  const format = 0b111011111000100;
  for (let index = 0; index < 15; index += 1) {
    const bit = Boolean((format >>> index) & 1);
    if (index < 6) matrix[index][8] = bit;
    else if (index < 8) matrix[index + 1][8] = bit;
    else matrix[SIZE - 15 + index][8] = bit;
    if (index < 8) matrix[8][SIZE - index - 1] = bit;
    else if (index < 9) matrix[8][15 - index] = bit;
    else matrix[8][15 - index - 1] = bit;
  }
  matrix[SIZE - 8][8] = true;
}

export function qrMatrix(text) {
  const bytes = codewords(text);
  const bits = bytes.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  const matrix = blankMatrix();
  patterns(matrix);
  let bitIndex = 0;
  let upward = true;
  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const row = upward ? SIZE - 1 - offset : offset;
      for (let x = 0; x < 2; x += 1) {
        const target = column - x;
        if (matrix[row][target] !== null) continue;
        const raw = bits[bitIndex] || 0;
        matrix[row][target] = (raw === 1) !== ((row + target) % 2 === 0);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return matrix;
}

export function qrSvg(text, title = 'QR code') {
  const matrix = qrMatrix(text);
  const pixels = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) pixels.push('<rect x="' + x + '" y="' + y + '" width="1" height="1"/>');
  }));
  return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + title.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" viewBox="-4 -4 ' + (SIZE + 8) + ' ' + (SIZE + 8) + '" shape-rendering="crispEdges"><rect x="-4" y="-4" width="' + (SIZE + 8) + '" height="' + (SIZE + 8) + '" fill="white"/><g fill="black">' + pixels.join('') + '</g></svg>';
}
