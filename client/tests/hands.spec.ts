import { test, expect, type Page } from '@playwright/test';
import { handIcon, handOf } from '../src/rps';
import { aroundSkills, freeSkills, kindOfSkill, kindSlots } from '../src/loadout';
import { affinityColors } from '../src/palette';
import type { Affinity, Skill, Snapshot } from '../src/types';

// 가위바위보 그림이다(2026-11-05 사용자 요청, 11-09 범위와 그림 방식을 정함). 타격은 가위, 방어는 주먹, 잡기는 보다.
// 터치 기술 버튼, PC 기술 막대, 로비 장비 칸에 상성 색으로 붙인다.
const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };
// 기대하는 색은 캔버스와 CSS가 함께 쓰는 상성 색(palette.ts)에서 구한다. CSS 변수와 palette.ts가 같은지는 world.spec.ts가 본다.
const colorOf = (kind: Affinity) => {
  const color = affinityColors[kind];
  return `rgb(${color >> 16}, ${(color >> 8) & 255}, ${color & 255})`;
};
const handFor = (kind: Affinity) => kind === 'none' ? undefined : handOf[kind];

// 그 요소 안의 손 그림과 그 색을 읽는다. 손 그림은 fill·stroke가 currentColor라 svg의 color가 곧 그림의 색이다.
const drawnIn = (page: Page, selector: string) => page.evaluate(selector => [...document.querySelectorAll(selector)].map(element => {
  const svg = element.querySelector<SVGElement>('svg.rps');
  const kind = [...element.classList].find(name => name.startsWith('skill-') && name !== 'skill-slot')?.slice(6);
  return { kind: kind as Affinity, hand: svg?.dataset.hand, color: svg ? getComputedStyle(svg).color : undefined };
}), selector);

// 손가락 사이 틈은 마스크로 뚫는다. 마스크는 그림마다 제 것을 써야 한다. 여러 그림이 같은 id를 나눠 쓰면 모두 문서에서 처음 나온
// 정의를 따르는데, 그 그림이 숨은 화면(로비나 작전 화면)에 있으면 마스크가 그려지지 않는다. 문서의 모든 손 그림에서 마스크 id가
// 겹치지 않고, 마스크를 쓰는 곳마다 같은 그림 안의 마스크를 가리키는지 본다. 틈을 정해 둔 바탕색으로 칠하던 .cut은 남지 않는다.
const masksOk = (page: Page) => page.evaluate(() => {
  const ids = [...document.querySelectorAll('svg.rps mask')].map(mask => mask.id);
  const own = [...document.querySelectorAll<SVGElement>('svg.rps [mask]')].every(element => {
    const id = /^url\(#([^)]+)\)$/.exec(element.getAttribute('mask')!)?.[1];
    return id !== undefined && document.getElementById(id)?.closest('svg') === element.closest('svg');
  });
  return { masked: ids.length > 0, unique: new Set(ids).size === ids.length, own, fixedCutColor: document.querySelector('svg.rps .cut') !== null };
});
const masksFine = { masked: true, unique: true, own: true, fixedCutColor: false };

async function expectLobbyHands(page: Page, freeChoices: number) {
  // 종류 칸 이름표에 그 종류의 손이 있다.
  for (const slot of kindSlots) {
    const [legend] = await drawnIn(page, `.kind-slot.skill-${slot.kind} legend`);
    expect({ hand: legend.hand, color: legend.color }, slot.kind).toEqual({ hand: handFor(slot.kind), color: colorOf(slot.kind) });
  }
  // 자유 칸은 아무 기술이나 고르므로 기술마다 그 종류의 손을 붙인다.
  const free = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[name="free-slot"]')].map(input => {
    const svg = input.parentElement!.querySelector<SVGElement>('svg.rps');
    return { skill: input.value, hand: svg?.dataset.hand, color: svg ? getComputedStyle(svg).color : undefined };
  }));
  expect(free).toHaveLength(freeChoices);
  for (const { skill, hand, color } of free) {
    const kind = kindOfSkill(skill as Skill);
    expect({ hand, color }, skill).toEqual({ hand: handFor(kind), color: colorOf(kind) });
  }
}

