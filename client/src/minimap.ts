import { unknownTile } from './movement';
import { colors } from './palette';
import type { Position, Snapshot } from './types';

// 미니맵이다(2026-11-09 사용자 결정). 맵 전체를 북쪽이 위인 채로 상자에 맞춰 줄여 그린다. 그리는 것은 넷이다.
// - 분대가 본 칸의 지형. 보지 못한 칸은 비워 둬 상자 바탕(CSS)이 보인다.
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
// 칸 색이다. 빈 땅은 어둡게, 벽은 밝게 칠해 길이 보이게 한다. 부술 수 없는 벽(맵 가장자리 등)은 메인 화면처럼 부술 수 있는 벽보다 어둡다.
const tileColors: Record<number, number> = { 0: colors.lit, 1: colors.wall, 2: 0x3d4a4c };
// 부순 시설, 대기 중인 보급 상자는 메인 화면과 같은 회색이다.
const spent = 0x64706a, waiting = 0x829388;

export class Minimap {
  // 칸 하나가 화소 하나인 지형 그림이다. 벽 판이 바뀔 때만 다시 만든다.
  private terrain = document.createElement('canvas');
  private terrainKey = '';
  private fitKey = '';
  // 상자의 CSS 폭이다(테두리 빼고). 점과 표시의 크기를 CSS px로 정하는 데 쓴다.
  private cssWidth = 1;

  constructor(readonly canvas: HTMLCanvasElement) { }

  // 보이거나 숨긴다. 메인 화면이 맵 전체를 보이는 동안(전체 지도 보기, 투입 전, 작전 종료)에는 필요 없다.
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
    // 캔버스의 화소 수는 반올림한 값이라 가로와 세로 배율이 아주 조금 다를 수 있어 따로 쓴다.
    const kx = width / s.map.width, ky = height / s.map.height;
    const u = width / this.cssWidth;
    const at = (p: Position) => ({ x: p.x * kx, y: p.y * ky });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, width, height);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain, 0, 0, width, height);
    // 탈출 지점: 분대가 그 칸을 본 뒤에만 온다. 구역(반지름 80)을 고리로, 열리면 채우고 확보 진행을 라임으로 그린다.
    const ext = s.extraction;
    if (ext) {
      const p = at(ext);
      const radius = Math.max(80 * kx, 4 * u);
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
    // 보급 상자: 메인 화면처럼 회수한 부목표 상자와 다 쓴 상자는 그리지 않는다. 부목표는 금색, 내가 기다리는 상자는 회색이다.
    for (const supply of s.supplies) {
      if (supply.collected || supply.uses === 0) continue;
      const p = at(supply);
      g.fillStyle = css(supply.cooldown > 0 ? waiting : supply.objective ? colors.gold : colors.teal);
      g.fillRect(p.x - 2 * u, p.y - 2 * u, 4 * u, 4 * u);
    }
    // 시설: X다. 남은 시설은 빨강, 부순 시설은 회색이다.
    for (const facility of s.facilities) {
      const p = at(facility);
      g.beginPath();
      g.moveTo(p.x - 3.5 * u, p.y - 3.5 * u);
      g.lineTo(p.x + 3.5 * u, p.y + 3.5 * u);
      g.moveTo(p.x + 3.5 * u, p.y - 3.5 * u);
      g.lineTo(p.x - 3.5 * u, p.y + 3.5 * u);
      g.strokeStyle = css(facility.hp > 0 ? colors.red : spent);
      g.lineWidth = 1.8 * u;
      g.stroke();
    }
    // 보이는 적: 몸 색의 작은 점이다.
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
    // 대원: 대원 색의 점이다. 나는 조금 크게 흰 고리를 둘러 찾기 쉽게 한다.
    for (const player of scene.players) {
      const p = at(player);
      g.beginPath();
      g.arc(p.x, p.y, (player.me ? 3.6 : 3) * u, 0, Math.PI * 2);
      g.fillStyle = css(player.color);
      g.fill();
      g.lineWidth = (player.me ? 1.4 : 1) * u;
      g.strokeStyle = player.me ? 'rgba(255, 255, 255, .95)' : css(0x111a1a);
      g.beginPath();
      g.arc(p.x, p.y, (player.me ? 4.3 : 3.5) * u, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // 상자 크기는 CSS가 정한다(style.css의 --minimap-w). 화면 크기가 바뀌면 다음 프레임을 기다리지 않고 그 자리에서 맞도록,
  // JS는 맵의 가로세로 비율(--minimap-ratio)만 알린다. 맵 크기는 방마다 다르다(가로 50~70칸, 세로 38~52칸).
  // 캔버스의 화소 수는 CSS 크기에 화면의 화소 밀도를 곱한 값이라 흐리지 않다. 맵이나 화면 크기가 바뀔 때만 다시 잰다.
  private fit(s: Snapshot) {
    const ratio = s.map.width / s.map.height;
    const key = `${ratio}@${innerWidth}x${innerHeight}x${devicePixelRatio}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    document.body.style.setProperty('--minimap-ratio', ratio.toFixed(4));
    const density = devicePixelRatio || 1;
    this.cssWidth = Math.max(1, this.canvas.clientWidth);
    this.canvas.width = Math.round(this.cssWidth * density);
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * density));
  }

  // 지형 그림을 다시 만든다. 방이 바뀌거나 벽 판(분대가 새 칸을 보거나 벽이 부서짐)이 바뀔 때만 한다.
  private paintTerrain(s: Snapshot, tiles: Uint8Array) {
    const key = `${s.room}:${s.mapRevision}:${s.map.columns}x${s.map.rows}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const { columns, rows } = s.map;
    this.terrain.width = columns;
    this.terrain.height = rows;
    const g = this.terrain.getContext('2d');
    if (!g) return;
    const image = g.createImageData(columns, rows);
    for (let i = 0; i < columns * rows; i++) {
      const tile = tiles[i];
      if (tile === undefined || tile === unknownTile) continue;
      const color = tileColors[tile] ?? colors.wall;
      image.data[i * 4] = color >> 16;
      image.data[i * 4 + 1] = (color >> 8) & 255;
      image.data[i * 4 + 2] = color & 255;
      image.data[i * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }
}
