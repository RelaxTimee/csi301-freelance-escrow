import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createPublicClient,
  decodeEventLog,
  fallback,
  hexToBigInt,
  http,
  isHex,
  parseEventLogs,
  toHex,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import { escrowAbi } from './abi'
import {
  allowedActions,
  createArgs,
  type Action,
  type Draft,
  type Job,
} from './domain'

export const address = '0x73Af871f0F57cA2EC4Ad8D4A7E075b2CFf037CeC'
export const deploymentBlock = 12075114n
export const explorer = 'https://sepolia.etherscan.io'
const endpoints = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.gateway.tenderly.co',
]
export const reader = createPublicClient({
  chain: sepolia,
  transport: fallback(
    endpoints.map((url) => http(url, { retryCount: 0, timeout: 10000 })),
    { retryCount: 1 },
  ),
})
export const contract = { address, abi: escrowAbi } as const
export async function overview() {
  const block = await reader.getBlock()
  const at = { ...contract, blockNumber: block.number }
  const [count, balance, owner] = await Promise.all([
    reader.readContract({ ...at, functionName: 'getJobCount' }),
    reader.readContract({ ...at, functionName: 'getContractBalance' }),
    reader.readContract({ ...at, functionName: 'owner' }),
  ])
  return { count, balance, owner, block: block.number, now: block.timestamp }
}
const pageSize = 6
export async function jobPage(start: bigint, account?: Address) {
  const items: Job[] = []
  let cursor = start
  while (cursor > 0n && items.length < pageSize) {
    const length = Number(cursor < BigInt(pageSize) ? cursor : BigInt(pageSize))
    const ids = Array.from({ length }, (_, index) => cursor - BigInt(index))
    const chunk = await reader.multicall({
      allowFailure: false,
      contracts: ids.map(
        (id) => ({ ...contract, functionName: 'getJob', args: [id] }) as const,
      ),
    })
    for (const job of chunk) {
      cursor = job.jobId - 1n
      if (
        !account ||
        [job.employer, job.freelancer].some(
          (a) => a.toLowerCase() === account.toLowerCase(),
        )
      )
        items.push(job)
      if (items.length === pageSize) break
    }
  }
  return { items, next: cursor }
}
export const getJob = (id: bigint) =>
  reader.readContract({ ...contract, functionName: 'getJob', args: [id] })
export interface HistoryItem {
  name: string
  hash: Hash
  block: bigint
  index: number
  amount?: bigint
  party?: Address
}
export async function history(
  id: bigint,
  head: bigint,
  signal: AbortSignal,
): Promise<HistoryItem[]> {
  const recent = head - 64n > deploymentBlock ? head - 64n : deploymentBlock
  if (recent === deploymentBlock) return rpcHistory(id, recent, head, signal)
  try {
    const [older, latest] = await Promise.all([
      indexedHistory(id, recent - 1n, signal),
      rpcHistory(id, recent, head, signal),
    ])
    return [...latest, ...older]
  } catch {
    signal.throwIfAborted()
    return rpcHistory(id, deploymentBlock, head, signal)
  }
}
async function indexedHistory(
  id: bigint,
  end: bigint,
  signal: AbortSignal,
): Promise<HistoryItem[]> {
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address,
    topic1: toHex(id, { size: 32 }),
    fromBlock: String(deploymentBlock),
    toBlock: String(end),
  })
  const res = await fetch('https://eth-sepolia.blockscout.com/api?' + params, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  })
  if (!res.ok) throw new Error('เปิดดัชนีเหตุการณ์ไม่ได้')
  const payload: unknown = await res.json()
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('result' in payload) ||
    !Array.isArray(payload.result)
  )
    throw new Error('ข้อมูลดัชนีไม่ถูกต้อง')
  if (
    !('status' in payload) ||
    (payload.status !== '1' &&
      !('message' in payload && payload.message === 'No logs found'))
  )
    throw new Error('ดัชนีเหตุการณ์ไม่พร้อมใช้งาน')
  return payload.result
    .map((row: unknown) => {
      if (
        !row ||
        typeof row !== 'object' ||
        !('address' in row) ||
        String(row.address).toLowerCase() !== address.toLowerCase() ||
        !('topics' in row) ||
        !Array.isArray(row.topics) ||
        !('transactionHash' in row) ||
        !isHex(row.transactionHash) ||
        !('data' in row) ||
        !isHex(row.data) ||
        !('blockNumber' in row) ||
        !isHex(row.blockNumber) ||
        !('logIndex' in row) ||
        !isHex(row.logIndex)
      )
        throw new Error('เหตุการณ์ไม่ถูกต้อง')
      const topics = row.topics.filter((topic) => topic !== null)
      if (!topics.length || !topics.every((topic) => isHex(topic)))
        throw new Error('หัวข้อเหตุการณ์ไม่ถูกต้อง')
      const log = decodeEventLog({
        abi: escrowAbi,
        data: row.data,
        topics: [topics[0], ...topics.slice(1)],
      })
      if (log.args.jobId !== id) throw new Error('เลขงานในเหตุการณ์ไม่ตรงกัน')
      return {
        name: log.eventName,
        hash: row.transactionHash,
        block: BigInt(row.blockNumber),
        index: Number(row.logIndex),
        amount: 'amount' in log.args ? log.args.amount : undefined,
        party:
          'to' in log.args
            ? log.args.to
            : 'by' in log.args
              ? log.args.by
              : undefined,
      }
    })
    .sort((a, b) => Number(b.block - a.block) || b.index - a.index)
}
async function rpcHistory(
  id: bigint,
  first: bigint,
  head: bigint,
  signal: AbortSignal,
): Promise<HistoryItem[]> {
  const items: HistoryItem[] = []
  let from = first,
    span = 40000n
  while (from <= head) {
    signal.throwIfAborted()
    const end = from + span - 1n < head ? from + span - 1n : head
    try {
      const raw = await reader.request({
        method: 'eth_getLogs',
        params: [
          {
            address,
            fromBlock: toHex(from),
            toBlock: toHex(end),
            topics: [null, toHex(id, { size: 32 })],
          },
        ],
      })
      const logs = raw
        .filter((l) => l.blockNumber && l.transactionHash && l.logIndex)
        .map((l) => ({
          ...l,
          blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null,
          blockNumber: hexToBigInt(l.blockNumber!),
          logIndex: Number(l.logIndex),
          transactionIndex: Number(l.transactionIndex),
          transactionHash: l.transactionHash!,
          blockHash: l.blockHash!,
        }))
      for (const log of parseEventLogs({ abi: escrowAbi, logs })) {
        items.push({
          name: log.eventName,
          hash: log.transactionHash,
          block: log.blockNumber,
          index: log.logIndex,
          amount: 'amount' in log.args ? log.args.amount : undefined,
          party:
            'to' in log.args
              ? log.args.to
              : 'by' in log.args
                ? log.args.by
                : undefined,
        })
      }
      from = end + 1n
    } catch (error) {
      if (
        span <= 1000n ||
        !/range|limit|too many|blocks|size/i.test(String(error))
      )
        throw error
      span /= 2n
    }
  }
  return items.reverse()
}
export type Intent =
  | { kind: 'create'; draft: Draft }
  | { kind: Action; id: bigint; proof?: string }
