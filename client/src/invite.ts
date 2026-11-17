// 초대 링크다. 주소에 방 코드를 실어 보낸다(?room=방 코드). 받은 사람이 링크를 열면 로비가 그 방의 참가를 앞세운다(main.ts의 showInvite).
// 방 코드만 복사해 보내면 받은 사람이 코드를 복사하고, 게임 주소를 열고, 코드를 붙여 넣어야 했다(2026-11-17 사용자 요청).
// 화면(document)을 쓰지 않는 계산만 둔다. 검사가 그대로 불러 쓴다.

// 방 코드의 모양이다. 서버는 헷갈리는 글자(I·O·0·1)를 뺀 대문자와 숫자 여섯 자를 쓴다(RoomHost.NewCode).
// 여기서는 모양만 본다. 그 방이 있는지는 참가할 때 서버가 답한다.
export const roomCodePattern = /^[A-Z2-9]{6}$/;

// 방 코드를 실은 초대 링크다. 지금 주소의 출처와 경로만 쓴다. 보내는 사람의 주소에 붙은 다른 인자(?touch, ?layout)는
// 받는 사람과 관계없으므로 싣지 않는다.
export const inviteLink = (origin: string, pathname: string, room: string) => `${origin}${pathname}?room=${room}`;

// 주소에 실려 온 초대를 읽는다. search는 location.search다. 초대가 없으면 둘 다 비어 있고, 모양이 틀린 코드면 malformed다.
// 손으로 고쳐 적은 주소도 받도록 앞뒤 빈칸을 떼고 대문자로 바꿔 본다.
export function readInvite(search: string): { room?: string; malformed: boolean } {
  const value = new URLSearchParams(search).get('room');
  if (value === null) return { malformed: false };
  const room = value.trim().toUpperCase();
  return roomCodePattern.test(room) ? { room, malformed: false } : { malformed: true };
}

// 주소에서 초대만 뺀 나머지다(경로와 남은 인자, # 뒤). 초대를 쓰고 난 뒤 주소창을 이 값으로 바꾼다.
// 그대로 두면 방에서 나온 뒤에도, 새로 고칠 때마다 로비가 끝난 초대를 앞세운다.
export function withoutInvite(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('room');
  return url.pathname + url.search + url.hash;
}

// 이 기기에서만 열리는 주소인지다(localhost, 127.x.x.x, ::1). 그런 주소로 만든 초대 링크는 다른 사람의 기기에서 열리지 않는다.
// 서버를 띄운 사람이 자기 화면은 localhost로 열고 친구에게는 공개 주소를 알려 주는 경우에, 복사한 링크가 쓸모없다는 것을 알린다.
// 같은 공유기 안의 사설 주소(192.168.x.x 등)는 같은 망의 사람이 열 수 있으므로 여기에 넣지 않는다.
export function localOnly(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host) || host === '::1';
}
