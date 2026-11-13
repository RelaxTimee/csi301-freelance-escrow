import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  parseEther,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { foundry } from 'viem/chains'
import { escrowAbi } from '../src/abi'
import { sendIntent, type Intent } from '../src/chain'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('No local TCP port')
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  )
  return bound.port
}
const publicAt = (url: string) =>
  createPublicClient({
    chain: foundry,
    transport: http(url, { retryCount: 0 }),
    pollingInterval: 25,
    cacheTime: 0,
  })
let rpc: ReturnType<typeof publicAt>
let url: string,
  processHandle: ChildProcess,
  contract: Address,
  owner: Address,
  employer: Address,
  freelancer: Address
const amount = parseEther('0.05')
const job = (id: bigint) =>
  rpc.readContract({
    address: contract,
    abi: escrowAbi,
    functionName: 'getJob',
    args: [id],
  })
const walletFor = (account: Address) =>
  createWalletClient({ account, chain: foundry, transport: http(url) })
const receipt = (hash: Hash) =>
  rpc.waitForTransactionReceipt({ hash, timeout: 10000 })
async function act(account: Address, intent: Intent) {
  const hash = await sendIntent(
    rpc,
    walletFor(account),
    contract,
    account,
    intent,
    () => {},
  )
  const result = await receipt(hash)
  expect(result.status).toBe('success')
  return result
}
async function create() {
  const result = await act(employer, {
    kind: 'create',
    draft: {
      name: 'Website',
      description: 'Acceptance build',
      freelancer,
      eth: '0.05',
      days: '2',
    },
  })
  return parseEventLogs({
    abi: escrowAbi,
    logs: result.logs,
    eventName: 'JobCreated',
  })[0].args.jobId
}
beforeAll(async () => {
  const port = await freePort()
  url = 'http://127.0.0.1:' + port
  const platform =
    process.platform + '-' + (process.arch === 'x64' ? 'amd64' : process.arch)
  const require = createRequire(import.meta.url)
  const binary = join(
    dirname(require.resolve('@foundry-rs/anvil-' + platform + '/package.json')),
    'bin',
    process.platform === 'win32' ? 'anvil.exe' : 'anvil',
  )
  processHandle = spawn(
    binary,
    ['--host', '127.0.0.1', '--port', String(port), '--silent'],
    { windowsHide: true, stdio: 'ignore' },
  )
  rpc = publicAt(url)
  for (let i = 0; i < 80; i++) {
    try {
      await rpc.getChainId()
      break
    } catch {
      await delay(100)
    }
  }
  ;[owner, employer, freelancer] = await createWalletClient({
    transport: http(url),
  }).getAddresses()
  const source = readFileSync(
    new URL('./fixtures/FreelanceEscrow.sol', import.meta.url),
    'utf8',
  )
  const input = {
    language: 'Solidity',
    sources: { 'FreelanceEscrow.sol': { content: source } },
    settings: {
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
    },
  }
  const build = JSON.parse(solc.compile(JSON.stringify(input))) as {
    contracts: Record<
      string,
      Record<string, { evm: { bytecode: { object: string } } }>
    >
  }
  const bytecode = ('0x' +
    build.contracts['FreelanceEscrow.sol'].FreelanceEscrow.evm.bytecode
      .object) as Hex
  const result = await receipt(
    await walletFor(owner).deployContract({ abi: escrowAbi, bytecode }),
  )
  if (!result.contractAddress) throw new Error('Local deployment failed')
  contract = result.contractAddress
}, 45000)
afterAll(() => {
  processHandle?.kill()
})
describe('deployed escrow on local EVM', () => {
  it('funds, submits and releases exactly once', async () => {
    const id = await create()
    await expect(act(freelancer, { kind: 'deposit', id })).rejects.toThrow()
    await act(employer, { kind: 'deposit', id })
    await expect(
      rpc.simulateContract({
        account: employer,
        address: contract,
        abi: escrowAbi,
        functionName: 'depositPayment',
        args: [id],
        value: amount,
      }),
    ).rejects.toThrow(/Already deposited/)
    await expect(act(employer, { kind: 'approve', id })).rejects.toThrow()
    await act(freelancer, {
      kind: 'submit',
      id,
      proof: 'https://example.org/delivery',
    })
    const before = await rpc.getBalance({ address: freelancer })
    const out = await act(employer, { kind: 'approve', id })
    expect(
      parseEventLogs({
        abi: escrowAbi,
        logs: out.logs,
        eventName: 'PaymentReleased',
      })[0].args.amount,
    ).toBe(amount)
    expect((await rpc.getBalance({ address: freelancer })) - before).toBe(
      amount,
    )
    expect((await job(id)).status).toBe(3)
    await expect(
      rpc.simulateContract({
        account: employer,
        address: contract,
        abi: escrowAbi,
        functionName: 'approveAndRelease',
        args: [id],
      }),
    ).rejects.toThrow(/Already paid/)
  })
  it.each(['pay', 'refund'] as const)(
    'resolves a dispute by %s',
    async (kind) => {
      const id = await create()
      await act(employer, { kind: 'deposit', id })
      if (kind === 'pay')
        await act(freelancer, { kind: 'submit', id, proof: 'file-hash' })
      await act(kind === 'pay' ? employer : freelancer, { kind: 'dispute', id })
      await expect(act(employer, { kind, id })).rejects.toThrow()
      const recipient = kind === 'pay' ? freelancer : employer
      const before = await rpc.getBalance({ address: recipient })
      await act(owner, { kind, id })
      expect((await rpc.getBalance({ address: recipient })) - before).toBe(
        amount,
      )
      expect((await job(id)).status).toBe(kind === 'pay' ? 3 : 5)
      expect(await rpc.getBalance({ address: contract })).toBe(0n)
    },
  )
})
