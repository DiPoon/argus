# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Argus는 1–4인 협동 PvE 브라우저 게임이다. C# 서버(.NET 10, ASP.NET Core)가 모든 판정의 권위를 가지고, TypeScript/PixiJS 클라이언트는 입력 전달과 화면 표시만 맡는다. 문서와 주석, 커밋 메시지는 한국어로 쓴다.

## 이 문서의 구성

이 파일은 세션마다 통째로 읽히므로 "어디에 무엇이 있는가"와 "깨면 안 되는 규칙"만 둔다. 까닭·수치·버린 안 같은 세부는 `.claude/rules/*.md`에 주제별로 있고, 머리말의 `paths`에 맞는 파일을 Read·Edit·Write로 다루거나 `cat`·`head`로 한 파일을 읽을 때 저절로 불려 온다.

- 그 밖의 길로는 불려 온다는 보장이 없다. 검색(Grep·`rg`)으로 찾은 줄만 보거나 `sed -n`으로 일부만 읽을 때, `cd <폴더> && cat <파일>`처럼 다른 명령과 이어 읽을 때, 셸(`sed -i`, heredoc)로 고칠 때, 새 파일을 쓰기 전, 설계 질문에 답할 때다. 그때는 그 파일을 Read로 한 번 열거나 아래 표에서 골라 규칙 파일을 먼저 읽는다.
- 이 파일과 규칙이 어느 체크아웃의 것으로 실리는지는 세션이 worktree(`.claude/worktrees/…`)에 들어간 방법에 달려 있다. 바깥 체크아웃에서 시작해 세션을 옮기지 않고 일하면(명령마다 `cd`, 경로로 열기) worktree의 파일을 열어도 시작한 체크아웃의 것이 실린다. Bash의 `cd`로 작업 폴더가 worktree로 바뀌었다는 알림이 와도, 그 뒤에 압축하거나 이어 해도 그렇다. 그래서 그 체크아웃을 최신 master로 둔다. `EnterWorktree`로 들어가면 그때부터 규칙은 worktree의 것이 실리고, 이 파일은 문맥을 다시 만들 때(이어 하기, 압축)에야 worktree의 것이 실린다. worktree에서 시작한 세션(`claude --worktree`)에는 처음부터 worktree의 것이 실린다. 2026-11-18에 Claude Code 2.1.327의 headless 실행으로 재고 11-20에 2.1.329로 다시 재어 같았던 동작이고, 공식 문서가 보장하는 것은 아니다. 옮기지 않은 경우는 11-20에 실제 작업 세션에서도 보았다. `/cd`로 옮긴 세션은 재지 못했다(`docs/verification.md`).
- 실린 판은 문맥에 함께 적힌 그 파일의 경로로 가린다. 두 판이 함께 보이면 지금 일하는 worktree의 것을 따른다. 규칙이 실리지 않았거나 실린 판이 지금 고치는 브랜치의 것이 아니면 아래 표에서 골라 그 브랜치의 파일을 직접 읽는다. 이 파일이나 규칙 파일을 고치는 브랜치에서는 실린 것이 고치기 전의 판일 수 있다.
- 새로 알게 된 세부는 이 파일이 아니라 맞는 규칙 파일에 적는다. 이 파일은 200줄 안으로 둔다.

