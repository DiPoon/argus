import type { Affinity } from './types';

// 상성마다의 가위바위보 손 그림이다(2026-11-05 사용자 요청). 타격은 가위, 방어는 주먹, 잡기는 보다. 상성이 그대로 맞는다.
// 타격이 잡기를 이기는 것이 가위가 보를 이기는 것이고, 잡기가 방어를 이기는 것이 보가 주먹을, 방어가 타격을 이기는 것이
// 주먹이 가위를 이기는 것이다. 터치 기술 버튼, PC 기술 막대, 로비 장비 칸에 붙인다(11-09 사용자 결정).
export type Hand = 'scissors' | 'rock' | 'paper';
export const handOf = { strike: 'scissors', block: 'rock', channel: 'paper' } as const satisfies Record<Exclude<Affinity, 'none'>, Hand>;

// 24칸 정사각형에 그린다. 손가락은 끝이 둥근 선, 손바닥은 둥근 사각형이다. fill·stroke가 currentColor라 놓인 자리의 상성 색
// (.skill-strike 등)을 그대로 쓴다. 이모지는 기기마다 모양과 색이 달라 상성 색으로 칠할 수 없어서 직접 그린다.
// 손가락 사이와 엄지의 틈은 바탕색 선(.rps .cut, style.css)으로 낸다.
const shapes: Record<Hand, string> = {
  // 가위(✌): 쥔 손 위로 검지와 중지를 V자로 편다. 엄지는 쥔 손 앞을 가로지른다.
  scissors: '<path d="M10.4 13.6 7.6 3.4M13.8 13.6 16.8 3.6" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" fill="none"/>'
    + '<rect x="6.2" y="11.6" width="12.4" height="10.4" rx="4" fill="currentColor"/>'
    + '<path class="cut" d="M8.6 17.2 14.6 15.8" stroke-width="4.4" stroke-linecap="round"/>'
    + '<path d="M8.6 17.2 14.6 15.8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  // 주먹(✊): 위에 접은 손가락 마디 넷이 나란하고, 엄지가 그 앞을 가로지른다.
  rock: '<rect x="5" y="9.5" width="14.4" height="12" rx="4.5" fill="currentColor"/>'
    + '<g class="cut" fill="currentColor" stroke-width="1.1">'
    + '<rect x="4.6" y="5.4" width="4" height="8.4" rx="2"/><rect x="8.2" y="4.4" width="4" height="9.2" rx="2"/>'
    + '<rect x="11.8" y="4.4" width="4" height="9.2" rx="2"/><rect x="15.4" y="5.6" width="3.8" height="8.2" rx="1.9"/></g>'
    + '<path class="cut" d="M7.2 15.2 13.4 13.6" stroke-width="4.6" stroke-linecap="round"/>'
    + '<path d="M7.2 15.2 13.4 13.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  // 보(✋): 손바닥과 펼친 다섯 손가락이다.
  paper: '<rect x="7" y="11.5" width="10.5" height="10" rx="3.8" fill="currentColor"/>'
    + '<path d="M8.6 12.5 7 5.2M11.3 11.5 10.9 3.2M14.2 11.5 14.8 3.4M16.6 12.6 18.4 6M8.4 17.6 3.8 13.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
};

// 그 상성의 손 그림이다. 상성이 없는 행동(none)에는 그림이 없다. 글로 된 이름이 곁에 있으므로 화면 낭독기에는 숨긴다.
export const handIcon = (kind: Affinity) => kind === 'none' ? ''
  : `<svg class="rps" data-hand="${handOf[kind]}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapes[handOf[kind]]}</svg>`;
