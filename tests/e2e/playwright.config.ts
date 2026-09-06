import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3535',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // PRD §123 makes mobile the PRIMARY platform, so the phone treatment is a
    // first-class project rather than a viewport tweak inside one spec. Pixel
    // 7 is 412px wide — below the `sm` (600px) boundary — so this project is
    // what actually exercises the bottom bar, the drill-down top bar and the
    // full-screen dialogs. A desktop-only suite would never load any of them.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Start the local stack if it is not already running.
  //
  // The `fake-openai` overlay (#30, epic #20) is part of the default command
  // because the AI-key gate now stands in front of every screen: without it,
  // `loginAsTestUser` cannot seed a key (no SECRETS_ENCRYPTION_KEY on a fresh
  // clone) and every spec lands on `/setup/ai-key` instead of the page it is
  // about.
  //
  // ONE READINESS PROBE IS ENOUGH. `api` declares
  // `depends_on: fake-openai: condition: service_healthy`, so the API container
  // does not start until the stand-in answers `/healthz` — by the time
  // `/api/health/live` responds, both are up.
  //
  // The `minio` and `e2e-media` overlays (#103, epic #67) join it for the same
  // reason: `media-attachments.spec.ts` needs a real object store, and it
  // needs `AI_VIDEO_MAX_FRAMES=4` so its frame-count assertion is a number
  // rather than a range. Every other spec is unaffected by both.
  webServer: process.env.CI ? undefined : {
    command:
      'cd ../../infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f minio.compose.yml -f fake-openai.compose.yml -f e2e-media.compose.yml up',
    url: 'http://localhost:3535/api/health/live',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