// 작전을 시작해 캠프에 투입한다. 첫 스냅샷이 오기 전의 캠프 선택은 아무 일도 하지 않으므로 투입 버튼이 풀릴 때까지 누른다.
async function deployAtCamp(page: Page, tap: boolean) {
  const press = (locator: ReturnType<Page['locator']>) => tap ? locator.tap() : locator.click();
  await press(page.getByRole('button', { name: '새 작전 시작' }));
  await expect(async () => {
    await press(page.getByRole('button', { name: '캠프 선택' }));
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  await press(page.locator('#deploy'));
}

// 첫 스냅샷의 규칙(서버의 기술 정의)을 받아 둔다. 규칙은 연결마다 처음 스냅샷에만 담긴다.
async function captureRules(page: Page) {
  const seen: { rules?: Snapshot['rules'] } = {};
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (typeof message === 'string' && seen.rules === undefined) {
        const data = JSON.parse(message);
        if (data.type === 'snapshot' && data.rules) seen.rules = data.rules;
      }
      ws.send(message);
    });
  });
  return seen;
}

test('the hands follow the affinity rules: strike is scissors, block is rock and grab is paper', () => {
  // 타격은 잡기를, 잡기는 방어를, 방어는 타격을 이긴다(서버의 Affinity.Beats). 가위는 보를, 보는 주먹을, 주먹은 가위를 이긴다.
  // 그림의 짝이 상성을 그대로 옮겨야 그림만 보고도 무엇이 무엇을 이기는지 안다.
  const affinityBeats = { strike: 'channel', channel: 'block', block: 'strike' } as const;
  const handBeats = { scissors: 'paper', paper: 'rock', rock: 'scissors' } as const;
  for (const [winner, loser] of Object.entries(affinityBeats)) expect(handBeats[handOf[winner as keyof typeof handOf]], winner).toBe(handOf[loser]);
  expect(handOf).toEqual({ strike: 'scissors', block: 'rock', channel: 'paper' });
});

test('a skill outside the kind slots gets no hand instead of stopping the lobby', () => {
  // 종류 칸에 없는 기술(예: 앞으로 넣을 상성 없는 대시)을 자유 칸에 넣어도 로비를 만들다 멈추지 않고 손 그림만 빠진다.
  expect(kindOfSkill('dash' as Skill)).toBe('none');
  expect(handIcon('none')).toBe('');
});

test('the lobby copy of the skill definitions matches the server rules', async ({ page }) => {
  // 로비는 방에 들어가기 전이라 서버의 기술 정의가 없어 loadout.ts에 따로 적어 둔다. 첫 스냅샷의 rules.skills와 맞춰 본다.
  // 기술을 다른 종류 칸에 넣거나, 서버에 기술을 더하고 로비를 그대로 두면 잡는다. 손 그림의 종류도 이 표에서 구한다.
  const seen = await captureRules(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => seen.rules?.skills.length ?? 0).toBeGreaterThan(0);
  const skills = seen.rules!.skills;
  for (const slot of kindSlots) expect(slot.skills, slot.title).toEqual(skills.filter(skill => skill.kind === slot.kind).map(skill => skill.id));
  for (const skill of skills) {
    expect(kindOfSkill(skill.id), `${skill.id}의 종류`).toBe(skill.kind);
    expect(aroundSkills.includes(skill.id), `${skill.id}가 둘레 기술인지`).toBe(skill.around);
  }
  // 자유 칸은 아무 기술이나 고른다(Rules.ValidSlots). 서버의 기술을 모두 서버의 차례대로 보인다.
  expect(freeSkills).toEqual(skills.map(skill => skill.id));
});

