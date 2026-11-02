// Level layout for Block 13. 1 grid cell = 1 meter. x → east, y(z) → south.
// Rooms are carved into a solid block; doors are placed in single wall cells.

export const W = 66, H = 43;

// zone definitions: floor/wall/ceiling style + ceiling height
export const ZONES = {
  L: { name: 'Intake', floor: 'linoleum', wall: 'paintLobby', ceil: 'ceiling', h: 3.0 },
  C: { name: 'Corridor', floor: 'linoleum', wall: 'paint', ceil: 'ceiling', h: 3.0 },
  W: { name: 'Ward C', floor: 'linoleum', wall: 'paintWard', ceil: 'ceiling', h: 3.0 },
  B: { name: 'Washroom', floor: 'floorTiles', wall: 'tiles', ceil: 'concreteCeil', h: 3.0 },
  H: { name: 'Hydrotherapy', floor: 'floorTiles', wall: 'tiles', ceil: 'concreteCeil', h: 4.4 },
  G: { name: 'Generator', floor: 'concrete', wall: 'cinder', ceil: 'concreteCeil', h: 4.2 },
  O: { name: 'Office', floor: 'linoleum', wall: 'paintLobby', ceil: 'ceiling', h: 3.0 },
  A: { name: 'Records', floor: 'concrete', wall: 'cinderRecords', ceil: 'concreteCeil', h: 3.6 },
  M: { name: 'Morgue', floor: 'floorTilesMorgue', wall: 'tilesMorgue', ceil: 'concreteCeil', h: 3.2 },
  P: { name: 'Pump Station', floor: 'concrete', wall: 'concreteWall', ceil: 'concreteCeil', h: 5.0 },
  E: { name: 'Freight Lift', floor: 'steelFloor', wall: 'steelWall', ceil: 'steelWall', h: 3.0 },
};

// rectangles: [zone, x0, y0, x1, y1] inclusive
export const ROOMS = [
  ['L', 1, 2, 14, 11],      // intake lobby
  ['L', 6, 1, 8, 1],        // service elevator alcove
  ['C', 6, 13, 8, 27],      // west corridor
  ['B', 1, 15, 4, 21],      // washroom
  ['W', 10, 15, 29, 25],    // ward C
  ['G', 24, 27, 24, 27],    // service passage ward → generator
  ['H', 1, 29, 17, 40],     // hydrotherapy
  ['G', 19, 28, 29, 40],    // generator hall
  ['C', 16, 3, 58, 6],      // east corridor (behind the gate)
  ['O', 18, 8, 28, 12],     // Dr. Varga's office
  ['A', 31, 8, 53, 22],     // records archive
  ['C', 55, 7, 58, 41],     // east service corridor
  ['C', 33, 38, 54, 41],    // south corridor
  ['M', 31, 24, 44, 36],    // morgue
  ['P', 46, 24, 53, 36],    // pump station
  ['E', 60, 16, 64, 21],    // freight lift car
];

// doors: [x, y, type, id]
// type: door (hinged), gate (powered roller), keycard (needs keycard), lift (freight doors), stuck (jammed shut, cosmetic)
export const DOORS = [
  [7, 12, 'door', 'lobby_west'],
  [5, 18, 'door', 'washroom'],
  [9, 17, 'door', 'ward_n'],
  [9, 23, 'door', 'ward_s'],
  [24, 26, 'door', 'ward_gen'],
  [7, 28, 'door', 'hydro'],
  [18, 34, 'door', 'hydro_gen'],
  [15, 4, 'gate', 'gate'], [15, 5, 'gate', 'gate'], [15, 6, 'gate', 'gate'],
  [22, 7, 'door', 'office'],
  [40, 7, 'door', 'archive_n'],
  [54, 15, 'door', 'archive_e'],
  [37, 23, 'door', 'archive_morgue'],
  [38, 37, 'door', 'morgue_s'],
  [54, 30, 'keycard', 'pump'],
  [59, 17, 'lift', 'lift'], [59, 18, 'lift', 'lift'], [59, 19, 'lift', 'lift'], [59, 20, 'lift', 'lift'],
];

export function buildGrid() {
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
  for (const [z, x0, y0, x1, y1] of ROOMS) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = z;
  }
  for (const [x, y] of DOORS) g[y][x] = 'D';
  return g;
}

export function doorZone(grid, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = grid[y + dy]?.[x + dx];
    if (c && c !== '#' && c !== 'D') return c;
  }
  return 'C';
}

// orientation of a door cell: 'x' means the door plane spans along x (passage runs along z)
export function doorAxis(grid, x, y) {
  const solidE = grid[y][x + 1] === '#', solidW = grid[y][x - 1] === '#';
  const solidN = grid[y - 1][x] === '#', solidS = grid[y + 1][x] === '#';
  if ((solidN || grid[y - 1][x] === 'D') && (solidS || grid[y + 1][x] === 'D') && !(solidE && solidW)) return 'z';
  return 'x';
}