| `.claude/rules/` | 내용 | 불러오는 파일(해당 검사 파일 포함) |
| --- | --- | --- |
| `determinism.md` | 틱 시각, 시드 난수, 금지한 수학 함수, 고정소수점, 상태 요약 | `Game/**` |
| `combat.md` | 기운·장판 판정, 기술 속성, 2티어, 잡기, 대시, 같은 순간의 판정 | `Match.cs`, `Match.Combat.cs`, `SkillDefinition.cs`, `Rules.cs`, `Model.cs` |
| `steering.md` | 적 조향의 규칙마다 없으면 생기는 일, 고칠 때 재는 법, 남는 한계, 예고하는 적의 방향 | `Match.Movement.cs` |
| `input.md` | 입력 검증, 누름과 누르고 있음, 기다리는 누름 | `Match.cs`, `Model.cs` |
| `authority.md` | 시야 필터, 투입, 분대가 본 칸, 시드와 id, 기록 비공개, 압축 | `Snapshot*.cs`, `Match.cs`, `BattleMap.cs`, `Networking/**`, `Program.cs` |
| `protocol.md` | 공통·수신자별 스냅샷, 벽 판 번호, 직렬화 | `Snapshot*.cs`, `Program.cs`, `types.ts`, `docs/protocol.md` |
| `server-runtime.md` | 틱 루프, 방의 수명과 상한, 잠금, WebSocket 닫기, 접속 복구, Docker | `Networking/**`, `Program.cs`, `Dockerfile`, `compose.yaml` |
| `recording.md` | 기록 형식과 쓰기, 재생, 버그 제보, CI의 재생 | `Recording/**`, `MatchRecord.cs`, `MatchReplay.cs`, `tools/**`, `ci.yml` |
| `mission.md` | 배치 검증, 손으로 만든 맵과 조용한 방, 맵 생성 순서, 처음 적 | `MissionLayout.cs`, `MissionGenerator.cs` |
| `prediction.md` | 서버와 같은 계산(대조 자료), 서버 재조정, 예측의 한계 | `fixed.ts`, `movement.ts`, `world.ts` |
| `client-main.md` | 키·마우스·터치의 누름 보내기, HUD, 방을 나갈 때 비우기, 초대 링크, 터치 화면과 CSS 주의점 | `main.ts`, `invite.ts`, `style.css`, `index.html` |
| `client-render.md` | 기운·장판 그리기, 원호, 벽 구역, 상성 색, 손 그림 | `world.ts`, `palette.ts`, `rps.ts`, `loadout.ts` |
| `client-minimap.md` | 미니맵의 크기와 자리, 알림이 비켜 가는 자리 | `minimap.ts`, `style.css` |
| `server-tests.md` | 하네스, 하나만 실행하기, 파일마다 다루는 것, 도우미 | `tests/Argus.Server.Tests/**` |
| `browser-tests.md` | 스펙마다 서버가 필요한지, 조용한 방, root 없는 환경 | `client/tests/**` |

## 명령어

모든 명령은 저장소 루트에서 실행한다. .NET 10 SDK와 Node.js 24(CI 기준)가 필요하다.

```bash
npm --prefix client ci                                         # 의존성 설치
npm --prefix client run typecheck                              # tsc --noEmit
npm --prefix client run build                                  # 타입 검사 + vite build → server/Argus.Server/wwwroot
dotnet build server/Argus.Server/Argus.Server.csproj           # 경고 하나로 실패한다
dotnet run --project server/Argus.Server --urls http://127.0.0.1:5077
dotnet run --project tests/Argus.Server.Tests                  # 서버 검사 전체 (218개, 빌드 포함 약 20초)
dotnet run --project tests/Argus.Server.Tests -- determinism   # 결정론 묶음만 (CI의 Windows·macOS가 쓴다)
dotnet run --project tests/Argus.Server.Tests -- vectors       # client/tests/fixed-vectors.json을 지금 서버 계산으로 다시 쓰기
dotnet run --project tools/Argus.Replay -- <기록.jsonl.gz> [--until <틱> [--snapshot <대원 id>]]   # 기록 하나 재생. 그 틱에서 멈춰 상태와 그 대원의 화면 보기
dotnet run --project tools/Argus.Replay -- <기록 폴더> [--strict]   # 폴더 전체 확인. --strict는 폴더에만 듣는다(파일에 주면 말없이 무시한다)
cd client && npx playwright install --with-deps chromium       # 브라우저 설치(처음 한 번. root 권한이 없으면 browser-tests.md)
cd client && npm run test:e2e                                  # 브라우저 검사 전체 (121개, 서버가 5077에 떠 있어야 한다)
cd client && npx playwright test tests/world.spec.ts -g "이름 일부"
```

