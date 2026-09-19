import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const port = 3300 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'api/server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused' },
  stdio: 'ignore',
})

try {
  let healthy = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      healthy = (await fetch(`${baseUrl}/api/health`)).ok
      if (healthy) break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.equal(healthy, true)

  const page = await fetch(`${baseUrl}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<div id="root"><\/div>/)
  console.log('Deployment smoke check passed')
} finally {
  child.kill()
}
