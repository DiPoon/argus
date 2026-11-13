import type { Page } from '@playwright/test';
import type { Player, Snapshot } from '../src/types';

// 페이지와 서버 사이의 WebSocket을 가운데서 잇는다. 보낸 입력을 모으고, 서버가 보낸 스냅샷을 바꾸거나 화면에 넘기지 않고 잡아 둔다.
// 연결을 끊어 재접속 장면도 만든다.
// player와 snapshot은 서버가 마지막으로 보낸 것이다. 스냅샷을 잡아 두는 동안(holding)에도 바뀌므로, 화면이 아직 모르는
// 서버의 상태를 검사가 볼 수 있다. waiting(기다리는 누름)처럼 벽·규칙·맵과 달리 스냅샷마다 오는 값은 snapshot에서 읽는다.
export async function relay(page: Page) {
  const wire = {
    inputs: [] as { held: number[]; pressed: number[]; aim: number; moveX: number; moveY: number }[],
    player: undefined as Player | undefined,
    snapshot: undefined as Snapshot | undefined,
    change: (data: Snapshot): Snapshot => data,
    holding: false,
    held: [] as string[],
    forward: (_message: string) => { },
    drop: () => { },
    release() {
      wire.holding = false;
      for (const message of wire.held.splice(0)) wire.forward(message);
    },
  };
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    wire.drop = () => { void ws.close(); };
    wire.forward = message => ws.send(message);
    ws.onMessage(message => {
      if (typeof message === 'string' && message.includes('"input"')) wire.inputs.push(JSON.parse(message));
      server.send(message);
    });
    server.onMessage(message => {
      if (typeof message === 'string') {
        const data = JSON.parse(message);
        if (data.type === 'snapshot') {
          wire.snapshot = data as Snapshot;
          wire.player = (data as Snapshot).players.find(p => p.id === data.you);
          message = JSON.stringify(wire.change(data));
          if (wire.holding) { wire.held.push(message); return; }
        }
      }
      ws.send(message);
    });
  });
  return wire;
}
