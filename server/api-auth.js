import crypto from 'node:crypto'

export function isApiRequestAuthorized(expectedToken, receivedToken) {
  if (!expectedToken) return true
  if (typeof receivedToken !== 'string') return false

  const expected = Buffer.from(expectedToken)
  const received = Buffer.from(receivedToken)
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}

export function createApiAuthMiddleware(expectedToken) {
  return (req, res, next) => {
    if (isApiRequestAuthorized(expectedToken, req.get('x-token-monitor-auth'))) return next()
    return res.status(401).json({ ok: false, error: 'unauthorized local API request' })
  }
}
