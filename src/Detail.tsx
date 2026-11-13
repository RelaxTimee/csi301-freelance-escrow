import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  ShieldCheck,
} from 'lucide-react'
import type { Address } from 'viem'
import { explorer, history, type Intent } from './chain'
import {
  allowedActions,
  deadlineText,
  eth,
  safeLink,
  short,
  statusNames,
  type Action,
  type Job,
} from './domain'
import { useResource } from './resource'
import { readOnly } from './deployment'

const actionLabels: Record<Action, string> = {
  deposit: 'ฝากค่าจ้าง',
  submit: 'ส่งมอบงาน',
  approve: 'อนุมัติและจ่ายเงิน',
  dispute: 'เปิดข้อพิพาท',
  pay: 'ตัดสินจ่ายให้ฟรีแลนซ์',
  refund: 'ตัดสินคืนเงินผู้ว่าจ้าง',
}
const eventLabels: Record<string, string> = {
  JobCreated: 'สร้างข้อตกลง',
  Deposited: 'ฝากค่าจ้าง',
  WorkSubmitted: 'ส่งมอบงาน',
  PaymentReleased: 'จ่ายเงินให้ฟรีแลนซ์',
  DisputeRaised: 'เปิดข้อพิพาท',
  Refunded: 'คืนเงินผู้ว่าจ้าง',
}
interface Props {
  job: Job
  owner: Address
  account?: Address
  head: bigint
  chainTime: bigint
  busy: boolean
  ready: boolean
  send: (i: Intent) => void
  connect: () => void
}
export function Detail({
  job,
  owner,
  account,
  head,
  chainTime,
  busy,
  ready,
  send,
  connect,
}: Props) {
  const [proof, setProof] = useState('')
  const [chosen, choose] = useState<Action>()
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(chainTime)
  useEffect(() => {
    const start = Date.now()
    const tick = () =>
      setNow(chainTime + BigInt(Math.floor((Date.now() - start) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [chainTime])
  const load = useCallback(
    (signal: AbortSignal) => history(job.jobId, head, signal),
    [job.jobId, head, retry],
  )
  const events = useResource(load)
  const actions = ready ? allowedActions(job, account, owner, now) : []
  const selected = chosen && actions.includes(chosen) ? chosen : undefined
  const href = safeLink(job.workProof)
  return (
    <div className="detail-grid">
      <article className="sheet">
        <div className="sectionline">
          <span className="mono">
            JOB / {job.jobId.toString().padStart(3, '0')}
          </span>
          <span className={'badge s' + job.status}>
            {statusNames[job.status]}
          </span>
        </div>
        <h2>{job.projectName}</h2>
        <p className="description">{job.description}</p>
        <dl>
          <dt>ค่าจ้าง</dt>
          <dd className="amount">{eth(job.amount)} ETH</dd>
          <dt>กำหนดส่ง</dt>
          <dd>{deadlineText(job.deadline)}</dd>
          <dt>ผู้ว่าจ้าง</dt>
          <dd>{job.employer}</dd>
          <dt>ฟรีแลนซ์</dt>
          <dd>{job.freelancer}</dd>
        </dl>
        {job.workProof && (
          <div className="proof">
            <FileCheck2 size={18} /> หลักฐานการส่งมอบ
            <p>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {job.workProof} ↗
                </a>
              ) : (
                job.workProof
              )}
            </p>
          </div>
        )}
        {job.status === 1 && now > job.deadline && (
          <p className="note">พ้นกำหนดส่งงานแล้ว คู่สัญญายังเปิดข้อพิพาทได้</p>
        )}
        {readOnly ? null : !ready ? (
          <button onClick={connect}>เชื่อมกระเป๋าบน Sepolia</button>
        ) : actions.length ? (
          <>
            {actions.includes('submit') && (
              <label>
                ลิงก์หรือแฮชของผลงาน
                <input
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                  placeholder="https://… หรือ File Hash"
                />
              </label>
            )}
            <div className="row-buttons">
              {actions.map((a) => (
                <button
                  className={a === 'dispute' ? 'secondary' : ''}
                  key={a}
                  disabled={busy || (a === 'submit' && !proof.trim())}
                  onClick={() => choose(a)}
                >
                  {actionLabels[a]}
                </button>
              ))}
            </div>
            {selected && (
              <div className="confirm">
                <b>ยืนยันการทำรายการ · {actionLabels[selected]}</b>
                {['approve', 'pay', 'refund', 'deposit'].includes(selected) && (
                  <p>
                    {eth(job.amount)} ETH →{' '}
                    {selected === 'refund'
                      ? job.employer
                      : selected === 'deposit'
                        ? 'สัญญา Escrow'
                        : job.freelancer}
                  </p>
                )}
                {selected === 'dispute' && (
                  <p>หลังเปิดข้อพิพาท ผู้ดูแลสัญญาจะเป็นผู้ตัดสินการจ่ายเงิน</p>
                )}
                {selected === 'submit' && <p>{proof}</p>}
                <div className="row-buttons">
                  <button
                    disabled={busy}
                    onClick={() => {
                      choose(undefined)
                      send({ kind: selected, id: job.jobId, proof })
                    }}
                  >
                    ยืนยันในกระเป๋า
                  </button>
                  <button
                    className="secondary"
                    onClick={() => choose(undefined)}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="note">
            <ShieldCheck size={16} />{' '}
            {job.status === 3 || job.status === 5
              ? 'ข้อตกลงนี้สิ้นสุดแล้ว'
              : 'บัญชีนี้ไม่มีรายการที่ทำได้ในสถานะปัจจุบัน'}
          </p>
        )}
      </article>
      <section className="sheet history">
        <h3>
          <Clock3 size={19} />
          ประวัติธุรกรรม
        </h3>
        {!events ? (
          <p>กำลังอ่านเหตุการณ์จากบล็อกเชน…</p>
        ) : events.error ? (
          <div role="alert">
            โหลดประวัติไม่สำเร็จ{' '}
            <button
              className="secondary"
              onClick={() => setRetry((n) => n + 1)}
            >
              ลองอีกครั้ง
            </button>
          </div>
        ) : events.data?.length ? (
          events.data.map((e) => (
            <div className="event" key={e.hash + e.index}>
              <CheckCircle2 size={17} />
              <div>
                <b>{eventLabels[e.name]}</b>
                <small>
                  Block {e.block.toLocaleString('en-US')}
                  {e.amount !== undefined && ' · ' + eth(e.amount) + ' ETH'}
                </small>
                {e.party && (
                  <small>
                    {e.name === 'DisputeRaised' ? 'ผู้แจ้ง' : 'ผู้รับ'}{' '}
                    {short(e.party)}
                  </small>
                )}
                <a
                  href={explorer + '/tx/' + e.hash}
                  title={e.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(e.hash)} <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
          ))
        ) : (
          <p>ยังไม่พบเหตุการณ์ของงานนี้</p>
        )}
      </section>
    </div>
  )
}
