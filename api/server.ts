import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3002)
const app = createApp()
const distDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

app.use(express.static(distDirectory))
app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
  response.sendFile(path.join(distDirectory, 'index.html'))
})

app.listen(port, () => {
  console.log(`Fleet API listening on http://localhost:${port}`)
})

