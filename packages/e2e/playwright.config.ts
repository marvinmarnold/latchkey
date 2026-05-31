import { defineConfig, devices } from '@playwright/test'
import * as path from 'path'

const PROXY_PORT = 3002
const ADMIN_PORT = 3001

// When E2E_PROXY_URL / E2E_ADMIN_URL are set, skip local server startup
// (used when testing against a deployed environment)
const useDeployed = !!(process.env.E2E_PROXY_URL && process.env.E2E_ADMIN_URL)

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  globalSetup: useDeployed ? undefined : './global-setup.ts',
  globalTeardown: useDeployed ? undefined : './global-teardown.ts',

  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? `http://localhost:${ADMIN_PORT}`,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Next.js admin dev server pointing at the local proxy
  webServer: useDeployed
    ? undefined
    : {
        command: `npm run dev -- --port ${ADMIN_PORT}`,
        cwd: path.join(__dirname, '..', 'admin'),
        port: ADMIN_PORT,
        timeout: 60000,
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_PUBLIC_PROXY_URL: `http://localhost:${PROXY_PORT}`,
        },
      },
})
