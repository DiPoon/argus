import { test, expect, type Page } from '@playwright/test';
import { handOf } from '../src/rps';

// 가위바위보 그림이다(2026-11-05 사용자 요청, 11-09 범위와 그림 방식을 정함). 타격은 가위, 방어는 주먹, 잡기는 보다.
// 터치 기술 버튼, PC 기술 막대, 로비 장비 칸에 상성 색으로 붙인다.
const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };
const colors: Record<string, string> = { strike: 'rgb(255, 107, 97)', block: 'rgb(71, 133, 255)', channel: 'rgb(166, 249, 186)' };
// 기술마다 종류다(서버의 기술 정의). 로비에서는 아직 서버의 규칙을 받지 않았으므로 검사가 따로 적어 둔다.
const kindOf: Record<string, 'strike' | 'block' | 'channel'> = { strike: 'strike', spin: 'strike', parry: 'block', spinblock: 'block', grab: 'channel', spingrab: 'channel' };

// 그 요소 안의 손 그림과 그 색을 읽는다. 손 그림은 fill·stroke가 currentColor라 svg의 color가 곧 그림의 색이다.
type Drawn = { hand: string | undefined; color: string | undefined };
const drawnIn = (page: Page, selector: string) => page.evaluate(selector => [...document.querySelectorAll(selector)].map(element => {
  const svg = element.querySelector<SVGElement>('svg.rps');
  const kind = [...element.classList].find(name => name.startsWith('skill-') && name !== 'skill-slot')?.slice(6);
  return { kind, hand: svg?.dataset.hand, color: svg ? getComputedStyle(svg).color : undefined };
}), selector);

async function expectLobbyHands(page: Page, freeSkills: number) {
  // 종류 칸 이름표에 그 종류의 손이 있다.
  for (const kind of ['strike', 'block', 'channel']) {
    const [legend] = await drawnIn(page, `.kind-slot.skill-${kind} legend`);
    expect({ hand: legend.hand, color: legend.color } satisfies Drawn, kind).toEqual({ hand: handOf[kind as keyof typeof handOf], color: colors[kind] });
  }
  // 자유 칸은 아무 기술이나 고르므로 기술마다 그 종류의 손을 붙인다.
  const free = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[name="free-slot"]')].map(input => {
    const svg = input.parentElement!.querySelector<SVGElement>('svg.rps');
    return { skill: input.value, hand: svg?.dataset.hand, color: svg ? getComputedStyle(svg).color : undefined };
  }));
  expect(free).toHaveLength(freeSkills);
  for (const { skill, hand, color } of free) expect({ hand, color }, skill).toEqual({ hand: handOf[kindOf[skill]], color: colors[kindOf[skill]] });
}

test('the hands follow the affinity rules: strike is scissors, block is rock and grab is paper', () => {
  // 타격은 잡기를, 잡기는 방어를, 방어는 타격을 이긴다(서버의 Affinity.Beats). 가위는 보를, 보는 주먹을, 주먹은 가위를 이긴다.
  // 그림의 짝이 상성을 그대로 옮겨야 그림만 보고도 무엇이 무엇을 이기는지 안다.
  const affinityBeats = { strike: 'channel', channel: 'block', block: 'strike' } as const;
  const handBeats = { scissors: 'paper', paper: 'rock', rock: 'scissors' } as const;
  for (const [winner, loser] of Object.entries(affinityBeats)) expect(handBeats[handOf[winner as keyof typeof handOf]], winner).toBe(handOf[loser]);
  expect(handOf).toEqual({ strike: 'scissors', block: 'rock', channel: 'paper' });
});

test('the PC lobby slots and skill bar show the hand of each kind in its color', async ({ page }) => {
  await page.goto('/');
  await expectLobbyHands(page, 6);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  // 첫 스냅샷이 오기 전의 캠프 선택은 아무 일도 하지 않으므로 투입 버튼이 풀릴 때까지 누른다.
  await expect(async () => {
    await page.getByRole('button', { name: '캠프 선택' }).click();
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  await page.locator('#deploy').click();
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  // 기술 막대의 칸마다 그 기술 종류의 손이 있다. 기본 장비는 타격·방어·잡기·자유(타격)다.
  const bar = await drawnIn(page, '.skill-slot');
  expect(bar.map(slot => slot.kind)).toEqual(['strike', 'block', 'channel', 'strike']);
  for (const { kind, hand, color } of bar) expect({ hand, color }, kind).toEqual({ hand: handOf[kind as keyof typeof handOf], color: colors[kind!] });
});

test('the touch skill buttons show the hand of their kind in its color, inside the button', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  try {
    await page.goto('/');
    // 터치 로비는 둘레 기술만 고른다. 자유 칸의 기술 셋도 기술마다 손이 있다.
    await expectLobbyHands(page, 3);
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(async () => {
      await page.getByRole('button', { name: '캠프 선택' }).tap();
      await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
    }).toPass();
    await page.locator('#deploy').tap();
    await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
    const buttons = await drawnIn(page, '.touch-skill');
    expect(buttons.map(button => button.kind)).toEqual(['strike', 'block', 'channel', 'strike']);
    for (const { kind, hand, color } of buttons) expect({ hand, color }, kind).toEqual({ hand: handOf[kind as keyof typeof handOf], color: colors[kind!] });
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
    // 기술 버튼은 작전이 바뀌어도 같은 요소를 다시 쓴다. 다음 작전에서 자유 칸을 잡기로 바꾸면 4번 버튼의 손도 보로 바뀐다.
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await page.getByRole('button', { name: /작전에서 나가기/ }).tap();
    await page.locator('input[name="free-slot"][value="spingrab"]').locator('..').tap();
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(async () => {
      await page.getByRole('button', { name: '캠프 선택' }).tap();
      await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
    }).toPass();
    await page.locator('#deploy').tap();
    await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
    const next = await drawnIn(page, '.touch-skill');
    expect(next.map(button => button.kind)).toEqual(['strike', 'block', 'channel', 'channel']);
    expect(next[3]).toEqual({ kind: 'channel', hand: 'paper', color: colors.channel });
  } finally { await context.close(); }
});
