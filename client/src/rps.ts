import type { Affinity } from './types';

// 상성마다의 가위바위보 손 그림이다(2026-11-05 사용자 요청). 타격은 가위, 방어는 주먹, 잡기는 보다. 상성이 그대로 맞는다.
// 타격이 잡기를 이기는 것이 가위가 보를 이기는 것이고, 잡기가 방어를 이기는 것이 보가 주먹을, 방어가 타격을 이기는 것이
// 주먹이 가위를 이기는 것이다. 터치 기술 버튼, PC 기술 막대, 로비 장비 칸에 붙인다(11-09 사용자 결정).
export type Hand = 'scissors' | 'rock' | 'paper';
export const handOf = { strike: 'scissors', block: 'rock', channel: 'paper' } as const satisfies Record<Exclude<Affinity, 'none'>, Hand>;

// viewBox 24×24 좌표에 그린다. 손가락은 끝이 둥근 선, 손바닥은 둥근 사각형이다. fill·stroke가 currentColor라 놓인 자리의 상성 색
// (.skill-strike 등)을 그대로 쓴다. 이모지는 기기마다 모양과 색이 달라 상성 색으로 칠할 수 없어서 직접 그린다.
// 손가락 마디 사이와 엄지 둘레의 틈은 마스크로 뚫어 실제 바탕이 비치게 한다. 손 그림이 놓이는 바탕은 자리마다 다르고(고른 장비,
// 사용 중인 칸) 터치 버튼은 지도 위에 반투명하게 놓이므로, 정해 둔 바탕색으로 틈을 칠하면 검은 윤곽선처럼 보였다(PR #25 리뷰).
// 마스크는 흰 바탕에 틈 자리를 검게 칠한 것이라, 마스크를 씌운 몸통에서 검은 자리만 뚫린다. 틈 위에 다시 그리는 엄지는 마스크 밖에 그린다.
const cutOut = (id: string, gaps: string, body: string) =>
  `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${gaps}</mask>`
  + `<g mask="url(#${id})">${body}</g>`;
// 엄지(선)와 그 둘레의 틈이다. 틈은 엄지보다 굵은 같은 선이라 엄지 양옆으로 (틈 굵기 - 엄지 굵기) / 2만큼 바탕이 비친다.
const thumb = (d: string, width: number, gap: number) => ({
  gap: `<path d="${d}" stroke="#000" stroke-width="${gap}" stroke-linecap="round" fill="none"/>`,
  line: `<path d="${d}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" fill="none"/>`,
});
const scissorsThumb = thumb('M8.6 17.2 14.6 15.8', 2.4, 4.4);
const rockThumb = thumb('M7.2 15.2 13.4 13.6', 2.6, 4.6);
// 주먹의 접은 손가락 마디 넷이다. 마스크에는 마디마다 안을 희게, 테두리를 검게 차례로 칠한다. 뒤 마디의 안이 앞 마디의 테두리를
// 다시 희게 덮으므로, 마디 사이에는 뒤 마디의 테두리 하나만큼, 마디와 손바닥 사이에는 마디의 아래 테두리만큼 틈이 난다.
const knuckles = '<rect x="4.6" y="5.4" width="4" height="8.4" rx="2"/><rect x="8.2" y="4.4" width="4" height="9.2" rx="2"/>'
  + '<rect x="11.8" y="4.4" width="4" height="9.2" rx="2"/><rect x="15.4" y="5.6" width="3.8" height="8.2" rx="1.9"/>';
const shapes: Record<Hand, (id: string) => string> = {
  // 가위(✌): 쥔 손 위로 검지와 중지를 V자로 편다. 엄지는 쥔 손 앞을 가로지른다.
  scissors: id => cutOut(id, scissorsThumb.gap,
    '<path d="M10.4 13.6 7.6 3.4M13.8 13.6 16.8 3.6" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" fill="none"/>'
    + '<rect x="6.2" y="11.6" width="12.4" height="10.4" rx="4" fill="currentColor"/>') + scissorsThumb.line,
  // 주먹(✊): 위에 접은 손가락 마디 넷이 나란하고, 엄지가 그 앞을 가로지른다.
  rock: id => cutOut(id, `<g fill="#fff" stroke="#000" stroke-width="1.1">${knuckles}</g>${rockThumb.gap}`,
    `<g fill="currentColor"><rect x="5" y="9.5" width="14.4" height="12" rx="4.5"/>${knuckles}</g>`) + rockThumb.line,
  // 보(✋): 손바닥과 펼친 다섯 손가락이다. 틈이 없어 마스크도 없다.
  paper: () => '<rect x="7" y="11.5" width="10.5" height="10" rx="3.8" fill="currentColor"/>'
    + '<path d="M8.6 12.5 7 5.2M11.3 11.5 10.9 3.2M14.2 11.5 14.8 3.4M16.6 12.6 18.4 6M8.4 17.6 3.8 13.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
};

// 그림마다 마스크 id를 따로 붙인다. 여러 그림이 같은 id를 나눠 쓰면 모두 문서에서 처음 나온 정의를 따르는데, 그 그림이 숨은 화면
// (display:none)에 있으면 마스크가 그려지지 않는다. 로비와 작전 화면은 서로를 숨기므로 그런 일이 생긴다.
let drawn = 0;
// 그 상성의 손 그림이다. 상성이 없는 행동(none)에는 그림이 없다. 글로 된 이름이 곁에 있으므로 화면 낭독기에는 숨긴다.
export const handIcon = (kind: Affinity) => {
  if (kind === 'none') return '';
  const hand = handOf[kind];
  drawn += 1;
  return `<svg class="rps" data-hand="${hand}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapes[hand](`rps-cut-${drawn}`)}</svg>`;
};
