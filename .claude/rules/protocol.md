---
paths:
  - "server/Argus.Server/Game/Snapshot.cs"
  - "server/Argus.Server/Game/SnapshotMessage.cs"
  - "client/src/types.ts"
  - "docs/protocol.md"
---

# 프로토콜 — 스냅샷을 만들고 보내는 방식

무엇을 보내면 안 되는지는 `authority.md`, 시간 필드를 틱에서 초로 바꾸는 규칙은 `determinism.md`의 "시각은 모두 틱 번호"에 있다.

통신 형식은 [docs/protocol.md](../../docs/protocol.md)의 protocol v6이다. `/health`의 `protocol`과 스냅샷의 `version`이 모두 6이다. `Game/Snapshot.cs`(공개 상태 선별)와 `Game/SnapshotMessage.cs`(전송 자료구조)가 서버 쪽이고, `client/src/types.ts`가 같은 모양을 TypeScript로 옮겨 둔 것이다.

방송할 때 `RoomHost.PublishSnapshots`는 `Snapshot.CreateShared`로 팀 공통 부분(시야 계산 포함)을 한 번만 만들고, 수신자마다 `Snapshot.CreatePersonal`로 `you`, 보급 `cooldown`, 기다리는 누름 `waiting`(있을 때만), 그리고 `walls`·`rules`·`map`을 담을지를 정한다. `walls`는 그 연결이 아직 받지 못한 판일 때만, `rules`·`map`은 아직 받지 못했을 때만 담는다. 받았는지는 **보낸 뒤에** `Peer.MarkSent`가 기록한다(`Peer.Send`). 만들 때 기록하면, 느린 연결에서 그 스냅샷이 버려졌을 때 클라이언트가 바뀐 벽을 영영 받지 못한다. 클라이언트(`main.ts`)와 임무 검사 봇은 빠진 값을 같은 방의 이전 스냅샷에서 이어 쓴다. 직렬화도 공통 부분은 방송마다 한 번만 한다. `Snapshot.SerializeShared`가 공통 부분을 한 번 직렬화하고, `Snapshot.Combine`이 수신자별 `PersonalSnapshot`을 직렬화한 뒤 두 JSON의 바깥 중괄호 안쪽을 원본 배열에서 바로 복사해 쉼표로 잇는다. `SnapshotMessage`에는 수신자별 속성이 없으므로 공통 부분에 수신자별 값이 섞일 수 없다. 연결 직후 한 명에게 보내는 `Snapshot.Create`도 같은 방식으로 만든다. **수신자별 값을 새로 추가하면 `PersonalSnapshot`에 넣는다.** `SnapshotMessage`에 넣으면 모든 수신자에게 같은 값이 간다. `LifecycleTests`의 `SharedSnapshot`이 수신자별 값을 확인하고, 그 값을 뺀 나머지가 공통 부분과 같은지 확인한다.

**전송 형식을 바꾸면 세 곳을 함께 갱신한다**: `SnapshotMessage.cs`, `client/src/types.ts`, `docs/protocol.md`. 이전 버전과는 호환되지 않으므로 서버와 브라우저 빌드를 같이 배포한다. 통신 형식을 깨는 변경은 버전을 올린다.