- 린터와 포매터, 솔루션 파일(.sln)은 없다. 정적 검사는 C# 세 프로젝트의 `TreatWarningsAsErrors`·`Nullable`과 TypeScript `strict`(`tsc --noEmit`)가 전부다. 외부 NuGet 패키지는 없고, npm 런타임 의존성은 `pixi.js` 하나다.
- `wwwroot`는 git에서 제외된다. **클라이언트를 빌드해야 서버가 화면을 제공한다.** 새로 클론했으면 클라이언트 빌드가 먼저다.
- 브라우저 검사용 서버는 `Argus__Missions__AllowHandmade=true`로 띄운다. 없으면 손으로 만든 맵과 조용한 방(`?layout=quiet`)의 방 만들기가 HTTP 403이다. `world.spec.ts`와 `fixed.spec.ts`는 게임 서버 없이 돈다.
- UI 작업 중에는 서버를 5077로 켜 두고 `npm --prefix client run dev`로 <http://localhost:5173>을 연다. Vite가 `/api`·`/health`·`/ws`를 5077로 전달한다.
- 서버 검사에는 이름으로 고르는 필터가 없다(`server-tests.md`). 서버는 SIGTERM으로 끈다. 그래야 기록이 끝 줄과 함께 닫힌다. 기록은 남긴 서버와 같은 커밋에서 재생한다(`recording.md`).
- CI(`.github/workflows/ci.yml`): `server`(빌드와 서버 검사)·`client`(빌드)·`browser` 작업이 서로 기다리지 않고 함께 돈다. `browser`는 클라이언트를 스스로 빌드해 브라우저 검사를 돌리고 남은 기록을 `--strict`로 재생한다. `cross-os`만 `browser`를 기다렸다가 Windows·macOS에서 결정론 묶음과 같은 기록의 재생을 돌린다. PR과 master 푸시에서 돈다.

## 디렉터리 지도

```text
server/Argus.Server/
  Program.cs                시작점. /health, POST /api/rooms, POST /api/rooms/{code}/join, /ws.
                            WebSocket 메시지(input·deploy·loadout·ping·report·reportNote) 해석, 참가 제한, 닫는 절차
  Networking/RoomHost.cs    방 목록과 33ms 틱 루프(BackgroundService). Room·Peer·TickClock·PublishSchedule·EntryFailure.
                            방 만들기(Create)·참가(Join)·접속(Attach/Detach)·진행(StepRoom)·방송(PublishSnapshots)·제보(Report)
  Networking/AddressKeys.cs 주소별 제한의 키(IPv6 /64, 사설망은 방 수 상한에서 제외)
  Game/                     결정론 시뮬레이션. Networking과 Recording을 참조하지 않는다
    Match.cs                한 방의 상태. 바깥 요청(Join·SetLoadout·Deploy·Input·Disconnect·AwaitConnection·Connect),
                            Step/RunTick, 대원의 한 틱(UpdatePlayer), 보급·증원·임무 종료, 본 칸(Explore)·Visible·PublicTiles
    Match.Combat.cs         ResolveCombat → 적마다 ResolveEnemy → ApplyCombatResults. 잡기 대상, 시설·벽 파괴
    Match.Movement.cs       몸 충돌(CanOccupy·MoveBody), 적 생성, 흐름장, 적 조향(ActEnemies → PlanMoves → MoveEnemies)
    Match.StateHash.cs      진행 상태 전체의 요약값
    Model.cs                Player·WaitingPress·PlayerAction·EnemyAction·EnemyPlan·Enemy·Facility·Supply·Effect·Notice
    Rules.cs                틱 상수(초당 30), 규칙 값, 대원 기술 정의(AllSkills), 장비 검사(ValidSlots)
    SkillDefinition.cs      SkillDefinition, Affinity.Beats, EnemySkill, EnemyDefinition(Grunt·Breaker·Warden·Chainer)
    Fixed.cs FixedVector.cs Angle.cs   고정소수점(1/4096), 벡터, 각도(한 바퀴 65536칸)
    SeededRandom.cs         HMAC-SHA256 카운터 난수, 용도별 시드(Derive)
    BattleMap.cs            벽 배열, CanStand, RayWall, Reveal, DeepestWall
    MissionLayout.cs        배치 데이터와 검증, CreateHandmade·CreateQuiet
    MissionGenerator.cs     방의 시드로 맵 생성
    Snapshot.cs             공개 상태 선별(CreateShared·CreatePersonal·Combine)
    SnapshotMessage.cs      전송 자료구조(SnapshotMessage, PersonalSnapshot, …)
    MatchRecord.cs MatchReplay.cs LayoutRecord.cs StateHasher.cs   기록 한 줄·헤더·IMatchRecorder, 재생, 배치의 기록 형식, 요약 계산
  Recording/                RecordingStore(폴더와 보관 수) → RecordingFile(쓰기), RecordingReader, RecordingCheck(폴더 판정), RecordingFormat
tests/Argus.Server.Tests/   자체 콘솔 하네스. Program.cs(Main·Fixture·TestTools), Pad.cs(입력 도우미), *Tests.cs 13개
tools/Argus.Replay/         기록 재생 명령(Program.cs 하나)
client/src/
  main.ts invite.ts         로비, 접속, 입력(키·마우스·터치), HUD, 재접속. invite.ts는 초대 링크(?room=방 코드)의 주소 계산
  world.ts                  PixiJS 그리기, 스냅샷 보간, 이동 예측과 서버 재조정(World)
  minimap.ts                미니맵(Minimap)
  movement.ts fixed.ts      서버의 대원 한 틱과 고정소수점을 옮긴 것(예측용)
  types.ts                  통신 형식의 TypeScript 쪽
  palette.ts rps.ts loadout.ts   색과 그리는 규칙, 손 그림 SVG, 로비의 장비 표
  style.css                 모든 화면의 CSS
client/tests/               Playwright 스펙 8개, 도우미 rooms.ts·wire.ts, 서버가 만든 fixed-vectors.json
docs/                       requirements·combat·protocol·verification (아래 "문서")
```

