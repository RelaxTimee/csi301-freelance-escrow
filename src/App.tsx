import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Layers3,
  LayoutGrid,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react'
import { createWalletClient, custom, parseEventLogs, type Hash } from 'viem'
import { sepolia } from 'viem/chains'
import {
  address,
  errorText,
  explorer,
  getJob,
  jobPage,
  overview,
  reader,
  sendIntent,
  type Intent,
} from './chain'
import { escrowAbi } from './abi'
import { eth, short, statusNames, type Draft } from './domain'
import { Detail } from './Detail'
import { useResource } from './resource'
import { useWallet } from './wallet'
import { readOnly } from './deployment'

const empty: Draft = {
  name: '',
  description: '',
  freelancer: '',
  eth: '',
  days: '',
}
const route = () => location.hash.slice(1) || '/'
const go = (target: string) => {
  location.hash = target
}
type Tx = { message: string; hash?: Hash; failed?: boolean }
export function App() {
  const wallet = useWallet()
  const [path, setPath] = useState(route)
  const [revision, refresh] = useState(0)
  const [mine, setMine] = useState(false)
  const [cursors, setCursors] = useState<bigint[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [tx, setTx] = useState<Tx>()
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<Hash>()
  const [receiptBlock, setReceiptBlock] = useState<bigint>(0n)
  useEffect(() => {
    const change = () => {
      setPath(route())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    setCursors([])
  }, [mine, wallet.account])
  const summary = useResource(useCallback(() => overview(), [revision]))
  const id = /^\/jobs\/([1-9]\d*)$/.exec(path)?.[1]
  const create = !readOnly && path === '/create'
  const isHome = !id && !create
  const data = summary?.data
  const start = cursors.at(-1) ?? data?.count ?? 0n
  const list = useResource(
    useCallback(
      () =>
        isHome && data && (!mine || wallet.account)
          ? jobPage(start, mine ? wallet.account : undefined)
          : Promise.resolve({ items: [], next: 0n }),
      [isHome, start, mine, wallet.account, data],
    ),
  )
  const detail = useResource(
    useCallback(
      () => (id ? getJob(BigInt(id)) : Promise.resolve(undefined)),
      [id, revision],
    ),
  )
  const reload = () => refresh((n) => n + 1)
  async function receive(hash: Hash) {
    const receipt = await reader.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120000,
    })
    setPending(undefined)
    if (receipt.status !== 'success') {
      setTx({ hash, failed: true, message: 'ธุรกรรมถูกย้อนกลับบนบล็อกเชน' })
      reload()
      return
    }
    setReceiptBlock(receipt.blockNumber)
    setTx({
      hash: receipt.transactionHash,
      message: 'ยืนยันธุรกรรมบน Sepolia แล้ว',
    })
    const created = parseEventLogs({
      abi: escrowAbi,
      eventName: 'JobCreated',
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === address.toLowerCase(),
      ),
    })[0]
    if (created) {
      setDraft(empty)
      setCursors([])
      go('/jobs/' + created.args.jobId)
    }
    reload()
  }
  async function send(intent: Intent) {
    if (readOnly) return
    if (
      locked.current ||
      pending ||
      !wallet.provider ||
      !wallet.account ||
      !wallet.ready
    )
      return
    locked.current = true
    setBusy(true)
    setTx({ message: 'กำลังตรวจสอบเงื่อนไขกับสัญญา…' })
    let hash: Hash | undefined
    try {
      const client = createWalletClient({
        chain: sepolia,
        account: wallet.account,
        transport: custom(wallet.provider),
      })
      if (
        (await client.getChainId()) !== sepolia.id ||
        (await client.getAddresses())[0]?.toLowerCase() !==
          wallet.account.toLowerCase()
      )
        throw new Error('บัญชีหรือเครือข่ายเปลี่ยน กรุณาตรวจสอบกระเป๋าอีกครั้ง')
      hash = await sendIntent(
        reader,
        client,
        address,
        wallet.account,
        intent,
        () => setTx({ message: 'รอการยืนยันในกระเป๋า…' }),
      )
      setPending(hash)
      setTx({ hash, message: 'ส่งธุรกรรมแล้ว กำลังรอบันทึกลงบล็อก…' })
      await receive(hash)
    } catch (e) {
      setTx({
        failed: true,
        hash,
        message: hash
          ? 'ส่งธุรกรรมแล้ว แต่ยังตรวจผลไม่ได้ กรุณาตรวจสถานะอีกครั้ง'
          : errorText(e),
      })
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  async function retryReceipt() {
    if (!pending || locked.current) return
    locked.current = true
    setBusy(true)
    try {
      await receive(pending)
    } catch (e) {
      setTx({ failed: true, hash: pending, message: errorText(e) })
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const connectLabel = wallet.connecting
    ? 'กำลังเชื่อมต่อ…'
    : wallet.account
      ? wallet.ready
        ? short(wallet.account)
        : 'เปลี่ยนเป็น Sepolia'
      : 'เชื่อมกระเป๋า'
  function submit(e: FormEvent) {
    e.preventDefault()
    void send({ kind: 'create', draft })
  }
  const filter = (value: boolean) => {
    setCursors([])
    setMine(value)
    go('/')
  }
  return (
    <>
      <header>
        <div className="shell nav">
          <a href="#/" className="brand">
            <span className="brand-icon">
              <Layers3 size={23} />
            </span>
            DigitalWork
          </a>
          <div className="nav-right">
            <span className="network">
              <i /> Sepolia Testnet
            </span>
            {readOnly ? <span>เดโมสำหรับการศึกษา · อ่านอย่างเดียว</span> : <button
              className="wallet"
              disabled={wallet.connecting}
              onClick={wallet.connect}
            >
              <Wallet size={16} />
              {connectLabel}
            </button>}
          </div>
        </div>
      </header>
      <main className="shell">
        <div className="bread">
          <LayoutGrid size={14} /> Workspace <span>/</span>{' '}
          {isHome ? 'ภาพรวม' : create ? 'สร้างข้อตกลง' : 'รายละเอียดงาน'}
        </div>
        {wallet.error && (
          <div className="alert" role="alert">
            {wallet.error}
          </div>
        )}
        {tx && (
          <div className={'notice ' + (tx.failed ? 'alert' : '')} role="status">
            <span>
              {tx.message}{' '}
              {tx.hash && (
                <a
                  href={explorer + '/tx/' + tx.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(tx.hash)} ↗
                </a>
              )}
            </span>
            {pending && !busy && (
              <button className="secondary" onClick={retryReceipt}>
                ตรวจสถานะ
              </button>
            )}
            {!pending && !busy && (
              <button
                className="icon"
                aria-label="ปิดข้อความ"
                onClick={() => setTx(undefined)}
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
        {isHome ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span /> FREELANCE ESCROW
                </p>
                <h1>{readOnly ? 'ติดตามข้อตกลงฟรีแลนซ์' : 'พื้นที่จัดการงานฟรีแลนซ์'}</h1>
                <p>{readOnly ? 'ดูสถานะงานและประวัติธุรกรรมบนเครือข่ายทดสอบ Sepolia' : 'สร้างข้อตกลง ติดตามผลงาน และจัดการค่าจ้างผ่าน Escrow'}</p>
                {!readOnly && <button onClick={() => go('/create')}>
                  <Plus size={17} />
                  สร้างข้อตกลง
                </button>}
              </div>
              <div className="visual" aria-hidden="true">
                <div className="orbit o1" />
                <div className="orbit o2" />
                <div className="layer l3" />
                <div className="layer l2" />
                <div className="layer l1" />
                <ShieldCheck className="shield" size={52} strokeWidth={1.25} />
                <span className="visual-label">ETH / ESCROW</span>
              </div>
            </section>
            <div className="stats">
              <div className="stat">
                <span className="tile">
                  <BriefcaseBusiness />
                </span>
                <div>
                  <small>ข้อตกลงทั้งหมด</small>
                  <strong>
                    {data?.count.toLocaleString('en-US') ?? '—'} <em>งาน</em>
                  </strong>
                </div>
              </div>
              <div className="stat">
                <span className="tile mint">
                  <CircleDollarSign />
                </span>
                <div>
                  <small>เงินใน Escrow</small>
                  <strong title={data && eth(data.balance)}>
                    {data ? eth(data.balance) : '—'} <em>ETH</em>
                  </strong>
                </div>
              </div>
              <div className="stat">
                <span className="tile lavender">
                  <Network />
                </span>
                <div>
                  <small>เครือข่ายสัญญา</small>
                  <strong>
                    Sepolia <em>Testnet</em>
                  </strong>
                </div>
              </div>
            </div>
            <section className="jobs">
              <div className="sectionline">
                <h2>รายการข้อตกลง</h2>
                <button
                  className="icon"
                  aria-label="รีเฟรชข้อมูลงาน"
                  onClick={reload}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              {!readOnly && <div className="tabs">
                <button
                  className={!mine ? 'active' : ''}
                  onClick={() => filter(false)}
                >
                  งานทั้งหมด
                </button>
                <button
                  className={mine ? 'active' : ''}
                  onClick={() => filter(true)}
                >
                  งานของฉัน
                </button>
              </div>}
              <div className="table-head job-row">
                <span>โครงการ</span>
                <span>ค่าจ้าง</span>
                <span>สถานะ</span>
                <span />
              </div>
              {summary?.error || list?.error ? (
                <div className="empty">
                  <Activity />
                  อ่านข้อมูลจาก Sepolia ไม่สำเร็จ
                  <button className="secondary" onClick={reload}>
                    ลองอีกครั้ง
                  </button>
                </div>
              ) : mine && !wallet.account ? (
                <div className="empty">
                  <Wallet />
                  เชื่อมกระเป๋าเพื่อดูงานที่คุณเป็นคู่สัญญา
                  <button className="secondary" onClick={wallet.connect}>
                    เชื่อมกระเป๋า
                  </button>
                </div>
              ) : !data || !list?.data ? (
                <div className="empty" role="status">
                  <RefreshCw />
                  กำลังอ่านข้อตกลงจาก Sepolia…
                </div>
              ) : !list.data.items.length ? (
                <div className="empty">
                  <FolderOpen />
                  {mine ? 'ยังไม่มีงานของบัญชีนี้' : 'ยังไม่มีข้อตกลงการจ้างงาน'}
                </div>
              ) : (
                list.data.items.map((job) => (
                  <a
                    className="job-row item"
                    href={'#/jobs/' + job.jobId}
                    key={String(job.jobId)}
                  >
                    <div className="project">
                      <span className="file">
                        <FileText size={19} />
                      </span>
                      <div>
                        <b>{job.projectName}</b>
                        <small>
                          JOB-{job.jobId.toString().padStart(3, '0')} ·{' '}
                          {short(job.freelancer)}
                        </small>
                      </div>
                    </div>
                    <strong className="job-amount">
                      {eth(job.amount)} ETH
                    </strong>
                    <span className={'badge s' + job.status}>
                      {statusNames[job.status]}
                    </span>
                    <ChevronRight size={16} />
                  </a>
                ))
              )}
              <div className="pager">
                <small>หน้า {cursors.length + 1}</small>
                <div>
                  <button
                    className="icon"
                    aria-label="หน้าก่อนหน้า"
                    disabled={!cursors.length}
                    onClick={() => setCursors((c) => c.slice(0, -1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="icon"
                    aria-label="หน้าถัดไป"
                    disabled={!list?.data?.next}
                    onClick={() =>
                      list?.data && setCursors((c) => [...c, list.data!.next])
                    }
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <a href="#/" className="back">
              <ArrowLeft size={15} /> กลับไปหน้ารวม
            </a>
            {create ? (
              <>
                <p className="eyebrow">NEW AGREEMENT</p>
                <h1>สร้างข้อตกลงการจ้างงาน</h1>
                <form className="sheet form" onSubmit={submit}>
                  <label>
                    ชื่อโครงการ
                    <input
                      required
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    รายละเอียดงาน
                    <textarea
                      required
                      rows={4}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Wallet Address ของฟรีแลนซ์
                    <input
                      required
                      placeholder="0x…"
                      value={draft.freelancer}
                      onChange={(e) =>
                        setDraft({ ...draft, freelancer: e.target.value })
                      }
                    />
                  </label>
                  <div className="pair">
                    <label>
                      ค่าจ้าง (Sepolia ETH)
                      <input
                        required
                        inputMode="decimal"
                        placeholder="0.01"
                        value={draft.eth}
                        onChange={(e) =>
                          setDraft({ ...draft, eth: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      ระยะเวลาส่งงาน (วัน)
                      <input
                        required
                        inputMode="numeric"
                        placeholder="7"
                        value={draft.days}
                        onChange={(e) =>
                          setDraft({ ...draft, days: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <p className="note">
                    <ArrowDownLeft size={17} />
                    กำหนดส่งเริ่มนับเมื่อสร้างงานสำเร็จ จากนั้นจึงฝากค่าจ้างในหน้ารายละเอียด
                  </p>
                  {wallet.ready ? (
                    <button disabled={busy || !!pending}>
                      สร้างข้อตกลง <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button type="button" onClick={wallet.connect}>
                      <Wallet size={16} />
                      {connectLabel}
                    </button>
                  )}
                </form>
              </>
            ) : (
              <>
                <p className="eyebrow">AGREEMENT DETAILS</p>
                <div className="sectionline">
                  <h1>รายละเอียดข้อตกลง</h1>
                  <button
                    className="icon"
                    aria-label="รีเฟรชรายละเอียด"
                    onClick={reload}
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
                {summary?.error || detail?.error ? (
                  <div className="empty">
                    อ่านรายละเอียดไม่ได้ กรุณาตรวจเลขงานและเครือข่าย
                    <button onClick={reload}>ลองอีกครั้ง</button>
                  </div>
                ) : data && detail?.data ? (
                  <Detail
                    key={id + ':' + wallet.account + ':' + wallet.chainId}
                    job={detail.data}
                    owner={data.owner}
                    account={wallet.account}
                    head={receiptBlock > data.block ? receiptBlock : data.block}
                    chainTime={data.now}
                    ready={wallet.ready}
                    busy={busy || !!pending}
                    send={send}
                    connect={wallet.connect}
                  />
                ) : (
                  <div className="empty">กำลังอ่านข้อตกลง…</div>
                )}
              </>
            )}
          </>
        )}
        <footer>
          <div>
            <ShieldCheck size={16} />
            <b>สัญญา Escrow</b>
            <a
              href={explorer + '/address/' + address + '#code'}
              target="_blank"
              rel="noreferrer"
            >
              {short(address)} <ArrowUpRight size={14} />
            </a>
            <button
              className="icon"
              aria-label="คัดลอกที่อยู่สัญญา"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                } catch {
                  setTx({ message: address })
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <a
            href={explorer + '/address/' + address}
            target="_blank"
            rel="noreferrer"
          >
            Sepolia Etherscan <ExternalLink size={13} />
          </a>
        </footer>
      </main>
    </>
  )
}
