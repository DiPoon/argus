import './style.css';
import { tickMilliseconds } from './movement';
import { World } from './world';
import { handIcon } from './rps';
import { aroundSkills, freeSkills, kindOfSkill, kindSlots } from './loadout';
import { applyWallChanges, skillNames, type Affinity, type Guest, type Player, type Snapshot, type SnapshotWire, type Skill } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
const slotKeys = ['좌클릭 / 1', '우클릭 / 2', 'Space / 3', 'Q / 4'];
const skillNotes: Record<Skill, string> = {
  strike: '앞쪽 좁은 범위', parry: '앞쪽 방어 후 반격', grab: '앞쪽 한 명',
  spin: '둘레 모두 · 조준 없음', spinblock: '둘레 모두 · 조준 없음', spingrab: '둘레 모두 · 조준 없음',
};
// 자유 칸은 아무 종류의 기술이나 고르므로 기술마다 그 종류의 손 그림을 상성 색으로 붙인다(hand). 종류 칸은 이름표에 붙인다.
const skillChoice = (name: string, skill: Skill, checked: boolean, hand = false) => {
  const kind = kindOfSkill(skill);
  const mark = hand ? `<span class="skill-${kind}">${handIcon(kind)}</span>` : '';
  return `<label><input type="radio" name="${name}" value="${skill}" ${checked ? 'checked' : ''}/><span><b>${mark}${skillNames[skill]}</b><small>${skillNotes[skill]}</small></span></label>`;
};
// 기술 칸(터치 기술 버튼, PC 기술 막대)의 손 그림이다. 칸은 처음에 한 번 만들고, 손 그림은 종류가 바뀔 때만 다시 그린다.
// 작전 중에는 장비가 바뀌지 않는데 updateUi는 스냅샷마다 불린다.
const showHand = (holder: HTMLElement, kind: Affinity) => {
  if (holder.dataset.kind === kind) return;
  holder.dataset.kind = kind;
  holder.innerHTML = handIcon(kind);
};
const chosenSkill = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
// 손가락으로 조작하는 기기다. 작전 화면에 이동 조이스틱과 기술 버튼을 띄운다. 주소에 ?touch를 붙이면 PC에서도 띄운다.
const touchMode = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
document.body.classList.toggle('touch', touchMode);
// 터치 화면에서는 마우스가 아닌 포인터(손가락·펜)를 손가락처럼 다룬다. 지도에서 기술을 내지 않고 조준에도 쓰지 않는다.
// PC 화면에는 터치 조작이 없으므로, 터치스크린 노트북의 손가락은 마우스 구실을 한다.
const fingerLike = (event: PointerEvent) => touchMode && event.pointerType !== 'mouse';
// 터치 기기의 로비에서는 둘레 기술만 고른다. 손가락으로는 조준하면서 기술을 쓰기 어렵다(2026-11-03 휴대폰 시험).
// 화면에서 고를 수 있는 기술만 줄인다. 서버는 어느 기기에서 온 참가든 같은 규칙(Rules.ValidSlots)으로 받는다.
const offered = (skills: Skill[]) => touchMode ? skills.filter(skill => aroundSkills.includes(skill)) : skills;
// 명단에 보이는 장비다. 종류 칸은 기본 기술과 다르게 고른 것만 적고, 자유 칸은 늘 적는다.
const loadoutText = (slots: Skill[]) => [
  ...slots.slice(0, 3).filter((skill, index) => skill !== kindSlots[index].skills[0]).map(skill => skillNames[skill]),
  `자유 ${skillNames[slots[3]]}`,
].join(' · ');

// 장비 칸 고르기다. PC 로비와 터치 로비가 같은 입력(이름 slot-1~3, free-slot)을 쓴다.
// 터치 로비의 종류 칸은 고를 기술이 하나뿐이라 처음부터 골라 둔다.
const loadoutFields = `${kindSlots.map((slot, index) => `<fieldset class="equipment-options kind-slot skill-${slot.kind}"><legend class="field-label"><strong><kbd>${index + 1}</kbd>${handIcon(slot.kind)}${slot.title}</strong><span>${slot.beats}</span></legend>
        ${offered(slot.skills).map((skill, choice) => skillChoice(`slot-${index + 1}`, skill, choice === 0)).join('')}
      </fieldset>`).join('')}
      <fieldset class="equipment-options primary-weapons"><legend class="field-label">4번 자유 칸 <span>${touchMode ? '둘레 기술 하나 더' : '아무 기술이나 하나 더 · Q 또는 4'}</span></legend>
        ${offered(freeSkills).map((skill, choice) => skillChoice('free-slot', skill, choice === 0, true)).join('')}
      </fieldset>`;
const desktopLobby = `  <main id="lobby" class="lobby">
    <section class="briefing">
      <div class="eyebrow"><span class="dash"></span> OPERATION 001</div>
      <h1>침묵의<br><span>전초기지.</span></h1>
      <p class="lead">적의 예고를 읽고, 동료와 함께 파훼하세요.<br>타격 · 받아치기 · 잡기. 거리를 맞추는 근접 전투.</p>
      <div class="brief-map" aria-hidden="true">
        <svg viewBox="0 0 540 240"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#2a3738" stroke-width="1"/></pattern></defs>
          <rect width="540" height="240" fill="url(#grid)"/><path d="M210 40h235v55m0 45v60H210v-70m0-45V40 M290 90h45v30 M355 150h40" stroke="#75827a" stroke-width="10" fill="none"/>
          <path d="M70 130h175l35-40 90 65-45 45" stroke="#cfe78b" stroke-width="1.5" stroke-dasharray="5 6" fill="none"/>
          <circle cx="70" cy="130" r="31" fill="#dfff80" fill-opacity=".06" stroke="#dfff80" stroke-opacity=".4"/><path d="M61 130h18m-9-9v18" stroke="#dfff80" stroke-width="2"/>
          <g fill="#1b2729" stroke="#ed8d74" stroke-width="2"><rect x="269" y="62" width="22" height="22"/><rect x="364" y="102" width="22" height="22"/><rect x="300" y="162" width="22" height="22"/></g>
          <text x="40" y="189" fill="#9cac9f" font-size="10" font-family="monospace">CAMP</text><text x="357" y="228" fill="#9cac9f" font-size="10" font-family="monospace">SECTOR / 07</text>
        </svg>
        <span class="map-caption">작전 개요도 <span>적 위치 정보 없음</span></span>
      </div>
      <div class="mission-steps"><div><b>01</b><span>적 시설 파괴</span></div><div><b>02</b><span>보급품 회수</span></div><div><b>03</b><span>탈출 지점 확보</span></div></div>
    </section>
    <section class="loadout-panel">
      <div class="eyebrow">DEPLOYMENT PREP</div><h2>분대에 합류하세요</h2><p class="muted">혼자 시작해도, 작전 중 함께해도 됩니다.</p>
      <label class="field-label" for="callsign">호출명 <span>가입 없이 게스트로 참가</span></label>
      <input id="callsign" maxlength="16" autocomplete="nickname" placeholder="대원 이름" value="대원" />
      ${loadoutFields}
      <p class="combat-intro">투입 마나 <b>0</b> · 보급 상자에서 충전 · 기술마다 마나 <b>1</b><br>자연 회복 없음. 빗나가도 마나를 소비합니다.<br>둘레 기술은 조준 없이 둘레 모두에 닿습니다. 기술은 한 번에 하나씩 사용합니다.</p>
      <button id="create" class="primary">새 작전 시작 <span>↗</span></button>
      <div class="or"><span></span> 초대받았다면 <span></span></div>
      <div class="join-row"><input id="room-input" aria-label="방 코드" placeholder="6자리 방 코드" maxlength="6" autocomplete="off"/><button id="join" class="secondary">참가</button></div>
      <p id="lobby-error" class="error" role="alert"></p>
      <p class="entry-note"><span>◌</span> 투입 준비 5초 · 아군 피해 없음 · 전원 사망 시 실패</p>
    </section>
    <footer class="lobby-footer"><span>4명까지 함께하는 협동 전투</span><span>PC 브라우저 · 키보드 + 마우스</span></footer>
  </main>`;