의존 방향은 한쪽이다. 서버는 `Program.cs` → `Networking` → `Recording` → `Game`이고, `Game`은 기록을 `IMatchRecorder` 인터페이스로만 안다. 검사와 재생 도구는 서버 프로젝트를 참조한다. 클라이언트는 `main.ts` → `world.ts`·`minimap.ts` → `movement.ts` → `fixed.ts`이고, 색은 `palette.ts`, 형식은 `types.ts`를 함께 쓴다.

읽는 요령:

- 코드의 주석이 까닭과 처리 순서를 자세히 적고 있다. 이름을 Grep으로 찾아 그 둘레만 읽는다. 큰 파일(`LifecycleTests.cs`, `EncounterTests.cs`, `world.spec.ts`, `CombatTests.cs`, `touch.spec.ts`, `main.ts`, `Match.cs`, 각 58~107KB)은 통째로 읽지 않는다.
- `docs/verification.md`(408KB)는 `rg -n '^## ' docs/verification.md`로 절을 찾아 그 부분만 읽는다. `client/tests/fixed-vectors.json`(생성물)과 `client/package-lock.json`은 읽지 않는다.

## 실행 모델

- `RoomHost`의 타이머 하나가 33ms마다 깨어 `TickClock`이 정한 틱 수(한 번에 8틱까지)만큼 방마다 `Match.Step()`을 부른다. 스냅샷은 0.1초마다 보낸다. 방이 둘 이상이면 방마다 동시에 진행한다.
- `Match.Step()`은 정확히 한 틱(1/30초)이다: `Tick++` → `RunTick` → `Explore` → 30틱마다 기록에 요약값.
- `RunTick`의 차례: 끝난 효과와 유예가 지난 대원 치우기 → 전멸 확인 → 착지 → 대원마다 `UpdatePlayer`(입력 끊김 처리 → 끝난 기술 치우기 → 기운 잇기 → 기다리는 누름으로 시작 → 이동 → 보급) → 증원 → 흐름장(0.5초마다) → `UpdateEnemies` → `ResolveCombat` → 쓰러진 적 치우기 → 전멸 확인 → 탈출 진행.
- 방의 종류: 운영 방은 생성 맵에 `Rules.ForGeneratedMission()`(엘리트 켬, 선딜 1배)이다. 기본 규칙 `new Rules()`는 검사가 쓰는 튜토리얼 수준(병사만, 선딜 2배)이다. 손으로 만든 40×30 맵(`layout: "handmade"`)과 적이 없는 조용한 방(`"quiet"`)은 검사용이고 `Argus:Missions:AllowHandmade`가 켜져 있어야 만들 수 있다.
- 메모리 기반 단일 인스턴스다. DB가 없고 재시작하면 방과 토큰이 사라진다. 디스크에 남는 것은 재현용 기록(`recordings/`, git 제외)뿐이다. 역방향 프록시 뒤에서는 `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`를 켜야 주소 기준 제한이 사용자마다 따로 센다. 이 설정은 앞단을 모두 믿으므로 프록시가 X-Forwarded-For를 덮어쓰거나 뒤에 덧붙이는 구성에서만 켜고, 서버를 직접 노출할 때는 켜지 않는다(켜면 클라이언트가 헤더로 주소를 바꿔 제한을 피한다). 공개 배포 전에는 서버가 보는 접속 주소부터 확인한다(`server-runtime.md`).

