import { unknownTile } from './movement';
import { colors, extractionRadius, facilityColor, supplyColor, supplyShown } from './palette';
import type { Position, Snapshot } from './types';

// 미니맵이다(2026-11-09 사용자 결정). 맵 전체를 북쪽이 위인 채로 상자에 맞춰 줄여 그린다. 그리는 것은 다섯이다.
// - 분대가 본 칸의 지형. 보지 못한 칸은 비워 둬 상자 바탕이 보인다.
// - 지금 시야(캠프와 살아 있는 대원). 본 땅보다 한 단계 밝게 칠한다(2026-11-11 사용자 결정).
// - 본 목표: 캠프, 시설, 보급 상자, 탈출 지점
// - 지금 보이는 적과 대원. 위치는 메인 화면이 그리는 위치(내 예측 위치, 동료와 적의 보간 위치)를 World가 넘긴다.
// - 메인 화면이 지금 보고 있는 범위(옅은 테두리)
// 모두 스냅샷에 이미 있는 공개 정보다. 서버는 시야 밖의 적과 보지 못한 칸의 목표를 보내지 않으므로 안개 규칙은 메인 화면과 같다.
export type MinimapDot = Position & { color: number; me?: boolean };
export interface MinimapScene {
  players: MinimapDot[];
  enemies: MinimapDot[];
  // 메인 화면이 보고 있는 범위다(월드 좌표). 카메라는 늘 나를 가운데 둔다.
  view: { left: number; top: number; right: number; bottom: number };
}

