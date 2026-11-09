import type { Affinity, Skill } from './types';

// 로비가 쓰는 기술 표다. 방에 들어가기 전이라 서버의 기술 정의(rules.skills)가 아직 없으므로 여기에 적어 둔다.
// 서버 정의와 같은지는 hands.spec.ts가 첫 스냅샷의 rules.skills와 맞춰 본다.

// 장비 칸마다 고를 수 있는 기술이다. 앞의 세 칸은 그 종류의 기술 가운데 하나, 자유 칸은 아무 기술이나 고른다(서버의 Rules.ValidSlots).
export const kindSlots: { kind: Exclude<Affinity, 'none'>; title: string; beats: string; skills: Skill[] }[] = [
  { kind: 'strike', title: '타격 칸', beats: '잡기를 파훼', skills: ['strike', 'spin'] },
  { kind: 'block', title: '방어 칸', beats: '타격을 파훼', skills: ['parry', 'spinblock'] },
  { kind: 'channel', title: '잡기 칸', beats: '방어를 파훼', skills: ['grab', 'spingrab'] },
];
export const freeSkills: Skill[] = ['strike', 'parry', 'grab', 'spin', 'spinblock', 'spingrab'];
// 조준하지 않는 둘레 기술이다(서버 기술 정의의 around).
export const aroundSkills: Skill[] = ['spin', 'spinblock', 'spingrab'];
// 기술의 종류다. 종류 칸의 목록에서 찾는다. 종류 칸에 없는 기술(앞으로 넣을 상성 없는 기술 등)은 none이다.
// none이면 손 그림만 빠지고 로비는 그대로 뜬다.
export const kindOfSkill = (skill: Skill): Affinity => kindSlots.find(slot => slot.skills.includes(skill))?.kind ?? 'none';