## 깨면 안 되는 규칙

요약이다. 까닭과 예외는 해당 규칙 파일에 있다.

### 결정론 (`Game/`)

- 시각은 모두 틱 번호(`long`)로 저장하고 비교한다. 초로 정한 기간은 `Rules.ToTicks`로 시작부터 한 번에 올리고, 초는 스냅샷으로 보낼 때만 쓴다.
- 게임 진행에 쓰는 난수는 `Match`의 `SeededRandom` 하나에서만 뽑는다. 맵 생성은 거기서 뽑지 않고 `SeededRandom.Derive(seed, "mission-layout")`로 따로 뽑은 시드를 쓴다(같은 수를 쓰면 공개되는 맵 모양으로 숨은 적을 알 수 있다). `Random`·`RandomNumberGenerator`·시계·`Math.Sin`/`Cos`/`Atan2`/`Pow`·`MathF`·`Vector2`를 쓰지 않는다. 삼각함수는 `Angle`, 제곱근은 `Fixed`다. `HashSet`·`Dictionary`의 순회 순서에 진행을 맡기지 않는다.
- 좌표와 거리는 `Fixed`·`FixedVector`로 계산한다. 거리는 제곱끼리 비교하고, 타일 번호는 `Fixed.FloorDivide`로 내리고, 초당 값은 `Rules.TicksPerSecond`로 나눠 틱당 값으로 바꾼다. `FromDouble`·`FromRadians`는 바깥에서 온 값(설정, 클라이언트 입력)에만 쓴다.
- `Match.Step()`은 진행할 시간을 받지 않는다. 판정을 더할 때 한 틱씩 진행한다는 가정을 깨지 않는다.

### 서버 권위와 시야

- 시야 밖의 적·예고·효과는 `Snapshot.CreateShared`가 직렬화 전에 뺀다. 적에 관한 필드를 더할 때 이 필터를 우회하지 않는다. 보지 못한 칸의 정보는 `Match.Explored`로 거른다.
- 결과가 숨은 적에 따라 달라지는 동작은 실패나 거절로 알리지 않는다(투입은 본 칸의 벽만 보고 답한다).
- 클라이언트가 정할 수 있는 것은 이동 방향·조준 방향·슬롯 번호뿐이다. 기술은 `pressed`(누름)로만 한 번 시작하고, `held`로 누름을 짐작하지 않는다. 클라이언트는 판정 결과를 정하지 않는다.
- 시드를 클라이언트에 보내지 않는다. 서버가 보내는 메시지에 토큰 같은 비밀을 넣지 않는다(WebSocket 압축). 숨은 사건에 공개 순번(`_nextId`)을 쓰지 않는다.
- 재현용 기록 파일을 서버 밖으로 내보내지 않는다(내려받는 HTTP 경로 금지). 예외는 CI 검사 방의 기록이다.
- 서드파티 클라이언트를 허용하므로 공식 클라이언트에서만 동작하는 장치로 규칙을 강제하지 않는다.