test('the gaps between the fingers show whatever lies behind the hand', async ({ page }) => {
  // 손가락 마디 사이와 엄지 둘레의 틈은 마스크로 뚫는다. 정해 둔 바탕색으로 칠하면 손 그림이 놓이는 바탕(고른 장비, 사용 중인 칸,
  // 지도 위의 반투명 터치 버튼)과 달라 검은 윤곽선처럼 보였다(PR #25 리뷰). 손 그림을 빨간 바탕 위에 흰색으로 크게 그려(240px,
  // viewBox 좌표 1이 10px) 몇 점의 색을 읽는다. 틈 자리는 바탕인 빨강이고 손은 흰색이다.
  await page.goto('/');
  const read = (kind: Affinity, points: number[][]) => page.evaluate(async ({ markup, points }) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" color="#ffffff" '))}`;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 240, height: 240 });
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 240, 240);
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...context.getImageData(Math.round(x * 10), Math.round(y * 10), 1, 1).data.slice(0, 3)]);
  }, { markup: handIcon(kind), points });
  const back = [255, 0, 0], hand = [255, 255, 255];
  // 가위: 엄지(굵기 2.4) 둘레 틈(굵기 4.4)의 가운데(엄지 가운데 줄에서 1.7 아래), 쥔 손의 아래쪽.
  expect(await read('strike', [[11.99, 18.16], [12, 20.6]]), '가위').toEqual([back, hand]);
  // 주먹: 첫째와 둘째 마디 사이, 엄지 아래 틈, 둘째 마디 위 테두리 바깥(예전에는 검은 윤곽선), 손바닥의 아래쪽.
  expect(await read('block', [[8.2, 8], [10.75, 16.14], [10.2, 4.1], [12, 19.8]]), '주먹').toEqual([back, back, back, hand]);
});

test('the PC lobby slots and skill bar show the hand of each kind in its color', async ({ page }) => {
  await page.goto('/');
  await expectLobbyHands(page, 6);
  await deployAtCamp(page, false);
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  // 기술 막대의 칸마다 그 기술 종류의 손이 있다. 기본 장비는 타격·방어·잡기·자유(타격)다.
  const bar = await drawnIn(page, '.skill-slot');
  expect(bar.map(slot => slot.kind)).toEqual(['strike', 'block', 'channel', 'strike']);
  for (const { kind, hand, color } of bar) expect({ hand, color }, kind).toEqual({ hand: handFor(kind), color: colorOf(kind) });
  // 기술 이름도 그 종류의 색으로 손 그림 옆에 이어 쓴다. 이름 줄의 span은 전투 HUD의 설명 글 규칙(블록, 10px, 회색)을 받지 않는다.
  const names = await page.evaluate(() => [...document.querySelectorAll('.skill-slot .name')].map(name => {
    const style = getComputedStyle(name);
    return [style.color, style.fontSize, style.display];
  }));
  expect(names).toEqual(bar.map(slot => [colorOf(slot.kind), '12px', 'inline']));
  expect(await masksOk(page)).toEqual(masksFine);
  // 칸과 손 그림은 한 번만 만들고, 스냅샷마다(0.1초) 글자와 클래스만 고친다. 표시를 붙여 두고 스냅샷 몇 번 뒤에도 같은 요소인지 본다.
  await page.evaluate(() => { for (const node of document.querySelectorAll('.skill-slot, .skill-slot svg.rps')) Object.assign(node, { kept: true }); });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => [...document.querySelectorAll('.skill-slot, .skill-slot svg.rps')].map(node => 'kept' in node))).toEqual(Array(8).fill(true));
  // 좁은 PC 창(화면을 크게 확대한 창)에서도 기술 이름과 키 이름이 잘리거나 두 줄로 꺾이지 않고, 손 그림은 칸 안에서 어느 글자와도
  // 겹치지 않는다. 폭 440px 이하에서는 손 그림이 이름 위 줄로 올라가고, 360px 이하에서는 여백이 줄어든다. 두 경계의 양쪽을 본다.
  // 360px 이하는 손 그림 전부터 이름이 잘리고 키 이름이 꺾였다. 이 개발 환경의 검사 브라우저는 한글 글꼴이 없어 이름을 좁게 그리므로,
  // 잘림은 CI의 한글 글꼴(WenQuanYi Zen Hei)에서 드러난다.
  for (const width of [441, 440, 361, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const slots = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.skill-slot')].map(slot => {
      const textBoxes = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].filter(box => box.width > 0);
      };
      const box = slot.getBoundingClientRect(), hand = slot.querySelector('svg.rps')!.getBoundingClientRect();
      const name = slot.querySelector('b')!, key = textBoxes(slot.querySelector('kbd')!);
      const words = [...key, ...textBoxes(slot.querySelector('.name')!), ...textBoxes(slot.querySelector('small')!)];
      const apart = (word: DOMRect) => word.right <= hand.left + .5 || word.left >= hand.right - .5 || word.bottom <= hand.top + .5 || word.top >= hand.bottom - .5;
      return {
        name: name.textContent,
        fits: name.scrollWidth <= name.clientWidth,
        keyOneLine: key.every(word => Math.abs(word.top - key[0].top) < 1),
        handShown: hand.width >= 12 && hand.left >= box.left && hand.right <= box.right && hand.top >= box.top && hand.bottom <= box.bottom,
        apart: words.every(apart),
      };
    }));
    for (const slot of slots) expect(slot, `${width}px ${slot.name}`).toEqual({ name: slot.name, fits: true, keyOneLine: true, handShown: true, apart: true });
  }
});

