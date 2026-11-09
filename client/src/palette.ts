import type { Affinity } from './types';

// 상성 색은 빛의 3원색이다. 타격 빨강, 방어 파랑, 잡기 초록이다(2026-11-05 사용자 요청, 11-08 사용자가 후보 중 골랐다).
// 캔버스(world.ts)는 CSS 변수를 읽지 못하므로 여기에 따로 둔다. CSS의 --strike·--block·--channel과 같은 값이어야 한다(world.spec.ts가 본다).
// pixi를 불러오지 않는 모듈이라 검사도 이 값을 그대로 가져다 쓴다. 어두운 지도 바닥에 대한 대비가 정상 시각과 적색약·녹색약
// 흉내 모두에서 4.5 이상이다. 순수한 빨강(#ff3b30)은 적색약에게 어두운 올리브색으로 보여 타격 범위가 흐렸다(대비 3.1).
// 초록은 빨강과 밝기가 크게 다르도록 연하게 골라, 녹색약에게도 둘이 밝기로 갈린다.
export const affinityColors: Record<Affinity, number> = { strike: 0xff6b61, block: 0x4785ff, channel: 0xa6f9ba, none: 0xeabd73 };
