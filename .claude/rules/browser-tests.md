---
paths:
  - "client/tests/**"
  - "client/playwright.config.ts"
---

# 브라우저 검사 — Playwright

## 준비

- 설정(`client/playwright.config.ts`): 작업자 1, 재시도 0, 검사 제한 90초, 화면 1440×960, `--disable-webgl`(Canvas 렌더러 경로를 검사한다), 기본 주소는 `ARGUS_URL`이나 `http://127.0.0.1:5077`이다.
- 서버가 필요한 검사는 클라이언트를 먼저 빌드하고(`npm --prefix client run build`, `wwwroot`가 있어야 화면이 나온다) 서버를 `Argus__Missions__AllowHandmade=true`로 띄운 뒤 돌린다. 이 설정이 없으면 손으로 만든 맵과 조용한 방의 방 만들기가 HTTP 403이다.
- 검사가 끝나면 서버를 SIGTERM으로 끈다. 남은 기록은 `dotnet run --project tools/Argus.Replay -- server/Argus.Server/recordings --strict`로 재생해 볼 수 있다(CI가 그렇게 한다).

## 파일마다 필요한 것

| 파일 | 검사 수 | 게임 서버 | 다루는 것 |
| --- | --- | --- | --- |
| `fixed.spec.ts` | 10 | 필요 없음(브라우저도 쓰지 않음) | `fixed-vectors.json`과 `fixed.ts`·`movement.ts`의 계산이 Raw까지 같은지 |
| `world.spec.ts` | 37 | 필요 없음(검사가 Vite 서버를 띄워 실제 `World`에 만든 스냅샷을 넣는다) | 그리기, 원호, 색, 예측과 서버 재조정, 대시 꼬리 |
| `minimap.spec.ts` | 12 | 일부만(`drawing` 묶음은 Vite 서버, 배치 검사는 게임 서버) | 미니맵 화소, 크기, 자리와 겹침 |
| `game.spec.ts` | 20 | 필요 | 입력(겹쳐 누름, 창을 다녀온 키), 재접속, 치트 방지 경계(위조 상태·잘못된 장비·순번 재생·신원 탈취) |
| `touch.spec.ts` | 23 | 필요 | 터치 로비와 조작, 휴대폰 크기별 배치, 스타일시트에 `:has(`가 없는지 |
| `hands.spec.ts` | 6 | 필요 | 손 그림의 짝과 자리, 마스크 |
| `mission.spec.ts` | 1 | 필요(손으로 만든 맵) | 임무 봇이 작전을 끝까지 진행 |

그리기나 예측만 고쳤으면 서버 없이 `cd client && npx playwright test tests/world.spec.ts tests/fixed.spec.ts`로 먼저 본다.

도우미: `rooms.ts`(`quietRoom`, 조용한 방의 주소), `wire.ts`(`relay`: 페이지와 서버 사이의 WebSocket을 가운데서 이어, 보낸 입력을 모으고 스냅샷을 바꾸거나 잡아 두고 연결을 끊는다). `fixed-vectors.json`은 서버가 만든 자료라 손으로 고치지 않는다(`dotnet run --project tests/Argus.Server.Tests -- vectors`).

## 조용한 방

**기술을 쓰거나 대원이 오래 살아 있어야 하는 새 브라우저 검사는 조용한 방(`quietRoom`, 주소의 `?layout=quiet`)에서 돌린다.** 착지한 뒤 8초를 넘기는 검사는 배치만 보더라도 그렇다. 생성 작전에서는 처음 적들이 캠프로 와서 대원을 친다. 까닭과 잰 수치는 `rooms.ts`의 주석과 `mission.md`에 있다. 조용한 방의 맵은 늘 40×30칸이다.

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
