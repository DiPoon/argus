---
paths:
  - "client/tests/**"
  - "client/playwright.config.ts"
---

# 브라우저 검사 — Playwright

## 준비

- 설정(`client/playwright.config.ts`): 작업자 1, 재시도 0, 검사 제한 90초, 화면 1440×960, `--disable-webgl`(Canvas 렌더러 경로를 검사한다), 기본 주소는 `ARGUS_URL`이나 `http://127.0.0.1:5077`이다. 검사 브라우저는 훈련을 마친 브라우저(localStorage `argus-tutorial=done`, `storageState`)로 시작한다. 처음 온 사람은 로비 대신 첫 방문 화면을 보므로(`client-main.md`의 "튜토리얼"), 이 값이 없으면 로비에서 시작하는 검사가 모두 막힌다. `browser.newContext()`로 손으로 연 문맥에도 들어가고(2026-11-24에 재서 확인), 파일의 `test.use({ storageState })`도 그 파일에서 손으로 연 문맥에까지 들어간다. 첫 방문을 보는 `tutorial.spec.ts`는 파일 전체를 빈 저장소로 두고, 훈련을 마친 브라우저가 필요한 검사만 `addInitScript`로 값을 넣는다.
- 서버가 필요한 검사는 클라이언트를 먼저 빌드하고(`npm --prefix client run build`, `wwwroot`가 있어야 화면이 나온다) 서버를 `Argus__Missions__AllowHandmade=true`와 `Argus__Limits__EntriesPerMinute=1000`으로 띄운 뒤 돌린다. 앞의 것이 없으면 손으로 만든 맵과 조용한 방의 방 만들기가 HTTP 403이다. 뒤의 것이 없으면 운영 한도(주소당 1분에 방 만들기와 참가를 합쳐 30번)에 걸려, 검사가 빨리 돌 때 429를 받는다(2026-11-22 CI에서 초대 검사가 그렇게 실패했다).
- 검사가 끝나면 서버를 SIGTERM으로 끈다. 남은 기록은 `dotnet run --project tools/Argus.Replay -- server/Argus.Server/recordings --strict`로 재생해 볼 수 있다(CI가 그렇게 한다). 서버를 띄운 때와 같은 커밋에서 재생한다. 그 사이에 커밋하면 기록을 모두 다른 코드 버전으로 건너뛴다(`recording.md`).

## 파일마다 필요한 것

| 파일 | 검사 수 | 게임 서버 | 다루는 것 |
| --- | --- | --- | --- |
| `fixed.spec.ts` | 10 | 필요 없음(브라우저도 쓰지 않음) | `fixed-vectors.json`과 `fixed.ts`·`movement.ts`의 계산이 Raw까지 같은지 |
| `world.spec.ts` | 44 | 필요 없음(검사가 Vite 서버를 띄워 실제 `World`에 만든 스냅샷을 넣는다) | 그리기, 원호, 색, 예측과 서버 재조정, 대시 꼬리 |
| `minimap.spec.ts` | 12 | 일부만(`drawing` 묶음은 Vite 서버, 배치 검사는 게임 서버) | 미니맵 화소, 크기, 자리와 겹침 |
| `game.spec.ts` | 20 | 필요 | 입력(겹쳐 누름, 창을 다녀온 키), 재접속, 치트 방지 경계(위조 상태·잘못된 장비·순번 재생·신원 탈취) |
| `touch.spec.ts` | 23 | 필요 | 터치 로비와 조작, 휴대폰 크기별 배치, 스타일시트에 `:has(`가 없는지 |
| `hands.spec.ts` | 6 | 필요 | 손 그림의 짝과 자리, 마스크 |
| `invite.spec.ts` | 11 | 필요(주소 계산의 두 검사만 브라우저도 쓰지 않음) | 초대 링크의 주소와 열리는 범위, 복사, 초대받은 로비의 모양과 자리와 Tab 차례, 초대를 치우는 때, 복구 정보와의 우선순위 |
| `mission.spec.ts` | 1 | 필요(손으로 만든 맵) | 임무 봇이 작전을 끝까지 진행 |
| `tutorial.spec.ts` | 5 | 필요(튜토리얼 방) | 첫 방문 화면과 그 예외(초대 링크, 저장소를 막은 창), PC에서 키보드로 훈련을 끝까지 진행, 건너뛰기·로비의 훈련 버튼·새로 고침·나온 뒤의 HUD, 휴대폰 다섯 크기에서 안내 상자의 자리 |

