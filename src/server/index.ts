import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { initDb, db } from './db/client.ts'
import { seed } from './db/seed.ts'
import { ensureLayout } from './db/layout.ts'
import { registerRoutes } from './routes.ts'
import { ZodError } from 'zod'

const PORT = Number(process.env.PORT ?? 8095)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

// Boş gövdeli POST'lar (ör. /send, /logout) hata vermesin
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = String(body ?? '').trim()
  if (!text) return done(null, {})
  try {
    done(null, JSON.parse(text))
  } catch (err) {
    done(err as Error, undefined)
  }
})

await app.register(cookie)
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
await initDb()

// İlk açılışta menü/personel/masa yoksa tohumla
const users = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM users`)
if (!users || users.c === 0) {
  const r = await seed()
  app.log.info({ seed: r }, 'veritabanı tohumlandı')
}

const layout = await ensureLayout()
if (layout.placed > 0) app.log.info({ placed: layout.placed }, 'masa yerleşimi kuruldu')

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'Geçersiz istek', issues: err.issues })
  }
  const status = (err as any).statusCode ?? 500
  if (status >= 500) req.log.error(err)
  return reply.code(status).send({ error: err.message ?? 'Sunucu hatası' })
})

await registerRoutes(app)

const dist = path.join(process.cwd(), 'dist')
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, prefix: '/' })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Bulunamadı' })
    return reply.sendFile('index.html')
  })
}

// Yüklenen ürün görselleri
const uploads = path.join(process.cwd(), 'var', 'uploads')
await app.register(fastifyStatic, { root: uploads, prefix: '/uploads/', decorateReply: false })

await app.listen({ port: PORT, host: HOST })
app.log.info(`Soprano POS hazır → http://localhost:${PORT}`)
