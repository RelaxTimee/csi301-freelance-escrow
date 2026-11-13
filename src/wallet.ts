import { useEffect, useState } from 'react'
import { getAddress, type Address, type EIP1193Provider } from 'viem'
import { sepolia } from 'viem/chains'
import { errorText } from './chain'
import { readOnly } from './deployment'

type Provider = EIP1193Provider & {
  isMetaMask?: boolean
  providers?: Provider[]
}
declare global {
  interface Window {
    ethereum?: Provider
  }
}
export function useWallet() {
  const [provider, setProvider] = useState<Provider>()
  const [account, setAccount] = useState<Address>()
  const [chainId, setChain] = useState<number>()
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  useEffect(() => {
    if (readOnly) return
    const injected = window.ethereum
    setProvider(injected?.providers?.find((p) => p.isMetaMask) ?? injected)
    const announce = (event: Event) => {
      const detail = (
        event as CustomEvent<{ info: { rdns: string }; provider: Provider }>
      ).detail
      if (detail.info.rdns === 'io.metamask') setProvider(detail.provider)
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    return () =>
      window.removeEventListener('eip6963:announceProvider', announce)
  }, [])
  useEffect(() => {
    if (!provider) return
    let live = true,
      revision = 0
    async function sync() {
      const stamp = ++revision
      try {
        const [accounts, chain] = await Promise.all([
          provider!.request({ method: 'eth_accounts' }),
          provider!.request({ method: 'eth_chainId' }),
        ])
        if (live && stamp === revision) {
          setAccount(accounts[0] ? getAddress(accounts[0]) : undefined)
          setChain(Number(chain))
          setError('')
        }
      } catch (e) {
        if (live && stamp === revision) {
          setAccount(undefined)
          setError(errorText(e))
        }
      }
    }
    const disconnected = () => {
      revision++
      setAccount(undefined)
      setChain(undefined)
    }
    void sync()
    provider.on('accountsChanged', sync)
    provider.on('chainChanged', sync)
    provider.on('disconnect', disconnected)
    return () => {
      live = false
      provider.removeListener('accountsChanged', sync)
      provider.removeListener('chainChanged', sync)
      provider.removeListener('disconnect', disconnected)
    }
  }, [provider])
  async function connect() {
    if (readOnly) return
    setError('')
    if (!provider) {
      setError('กรุณาติดตั้ง MetaMask หรือเปิดเว็บนี้ในเบราว์เซอร์ของกระเป๋า')
      return
    }
    setConnecting(true)
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      setAccount(accounts[0] ? getAddress(accounts[0]) : undefined)
      if (
        Number(await provider.request({ method: 'eth_chainId' })) !== sepolia.id
      ) {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }],
        })
      }
      setChain(Number(await provider.request({ method: 'eth_chainId' })))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setConnecting(false)
    }
  }
  return {
    account,
    provider,
    chainId,
    error,
    connecting,
    connect,
    ready: Boolean(account && chainId === sepolia.id),
  }
}