export async function sendIntent(
  client: PublicClient,
  wallet: WalletClient,
  target: Address,
  account: Address,
  intent: Intent,
  signing: () => void,
) {
  const base = { address: target, abi: escrowAbi, account, chain: client.chain }
  const simulate = async () => {
    if (intent.kind === 'create')
      return client.simulateContract({
        ...base,
        functionName: 'createJob',
        args: createArgs(intent.draft, account),
      })
    const [job, owner, block] = await Promise.all([
      client.readContract({
        ...base,
        functionName: 'getJob',
        args: [intent.id],
      }),
      client.readContract({ ...base, functionName: 'owner' }),
      client.getBlock(),
    ])
    if (
      !allowedActions(job, account, owner, block.timestamp).includes(
        intent.kind,
      )
    )
      throw new Error('สิทธิ์ สถานะงาน หรือกำหนดส่งไม่อนุญาตให้ทำรายการนี้')
    const args = [intent.id] as const
    switch (intent.kind) {
      case 'deposit':
        return client.simulateContract({
          ...base,
          functionName: 'depositPayment',
          args,
          value: job.amount,
        })
      case 'submit': {
        const proof = intent.proof?.trim()
        if (!proof) throw new Error('กรุณาระบุลิงก์หรือแฮชของผลงาน')
        return client.simulateContract({
          ...base,
          functionName: 'submitWork',
          args: [intent.id, proof],
        })
      }
      case 'approve':
        return client.simulateContract({
          ...base,
          functionName: 'approveAndRelease',
          args,
        })
      case 'dispute':
        return client.simulateContract({
          ...base,
          functionName: 'raiseDispute',
          args,
        })
      case 'pay':
      case 'refund':
        return client.simulateContract({
          ...base,
          functionName: 'resolveDispute',
          args: [intent.id, intent.kind === 'pay'],
        })
    }
  }
  const { request } = await simulate()
  signing()
  return wallet.writeContract({ ...request, abi: escrowAbi as Abi })
}
export function errorText(error: unknown): string {
  if (error instanceof BaseError) {
    if (
      error.walk(
        (e) =>
          e instanceof UserRejectedRequestError ||
          (typeof e === 'object' &&
            e !== null &&
            'code' in e &&
            e.code === 4001),
      ) instanceof Error
    )
      return 'คุณปฏิเสธคำขอในกระเป๋า'
    const reverted = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    )
    if (reverted instanceof ContractFunctionRevertedError)
      return 'สัญญาปฏิเสธรายการ · ' + (reverted.reason || reverted.shortMessage)
    return 'เชื่อมต่อเครือข่ายหรือกระเป๋าไม่สำเร็จ · ' + error.shortMessage
  }
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === 4001
  )
    return 'คุณปฏิเสธคำขอในกระเป๋า'
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ'
}