### 동시성

- `Match`를 만지는 모든 경로는 `lock (room.Gate)` 안에서 만진다. 방을 찾은 뒤 잠금을 잡는 경로는 잠금 안에서 `IsRegistered`로 다시 확인한다.
- 클라이언트가 보낸 JSON 값은 `ValueKind`를 확인한 뒤 읽는다. 연결 오류가 아닌 예외는 결함으로 기록된다.

### 전투

- 상성(타격 < 방어 < 잡기 < 타격)은 `Affinity.Beats(response, attack)` 한 곳에 있고 **기술 id가 아니라 `Kind`를 비교한다.** id `strike`/`parry`/`grab`의 `Kind`는 `strike`/`block`/`channel`이다.
- 기술별 동작은 `SkillDefinition`의 속성으로 판단한다. 판정 코드에 `Skill.Id == "parry"` 같은 비교를 넣지 않는다.
- 한 틱의 판정은 그 틱이 시작할 때의 대원 상태로 한다. 판정 도중에 대원의 상태를 바꾸지 않고 `ApplyCombatResults`로 미룬다.
- 적은 예고하는 동안 노린 대원 쪽으로 돈다. 걸어서 피할 틈(도는 빠르기 한도, 방향 굳히기)을 만들지 않는다. 피하기는 대시가 맡는다.

## 함께 고칠 곳

| 바꾸는 것 | 함께 고칠 곳 |
| --- | --- |
| 전송 형식(스냅샷, 입력, 메시지) | 스냅샷은 `Game/SnapshotMessage.cs` + `client/src/types.ts`, 입력과 그 밖의 메시지는 `Program.cs`(읽고 답하는 곳) + `client/src/main.ts`(보내는 곳), 어느 쪽이든 `docs/protocol.md`. 형식을 깨면 버전(지금 6: `/health`의 `protocol`, 스냅샷의 `version`)을 올린다 |
| 수신자마다 다른 값 | `PersonalSnapshot`에 넣는다. `SnapshotMessage`에 넣으면 모두에게 같은 값이 간다 |
| `Match`의 상태 필드 | `Match.StateHash.cs`에도 넣는다 |
| 바깥에서 `Match` 상태를 바꾸는 메서드 | 그 메서드가 `Recorder`에 적고, `MatchReplay.Apply`가 다시 반영한다 |
| 클라이언트가 따라 하는 서버 계산(고정소수점 연산, 대원 이동, 기술을 시작하는 차례. 해당하는 함수의 목록은 `prediction.md`) | `client/src/fixed.ts`·`movement.ts` + `-- vectors`로 대조 자료를 다시 만든다 |
| `MissionGenerator` | `GeneratorTests`의 고정값(SHA-256). 의도한 변경일 때만 |
| `SeededRandom`이 뽑는 방식 | `SeededSequence`의 고정값. 예전 기록은 재현할 수 없게 된다 |
| 대원 기술 추가 | `Rules.AllSkills` + `types.ts`(`Skill`·`skillNames`) + `loadout.ts` + `main.ts`의 `skillNotes` |
| 색, 목표를 그리는 규칙 | `palette.ts` 한 곳(메인 화면과 미니맵이 함께 쓴다). 상성 색은 CSS 변수와 같은 값 |
| 입력을 보내는 경로 | 반드시 `main.ts`의 `sendInput`을 거친다(예측이 기록한다) |
| 방마다 바뀌는 HUD 요소 | `main.ts`의 `firstTexts` |
| 게임 규칙 | `docs/combat.md`의 해당 절, 필요하면 `docs/requirements.md`와 README |
| 새 서버 검사 파일 | `tests/Argus.Server.Tests/Program.cs`의 `Register` 호출 |

