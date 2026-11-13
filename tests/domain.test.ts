import { describe, expect, it } from 'vitest'
import { zeroAddress, parseEther, type Address } from 'viem'
import { allowedActions, createArgs, safeLink, type Job } from '../src/domain'
const employer: Address = '0x1000000000000000000000000000000000000000'
const freelancer: Address = '0x2000000000000000000000000000000000000000'
const owner: Address = '0x3000000000000000000000000000000000000000'
const job: Job = {
  jobId: 1n,
  projectName: 'Web',
  description: 'Landing page',
  employer,
  freelancer,
  amount: 1n,
  deadline: 10n,
  status: 1,
  workProof: '',
}
const draft = {
  name: 'Web',
  description: 'Landing page',
  freelancer,
  eth: '0.000000000000000001',
  days: '1',
}
describe('contract rules', () => {
  it('accepts a submission at the deadline and permits only dispute afterwards', () => {
    expect(allowedActions(job, freelancer, owner, 10n)).toEqual([
      'submit',
      'dispute',
    ])
    expect(allowedActions(job, freelancer, owner, 11n)).toEqual(['dispute'])
  })
  it.each([0, 1, 2, 3, 4, 5])(
    'enforces available actions at status %i',
    (status) => {
      const current = { ...job, status }
      expect(allowedActions(current, employer, owner, 0n)).toEqual(
        [['deposit'], ['dispute'], ['approve', 'dispute'], [], [], []][status],
      )
      expect(allowedActions(current, freelancer, owner, 0n)).toEqual(
        [[], ['submit', 'dispute'], ['dispute'], [], [], []][status],
      )
      expect(allowedActions(current, owner, owner, 0n)).toEqual(
        status === 4 ? ['pay', 'refund'] : [],
      )
      expect(allowedActions(current, undefined, owner, 0n)).toEqual([])
    },
  )
  it('converts ETH exactly to integer wei', () => {
    expect(createArgs(draft, employer)[3]).toBe(1n)
    expect(
      createArgs({ ...draft, eth: '1.000000000000000001' }, employer)[3],
    ).toBe(parseEther('1') + 1n)
  })
  it.each(['0', '-1', '1e3', '1.0000000000000000001', '', '1,000'])(
    'rejects invalid ETH %s',
    (eth) => expect(() => createArgs({ ...draft, eth }, employer)).toThrow(),
  )
  it.each([employer, zeroAddress, 'invalid'])(
    'rejects an invalid counterparty %s',
    (freelancer) =>
      expect(() => createArgs({ ...draft, freelancer }, employer)).toThrow(),
  )
  it.each(['0', '1.5', '-2'])('requires a positive whole duration %s', (days) =>
    expect(() => createArgs({ ...draft, days }, employer)).toThrow(),
  )
  it('renders arbitrary proof as text unless it is an HTTP(S) URL', () => {
    expect(safeLink('javascript:alert(1)')).toBeUndefined()
    expect(safeLink('Qm123')).toBeUndefined()
    expect(safeLink('https://example.org/work')).toBe(
      'https://example.org/work',
    )
  })
})
