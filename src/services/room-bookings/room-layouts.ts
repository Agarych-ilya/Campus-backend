/**
 * The database, not Flutter, owns the room geometry. These two layouts are
 * initial seeds; INSERT IGNORE protects later edits made in MySQL.
 * Keep seat identity {row,desk,seat} compatible with existing reservations.
 */
export type RoomSeatPosition = {
  row: number;
  desk: number;
  seat: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};
export type RoomElement = {
  id: string;
  type: 'rect' | 'line' | 'curve' | 'label' | 'outlet';
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  text?: string;
  color?: string;
  rotation?: number;
};
export type RoomLayout = {
  version: 1;
  room: string;
  university: string;
  building: string;
  name: string;
  description: string;
  width: number;
  height: number;
  seats: RoomSeatPosition[];
  elements: RoomElement[];
};

const arcOffset = (index: number, count: number): number => {
  const center = (count - 1) / 2;
  const n = (index - center) / center;
  return 24 * n * n;
};

export function makeInitialRoomLayouts(): RoomLayout[] {
  const mpei = 'НИУ «МЭИ»';
  const standard: RoomLayout = {
    version: 1,
    room: 'М-307',
    university: mpei,
    building: 'М',
    name: 'М-307',
    description: '3 вертикальных ряда · 9 двухместных парт',
    width: 525,
    height: 855,
    seats: [],
    elements: [
      {
        id: 'board', type: 'rect', x: 70, y: 15,
        width: 385, height: 45, text: 'Доска / преподаватель',
      },
    ],
  };
  for (let row = 1; row <= 3; row++) {
    standard.elements.push({
      id: `row-${row}`, type: 'label',
      x: 40 + (row - 1) * 164, y: 68, text: `Ряд ${row}`,
    });
    for (let desk = 1; desk <= 9; desk++) {
      const x = 79 + (row - 1) * 164;
      const y = 102 + (desk - 1) * 81;
      for (let seat = 1; seat <= 2; seat++) {
        standard.seats.push({
          row, desk, seat,
          x: x + (seat - 1) * 31,
          y, width: 27, height: 33,
        });
      }
      standard.elements.push({
        id: `desk-${row}-${desk}`, type: 'rect',
        x, y: y + 36, width: 58, height: 7,
      });
      standard.elements.push({
        id: `desk-label-${row}-${desk}`, type: 'label',
        x: x - 3, y: y + 46, text: `Парта ${desk}`,
      });
    }
  }
  for (const desk of [6, 8]) {
    standard.elements.push({
      id: `outlet-3-${desk}-2`, type: 'outlet',
      x: 79 + 2 * 164 + 70,
      y: 102 + (desk - 1) * 81 + 5,
      text: `Розетка справа от парты ${desk}, ряд 3`,
    });
  }

  const amphitheater: RoomLayout = {
    version: 1,
    room: 'В-308',
    university: mpei,
    building: 'В',
    name: 'В-308',
    description: 'Амфитеатр · 176 мест · центральный блок и боковые проходы',
    width: 830,
    height: 875,
    seats: [],
    elements: [
      { id: 'back', type: 'label', x: 278, y: 10,
        text: 'Задняя часть аудитории' },
      { id: 'left-title', type: 'label', x: 162, y: 38,
        text: 'Левая сторона' },
      { id: 'right-title', type: 'label', x: 505, y: 38,
        text: 'Правая сторона' },
      { id: 'upper-aisle', type: 'rect', x: 393, y: 91,
        width: 44, height: 265, color: 'aisle' },
      { id: 'lower-block', type: 'rect', x: 358, y: 356,
        width: 114, height: 400, color: 'block' },
      { id: 'board', type: 'rect', x: 175, y: 790,
        width: 480, height: 51, text: 'Экран / преподаватель' },
    ],
  };
  for (let row = 1; row <= 10; row++) {
    const count = row <= 4 ? 10 : 8;
    const top = 98 + (row - 1) * 63 + (row >= 5 ? 26 : 0);
    amphitheater.elements.push({
      id: `row-${row}`, type: 'label',
      x: 402, y: top + 9, text: String(11 - row),
      color: row <= 4 ? 'upper' : 'lower',
    });
    for (let side = 1; side <= 2; side++) {
      // Eight-place banks remain flush with the OUTER edge of ten-place banks.
      const start = side === 1 ? 90 : 438 + (10 - count) * 30;
      amphitheater.elements.push({
        id: `guide-${row}-${side}`, type: 'curve',
        x: start + 13.5, y: top + 41,
        cx: start + (count - 1) * 15 + 13.5,
        cy: top - 7,
        x2: start + (count - 1) * 30 + 13.5,
        y2: top + 41,
        color: row <= 4 ? 'upper' : 'lower',
      });
      for (let i = 0; i < count; i++) {
        amphitheater.seats.push({
          row,
          desk: side === 1 ? count - i : i + 1,
          seat: side,
          x: start + i * 30,
          y: top + arcOffset(i, count),
          width: 27,
          height: 34,
          rotation: ((i - (count - 1) / 2) / ((count - 1) / 2)) * 0.13,
        });
      }
    }
  }
  return [standard, amphitheater];
}
