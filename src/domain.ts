import {
  formatEther,
  isAddress,
  isAddressEqual,
  maxUint256,
  parseEther,
  zeroAddress,
  type Address,
} from 'viem'

export const statusNames = [
  'รอฝากเงิน',
  'ฝากเงินแล้ว',
  'ส่งงานแล้ว',
  'จ่ายเงินแล้ว',
  'มีข้อพิพาท',
  'คืนเงินแล้ว',
] as const
export interface Job {
  jobId: bigint
  employer: Address
  freelancer: Address
  projectName: string
  description: string
  amount: bigint
  deadline: bigint
  workProof: string
  status: number
}
export type Action =
  'deposit' | 'submit' | 'approve' | 'dispute' | 'pay' | 'refund'
export function allowedActions(
  job: Job,
  account: Address | undefined,
  owner: Address,
  now: bigint,
): Action[] {
  if (!account) return []
  const employer = isAddressEqual(account, job.employer)
  const freelancer = isAddressEqual(account, job.freelancer)
  const actions: Action[] = []
  if (job.status === 0 && employer) actions.push('deposit')
  if (job.status === 1 && freelancer && now <= job.deadline)
    actions.push('submit')
  if (job.status === 2 && employer) actions.push('approve')
  if ((job.status === 1 || job.status === 2) && (employer || freelancer))
    actions.push('dispute')
  if (job.status === 4 && isAddressEqual(account, owner))
    actions.push('pay', 'refund')
  return actions
}
export interface Draft {
  name: string
  description: string
  freelancer: string
  eth: string
  days: string
}
export function createArgs(draft: Draft, employer: Address) {
  const name = draft.name.trim(),
    description = draft.description.trim(),
    freelancer = draft.freelancer.trim()
  if (!name || !description) throw new Error('กรุณาระบุชื่อโครงการและรายละเอียดงาน')
  if (
    !isAddress(freelancer) ||
    isAddressEqual(freelancer, zeroAddress) ||
    isAddressEqual(freelancer, employer)
  )
    throw new Error('ระบุที่อยู่ฟรีแลนซ์ที่ถูกต้องและต่างจากผู้ว่าจ้าง')
  if (!/^\d+(\.\d{1,18})?$/.test(draft.eth))
    throw new Error('ระบุจำนวน ETH เป็นทศนิยมได้สูงสุด 18 ตำแหน่ง')
  const amount = parseEther(draft.eth)
  if (amount <= 0n || amount > maxUint256)
    throw new Error('ค่าจ้างต้องมากกว่าศูนย์และอยู่ในช่วง uint256')
  if (
    !/^[1-9]\d*$/.test(draft.days) ||
    BigInt(draft.days) >= maxUint256 / 86400n
  )
    throw new Error('ระบุระยะเวลาเป็นจำนวนวันเต็มที่มากกว่าศูนย์')
  return [name, description, freelancer, amount, BigInt(draft.days)] as const
}
export function deadlineText(seconds: bigint) {
  if (seconds > 8640000000000n) return `Unix ${seconds}`
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Number(seconds) * 1000)
}
export const short = (value: string) =>
  value.slice(0, 6) + '…' + value.slice(-4)
export const eth = (wei: bigint) => formatEther(wei)
export function safeLink(proof: string) {
  try {
    const url = new URL(proof)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
