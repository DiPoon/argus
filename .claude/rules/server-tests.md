---
paths:
  - "tests/Argus.Server.Tests/**/*.cs"
---

# 서버 검사 — 자체 콘솔 하네스

## 실행과 하나만 실행하기

서버 검사는 xUnit이 아니라 `tests/Argus.Server.Tests/Program.cs`의 자체 콘솔 하네스다. 인자 없이 돌리면 `Main()`이 열세 개의 `Register` 호출로 모든 검사를 등록한 뒤 순서대로 실행한다. 이름으로 고르는 필터는 없고, `-- determinism`을 주면 결정론 검사(`DeterminismTests`, `FixedTests`, `ClientParityTests`, `GeneratorTests`)만 돌린다. `-- vectors`는 검사 대신 클라이언트 예측 대조 자료를 다시 쓴다. 전체가 빌드를 포함해 20초 안팎이면 끝나므로 보통 그대로 돌린다. 하나만 보려면 `Program.cs`의 `Register` 호출을 임시로 줄이거나 해당 `*Tests.cs`의 `Register`에서 `tests.Add` 줄을 임시로 주석 처리한다. **임시 수정을 되돌리고 전체를 다시 통과시킨 뒤 커밋한다.**

검사 하나는 `Register` 안의 `tests.Add(new TestCase("영어 문장으로 쓴 이름", 메서드))` 한 줄이고, 실패는 예외다. 출력은 검사마다 `PASS 이름`이나 `FAIL 이름`, 마지막 줄은 `218/218 checks passed`다(2026-11-20. `-- determinism`은 26개, 약 13초).

## 파일마다 다루는 것

| 파일 | 검사 수 | 다루는 것 | 함께 읽을 규칙 |
| --- | --- | --- | --- |
| `LifecycleTests.cs` | 46 | 투입·재접속·보급·임무 종료, `RoomHost`(방 만들기와 상한, 연결), 스냅샷 전송 모양(`TimedWireShape`·`SkillWireTimes`·`SharedSnapshot`·`EnemyWireShape`) | `server-runtime.md` |
| `EquipmentTests.cs` | 18 | 장비 칸, 마나, 누른 차례와 기다리는 누름 | `input.md` |
| `CombatTests.cs` | 39 | 상성 아홉 가지, 받아치기, 잡기, 2티어 합산, 같은 순간의 판정, 기술 속성(`SkillFlags`·`AroundSkills`) | `combat.md` |
| `AuraTests.cs` | 16 | 기운·장판 모델, 누르고 있는 기운, 같은 순간의 장판, 사슬병의 잡기 Ⅱ(`GrabElite`) | `combat.md`, `input.md` |
| `DashTests.cs` | 7 | 대시 | `combat.md` |
| `EncounterTests.cs` | 39 | 적 출현과 증원의 종류(`ReinforcementShares`·`ReinforcementsOverTime`), 예고와 방향, 조향 장면 | `steering.md` |
| `DeterminismTests.cs` | 7 | 시드 난수 고정값, 같은 시드 같은 상태, `TickClock`, 이식성(`PortabilityCheck`가 IL을 읽는다) | `determinism.md` |
| `FixedTests.cs` | 9 | 고정소수점과 각도, 고정값 | `determinism.md` |
| `ClientParityTests.cs` | 2 | 클라이언트 대조 자료가 지금 계산과 같은지. `-- vectors`가 이 파일의 `Write`로 자료를 다시 쓴다 | `prediction.md` |
| `RecordingTests.cs` | 13 | 기록, 재생, 보관, 제보 | `recording.md` |
| `LayoutTests.cs` | 6 | 배치 검증, 맵 크기 | `mission.md` |
| `GeneratorTests.cs` | 8 | 맵 생성 조건과 고정값(SHA-256) | `mission.md` |
| `ExplorationTests.cs` | 8 | 분대가 본 칸, 바뀐 벽 보내기 | `authority.md` |

## 도우미(`Program.cs`, `Pad.cs`)

- `Fixture`: 손으로 만든 맵, 시드 73, 기본 규칙은 `new Rules { MaxEnemies = 0 }`이라 처음 적도 증원도 없다(`PlaceInitialEnemy`가 상한을 보고 넘어간다). 대원 `p`가 캠프에 착지해 살아 있는 상태로 시작한다. 적은 검사가 아래 도우미로 직접 둔다.
- `TestTools.Advance(match, 초)`: 정수 틱으로만 진행하고 나머지는 한 틱으로 올린다. `StepUntil(match, 틱)`은 틱을 정확히 맞춘다.
- `TestTools.NewHost(...)`: 검사의 `RoomHost`는 모두 이것으로 만든다. 방마다 정수 1, 2, 3, …의 시드를 차례로 쓴다(`TestSeeds`).
- `TestTools.Scout(match, player, point)`: 캠프에서 먼 곳을 다루기 전에 그곳을 본 칸으로 만든다. 안 본 칸은 스냅샷에 실리지 않고 투입도 받지 않는다.
- `Check`·`Equal`·`Near`·`Throws<T>`·`Distance`: 확인과 비교.
- `Ally`(동료 대원), `Target`(대원 오른쪽 50에 두는, 움직이지도 행동하지도 않는 적), `Threat`·`BeginAction`(기술을 쓰는 중인 적. 기술이 `arrivesIn`초 뒤에 닿게 시작 틱을 앞당긴다. 검사가 직접 만든 행동은 `TargetId`가 없어 돌지 않는다).
- `Prepare`: 입력을 거치지 않고 대원의 기술을 시작한다. 버튼은 이미 놓은 것이라 기운은 가장 짧게만 돈다. 누르고 있는 장면은 입력으로 만든다.
- `Gone(player, action)`: 기술이 목록에서 빠졌는지(완벽 대응을 냈거나 끊김).
- `Pad`: 클라이언트처럼 입력을 틱마다 보낸다(`Send`는 틱을 진행하지 않고, `Play`·`Run`·`Press`·`Tap`·`RunUntilBusyLeft`는 진행한다). **입력을 다루는 검사는 `Pad`를 쓴다.** 입력 없이 시간을 흘리면 0.35초 무입력 처리가 버튼을 뗀 것으로 만들어 결함을 가린다.

## 쓰는 방식

- 새로 쓰거나 고치는 검사는 `AGENTS.md`의 C# 작성 방식을 따른다. 기존 검사의 간결한 표현은 그대로 두어도 된다.
- 시간은 틱으로 센다. 실제 시간과 소켓에 기대는 검사는 거의 `LifecycleTests`와 `RecordingTests`에 있고, CI는 이런 검사를 리눅스에서만 돌린다.
- 규칙을 고정하는 검사를 더할 때는 그 규칙을 일부러 틀리게 바꿔 검사가 잡는지 본다(변형 검사). 고정값(SHA-256, 첫 난수)이 바뀌는 변경은 의도한 것인지 확인한 뒤 새 값으로 고친다.
- 새 검사 파일을 만들면 `Program.cs`의 `Main`에 `Register` 호출을 더한다. 운영체제에 따라 달라질 수 있는 계산의 검사면 `determinism` 묶음에도 넣는다.
