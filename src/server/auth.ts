import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from './db/client.ts'

export type Role = 'waiter' | 'cashier' | 'manager'
export type AuthUser = { id: number; name: string; role: Role }

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(pin, salt, 32)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export async function loginWithPin(pin: string): Promise<AuthUser | null> {
  const users = await db.all<{ id: number; name: string; role: Role; pin_hash: string }>(
    `SELECT id, name, role, pin_hash FROM users WHERE active = true`,
  )
  const user = users.find((u) => verifyPin(pin, u.pin_hash))
  if (!user) return null

  const token = randomBytes(24).toString('hex')
  const ttlHours = 30 * 24
  await db.one(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '${ttlHours} hours') RETURNING token`,
    [token, user.id],
  )
  return { id: user.id, name: user.name, role: user.role }
}

export async function userForToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null
  return db.one<AuthUser>(
    `SELECT u.id, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.active = true`,
    [token],
  )
}

export async function logout(token: string) {
  await db.all(`DELETE FROM sessions WHERE token = $1`, [token])
}

/** Rol yetki kontrolü: verilen rollerden biri değilse 403. */
export function requireRole(user: AuthUser, roles: Role[]) {
  if (!roles.includes(user.role)) {
    const err: any = new Error('Bu işlem için yetkiniz yok')
    err.statusCode = 403
    throw err
  }
}