// 터치 기기의 로비다. 휴대폰 가로 화면 한 장에 들어오도록 왼쪽에 참가, 오른쪽에 장비 칸만 둔다. 입력의 id는 PC 로비와 같다.
// 장비 칸 위의 한 줄이 둘레 기술만 고르는 까닭을 알린다.
const touchLobby = `<main id="lobby" class="lobby touch-lobby">
    <section class="loadout-panel">
      <div class="touch-entry">
        <div class="eyebrow">ARGUS · 협동 전투</div>
        <label class="field-label" for="callsign">호출명 <span>게스트로 참가</span></label>
        <input id="callsign" maxlength="16" autocomplete="nickname" placeholder="대원 이름" value="대원" />
        <button id="create" class="primary">새 작전 시작 <span>↗</span></button>
        <div class="join-row"><input id="room-input" aria-label="방 코드" placeholder="방 코드" maxlength="6" autocomplete="off"/><button id="join" class="secondary">참가</button></div>
        <p id="lobby-error" class="error" role="alert"></p>
        <button id="lobby-full" type="button" class="touch-button">전체 화면</button>
      </div>
      <div class="touch-gear"><p class="touch-gear-note">휴대폰에서는 조준 없이 둘레 모두에 닿는 <b>둘레 기술</b>을 씁니다. 버튼만 누르면 됩니다.</p>${loadoutFields}
        <p class="combat-intro touch-intro">투입 마나 <b>0</b> · 보급 상자에서 충전 · 기술마다 마나 <b>1</b> · 자연 회복 없음<br>투입 준비 5초 · 아군 피해 없음 · 전원 사망 시 실패</p></div>
    </section>
  </main>`;
