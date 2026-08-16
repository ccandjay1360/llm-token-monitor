const providerLocks = new Map()
const interactiveLocks = new Map()
const providerEpochs = new Map()

export function getProviderBrowserEpoch(providerId) {
  return providerEpochs.get(providerId) || 0
}

export async function withProviderBrowserLock(providerId, task, { priority = false } = {}) {
  if (priority) {
    const epoch = getProviderBrowserEpoch(providerId) + 1
    providerEpochs.set(providerId, epoch)

    let finish
    const done = new Promise((resolve) => { finish = resolve })
    interactiveLocks.set(providerId, { epoch, done })
    try {
      return await task()
    } finally {
      finish()
      if (interactiveLocks.get(providerId)?.epoch === epoch) {
        interactiveLocks.delete(providerId)
      }
    }
  }

  const previous = providerLocks.get(providerId) || Promise.resolve()
  let release
  const current = new Promise((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  providerLocks.set(providerId, tail)

  await previous
  const interactive = interactiveLocks.get(providerId)
  if (interactive) await interactive.done
  try {
    return await task()
  } finally {
    release()
    if (providerLocks.get(providerId) === tail) providerLocks.delete(providerId)
  }
}
