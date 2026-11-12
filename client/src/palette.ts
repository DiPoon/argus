import type { Affinity } from './types';

// 화면의 색이다. 메인 화면(world.ts)과 미니맵(minimap.ts)이 함께 쓴다. pixi를 불러오지 않는 모듈이라 검사도 이 값을 그대로 가져다 쓴다.

// 상성 색은 빛의 3원색이다. 타격 빨강, 방어 파랑, 잡기 초록이다(2026-11-05 사용자 요청, 11-08 사용자가 후보 중 골랐다).
// 캔버스는 CSS 변수를 읽지 못하므로 여기에 따로 둔다. CSS의 --strike·--block·--channel과 같은 값이어야 한다(world.spec.ts가 본다).
// 어두운 지도 바닥에 대한 대비가 정상 시각과 적색약·녹색약 흉내 모두에서 4.5 이상이다. 순수한 빨강(#ff3b30)은 적색약에게 어두운
// 올리브색으로 보여 타격 범위가 흐렸다(대비 3.1). 초록은 빨강과 밝기가 크게 다르도록 연하게 골라, 녹색약에게도 둘이 밝기로 갈린다.
export const affinityColors: Record<Affinity, number> = { strike: 0xff6b61, block: 0x4785ff, channel: 0xa6f9ba, none: 0xeabd73 };
// 지도와 목표의 색이다. spent는 부순 시설, waiting은 내가 다시 쓰기를 기다리는 보급 상자, outline은 몸과 손의 윤곽이다.
export const colors = {
  floor: 0x141e20, lit: 0x253335, grid: 0x304044, wall: 0x657372, edge: 0x94a29a, unknown: 0x0b1315,
  lime: 0xdfff80, teal: 0x77cec2, red: 0xf28068, gold: 0xeabd73, pink: 0xff8fd6,
  spent: 0x64706a, waiting: 0x829388, outline: 0x111a1a,
};
// 목표를 그리는 규칙이다. 메인 화면과 미니맵이 같은 규칙으로 그리도록 여기에 둔다. 한쪽만 바꾸면 두 화면이 말없이 달라진다.
// 탈출 구역의 반지름(월드 단위)이다. 서버가 탈출 지점에 있다고 보는 거리와 같다.
export const extractionRadius = 80;
// 남은 시설은 빨강, 부순 시설은 회색이다.
export const facilityColor = (facility: { hp: number }) => facility.hp > 0 ? colors.red : colors.spent;
// 회수한 부목표 상자와 다 쓴 상자(남은 횟수 0)는 그리지 않는다.
export const supplyShown = (supply: { collected: boolean; uses: number }) => !supply.collected && supply.uses > 0;
// 내가 기다리는 상자는 회색, 부목표 상자는 금색, 그 밖에는 청록이다.
export const supplyColor = (supply: { cooldown: number; objective: boolean }) => supply.cooldown > 0 ? colors.waiting : supply.objective ? colors.gold : colors.teal;
// 대원 색이다. 명단 차례대로 쓴다.
export const team = [colors.lime, colors.teal, 0xaeb5fa, 0xf2c981];
// 적의 tiers는 타격·방어·잡기 순서다. 엘리트의 몸 색은 그 엘리트가 쓰는 2티어 행동의 종류이고, 2티어 행동이 없으면 병사의 색이다.
const tierKinds: Affinity[] = ['strike', 'block', 'channel'];
export const bodyColor = (tiers: number[]) => {
  const index = tiers.indexOf(2);
  return index >= 0 ? affinityColors[tierKinds[index]] : 0xd2b49b;
};
