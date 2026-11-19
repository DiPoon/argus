// 초대 링크다. 주소에 방 코드를 실어 보낸다(?room=방 코드). 받은 사람이 링크를 열면 로비가 그 방의 참가를 앞세운다(main.ts의 showInvite).
// 방 코드만 복사해 보내면 받은 사람이 코드를 복사하고, 게임 주소를 열고, 코드를 붙여 넣어야 했다(2026-11-17 사용자 요청).
// 화면(document)을 쓰지 않는 계산만 둔다. 검사가 그대로 불러 쓴다.

// 방 코드의 모양이다. 서버(RoomHost.NewCode)는 헷갈리는 글자(I·O·0·1)를 뺀 대문자와 숫자 여섯 자를 쓴다.
// 서버가 만들 수 없는 코드는 모양이 틀린 것으로 친다. 그런 링크를 초대로 받으면 참가를 누른 뒤에야 없는 방이라는 답을 받는다(PR #31 리뷰 9).
// 여기서는 모양만 본다. 그 방이 있는지는 참가할 때 서버가 답한다.
const roomCodePattern = /^[A-HJ-NP-Z2-9]{6}$/;

// 사람이 적거나 주소로 받은 방 코드를 서버가 쓰는 모양으로 맞춘다. 앞뒤 빈칸을 떼고 대문자로 바꾼다. 모양이 틀리면 undefined다.
// 주소로 받은 코드와 입력란에 친 코드가 같은 판정을 받도록 두 곳(readInvite, main.ts의 enter)이 이 함수 하나를 쓴다(PR #31 리뷰 10).
export function normalizeRoomCode(value: string): string | undefined {
  const room = value.trim().toUpperCase();
  return roomCodePattern.test(room) ? room : undefined;
}

// 방 코드를 실은 초대 링크다. 지금 주소의 출처와 경로만 쓴다. 보내는 사람의 주소에 붙은 다른 인자(?touch, ?layout)는
// 받는 사람과 관계없으므로 싣지 않는다.
export const inviteLink = (origin: string, pathname: string, room: string) => `${origin}${pathname}?room=${room}`;

// 주소에 실려 온 초대를 읽는다. search는 location.search다. 초대가 없으면 둘 다 비어 있고, 모양이 틀린 코드면 malformed다.
export function readInvite(search: string): { room?: string; malformed: boolean } {
  const value = new URLSearchParams(search).get('room');
  if (value === null) return { malformed: false };
  const room = normalizeRoomCode(value);
  return room ? { room, malformed: false } : { malformed: true };
}

// 주소에서 초대만 뺀 나머지다(경로와 남은 인자, # 뒤). 초대를 쓰고 난 뒤 주소창을 이 값으로 바꾼다.
// 그대로 두면 방에서 나온 뒤에도, 새로 고칠 때마다 로비가 끝난 초대를 앞세운다.
export function withoutInvite(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('room');
  return url.pathname + url.search + url.hash;
}

// 초대 링크가 어디까지 열리는지를 주소의 호스트 이름으로 가늠한다. 링크는 복사한 화면의 주소로 만들어지는데,
// 서버를 띄운 사람이 자기 화면은 localhost로 열고 친구에게는 다른 주소(터널 주소 등)를 알려 주면 복사한 링크가 친구에게 열리지 않는다.
// - device: 이 기기에서만 열린다. localhost, 127.x.x.x, ::1, 그리고 모든 주소에서 받는다는 뜻의 0.0.0.0·::다.
//   서버를 --urls http://0.0.0.0:5077로 띄우면 콘솔에 그 주소가 찍히고, 그것을 눌러 연 화면도 이 기기에서만 열린다(PR #31 리뷰 4).
// - network: 같은 망(공유기)의 기기에서만 열린다. 사설 주소(10/8, 172.16/12, 192.168/16), 링크 로컬 주소(169.254/16, fe80::/10),
//   IPv6 고유 로컬 주소(fc00::/7), .local 이름, 점이 없는 이름(같은 망의 PC 이름)이다. 같은 망의 사람은 열 수 있으므로 막지는 않고 알린다.
//   망 밖의 친구(터널로 들어올 사람)에게 보내면 열리지 않는다(PR #31 리뷰 14).
// - anywhere: 그 밖이다. 공개 주소와 터널 주소다.
// 서버는 친구가 어느 주소로 닿는지 모르므로 이것은 짐작이다. hosts 파일의 별칭처럼 이름만으로 알 수 없는 주소는 anywhere로 친다.
export type LinkReach = 'device' | 'network' | 'anywhere';

export function linkReach(hostname: string): LinkReach {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return 'device';
  if (host === '::1' || host === '::' || host === '0.0.0.0') return 'device';
  // IPv4 매핑 루프백이다. 주소창은 [::ffff:127.0.0.1]을 [::ffff:7f00:1]로 바꿔 적는다.
  if (/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host) || /^::ffff:127(\.\d{1,3}){3}$/.test(host)) return 'device';
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]), second = Number(ipv4[2]);
    if (first === 127) return 'device';
    if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254)) return 'network';
    return 'anywhere';
  }
  if (host.includes(':')) {
    // 주소창은 IPv6 주소의 각 묶음에서 앞의 0을 뺀다. 그래서 fc00::/7과 fe80::/10은 첫 묶음이 네 자리일 때만이다.
    return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) ? 'network' : 'anywhere';
  }
  if (host.endsWith('.local') || !host.includes('.')) return 'network';
  return 'anywhere';
}

// 초대 링크를 복사한 뒤의 알림이다. 가장 긴 것(device)을 터치 화면의 배치 검사가 잰다(touch.spec.ts. 검사 서버가 127.0.0.1이다).
// 다른 문구는 그보다 넓지 않게 쓴다. 넓으면 그 알림이 좁은 휴대폰에서 꺾여도 어느 검사에도 걸리지 않는다. touch.spec.ts가 폭을 견준다.
export const copiedNotices: Record<LinkReach, string> = {
  device: '초대 링크를 복사했습니다. 단, 이 주소는 이 PC에서만 열립니다.',
  network: '초대 링크를 복사했습니다. 단, 같은 망에서만 열립니다.',
  anywhere: '초대 링크를 복사했습니다. 친구에게 보내세요.',
};