## 코드 작성 방식

**C#은 [AGENTS.md](AGENTS.md)를 따른다.** 사용자는 C#을 학습 중이고 축약 문법보다 기본 문법을 선호한다.

- 명시적 타입, 일반 생성자, 중괄호 있는 `if`/`else`와 `for`/`foreach`를 쓴다.
- LINQ 연결, switch 식, 복잡한 패턴 매칭, 삼항 연산자, 식 본문 메서드, 주 생성자(primary constructor), target-typed `new`, 컬렉션 식을 **피한다**.
- 한 줄에 한 동작. 중요한 처리 순서와 이유는 짧은 한국어 주석으로 남긴다.
- 자동 속성, nullable, `async`/`await`, `lock`은 목적이 있으므로 유지한다. 문법을 피하려고 동작을 복잡하게 바꾸지 않는다.
- 기존 검사의 간결한 표현은 유지해도 되지만, 새로 쓰거나 수정하는 검사에는 위 방식을 적용한다.
- 모양: 파일 범위 네임스페이스, `sealed` 클래스, 비공개 필드는 `_camelCase`, 들여쓰기 4칸.

TypeScript는 이 제약을 받지 않는다. `main.ts`처럼 간결한 화살표 함수와 템플릿 문자열을 쓰고, 작은따옴표와 세미콜론, 들여쓰기 2칸이다. `verbatimModuleSyntax`라 형식은 `import type`이나 `type` 수식어로 가져온다.

주석과 문서는 무엇이 아니라 왜를 적고, 결정에는 날짜와 근거(사용자 결정, PR 리뷰 번호, 잰 수치)를 남긴다. 용어는 대원(player), 분대, 칸(맵의 한 칸. 화면의 네모는 "상자"), 기운(aura), 장판(zone), 누름과 누르고 있음, 검사(test), 틱이다.

## 작업 흐름

- 고친 뒤 확인: 서버 코드는 서버 검사 전체, 클라이언트는 `npm --prefix client run build`와 관련 스펙, 입력·통신·화면 흐름은 브라우저 검사 전체. 검사를 하나만 돌리려고 한 임시 수정은 되돌리고 전체를 다시 통과시킨 뒤 커밋한다.
- 규칙을 고정하는 검사를 더하면 그 규칙을 일부러 틀리게 바꿔 검사가 잡는지 본다.
- 가독성 정리처럼 동작을 바꾸지 않아야 하는 작업에서는 게임 규칙과 통신 형식을 보존하고, 서버 검사와 브라우저 검사로 회귀가 없음을 확인한다.
- 검증을 수행했으면 `docs/verification.md` 맨 위에 날짜와 확인한 범위, 확인하지 못한 것을 남긴다.
- 커밋은 영역마다 나누고 제목에 접두어를 붙인다(`서버:`, `화면:`, `검사:`, `문서:`). 본문은 무엇을 왜 바꿨는지와 검사를 목록으로 적는다. 작업은 브랜치(`feature/…`, `fix/…`)에서 PR로 master에 합친다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 합의한 목표와 범위. 무엇을 넣지 않기로 했는지 포함 |
| [docs/combat.md](docs/combat.md) | 확정된 전투 판정 규칙, 시험 수치, 아직 규칙이 아닌 임시 처리 |
| [docs/protocol.md](docs/protocol.md) | protocol v6 통신 형식과 버전별 변경 |
| [docs/verification.md](docs/verification.md) | 날짜별 검증 기록과 실제 확인한 범위. 새 기록이 맨 위다 |

`docs/combat.md`는 세 층으로 나뉜다. **합의한 규칙**은 바꾸기 전에 확인을 받고, **시험 설정**의 수치는 자유롭게 조정하며, **규칙으로 확정하지 않은 임시 처리**는 지금 적당히 맞춰 둔 동작이라 바꿔도 규칙 위반이 아니다. 어느 층에 해당하는지 먼저 판단한다. 게임 규칙을 바꾸면 해당 절을 함께 고친다.
