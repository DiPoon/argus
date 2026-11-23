import { defineConfig } from '@playwright/test';

const baseURL = process.env.ARGUS_URL ?? 'http://127.0.0.1:5077';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  use: {
    actionTimeout: 15000,
    baseURL,
    // 검사 브라우저는 훈련을 마친 브라우저로 시작한다. 처음 온 사람은 로비 대신 첫 방문 화면을 보므로(이슈 #36), 로비에서 시작하는
    // 검사가 모두 그 화면에 막힌다. 손으로 연 문맥(browser.newContext)에도 이 값이 들어간다. 첫 방문을 보는 검사(tutorial.spec.ts)는 비운다.
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'argus-tutorial', value: 'done' }] }] },
    viewport: { width: 1440, height: 960 },
    // Exercise the native 2D fallback in CI, where hardware WebGL is unavailable.
    launchOptions: { args: ['--disable-webgl'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