// 투입 위치를 고르는 동작이다. 터치 기기에서는 손가락으로 누른다.
const pick = touchMode ? '누르세요' : '클릭하세요';
// FIELD NOTES에 적은 피해 값(부분 대응 1·1, 비김 2·1)은 합의한 규칙(docs/combat.md)의 값이다.
// 서버는 부분 대응 피해 값을 보내지 않으므로, 규칙을 바꾸면 이 문구도 함께 고친다.
// 지도 위쪽의 메뉴 버튼·체력과 마나·경과 시간(.top-row)과 그 아래 알림을 .top-stack으로 묶는다. PC에서는 묶음이 없는 것처럼
// 각자 제자리에 그리고, 터치 화면에서는 한 줄에 차례로 이어 붙인다(style.css의 터치 조작 절).
$('app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="ARGUS 홈"><span class="brand-mark">△</span> ARGUS <span class="version">COMBAT TEST / 02</span></a>
    <div class="top-right"><span id="connection" class="connection"><i></i> 투입 대기</span><span class="build-tag">CO-OP PVE · 1–4</span></div>
  </header>
${touchMode ? touchLobby : desktopLobby}
  <main id="operation" class="operation" hidden>
    <aside class="sidebar">
      <div class="eyebrow">OPERATION 001</div><h2>침묵의 전초기지</h2>
      <button id="copy-code" class="room-code" title="친구에게 방 코드를 공유하세요"><span>초대 코드</span><b id="room-code">------</b><span>⧉</span></button>
      <div class="side-section"><div class="section-label">MISSION <span id="mission-state">준비 중</span></div>
        <div class="objective"><span class="objective-icon primary-dot">◇</span><div><b>적 시설 파괴</b><small>구역 내 시설을 모두 무력화</small></div><strong id="primary-count">0/3</strong></div>
        <div id="facility-list" class="facility-list"></div>
        <div class="objective"><span class="objective-icon gold">◇</span><div><b>보급품 회수</b><small>부목표 · 가까이 가서 회수</small></div><strong id="secondary-count">0/2</strong></div>
        <div class="objective"><span class="objective-icon teal">↑</span><div><b>탈출 지점 확보</b><small id="extract-note">주목표 완료 후 활성화</small></div></div>
        <div class="progress"><i id="extract-progress"></i></div>
      </div>
      <div class="side-section"><div class="section-label">SQUAD <span id="team-count">1 / 4</span></div><div id="roster"></div></div>
      <div class="side-bottom"><div class="section-label">FIELD NOTES</div><p>밝은 구역은 분대의 공유 시야입니다. 어두운 곳에도 적이 있을 수 있습니다.</p><p class="combat-legend"><span class="skill-strike">타격</span>은 잡기를 이깁니다.<br><span class="skill-block">방어</span>는 타격을 이깁니다.<br><span class="skill-channel">잡기</span>는 방어를 이깁니다.</p><p>Ⅱ(대응 2)로 표시된 엘리트 행동은 이기는 기술이 둘 겹쳐야 파훼됩니다. 혼자 이기는 기술을 맞히면 나와 엘리트가 1씩 잃고, 같은 기술로 맞서면 나는 2, 엘리트는 1을 잃습니다. 동료와 맞추세요. 타격 예고가 끝날 무렵 받아치세요. 너무 일찍 쓰면 방어가 먼저 끝납니다.</p><button id="report" class="text-button">버그 제보 ↗</button><button id="leave" class="text-button">작전에서 나가기 ↗</button><form id="report-note" class="report-note" hidden><label for="report-text">무엇이 이상했나요? 비워 둬도 제보는 남았습니다.</label><input id="report-text" maxlength="200" autocomplete="off" placeholder="예: 적이 벽을 지나갔어요"><div class="report-actions"><button type="submit" class="secondary">덧붙이기</button><button type="button" id="report-close" class="text-button">닫기</button></div></form></div>
    </aside>
    <section id="battlefield" class="battlefield" aria-label="작전 지도">
      <div id="canvas-host" class="canvas-host"></div>
      <div class="top-stack"><div class="top-row">
        <div class="touch-top"><div class="touch-buttons"><button id="touch-menu" type="button" class="touch-button">☰ 메뉴</button><button id="touch-map" type="button" class="touch-button">지도</button><button id="touch-full" type="button" class="touch-button">전체 화면</button></div><span id="touch-mission" class="mission-mini"></span></div>
        <div id="combat-hud" class="combat-hud" hidden>
          <div class="vitals"><div><span id="my-name">대원</span><b id="hp">6</b><small id="max-hp">/ 6 HP</small><div class="health-bar"><i id="health-fill"></i></div></div>
          <div><span>마나</span><b id="mana">0</b><small id="max-mana">/ 24</small><div class="mana-bar"><i id="mana-fill"></i></div></div></div>
          <div class="skill-bar" id="skill-bar">${slotKeys.map((key, index) => `<div class="skill-slot" data-slot="${index + 1}"><kbd>${key}</kbd><b><span class="hand"></span><span class="name"></span></b><small></small><i></i></div>`).join('')}</div><p id="combat-status" aria-live="polite"></p>
        </div>
        <div class="map-top"><span class="map-title"><i></i><span id="view-label">전술 지도 / 투입 위치 선택</span></span><div class="timers"><span id="mission-mini" class="mission-mini"></span><span>경과 <b id="elapsed">00:00</b></span></div><span id="touch-extract" class="mission-mini touch-extract"></span></div>
      </div><div id="toast" class="toast" role="status" hidden></div></div>
      <div id="deploy-panel" class="deploy-panel"><div><span class="eyebrow" id="deploy-kicker">READY TO DEPLOY</span><h3 id="deploy-title">투입할 위치를 선택하세요</h3><p id="deploy-description">분대가 본 곳의 빈 지면을 ${pick}. 선택 전에는 계속 대기합니다.</p></div><div class="deploy-actions"><button id="camp" class="secondary">캠프 선택</button><button id="deploy" class="primary" disabled>위치 선택 필요</button></div></div>
      <div id="touch-controls" class="touch-controls" hidden>
        <div id="touch-move" class="touch-move" aria-label="이동"><i id="touch-base" class="touch-base" hidden><b id="touch-knob" class="touch-knob"></b></i></div>
        ${slotKeys.map((_, index) => `<button type="button" class="touch-skill" data-slot="${index + 1}"><span class="hand"></span><b></b><small></small></button>`).join('')}
      </div>
      <div class="map-bottom"><span id="controls">클릭 위치 선택 · 캠프는 권장 투입 지점</span><span id="performance">공유 시야</span></div>
      <div id="result" class="result-overlay" hidden><div class="result-card"><span class="eyebrow">OPERATION COMPLETE</span><h2 id="result-title">작전 종료</h2><p id="result-description"></p><div id="result-stats"></div><button id="again" class="primary">다음 작전 준비 <span>↗</span></button></div></div>
    </section>
  </main>`;

// 터치 화면의 서랍과 작전 종료 카드는 지도 위쪽 줄과 알림 아래에서 시작한다. 그 높이는 화면 폭과 글자와 알림 수에 달려 있어 px로 정하지 않고 재서 쓴다.
if (touchMode) {
  const topStack = document.querySelector('.top-stack')!;
  new ResizeObserver(() => document.body.style.setProperty('--top-stack', `${topStack.getBoundingClientRect().bottom}px`)).observe(topStack);
} else {
  // PC 화면의 알림은 경과 시간 상자 아래에 둔다. 좁은 창에서는 상자 안에서 줄이 바뀌어 키가 달라지므로 아래 끝을 재서 쓴다(style.css의 .toast).
  const mapTop = document.querySelector<HTMLElement>('.map-top')!;
  new ResizeObserver(() => document.body.style.setProperty('--map-top', `${mapTop.offsetTop + mapTop.offsetHeight}px`)).observe(mapTop);
}

let guest: Guest | undefined;
let snapshot: Snapshot | undefined;
let socket: WebSocket | undefined;
let world: World | undefined;
let connecting = false;
let reconnectTimer = 0;
let sequence = 0;
let ping = 0;
const mouseButtons = new Set<number>();
// 마지막으로 띄운 안내의 순번이다. 0이면 이 방에서 아직 띄운 안내가 없다.
let lastNotice = 0;
// 내용을 덧붙일 버그 제보의 틱이다. 입력란을 닫으면 비운다.
let reportTick: number | null = null;
let toastTimer = 0;
// 알림 줄마다 3.5초 동안 보이고 최대 세 줄까지 쌓인다. 안내가 몰려 와도 앞의 것이 곧바로 지워지지 않는다.
const toastLines: { text: string; until: number }[] = [];
// 투입 요청을 보내고 서버의 답(투입 중 상태나 오류 안내)을 기다리는 중이다. 그동안 투입 버튼을 막아 두 번 보내지 않는다.
let deployRequested = false;
const keys = new Set<string>();
let mouse = { x: 0, y: 0, known: false };
// 동시에 눌린 슬롯 중 가장 나중에 누른 것이 나가도록 누름 순서를 유지한다.
const slotOrder: number[] = [];
// 다시 눌러야 하는 키(staleKeys)는 쥐고 있어도 누른 것으로 치지 않는다. 같은 슬롯의 다른 입력을
// 새로 눌렀다 떼었을 때 쥐고 있던 키로 기술이 이어지지 않게 한다.
const keyHeld = (code: string) => keys.has(code) && !staleKeys.has(code);
// 터치 조작의 상태다. x·y는 조이스틱이 가리키는 이동 방향(길이 1), aim은 마지막으로 움직인 방향,
// pointers는 기술 버튼을 누르고 있는 손가락(포인터 id → 슬롯)이다. 한 버튼을 두 손가락으로 누르면 둘 다 떼어야 뗀 것이다.
const touch = { x: 0, y: 0, aim: 0, aimKnown: false, pointers: new Map<number, number>() };
const touchedSlots = () => new Set(touch.pointers.values());
function slotHeld(slot: number) {
  if (touchedSlots().has(slot)) return true;
  if (slot === 1) return mouseButtons.has(0) || keyHeld('Digit1');
  if (slot === 2) return mouseButtons.has(2) || keyHeld('Digit2');
  if (slot === 3) return keyHeld('Space') || keyHeld('Digit3');
  return keyHeld('KeyQ') || keyHeld('Digit4');
}
function slotFromCode(code: string) {
  if (code === 'Digit1') return 1;
  if (code === 'Digit2') return 2;
  if (code === 'Space' || code === 'Digit3') return 3;
  if (code === 'KeyQ' || code === 'Digit4') return 4;
  return 0;
}
// 마지막으로 입력을 보낸 뒤에 누른 슬롯이다(가장 나중에 누른 것). 다음 입력을 보내기 전에 떼었어도 그 입력의 press로 한 번은 보낸다.
// 입력은 1/30초마다 보내므로, 그 사이에 눌렀다 뗀 짧은 누름이나 브라우저가 잠깐 멈춘 사이의 누름이 빠지지 않게 한다(2026-11-05 휴대폰 시험).
let pressedSinceSend = 0;
function pressSlot(slot: number) {
  const index = slotOrder.indexOf(slot);
  if (index >= 0) slotOrder.splice(index, 1);
  slotOrder.push(slot);
  pressedSinceSend = slot;
}
// 살아 있지 않을 때 누른 기술 키와, 살아 있는 상태를 벗어날 때 눌려 있던 기술 키다. 떼었다 다시 눌러야 기술이 나간다.
// 그대로 두면 투입을 기다리며 쥔 키가 착지 뒤 마나가 차는 순간부터 기술을 계속 낸다.
const staleKeys = new Set<string>();
// 사망 등으로 살아 있는 상태를 벗어날 때 부른다. 마우스는 syncButtons가 새로 눌린 버튼만 받으므로 비우기만 하면 된다.
function releaseSkills() {
  mouseButtons.clear(); slotOrder.length = 0; pressedSinceSend = 0; releaseTouchSkills();
  for (const code of keys) if (slotFromCode(code) > 0) staleKeys.add(code);
}
// 버튼을 겹쳐 누르거나 뗄 때 브라우저는 pointerdown·pointerup 대신 pointermove로만 알린다.
// 그래서 세 이벤트 모두에서 event.buttons(지금 눌린 버튼 비트)로 상태를 다시 맞춘다.
// 직전 이벤트와 비교해 새로 눌린 버튼만 누름으로 본다. 투입 클릭을 쥔 채 살아난 순간 타격이 나가지 않게 한다.
let pointerButtons = 0;
// 입력을 비운 뒤(창을 다녀왔을 때 등) 처음 받은 pointermove·pointerup의 버튼은 비우기 전부터 쥐고 있던 것이다.
// 새 누름으로 치지 않고 기준값으로만 받는다. 0으로 비우면 쥐고 있던 버튼이 돌아온 뒤 첫 움직임에서 새로 누른 것으로
// 보여 기술이 나간다. pointerdown은 아무 버튼도 누르지 않은 상태에서만 오므로(fresh) 그대로 새 누름으로 본다.
let pointerBaseline = false;
function syncButtons(buttons: number, allowPress: boolean, fresh = false) {
  if (pointerBaseline) {
    pointerBaseline = false;
    if (!fresh) { pointerButtons = buttons; return; }
    pointerButtons = 0;
  }
  for (const [button, bit, slot] of [[0, 1, 1], [2, 2, 2]] as const) {
    const pressed = (buttons & bit) !== 0 && (pointerButtons & bit) === 0;
    if (pressed && allowPress && !mouseButtons.has(button)) { mouseButtons.add(button); pressSlot(slot); }
    if ((buttons & bit) === 0) mouseButtons.delete(button);
  }
  pointerButtons = buttons;
}

function me(): Player | undefined { return snapshot?.players.find(p => p.id === snapshot?.you); }
function send(value: object) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(value));
  return true;
}
// 입력을 보내고, 서버가 확인할 때까지 화면 예측에 쓰도록 기록한다. 실제로 보낸 입력만 기록한다.
function sendInput(x: number, y: number, aim: number, slot: number, press = 0) {
  const seq = sequence++;
  if (send({ type: 'input', seq, moveX: x, moveY: y, aim, slot, press })) world?.recordInput(seq, x, y);
}
function status(text: string, connected = false) { $('connection').innerHTML = `<i class="${connected ? 'online' : ''}"></i> ${escape(text)}`; }
function toast(text: string, merge = true) {
  const now = performance.now();
  const last = toastLines.at(-1);
  // 빈 곳을 여러 번 누르는 것처럼 같은 말을 거듭 띄우면 줄을 늘리지 않고 시간만 늘린다. 안내는 순번이 달라 따로 띄운다.
  if (merge && last?.text === text) last.until = now + 3500;
  else toastLines.push({ text, until: now + 3500 });
  if (toastLines.length > 3) toastLines.splice(0, toastLines.length - 3);
  renderToast();
}
function renderToast() {
  const now = performance.now();
  for (let i = toastLines.length - 1; i >= 0; i--) if (toastLines[i].until <= now) toastLines.splice(i, 1);
  const box = $('toast');
  box.replaceChildren(...toastLines.map(line => Object.assign(document.createElement('div'), { textContent: line.text })));
  box.hidden = toastLines.length === 0;
  window.clearTimeout(toastTimer);
  if (toastLines.length > 0) toastTimer = window.setTimeout(renderToast, Math.min(...toastLines.map(line => line.until)) - now);
}
function clearInput() {
  keys.clear(); mouseButtons.clear(); pressedSinceSend = 0; pointerBaseline = true;
  // 조이스틱과 기술 버튼을 쥔 손가락은 비우지 않는다. 포인터를 잡아 두므로 뗀 것은 늘 알 수 있다.
  // 비우면 움직이지 않는 손가락은 새 이벤트가 오지 않아 되살릴 길이 없다. 쥐고 있던 키는 자동 반복으로 되살아난다.
  slotOrder.splice(0, slotOrder.length, ...touchedSlots());
  if (world) world.control = { x: 0, y: 0, aim: world.control.aim, slot: 0 };
  // 서버는 작전 중 살아 있는 대원의 입력만 받는다. 30Hz 입력과 같은 조건일 때만 멈춤 입력을 보낸다.
  if (me()?.state === 'alive' && snapshot?.phase === 'active') sendInput(0, 0, world?.control.aim ?? 0, 0);
}

async function enter(code?: string) {
  if (connecting) return;
  const inputCode = code?.trim().toUpperCase();
  if (inputCode !== undefined && !/^[A-Z2-9]{6}$/.test(inputCode)) { $('lobby-error').textContent = '6자리 방 코드를 입력하세요.'; return; }
  // 전체 화면은 누름 안에서만 켤 수 있으므로 서버의 답을 기다리기 전에 켠다.
  if (touchMode) enterFullscreen();
  connecting = true;
  $('lobby-error').textContent = '';
  $<HTMLButtonElement>('create').disabled = $<HTMLButtonElement>('join').disabled = true;
  try {
    const response = await fetch(inputCode ? `/api/rooms/${inputCode}/join` : '/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $<HTMLInputElement>('callsign').value || '대원',
        slots: [chosenSkill('slot-1'), chosenSkill('slot-2'), chosenSkill('slot-3'), chosenSkill('free-slot')],
      }),
    });
    if (!response.ok) {
      const message = await response.json().catch(() => null);
      throw new Error(message?.error ?? '잠시 뒤 다시 참가해 주세요.');
    }
    guest = await response.json() as Guest;
    sessionStorage.setItem('argus-guest', JSON.stringify(guest));
    await openOperation();
  } catch (error) { $('lobby-error').textContent = error instanceof Error ? error.message : '서버에 연결할 수 없습니다.'; }
  finally { connecting = false; $<HTMLButtonElement>('create').disabled = $<HTMLButtonElement>('join').disabled = false; }
}

async function openOperation() {
  $('lobby').hidden = true; $('operation').hidden = false; document.body.classList.add('operating');
  // 당겨서 새로고침을 막는 규칙은 html에 있어야 한다(style.css). :has()를 쓰지 않으려고 html에도 붙인다.
  document.documentElement.classList.toggle('touch-operating', touchMode);
  if (!world) {
    try { world = new World(); await world.init($('canvas-host')); }
    catch { world = undefined; leave(); $('lobby-error').textContent = '그래픽 초기화에 실패했습니다. 브라우저의 하드웨어 가속을 확인해 주세요.'; return; }
    const canvas = world.app.canvas;
    canvas.addEventListener('pointermove', event => {
      // 손가락은 조준에 쓰지 않는다. 손가락이 지나간 자리를 조준으로 치면 기술 버튼을 누를 때마다 방향이 튄다.
      if (fingerLike(event)) return;
      mouse = { x: event.clientX, y: event.clientY, known: true };
      syncButtons(event.buttons, me()?.state === 'alive');
    });
    canvas.addEventListener('pointerdown', event => {
      if (!world || (event.button !== 0 && event.button !== 2)) return;
      // 손가락은 투입 위치 고르기에만 쓴다. 기술은 화면의 기술 버튼으로 쓴다.
      // 손가락은 마우스 버튼 상태(syncButtons)에 넣지 않는다. 다른 포인터 이벤트도 손가락은 건너뛰므로, 넣으면 뗀 것을 맞추지 못한다.
      const touched = fingerLike(event);
      if (touched && me()?.state !== 'waiting') return;
      if (!touched) mouse = { x: event.clientX, y: event.clientY, known: true };
      if (event.button === 0 && me()?.state === 'waiting' && snapshot?.phase !== 'ended') {
        const point = world.screenToWorld(event.clientX, event.clientY);
        if (!touched) syncButtons(event.buttons, false, true);
        // 서버처럼 분대가 본 칸의 빈 지면에만 투입한다.
        const check = world.deployCheck(point);
        if (check === 'unseen') { toast('아직 보지 못한 곳에는 투입할 수 없습니다.'); return; }
        if (check === 'blocked') { toast('벽을 피해 빈 지면을 선택하세요.'); return; }
        world.landing = point; updateUi();
      } else { syncButtons(event.buttons, me()?.state === 'alive', true); }
    });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
  }
  // 로비에 있는 동안 창이나 화면 방향이 바뀌면, Pixi는 숨은 작전 화면의 크기를 0으로 읽고 예전 캔버스 크기를 그대로 둔다. 보인 뒤에 다시 맞춘다.
  world.app.resize();
  world.app.ticker.start();
  connect();
}

function connect() {
  if (!guest) return;
  window.clearTimeout(reconnectTimer);
  status('연결 중');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket = ws;
  ws.addEventListener('open', () => { ws.send(JSON.stringify({ type: 'hello', room: guest!.room, token: guest!.token })); });
  ws.addEventListener('message', event => {
    if (socket !== ws) return;
    const message = JSON.parse(event.data);
    if (message.type === 'pong') { ping = Math.round(performance.now() - message.sent); return; }
    if (message.type === 'error') { deployRequested = false; toast(message.message); updateUi(); return; }
    // 서버가 제보를 이 방의 기록에 남겼다. 방 코드와 틱을 알려 주면 그 순간을 그대로 다시 돌려 볼 수 있다.
    // 내용을 적을 입력란을 연다. 싸우는 중일 수 있으므로 키보드를 빼앗지 않도록 입력란으로 커서를 옮기지는 않는다.
    if (message.type === 'reported') {
      toast(`제보를 남겼습니다 · 방 ${guest?.room ?? ''} · ${message.tick}틱`, false);
      reportTick = message.tick;
      $('report-note').hidden = false;
      return;
    }
    if (message.type === 'reportNoted') { toast('제보에 내용을 덧붙였습니다.', false); return; }
    if (message.type !== 'snapshot') return;
    if (message.version !== 5) { leave(); $('lobby-error').textContent = '서버와 클라이언트 버전이 다릅니다. 새로고침 후 다시 접속하세요.'; return; }
    // 벽은 바뀔 때만, 규칙과 맵은 접속 직후에만 온다. 빠진 값은 같은 방의 이전 스냅샷에서 이어 쓴다.
    const wire = message as SnapshotWire;
    const previous = snapshot?.room === wire.room ? snapshot : undefined;
    // 벽은 전체가 오거나, 받은 배열에서 바뀐 칸만 온다. 바뀐 칸은 같은 방의 이전 배열에 적용한다.
    let walls = wire.walls ?? previous?.walls;
    if (!wire.walls && wire.wallChanges && walls !== undefined) walls = applyWallChanges(walls, wire.wallChanges);
    const rules = wire.rules ?? previous?.rules, map = wire.map ?? previous?.map;
    // 서버는 실제로 보낼 때까지 다시 담으므로 처음 받은 스냅샷에는 모두 있다. 그래도 빠졌으면 다음 것을 기다린다.
    if (walls === undefined || rules === undefined || map === undefined) return;
    const wasAlive = me()?.state === 'alive';
    const wasEnded = previous?.phase === 'ended';
    snapshot = { ...wire, walls, rules, map };
    if (me()?.state !== 'waiting') deployRequested = false;
    // 서랍을 연 채 쓰러지거나 작전이 끝나면 서랍을 닫는다. 서랍이 투입 버튼이나 다음 작전 버튼을 덮으면 플레이어가 알아채기 어렵다.
    if (wasAlive && me()?.state !== 'alive') { releaseSkills(); closeMenu(); }
    // 작전이 끝나는 순간 한 번만 입력을 비운다. 끝난 뒤의 스냅샷마다 비울 필요는 없다.
    if (!wasEnded && snapshot.phase === 'ended') { clearInput(); closeMenu(); }
    sequence = Math.max(sequence, (me()?.ack ?? -1) + 1);
    status('분대 연결됨', true);
    world!.update(snapshot);
    updateUi();
    // 순번이 마지막으로 띄운 것보다 큰 안내를 모두 띄운다. 한 방송에 여러 개가 와도, 같은 틱에 같은 문구가 와도 빠뜨리지 않는다.
    // 방에 들어온 직후에는 지난 안내가 최대 여섯 개 함께 오므로 가장 최근 것만 띄운다.
    const fresh = snapshot.notices.filter(notice => notice.id > lastNotice);
    if (fresh.length > 0) {
      for (const notice of lastNotice === 0 ? fresh.slice(-1) : fresh) toast(notice.text, false);
      lastNotice = fresh[fresh.length - 1].id;
    }
  });
  ws.addEventListener('close', event => {
    if (socket !== ws || !guest) return;
    deployRequested = false;
    clearInput();
    if (event.code === 1008) { leave(); $('lobby-error').textContent = '참가 정보가 만료되었습니다. 새 작전에 참가해 주세요.'; return; }
    if (event.code === 4001) { leave(); $('lobby-error').textContent = '같은 대원이 다른 창에서 접속했습니다. 이 창에서는 별도 대원으로 참가할 수 있습니다.'; return; }
    status('재접속 중');
    toast('연결을 복구하고 있습니다. 캐릭터와 임무는 계속 진행됩니다.');
    reconnectTimer = window.setTimeout(connect, 1500);
  });
}

function closeMenu() { document.body.classList.remove('menu-open'); }

// 임무 목표 수다. 합의한 임무 규칙(docs/requirements.md)이 시설 3곳 파괴, 선택 보급품 2개 회수이고, 생성기(MissionGenerator.FacilityCount)와
// 서버의 시작 안내도 같은 수를 쓴다. 스냅샷에는 분대가 본 시설과 보급만 오므로 s.facilities.length로는 전체 수를 알 수 없다.
const facilityGoal = 3, supplyGoal = 2;

// 탈출 확보 시간(초)이다. 옆 패널과 작은 임무 진행이 같은 값을 보인다. 정수로 내리므로 20초를 채우기 전에 20이 보이지 않는다.
// 소수 한 자리를 보이면 작은 탈출 상자가 넓어져, 폭 533px 휴대폰 가로 화면에서 위쪽 줄이 두 줄로 꺾이고 오른쪽 위 기술 버튼을 덮었다.
const extractSeconds = (progress: number) => Math.floor(progress);

// 내용이 같으면 다시 쓰지 않는다. updateUi는 스냅샷마다(초당 10번) 불리는데, innerHTML을 다시 쓰면 요소를 지우고 새로 만들어
// 레이아웃과 스타일을 다시 계산한다.
const markup = new Map<string, string>();
function setMarkup(id: string, html: string) {
  if (markup.get(id) === html) return;
  markup.set(id, html);
  $(id).innerHTML = html;
}

function leave() {
  guest = undefined; snapshot = undefined; lastNotice = 0; sequence = 0;
  closeReportNote();
  sessionStorage.removeItem('argus-guest');
  window.clearTimeout(reconnectTimer);
  socket?.close(); socket = undefined;
  // 손가락 상태를 다음 작전으로 넘기지 않는다. 터치 조작도 숨긴다. 다음 방의 첫 스냅샷이 오기 전에는 updateUi가 돌지 않아 지난 작전의 버튼이 남는다.
  releaseStick(); releaseTouchSkills();
  clearInput();
  if (world) { world.landing = undefined; world.overview = false; world.app.ticker.stop(); }
  $('operation').hidden = true; $('lobby').hidden = false; $('result').hidden = true; $('touch-controls').hidden = true;
  // 작은 임무 진행도 비운다. 다음 방의 첫 스냅샷이 오기 전에는 updateUi가 돌지 않아, 비우지 않으면 지난 작전의 진행이 보인다.
  for (const id of ['mission-mini', 'touch-mission', 'touch-extract']) setMarkup(id, '');
  document.body.classList.remove('operating', 'menu-open', 'ended');
  document.documentElement.classList.remove('touch-operating');
  status('투입 대기');
}

function updateUi() {
  const s = snapshot, p = me();
  if (!s || !p) return;
  const alive = p.state === 'alive', ended = s.phase === 'ended';
  $('room-code').textContent = s.room;
  $('mission-state').textContent = ended ? '작전 종료' : s.phase === 'active' ? '진행 중' : '투입 대기';
  $('elapsed').textContent = time(s.elapsed);
  // 작은 임무 진행이다. 옆 패널이 보이지 않을 때만 보인다(style.css). 폭 760px 이하의 PC 창은 경과 시간 옆(#mission-mini)에 둔다.
  // 터치 화면은 시설·보급품을 메뉴 버튼 아래(#touch-mission)에, 탈출을 경과 시간 아래(#touch-extract)에 나눠 둔다.
  // 가로 화면에서는 체력·마나 상자가 두 상자보다 키가 커서 그 아래가 비어 있으므로, 나눠 두면 위쪽 줄이 높아지지 않는다.
  const destroyed = s.facilities.filter(f => f.hp <= 0).length;
  const collected = s.supplies.filter(f => f.objective && f.collected).length;
  const ext = s.extraction;
  // 탈출은 주목표(시설 파괴)를 이룬 뒤에만 보인다. 그 전에는 탈출 지점을 찾았는지가 쓸모없는 정보다(2026-11-08 사용자).
  // 탈출 지점이 보이면 서버가 보낸 unlocked(주목표 완료)로 정한다. 옆 패널도 이 값을 쓴다. 보이지 않으면 그 값이 오지 않으므로
  // 부순 시설 수로 정한다. 시설은 사선이 열린 대원만 부술 수 있어, 부순 시설은 분대가 본 시설로 스냅샷에 온다.
  // 주목표를 이뤘는데 아직 못 찾았으면 찾으라고 알리고, 찾은 뒤에는 확보한 시간을 옆 패널과 같은 값으로 보인다.
  const primaryDone = ext ? ext.unlocked : destroyed >= facilityGoal;
  // 단위(초)는 숫자 밖에 이름과 같은 작은 글자로 붙인다. 그러면 탈출 상자가 같은 글꼴의 "경과 00:00" 상자보다 늘 좁아, 경과 시간
  // 아래에 두어도 오른쪽 묶음이 넓어지지 않는다. 숫자 안에 넣었을 때는 한글 글꼴에서 1px, CI 실행기의 글꼴에서 2px 넓었다.
  const item = (text: string, count: string, done: boolean, unit = '') => `<span class="mission-item${done ? ' done' : ''}">${text}${count ? ` <b>${count}</b>${unit}` : ''}</span>`;
  const objectives = item('시설', `${destroyed}/${facilityGoal}`, destroyed >= facilityGoal) + item('보급품', `${collected}/${supplyGoal}`, collected >= supplyGoal);
  const extraction = !primaryDone ? ''
    : ext ? item('탈출', `${extractSeconds(ext.progress)}/${ext.duration}`, false, '초') : item('탈출 지점 찾기', '', false);
  setMarkup('mission-mini', objectives + extraction);
  setMarkup('touch-mission', objectives);
  setMarkup('touch-extract', extraction);
  $('primary-count').textContent = `${destroyed}/${facilityGoal}`;
  $('secondary-count').textContent = `${collected}/${supplyGoal}`;
  // 시설과 탈출 지점은 분대가 본 것만 온다. 아직 찾지 못한 시설은 자리만 표시한다.
  $('facility-list').innerHTML = s.facilities.map(f => `<span class="${f.hp <= 0 ? 'done' : ''}">${f.hp <= 0 ? '✓' : '◇'} 0${f.id}</span>`).join('')
    + '<span class="unknown">? 미발견</span>'.repeat(Math.max(0, facilityGoal - s.facilities.length));
  $('extract-note').textContent = !ext ? '탈출 지점 미발견 · 지도를 탐색하세요'
    : ext.unlocked ? `구역 안에서 ${ext.duration}초 확보 · ${extractSeconds(ext.progress)}초` : '주목표 완료 후 활성화';
  $('extract-progress').style.width = ext ? `${Math.min(100, 100 * ext.progress / ext.duration)}%` : '0%';
  $('team-count').textContent = `${s.players.length} / 4`;
  $('roster').innerHTML = s.players.map((member, index) => `<div class="member ${member.id === s.you ? 'self' : ''}"><span class="member-number color-${index}">0${index + 1}</span><div><b>${escape(member.name)}${member.id === s.you ? ' <small>나</small>' : ''}</b><span>${!member.connected ? '연결 끊김' : member.state === 'alive' ? `${Math.ceil(member.hp)} HP` : member.state === 'deploying' ? `투입까지 ${member.deploy.toFixed(1)}초` : member.hasDeployed ? '증원 대기' : '투입 대기'}</span><span class="roster-loadout">마나 ${member.mana}/${member.maxMana} · ${loadoutText(member.slots)}</span></div><i class="${member.state === 'alive' ? 'alive-dot' : ''}"></i></div>`).join('');
  $('deploy-panel').hidden = alive || ended;
  $('combat-hud').hidden = !alive || ended;
  $('view-label').textContent = alive ? '분대 공유 시야 / SECTOR 07' : '전술 지도 / 투입 위치 선택';
  $('controls').textContent = alive ? 'WASD 이동 · 좌클릭 타격 · 우클릭 받아치기 · Space 잡기 · Q 자유 슬롯 · M 지도' : '클릭 위치 선택 · 캠프는 권장 투입 지점';
  if (!alive && !ended) {
    const preparing = p.state === 'deploying';
    $('deploy-kicker').textContent = preparing ? 'DEPLOYMENT IN PROGRESS' : p.hasDeployed ? 'REINFORCEMENT' : 'READY TO DEPLOY';
    $('deploy-title').textContent = preparing ? `${p.deploy.toFixed(1)}초 후 투입합니다` : p.hasDeployed ? '증원할 위치를 선택하세요' : '투입할 위치를 선택하세요';
    $('deploy-description').textContent = preparing ? '투입이 완료될 때까지 해당 위치의 시야는 열리지 않습니다.' : `분대가 본 곳의 빈 지면을 ${pick}. 지금 보이지 않는 곳의 안전은 보장되지 않습니다.`;
    $<HTMLButtonElement>('camp').disabled = preparing;
    $<HTMLButtonElement>('deploy').disabled = preparing || deployRequested || !world?.landing;
    $('deploy').textContent = preparing || deployRequested ? '투입 준비 중…' : world?.landing ? '5초 후 투입 ↗' : '위치 선택 필요';
  }
  if (alive) {
    $('my-name').textContent = p.name;
    $('hp').textContent = Math.ceil(p.hp).toString(); $('max-hp').textContent = `/ ${p.maxHp} HP`;
    $('health-fill').style.width = `${100 * p.hp / p.maxHp}%`;
    $('health-fill').classList.toggle('low', p.hp < p.maxHp * .3);
    $('mana').textContent = p.mana.toString();
    $('max-mana').textContent = `/ ${p.maxMana}`;
    $('mana-fill').style.width = `${100 * p.mana / p.maxMana}%`;
    const current = p.actions.at(-1);
    const phaseText = current?.phase === 'interrupted' ? '중단됨' : current?.phase === 'followup' ? '일반 반격' : current?.phase === 'recovery' ? '후딜레이' : current ? skillNames[current.skill as Skill] : '준비';
    // 기술 칸 하나의 표시다. 기술 막대와 터치 기술 버튼이 같은 규칙을 쓴다.
    const slotView = (slot: number) => {
      const skill = p.slots[slot - 1];
      const definition = s.rules.skills.find(d => d.id === skill)!;
      const active = current?.slot === slot && current.endsAt > s.now;
      return { name: skillNames[skill], kind: definition.kind, active, empty: p.mana < definition.mana, note: active ? phaseText : `마나 ${definition.mana}` };
    };
    // 터치 화면에서는 기술 막대를 숨기고 기술 버튼이 그 일을 한다. 보이는 쪽만 갱신한다.
    if (touchMode) {
      for (const button of document.querySelectorAll<HTMLButtonElement>('.touch-skill')) {
        const slot = Number(button.dataset.slot);
        const view = slotView(slot);
        button.className = `touch-skill skill-${view.kind}${touchedSlots().has(slot) ? ' held' : ''}${view.empty ? ' empty' : ''}${view.active ? ' active' : ''}`;
        button.querySelector('b')!.textContent = view.name;
        button.querySelector('small')!.textContent = view.note;
        showHand(button.querySelector<HTMLElement>('.hand')!, view.kind);
      }
    } else {
      const busy = Math.max(0, Math.min(1, p.busy / (current ? s.rules.skills.find(d => d.id === current.skill)!.duration : 1)));
      // 터치 버튼처럼 칸은 한 번만 만들어 두고, 클래스와 글자, 진행 막대 폭만 고친다.
      for (const element of document.querySelectorAll<HTMLElement>('.skill-slot')) {
        const view = slotView(Number(element.dataset.slot));
        element.className = `skill-slot skill-${view.kind}${view.active ? ' active' : ''}${view.empty ? ' empty' : ''}`;
        element.querySelector('.name')!.textContent = view.name;
        element.querySelector('small')!.textContent = view.note;
        element.querySelector('i')!.style.width = `${100 * busy}%`;
        showHand(element.querySelector<HTMLElement>('.hand')!, view.kind);
      }
    }
    $('combat-status').textContent = p.mana === 0 ? '마나가 없습니다 · 보급 상자에 접근해 충전하세요' : p.busy > 0 ? `${phaseText} · ${p.busy.toFixed(1)}초` : '예고를 읽고 대응하세요 · 기술 사용 중에도 이동 가능';
    $('combat-status').classList.toggle('empty', p.mana === 0);
  }
  $('touch-controls').hidden = !touchMode || !alive || ended;
  $('performance').textContent = `${ping} ms · ${world?.fps ?? 60} FPS · 적 ${world?.shownEnemies ?? 0}/${s.enemies.length}`;
  $('result').hidden = !ended;
  // 종료 카드가 보이는 동안이다. CSS가 :has() 없이 이 상태를 고른다(임무 진행과 알림 숨김).
  document.body.classList.toggle('ended', ended);
  if (ended) {
    $('result-title').textContent = s.result === 'success' ? '분대, 복귀 완료.' : '분대 신호 소실.';
    $('result-description').textContent = s.result === 'success' ? '적 시설을 무력화하고 탈출 지점을 확보했습니다.' : '전원이 사망하여 작전이 종료되었습니다.';
    $('result-stats').innerHTML = `<div><b>${time(s.elapsed)}</b><span>작전 시간</span></div><div><b>${s.players.reduce((sum, member) => sum + member.kills, 0)}</b><span>분대 처치</span></div><div><b>${collected}/${supplyGoal}</b><span>보급품 회수</span></div>`;
  }
}

$('create').addEventListener('click', () => void enter());
$('join').addEventListener('click', () => void enter($<HTMLInputElement>('room-input').value));
$('room-input').addEventListener('keydown', event => { if (event.key === 'Enter') void enter($<HTMLInputElement>('room-input').value); });
$('copy-code').addEventListener('click', () => {
  if (!guest) return;
  navigator.clipboard?.writeText(guest.room).then(() => toast('초대 코드를 복사했습니다. 친구에게 공유하세요.')).catch(() => toast(`초대 코드: ${guest!.room}`));
  if (!navigator.clipboard) toast(`초대 코드: ${guest.room}`);
});
$('camp').addEventListener('click', () => {
  if (!world || !snapshot) return;
  // 같은 캠프를 추천한다. 아군끼리는 겹칠 수 있다.
  world.landing = { x: snapshot.map.campX, y: snapshot.map.campY };
  updateUi();
});
// 요청을 보내는 즉시 버튼을 막는다. 다음 스냅샷이 오기 전에 다시 눌러도 요청이 두 번 나가지 않는다.
$('deploy').addEventListener('click', () => {
  if (!world?.landing || deployRequested) return;
  if (send({ type: 'deploy', ...world.landing })) { deployRequested = true; updateUi(); }
});
$('leave').addEventListener('click', leave);
// 버그 제보는 누른 순간의 틱을 서버 기록에 찍는다. 내용은 그 뒤에 화면 안 입력란으로 받아 그 제보에 덧붙인다.
// 브라우저 입력 창(prompt)을 쓰면 닫을 때까지 게임이 멈추고, 닫은 순간이 제보 틱으로 찍힌다.
$('report').addEventListener('click', () => {
  if (!send({ type: 'report' })) toast('작전에 연결된 뒤에 제보할 수 있습니다.');
});
// 입력란에서 친 키는 게임 키로 받지 않는다(keydown 처리가 입력란을 건너뛴다). 이모지를 반으로 자르지 않도록 글자 단위로 자른다.
$('report-note').addEventListener('submit', event => {
  event.preventDefault();
  const text = Array.from($<HTMLInputElement>('report-text').value.trim()).slice(0, 200).join('');
  if (text && reportTick !== null) send({ type: 'reportNote', tick: reportTick, text });
  closeReportNote();
});
$('report-close').addEventListener('click', () => closeReportNote());
$('report-text').addEventListener('keydown', event => { if (event.key === 'Escape') closeReportNote(); });
function closeReportNote() {
  const input = $<HTMLInputElement>('report-text');
  input.blur();
  input.value = '';
  $('report-note').hidden = true;
  reportTick = null;
}
$('again').addEventListener('click', leave);
// 캔버스 밖에서 떼거나 움직여도 놓은 버튼은 반영한다. 새로 누르는 것은 캔버스 위에서만 받는다.
// PC 화면의 손가락을 끌면 브라우저가 화면 밀기로 받아 pointerup 대신 pointercancel을 보낸다. 받지 않으면 기술이 눌린 채로 남는다.
for (const type of ['pointerup', 'pointercancel'] as const) {
  window.addEventListener(type, event => { if (!fingerLike(event)) syncButtons(event.buttons, false); });
}
window.addEventListener('pointermove', event => { if (!fingerLike(event) && event.target !== world?.app.canvas) syncButtons(event.buttons, false); });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
window.addEventListener('keydown', event => {
  if (!guest || event.target instanceof HTMLInputElement) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyM', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  const pressed = slotFromCode(event.code);
  // 살아 있지 않을 때 누른 기술 키는 다시 눌러야 한다. 살아 있을 때 새로 누르면(자동 반복이 아니면) 다시 쓸 수 있다.
  if (pressed > 0 && me()?.state !== 'alive') staleKeys.add(event.code);
  else if (pressed > 0 && !event.repeat) staleKeys.delete(event.code);
  // 자동 반복은 누름 순서를 바꾸지 않는다. 다만 창이 포커스를 잃어 순서가 비워진 뒤에도
  // 계속 누르고 있던 키는 자동 반복으로만 들어오므로, 순서에 없을 때는 다시 넣는다.
  if (pressed > 0 && !staleKeys.has(event.code) && (!event.repeat || !slotOrder.includes(pressed))) pressSlot(pressed);
  if (event.repeat) return;
  if (event.code === 'KeyM' && world) world.overview = !world.overview;
});
window.addEventListener('keyup', event => { keys.delete(event.code); staleKeys.delete(event.code); });
// 이동 조이스틱: 왼쪽 아래를 누르면 그 자리가 가운데가 되고, 끄는 방향으로 걷는다. 가운데의 작은 흔들림은 멈춤으로 본다.
// 이동은 키보드처럼 늘 같은 빠르기로 한다. 서버는 길이 1보다 짧은 이동을 그만큼 느리게 걷게 하므로 길이를 1로 맞춘다.
const stickRadius = 56, stickDeadZone = 10;
let stickPointer: number | null = null;
let stickOrigin = { x: 0, y: 0 };
function moveStick(event: PointerEvent) {
  const dx = event.clientX - stickOrigin.x, dy = event.clientY - stickOrigin.y;
  const length = Math.hypot(dx, dy);
  // 손잡이는 받침 밖으로 나가지 않는다. 걷는 방향은 손가락이 받침 밖에 있어도 손가락 쪽이다.
  const knob = Math.min(1, stickRadius / Math.max(length, 1));
  $('touch-knob').style.transform = `translate(${dx * knob}px, ${dy * knob}px)`;
  if (length < stickDeadZone) { touch.x = 0; touch.y = 0; return; }
  touch.x = dx / length; touch.y = dy / length;
  touch.aim = Math.atan2(dy, dx); touch.aimKnown = true;
}
function releaseStick() {
  stickPointer = null; touch.x = 0; touch.y = 0;
  $('touch-base').hidden = true;
}
function releaseTouchSkills() {
  touch.pointers.clear();
  for (const button of document.querySelectorAll('.touch-skill')) button.classList.remove('held');
}
$('touch-move').addEventListener('pointerdown', event => {
  if (stickPointer !== null) return;
  stickPointer = event.pointerId;
  $('touch-move').setPointerCapture(event.pointerId);
  const area = $('touch-move').getBoundingClientRect();
  stickOrigin = { x: event.clientX, y: event.clientY };
  Object.assign($('touch-base').style, { left: `${event.clientX - area.left}px`, top: `${event.clientY - area.top}px` });
  $('touch-base').hidden = false;
  moveStick(event);
});
$('touch-move').addEventListener('pointermove', event => { if (event.pointerId === stickPointer) moveStick(event); });
// 포인터를 놓치면 lostpointercapture가 온다. 그때 비우지 않으면 다음 손가락의 누름을 받지 못한다.
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  $('touch-move').addEventListener(type, event => { if (event.pointerId === stickPointer) releaseStick(); });
}
// 기술 버튼: 누르고 있는 동안 그 슬롯을 쓴다. 키보드처럼 나중에 누른 버튼이 먼저다.
for (const button of document.querySelectorAll<HTMLButtonElement>('.touch-skill')) {
  const slot = Number(button.dataset.slot);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    // 키보드·마우스처럼 살아 있을 때의 누름만 받는다. 살아 있지 않을 때의 누름이 착지 뒤 첫 입력에 실려 나가지 않게 한다.
    if (me()?.state !== 'alive') return;
    button.setPointerCapture(event.pointerId);
    touch.pointers.set(event.pointerId, slot); pressSlot(slot);
    button.classList.add('held');
  });
  const release = (event: PointerEvent) => {
    touch.pointers.delete(event.pointerId);
    button.classList.toggle('held', touchedSlots().has(slot));
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}
$('touch-controls').addEventListener('contextmenu', event => event.preventDefault());
$('touch-menu').addEventListener('click', () => document.body.classList.toggle('menu-open'));
$('touch-map').addEventListener('click', () => { if (world) world.overview = !world.overview; });
// 안드로이드 크롬은 전체 화면으로 주소창을 숨기고 가로로 고정할 수 있다. 아이폰 사파리는 페이지 전체 화면을 지원하지 않아 버튼을 숨긴다.
// 전체 화면은 누름(사용자 동작) 안에서만 켤 수 있다. 터치 기기에서 작전을 시작하거나 참가하는 누름에서도 켠다.
function enterFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  const orientation = screen.orientation as unknown as { lock?: (to: string) => Promise<void> };
  document.documentElement.requestFullscreen().then(() => orientation.lock?.('landscape')).catch(() => undefined);
}
for (const id of ['touch-full', 'lobby-full']) {
  if (!document.getElementById(id)) continue;
  $(id).hidden = !document.fullscreenEnabled;
  $(id).addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else enterFullscreen(); });
}
document.addEventListener('fullscreenchange', () => {
  for (const id of ['touch-full', 'lobby-full']) {
    if (document.getElementById(id)) $(id).textContent = document.fullscreenElement ? '전체 화면 끄기' : '전체 화면';
  }
});
function sendControl() {
  if (!world || !snapshot || me()?.state !== 'alive' || snapshot.phase !== 'active') return;
  let x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  let y = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
  if (x === 0 && y === 0) { x = touch.x; y = touch.y; }
  const p = world.mePosition() ?? me()!;
  const aimAt = mouse.known ? world.screenToWorld(mouse.x, mouse.y) : { x: p.x + 1, y: p.y };
  // 터치로만 조작하면 마우스 위치가 없으므로 마지막으로 움직인 방향을 조준으로 쓴다. 둘레 기술은 조준이 필요 없다.
  const aim = !mouse.known && touch.aimKnown ? touch.aim : Math.atan2(aimAt.y - p.y, aimAt.x - p.x);
  let slot = 0;
  for (const candidate of slotOrder) { if (slotHeld(candidate)) slot = candidate; }
  // slot은 지금 쥐고 있는 슬롯만 뜻한다. 지난 입력 뒤에 누른 슬롯은 이미 떼었어도 press로 한 번 따로 보낸다.
  // 서버는 입력이 몰려 와도 틱마다 누름을 쥐고 있음보다 먼저 쓰고, 그 틱에만 쓴다(Player.PressedSlot).
  const press = pressedSinceSend;
  pressedSinceSend = 0;
  world.control = { x, y, aim, slot };
  sendInput(x, y, aim, slot, press);
}
// 입력은 서버의 틱과 같은 빠르기(초당 30번)로 보낸다. 클라이언트 예측이 보낸 입력 하나를 한 틱으로 치기 때문이다.
// setInterval(…, 1000 / 30)은 브라우저가 33ms로 내려 초당 30.3번이 되고 예측이 조금씩 앞서므로, 보낼 시각을 1/30초씩 더해 정한다.
// 타이머가 늦게 깨어 보낼 차례를 놓치면 밀린 입력을 몰아 보내지 않는다. 서버는 그동안 마지막 입력을 계속 쓰므로,
// 예측도 마지막 입력을 놓친 틱만큼 더 쓴 것으로 치고(holdLastInput) 다음 차례부터 다시 1/30초 간격으로 보낸다.
let nextInputAt = performance.now();
function pumpInput() {
  const missed = Math.max(0, Math.floor((performance.now() - nextInputAt) / tickMilliseconds));
  try {
    if (missed > 0) world?.holdLastInput(missed);
    sendControl();
  } finally {
    // 입력이나 예측에서 예외가 나도 다음 차례는 반드시 예약한다. 예약이 끊기면 새로고침할 때까지 입력이 나가지 않는다.
    nextInputAt += (missed + 1) * tickMilliseconds;
    window.setTimeout(pumpInput, Math.max(0, nextInputAt - performance.now()));
  }
}
pumpInput();
window.setInterval(() => send({ type: 'ping', sent: performance.now() }), 2000);

try { const saved = sessionStorage.getItem('argus-guest'); if (saved) guest = JSON.parse(saved) as Guest; } catch { sessionStorage.removeItem('argus-guest'); }
if (guest?.room && guest?.token) void openOperation();