const css = (color: number, alpha = 1) => `rgba(${color >> 16}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
// 본 땅의 색이다. 메인 화면의 바닥색(colors.floor)은 보지 못한 바탕과 거의 같아(대비 1.11) 본 곳이 보이지 않으므로,
// 그보다 밝은 색(colors.lit, 대비 1.43)으로 칠한다. 메인 화면에서는 이 색이 지금 시야지만, 미니맵에서는 본 땅이다.
const seenFloor = colors.lit;
// 지금 시야의 색이다. 본 땅보다 한 단계 밝다(대비 1.34). 메인 화면의 시야와 바닥의 차이(1.30)와 비슷하게 골랐다.
// 지금 보이지 않는 본 땅은 그대로 어두워서, 적 점이 없다고 비어 있는 곳으로 읽히지 않는다.
const sight = 0x34474a;
// 벽은 밝게 칠해 길이 보이게 한다. 부술 수 없는 벽(맵 가장자리)은 메인 화면처럼 부술 수 있는 벽보다 어둡다.
const wallColors: Record<number, number> = { 1: colors.wall, 2: 0x3d4a4c };
// 대원 점에 두르는 밝은 고리다. 적 점에는 고리가 없다. 4번 대원의 색은 병사의 몸 색과 비슷해(색 차이 12.8), 고리가 없으면
// 미니맵에서 대원이 적으로 보인다(2026-11-11 사용자 결정). 나는 조금 크게, 고리도 더 굵고 진하게 둘러 찾기 쉽게 한다.
const teammateRing = 'rgba(255, 255, 255, .7)', myRing = 'rgba(255, 255, 255, .95)';
// 메인 화면(world.ts)처럼 화소 밀도는 2까지만 쓴다. 2~4px 점에서는 그보다 촘촘해도 보이지 않고, 매 프레임 그릴 화소만 늘어난다.
const maxDensity = 2;

export class Minimap {
  // 칸 하나가 화소 하나인 지형 그림 둘이다. 본 땅과 벽을 따로 두어, 메인 화면처럼 시야를 땅 위·벽 아래에 그린다.
  // 벽 배열이 바뀔 때만 다시 만든다.
  private floor = document.createElement('canvas');
  private walls = document.createElement('canvas');
  private paintedTiles?: Uint8Array;
  private fitKey = '';
  // 상자 안쪽(테두리 빼고)의 CSS 폭이다. 점과 표시의 크기를 CSS px로 정하는 데 쓴다.
  private cssWidth = 1;
  // 브라우저가 알려 준 상자 안쪽의 실제 화소 수다. 모르는 브라우저에서는 비어 있다.
  private deviceSize?: { width: number; height: number };

  constructor(readonly canvas: HTMLCanvasElement) {
    // 상자 바탕은 보지 못한 칸의 색이다. 메인 화면의 덮개와 같은 색(colors.unknown)을 조금 비치게 칠한다.
    canvas.style.backgroundColor = css(colors.unknown, .9);
    if (typeof ResizeObserver === 'undefined') return;
    // 상자 크기는 소수 CSS px일 수 있다(vw·dvh·맵 비율로 구한 값). 그림의 화소 수가 브라우저가 실제로 쓰는 화소 수와 다르면
    // 브라우저가 그림을 다시 표본화해 선이 반 화소씩 번진다. 실제 화소 수를 알려 주는 브라우저에서는 그 값을 쓴다.
    const observer = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].devicePixelContentBoxSize?.[0];
      this.deviceSize = box ? { width: box.inlineSize, height: box.blockSize } : undefined;
      // 상자 크기가 바뀌었으니 다음에 그릴 때 다시 잰다.
      this.fitKey = '';
    });
    // 실제 화소 수를 모르는 브라우저는 그 상자 종류를 받지 않고 예외를 낸다. 그때는 크기가 바뀐 것만 듣는다.
    try { observer.observe(canvas, { box: 'device-pixel-content-box' }); } catch { observer.observe(canvas); }
  }

  // 보이거나 숨긴다. 숨는 때는 World가 한 곳에서 정한다: 메인 화면이 맵 전체를 보이는 동안(전체 지도 보기, 투입 전, 작전 종료)과
  // 터치 화면의 서랍이 열린 동안이다. CSS로 따로 숨기지 않는다. 따로 숨기면 숨은 상자를 0으로 재고 그 크기가 굳는다.
  // 보이는 동안에는 body에 minimap-on을 붙여, 알림이 미니맵 옆의 빈 자리로 비켜 가게 한다(style.css).
  show(visible: boolean) {
    if (this.canvas.hidden === !visible) return;
    this.canvas.hidden = !visible;
    document.body.classList.toggle('minimap-on', visible);
    // 숨은 동안에는 크기를 잴 수 없으므로 다시 보일 때 다시 잰다.
    if (visible) this.fitKey = '';
  }

  draw(s: Snapshot, tiles: Uint8Array, scene: MinimapScene) {
    if (this.canvas.hidden) return;
    this.fit(s);
    this.paintTerrain(s, tiles);
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const { width, height } = this.canvas;
    // kx·ky는 월드 좌표 1이 캔버스 화소 몇 개인지(가로·세로), u는 CSS px 1이 캔버스 화소 몇 개인지다. 점과 표시의 크기는 CSS px로 정한다.
    // 캔버스의 화소 수는 정수로 맞춘 값이라 가로와 세로 배율이 아주 조금 다를 수 있어 따로 쓴다.
    const kx = width / s.map.width, ky = height / s.map.height;
    const u = width / this.cssWidth;
    const at = (p: Position) => ({ x: p.x * kx, y: p.y * ky });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, width, height);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.floor, 0, 0, width, height);
    // 지금 시야: 스냅샷의 시야 다각형(캠프와 살아 있는 대원)을 본 땅 위에 칠한다. 다각형은 [x, y, x, y, …]다.
    // 메인 화면처럼 벽은 그 위에 그린다. 지금 보이는 곳은 아직 본 칸으로 오지 않았어도 밝게 보인다.
    g.fillStyle = css(sight);
    for (const polygon of s.sight) {
      g.beginPath();
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        if (i === 0) g.moveTo(polygon[i] * kx, polygon[i + 1] * ky);
        else g.lineTo(polygon[i] * kx, polygon[i + 1] * ky);
      }
      g.closePath();
      g.fill();
    }
    g.drawImage(this.walls, 0, 0, width, height);
    // 탈출 지점: 분대가 그 칸을 본 뒤에만 온다. 구역을 고리로, 열리면 채우고 확보 진행을 라임으로 그린다.
    const ext = s.extraction;
    if (ext) {
      const p = at(ext);
      const radius = Math.max(extractionRadius * kx, 4 * u);
      g.beginPath();
      g.arc(p.x, p.y, radius, 0, Math.PI * 2);
      if (ext.unlocked) { g.fillStyle = css(colors.teal, .25); g.fill(); }
      g.strokeStyle = css(colors.teal, ext.unlocked ? 1 : .7);
      g.lineWidth = 1.5 * u;
      g.stroke();
      if (ext.progress > 0) {
        g.beginPath();
        g.arc(p.x, p.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ext.progress / ext.duration));
        g.strokeStyle = css(colors.lime);
        g.lineWidth = 2 * u;
        g.stroke();
      }
    }
    // 캠프: 청록 네모 테두리다.
    const camp = at({ x: s.map.campX, y: s.map.campY });
    g.strokeStyle = css(colors.teal);
    g.lineWidth = 1.5 * u;
    g.strokeRect(camp.x - 3.5 * u, camp.y - 3.5 * u, 7 * u, 7 * u);
    // 보급 상자: 그리는 상자와 색은 메인 화면과 같은 규칙이다(palette.ts).
    for (const supply of s.supplies) {
      if (!supplyShown(supply)) continue;
      const p = at(supply);
      g.fillStyle = css(supplyColor(supply));
      g.fillRect(p.x - 2 * u, p.y - 2 * u, 4 * u, 4 * u);
    }
    // 시설: X다. 색은 메인 화면과 같은 규칙이다(남은 시설은 빨강, 부순 시설은 회색).
    for (const facility of s.facilities) {
      const p = at(facility);
      g.beginPath();
      g.moveTo(p.x - 3.5 * u, p.y - 3.5 * u);
      g.lineTo(p.x + 3.5 * u, p.y + 3.5 * u);
      g.moveTo(p.x + 3.5 * u, p.y - 3.5 * u);
      g.lineTo(p.x - 3.5 * u, p.y + 3.5 * u);
      g.strokeStyle = css(facilityColor(facility));
      g.lineWidth = 1.8 * u;
      g.stroke();
    }
    // 보이는 적: 몸 색의 작은 점이다. 고리는 두르지 않는다.
    for (const enemy of scene.enemies) {
      const p = at(enemy);
      g.beginPath();
      g.arc(p.x, p.y, 2.2 * u, 0, Math.PI * 2);
      g.fillStyle = css(enemy.color);
      g.fill();
    }
    // 메인 화면이 보고 있는 범위다. 거슬리지 않게 옅은 테두리 하나로 그린다(사용자: "너무 다 그리자고 하나요?").
    const view = at({ x: scene.view.left, y: scene.view.top });
    const end = at({ x: scene.view.right, y: scene.view.bottom });
    g.strokeStyle = 'rgba(255, 255, 255, .35)';
    g.lineWidth = u;
    g.strokeRect(view.x, view.y, end.x - view.x, end.y - view.y);
    // 대원: 대원 색의 점에 밝은 고리를 두른다. 고리로 적 점과 가른다.
    for (const player of scene.players) {
      const p = at(player);
      g.beginPath();
      g.arc(p.x, p.y, (player.me ? 3.6 : 3) * u, 0, Math.PI * 2);
      g.fillStyle = css(player.color);
      g.fill();
      g.lineWidth = (player.me ? 1.4 : 1) * u;
      g.strokeStyle = player.me ? myRing : teammateRing;
      g.beginPath();
      g.arc(p.x, p.y, (player.me ? 4.3 : 3.5) * u, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // 상자 크기는 CSS가 정한다(style.css의 --minimap-w). 화면 크기가 바뀌면 다음 프레임을 기다리지 않고 그 자리에서 맞도록,
  // JS는 맵의 가로세로 비율(--minimap-ratio)만 알린다. 맵 크기는 방마다 다르다(가로 50~70칸, 세로 38~52칸).
  // 여기서는 그림의 화소 수만 상자에 맞춘다. 맵이나 화면 크기가 바뀌거나 브라우저가 상자 크기가 바뀌었다고 알릴 때만 다시 잰다.
  private fit(s: Snapshot) {
    const ratio = s.map.width / s.map.height;
    const key = `${ratio}@${innerWidth}x${innerHeight}x${devicePixelRatio}`;
    if (key === this.fitKey) return;
    document.body.style.setProperty('--minimap-ratio', ratio.toFixed(4));
    // 상자 안쪽의 CSS 크기다. clientWidth는 정수로 반올림한 값이라 쓰지 않는다.
    const rect = this.canvas.getBoundingClientRect();
    const style = getComputedStyle(this.canvas);
    const width = rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    const height = rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    // 상자가 화면에 없으면(크기 0) 재지 않고 키도 두지 않는다. 0으로 잰 크기를 굳히면 다시 보였을 때 그림이 한 덩어리로 늘어난다.
    if (!(width > 0 && height > 0)) return;
    this.fitKey = key;
    this.cssWidth = width;
    const screenDensity = devicePixelRatio || 1;
    const density = Math.min(screenDensity, maxDensity);
    let pixelWidth = Math.max(1, Math.round(width * density)), pixelHeight = Math.max(1, Math.round(height * density));
    // 화소 밀도를 낮추지 않는 화면에서는 브라우저가 알려 준 실제 화소 수를 그대로 써서 그림과 화면의 화소가 하나씩 맞게 한다.
    // 브라우저는 상자의 두 끝을 화소 경계에 맞추므로 실제 화소 수는 잰 크기에 밀도를 곱한 값과 1까지 다를 수 있다(반올림만으로는 못 맞춘다).
    // 알려 준 값이 그보다 크게 다르면(크기가 막 바뀌어 아직 새 값이 오지 않음) 잰 값을 쓰고, 새 값이 오면 다시 맞춘다.
    const exact = this.deviceSize;
    if (exact && density === screenDensity && Math.abs(exact.width - width * density) <= 1 && Math.abs(exact.height - height * density) <= 1) {
      pixelWidth = exact.width;
      pixelHeight = exact.height;
    }
    // 화소 수를 바꾸면 그림이 지워진다. 같으면 그대로 둔다.
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
  }

  // 지형 그림을 다시 만든다. World는 지형이 바뀔 때(방이 바뀌거나, 분대가 새 칸을 보거나, 벽이 부서짐)마다 벽 배열을 새로 만들므로,
  // 배열이 바뀌었는지만 본다. 다시 푸는 조건을 여기서 따로 흉내 내면 World와 어긋날 수 있다.
  private paintTerrain(s: Snapshot, tiles: Uint8Array) {
    if (tiles === this.paintedTiles) return;
    this.paintedTiles = tiles;
    const { columns, rows } = s.map;
    const floor = this.floor.getContext('2d'), walls = this.walls.getContext('2d');
    if (!floor || !walls) return;
    for (const layer of [this.floor, this.walls]) { layer.width = columns; layer.height = rows; }
    const floorImage = floor.createImageData(columns, rows), wallImage = walls.createImageData(columns, rows);
    for (let i = 0; i < columns * rows; i++) {
      const tile = tiles[i];
      if (tile === undefined || tile === unknownTile) continue;
      const color = tile === 0 ? seenFloor : wallColors[tile] ?? colors.wall;
      const data = (tile === 0 ? floorImage : wallImage).data;
      data[i * 4] = color >> 16;
      data[i * 4 + 1] = (color >> 8) & 255;
      data[i * 4 + 2] = color & 255;
      data[i * 4 + 3] = 255;
    }
    floor.putImageData(floorImage, 0, 0);
    walls.putImageData(wallImage, 0, 0);
  }
}