그리기나 예측만 고쳤으면 서버 없이 `cd client && npx playwright test tests/world.spec.ts tests/fixed.spec.ts`로 먼저 본다.

도우미: `rooms.ts`(`quietRoom`, 조용한 방의 주소), `wire.ts`(`relay`: 페이지와 서버 사이의 WebSocket을 가운데서 이어, 보낸 입력을 모으고 스냅샷을 바꾸거나 잡아 두고 연결을 끊는다). `fixed-vectors.json`은 서버가 만든 자료라 손으로 고치지 않는다(`dotnet run --project tests/Argus.Server.Tests -- vectors`).

## 조용한 방

조용한 방은 손으로 만든 맵에 처음 적도 증원도 없는 방이다(`quietRoom`, 주소의 `?layout=quiet`. 배치는 `mission.md`). 생성 작전에서는 처음 적들이 캠프로 와서 대원을 치고(가만히 선 대원은 가장 이르면 4초에 처음 맞고 9초에 쓰러진다), 맞거나 받아친 기술은 그 순간 기술 목록에서 빠지므로, 기술이 스냅샷에 보이는지로 확인하는 검사가 적 하나에 흔들린다. **기술을 쓰거나 대원이 오래 살아 있어야 하는 새 브라우저 검사는 조용한 방에서 돌린다.** 배치만 보는 검사도 착지한 뒤 8초를 넘기면 그렇다. 혼자인 대원이 쓰러지면 작전이 끝나 화면이 바뀐다. 캠프에 선 대원이 쓰러지는 판은 착지 뒤 10초 안에 시드 300개 가운데 1판, 12초 안에 14판, 15초 안에 78판이다(2026-11-16). 미니맵의 휴대폰 배치 검사가 생성 작전에서 15초쯤 걸려 그렇게 한 번 실패했고 조용한 방으로 옮겼다. 조용한 방의 맵은 늘 40×30칸이라, 맵 비율에 기대는 배치는 가장 좁은 맵과 가장 넓은 맵의 비율을 덮어써서 잰다(`minimap.spec.ts`가 `--minimap-ratio`를 `!important`로 덮는다). 같은 내용이 `rooms.ts`의 주석에도 있다.

## 화면을 두 번 재서 견주는 검사

보이는 요소나 계산된 값을 두 번 갈무리해 견주는 검사는 화면이 가라앉은 뒤에 잰다. 작전 화면의 투입 안내는 첫 스냅샷이 오기 전부터 보이지만, 임무 진행 상자와 합류 알림은 첫 스냅샷이 와야 생기고 알림은 3.5초 뒤 사라진다. 그 사이에 재면 두 갈무리 사이에 생기거나 사라진 요소를 재려던 차이로 읽는다. `touch.spec.ts`의 폭 경계 검사가 2026-11-20에 전체 실행에서 한 번 그렇게 실패했다(서버가 보내는 글을 붙잡아 두고 재 보니, 첫 스냅샷 전에는 실패한 비교에서 늘어난 바로 그 일곱 줄만 없었다). 첫 스냅샷이 온 것(`#touch-mission`에 글이 있음)과 알림이 숨은 것(`#toast`)을 기다린 뒤 잰다. 스냅샷이 늦게 오는 때는 `page.routeWebSocket`으로 서버가 보내는 글을 늦춰 흉내 낼 수 있다.

## 서버 시각이 걸린 값은 스냅샷의 시각으로 기다린다

"누르고 0.3초 뒤에는 이만큼"처럼 서버의 시간 흐름에 달린 값을 보는 검사는 벽시계(`waitForTimeout`)로 기다린 뒤 마지막 스냅샷을 읽지 않는다. 스냅샷의 서버 시각(`now`)이 그 시점에 닿을 때까지 `expect.poll`로 기다리고 그 스냅샷에서 읽는다. CI 실행기에서는 스냅샷이 한두 장 늦게 닿는 일이 있어, 벽시계로 기다리면 마지막 스냅샷이 0.1~0.2초 전의 것일 수 있다(2026-11-23, `game.spec.ts`의 누르고 있는 기운 검사가 그렇게 실패했다). 이런 검사가 늦은 스냅샷을 견디는지는, 관찰 도우미가 스냅샷 몇 장을 늦게 받는 것으로 두는 임시 검사로 본다. `routeWebSocket`으로 페이지가 받는 프레임을 버려도 `page.on('websocket')`으로 받는 관찰 도우미에는 걸리지 않는다.

