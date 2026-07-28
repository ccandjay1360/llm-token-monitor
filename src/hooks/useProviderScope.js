import { useSearchParams } from 'react-router-dom'

export function useProviderScope() {
  const [searchParams, setSearchParams] = useSearchParams()
  const providerId = searchParams.get('provider') || 'all'

  const setProviderId = (nextProviderId) => {
    const next = new URLSearchParams(searchParams)
    if (!nextProviderId || nextProviderId === 'all') {
      next.delete('provider')
    } else {
      next.set('provider', nextProviderId)
    }
    setSearchParams(next, { replace: true })
  }

  return { providerId, setProviderId }
}