test('the touch skill buttons show the hand of their kind in its color, inside the button', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  try {
    await page.goto('/');
    // 터치 로비는 둘레 기술만 고른다. 자유 칸의 기술 셋도 기술마다 손이 있다.
    await expectLobbyHands(page, 3);
    await deployAtCamp(page, true);
    await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
    const buttons = await drawnIn(page, '.touch-skill');
    expect(buttons.map(button => button.kind)).toEqual(['strike', 'block', 'channel', 'strike']);
    for (const { kind, hand, color } of buttons) expect({ hand, color }, kind).toEqual({ hand: handFor(kind), color: colorOf(kind) });
    expect(await masksOk(page)).toEqual(masksFine);
    // 손 그림과 이름, 마나는 둥근 버튼 안에 들어간다. 버튼에 꼭 맞는 정사각형이 아니라 원 안이어야 하므로 네 모서리를 원으로 잰다.
    const fits = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.touch-skill')].map(button => {
      const circle = button.getBoundingClientRect();
      const cx = circle.left + circle.width / 2, cy = circle.top + circle.height / 2, radius = circle.width / 2;
      return [...button.querySelectorAll('svg.rps, b, small')].every(part => {
        const r = part.getBoundingClientRect();
        return [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= radius + .5);
      });
    }));
    expect(fits).toEqual([true, true, true, true]);
    // 손 그림은 버튼 가운데에 있고, 1번 버튼은 26px, 나머지는 22px이다.
    const placed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.touch-skill')].map(button => {
      const circle = button.getBoundingClientRect(), hand = button.querySelector('svg.rps')!.getBoundingClientRect();
      return { size: Math.round(hand.width), centered: Math.abs(hand.left + hand.width / 2 - (circle.left + circle.width / 2)) < 1 };
    }));
    expect(placed).toEqual([{ size: 26, centered: true }, { size: 22, centered: true }, { size: 22, centered: true }, { size: 22, centered: true }]);
    // 기술 버튼은 작전이 바뀌어도 같은 요소를 다시 쓴다. 다음 작전에서 자유 칸을 잡기로 바꾸면 4번 버튼의 손도 보로 바뀐다.
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await page.getByRole('button', { name: /작전에서 나가기/ }).tap();
    await page.locator('input[name="free-slot"][value="spingrab"]').locator('..').tap();
    await deployAtCamp(page, true);
    await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
    const next = await drawnIn(page, '.touch-skill');
    expect(next.map(button => button.kind)).toEqual(['strike', 'block', 'channel', 'channel']);
    expect(next[3]).toEqual({ kind: 'channel', hand: 'paper', color: colorOf('channel') });
    expect(await masksOk(page)).toEqual(masksFine);
  } finally { await context.close(); }
});
