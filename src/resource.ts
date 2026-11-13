import { useEffect, useState } from 'react'
import { errorText } from './chain'

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{
    key: typeof load
    data?: T
    error?: string
  }>()
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: load, data })
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setResult({ key: load, error: errorText(e) })
      })
    return () => controller.abort()
  }, [load])
  return result?.key === load ? result : undefined
}