## 이름으로 고르기

Playwright는 이름으로 고를 수 있다.

```bash
cd client
npx playwright test tests/mission.spec.ts
npx playwright test -g "late join"
ARGUS_URL=http://127.0.0.1:8080 npm run test:e2e   # 다른 포트
```

## root 권한 없이 브라우저 검사 환경 만들기

`playwright install --with-deps`는 apt로 시스템 라이브러리를 설치하므로 root 권한이 필요하다. 그럴 수 없으면 브라우저와 빠진 라이브러리를 따로 받아 환경 변수로 알려 준다. 이 개발 환경(WSL)에서는 `libnss3`, `libnspr4`, `libasound2t64`가 빠져 있었다. `/tmp`는 재시작할 때 지워지므로 유지되는 곳에 둔다.

```bash
D=$HOME/.cache/argus-browser
mkdir -p $D/browsers $D/debs $D/root
(cd client && PLAYWRIGHT_BROWSERS_PATH=$D/browsers npx playwright install --only-shell chromium)
(cd $D/debs && apt-get download libnss3 libnspr4 libasound2t64)
for deb in $D/debs/*.deb; do dpkg -x "$deb" $D/root; done
cd client && PLAYWRIGHT_BROWSERS_PATH=$D/browsers LD_LIBRARY_PATH=$D/root/usr/lib/x86_64-linux-gnu npm run test:e2e
```

저장소가 Windows 드라이브(WSL의 `/mnt/e` 같은 곳)에 있으면 검사 결과 폴더를 리눅스 쪽 디스크로 돌린다(`npx playwright test --output $D/test-results`). Playwright는 실패했을 때 남기려고 검사 내내 기록(trace)을 그 폴더에 쓰는데, Windows 드라이브에는 쓰기가 느리다. 화면 크기 33가지를 재는 미니맵 휴대폰 배치 검사가 35초에서 45~90초로 늘어, 전체 실행에서 제한 시간 90초에 한 번 걸렸다(2026-11-17). 결과 폴더만 옮기면 다시 35초다. CI 실행기는 리눅스 디스크라 해당하지 않는다.

### WebKit·Firefox로 돌리기

CI와 기본 설정은 Chromium(Canvas 렌더러)만 쓴다. 다른 엔진의 동작이 걸린 변경(이미지 읽기 등)은 임시 설정 파일로 WebKit·Firefox에서도 돌려 본다(2026-11-22, PR #37 리뷰 1번). 설정에 `projects: [{ name: 'webkit', use: { browserName: 'webkit' } }, { name: 'firefox', use: { browserName: 'firefox' } }]`만 두고 Chromium 전용 `--disable-webgl`은 뺀다. 두 엔진은 이 환경에서 소프트웨어 WebGL로 그려, Pixi가 WebGL 렌더러를 쓴다. 그래서 화소를 읽는 검사는 그린 직후 캔버스를 2D 캔버스로 옮겨 읽는다(WebGL 캔버스는 `getContext('2d')`가 없다).

- `npx playwright install webkit firefox`(위의 `PLAYWRIGHT_BROWSERS_PATH`). Firefox는 그대로 돌았다.
- WebKit은 시스템 라이브러리 마흔 개쯤이 빠져 있었다. Playwright 소스(`playwright-core`의 `nativeDeps`, `ubuntu24.04-x64`의 `webkit` 목록)의 꾸러미를 위처럼 `apt-get download`로 받아 따로 푼다(`$D/root-webkit`). 없는 이름이 하나라도 있으면 전체가 멈추므로 하나씩 받는다. 받은 뒤 `ldd`로 `not found`를 다시 찾아 그 꾸러미도 받는다(두세 번 되풀이). `libbacktrace`·`libjxl`은 WebKit 묶음의 `sys/lib`에 들어 있다.
- WebKit의 감싸는 스크립트(`webkit-*/minibrowser-wpe/MiniBrowser`, `minibrowser-gtk/MiniBrowser`)가 `LD_LIBRARY_PATH`를 덮어쓰므로, 바깥 값을 뒤에 잇게 고친다(`…/sys/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}`).
- 실행: `LD_LIBRARY_PATH=$D/root-webkit/usr/lib/x86_64-linux-gnu:$D/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PLAYWRIGHT_BROWSERS_PATH=$D/browsers npx playwright test -c <임시 설정> …`. 미리 확인하는 라이브러리 검사는 gstreamer 플러그인까지 요구해 건너뛴다.
