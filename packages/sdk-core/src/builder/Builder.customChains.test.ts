import type { TAssetInfo } from '@paraspell/assets'
import { Native } from '@paraspell/assets'
import type { TPalletEntry } from '@paraspell/pallets'
import { type TChain, Version } from '@paraspell/sdk-common'
import { describe, expect, it, vi } from 'vitest'

import { PolkadotApi } from '../api/PolkadotApi'
import { TX_CLIENT_TIMEOUT_MS } from '../constants'
import type { TBridgeStatus, TDryRunChainResult, TSerializedExtrinsics } from '../types'
import { Builder } from './Builder'

const BALANCE = 10n ** 18n

const PALLETS: TPalletEntry[] = [
  { name: 'System', index: 0, hasExtrinsics: true },
  { name: 'Balances', index: 10, hasExtrinsics: true },
  { name: 'PolkadotXcm', index: 31, hasExtrinsics: true },
  { name: 'Assets', index: 50, hasExtrinsics: true }
] as TPalletEntry[]

const dryRun = (asset: TAssetInfo): Promise<TDryRunChainResult> =>
  Promise.resolve({ success: true as const, fee: 1000n, forwardedXcms: [], asset })

// Keep init and custom-chain hydration real; stub only the client and chain responses.
class OfflineApi extends PolkadotApi<unknown, TSerializedExtrinsics, unknown, 'MyChain'> {
  readonly type = 'PAPI' as const
  leaseClient = () => Promise.resolve({})
  accountToHex = () => '0x' + '00'.repeat(32)
  accountToUint8a = () => new Uint8Array(32)
  deserializeExtrinsics = (s: TSerializedExtrinsics) => s
  txFromHex = () => Promise.resolve({} as TSerializedExtrinsics)
  txToHex = () => Promise.resolve('')
  encodeTx = () => ({})
  queryState = <T>() =>
    Promise.resolve({
      providers: 1,
      data: { free: BALANCE, reserved: 0n, frozen: 0n },
      free: BALANCE,
      balance: BALANCE
    } as T)
  queryRuntimeApi = <T>() => Promise.resolve({} as T)
  callBatchMethod = () => ({}) as TSerializedExtrinsics
  objectToHex = () => Promise.resolve('')
  hexToUint8a = () => new Uint8Array()
  stringToUint8a = () => new Uint8Array()
  getMethod = () => ''
  getTypeThenAssetCount = () => undefined
  hasMethod = (pallet: string) => Promise.resolve(pallet === 'PolkadotXcm')
  hasRuntimeApi = () => Promise.resolve(true)
  fetchPalletList = () => Promise.resolve(PALLETS)
  isEvmChain = () => Promise.resolve(false)
  getPaymentInfo = () => Promise.resolve({ partialFee: 0n, weight: { refTime: 0n, proofSize: 0n } })
  getXcmWeight = () => Promise.resolve({ refTime: 0n, proofSize: 0n })
  getXcmPaymentApiFee = () => Promise.resolve(0n)
  getFromRpc = () => Promise.resolve('')
  blake2AsHex = () => ''
  xxhashAsHex = () => ''
  clone = () => new OfflineApi(this._config)
  createApiForChain = () => Promise.resolve(new OfflineApi(this._config))
  getDryRunCall = (o: { chain: TChain | 'MyChain' }) =>
    dryRun(this.findNativeAssetInfoOrThrow(o.chain))
  getDryRunXcm = (o: { chain: TChain | 'MyChain' }) =>
    dryRun(this.findNativeAssetInfoOrThrow(o.chain))
  getBridgeStatus = (): Promise<TBridgeStatus> => Promise.resolve('Normal')
  createBridgedForwardedXcms = () => []
  disconnect = () => Promise.resolve()
  validateSubstrateAddress = () => true
  deriveAddress = () => ''
  signAndSubmit = () => Promise.resolve('')
  signAndSubmitFinalized = () => Promise.resolve('')
  getSystemProperties = () =>
    Promise.resolve({ ss58Format: 42, tokenSymbol: 'MYC', tokenDecimals: 12 })
  getConstant = <T = unknown>() => Promise.resolve(1_000_000_000n as T)
}

const ADDR = '5F3sa2TJAWMqDhXG6jhV4N8ko9SxwGy8TpaNS1repo5EYjQX'

const createApi = () =>
  new OfflineApi({
    customChains: {
      MyChain: {
        paraId: 4242,
        ecosystem: 'Polkadot',
        xcmVersion: Version.V5,
        providers: ['wss://rpc.mychain.example/ws'],
        assets: [
          {
            symbol: 'DOT',
            assetId: '1',
            decimals: 10,
            existentialDeposit: '10000000',
            location: { parents: 1, interior: 'Here' }
          }
        ]
      }
    },
    customAssets: {
      AssetHubPolkadot: [
        {
          symbol: 'MYC',
          decimals: 12,
          existentialDeposit: '1000000000',
          location: { parents: 1, interior: { X1: [{ Parachain: 4242 }] } }
        }
      ]
    }
  })

type RouteChain = 'MyChain' | 'AssetHubPolkadot'

const builder = (
  from: RouteChain,
  to: RouteChain,
  symbol: string,
  amount: bigint | 'ALL' = 10n ** 10n
) =>
  Builder(createApi()).from(from).to(to).currency({ symbol, amount }).sender(ADDR).recipient(ADDR)

type Call = [string, (b: ReturnType<typeof builder>) => Promise<unknown>]

describe('native ALL transfer client lifetime', () => {
  it.each(['AssetHubPolkadot', 'Hydration'] as const)(
    'keeps the transaction lease when building AssetHubPolkadot -> %s',
    async destination => {
      const api = createApi()
      const leaseSpy = vi.spyOn(api, 'leaseClient')

      await Builder(api)
        .from('AssetHubPolkadot')
        .to(destination)
        .currency({ symbol: Native('DOT'), amount: 'ALL' })
        .sender(ADDR)
        .recipient(ADDR)
        .build()

      expect(leaseSpy).toHaveBeenCalledWith(expect.anything(), TX_CLIENT_TIMEOUT_MS)
      expect(api._ttlMs).toBe(TX_CLIENT_TIMEOUT_MS)
    }
  )
})

describe('native transfer query client lifetime', () => {
  const route = (api: OfflineApi) =>
    Builder(api)
      .from('AssetHubPolkadot')
      .to('Hydration')
      .currency({ symbol: Native('DOT'), amount: 10n ** 12n })
      .sender(ADDR)
      .recipient(ADDR)

  it.each<[string, (b: ReturnType<typeof route>) => Promise<unknown>]>([
    ['getTransferableAmount', b => b.getTransferableAmount()],
    ['getMinTransferableAmount', b => b.getMinTransferableAmount()],
    ['verifyEdOnDestination', b => b.verifyEdOnDestination()]
  ])('keeps the transaction lease during %s', async (_name, query) => {
    const api = createApi()
    const leaseSpy = vi.spyOn(api, 'leaseClient')

    await expect(query(route(api))).resolves.toBeDefined()

    expect(leaseSpy).toHaveBeenCalledWith(expect.anything(), TX_CLIENT_TIMEOUT_MS)
    expect(api._ttlMs).toBe(TX_CLIENT_TIMEOUT_MS)
  })
})

describe('custom destination: AssetHubPolkadot -> MyChain (MYC)', () => {
  const route = (amount?: 'ALL') => builder('AssetHubPolkadot', 'MyChain', 'MYC', amount)

  it.each<Call>([
    ['build()', b => b.build()],
    ['dryRun()', b => b.dryRun()],
    ['getXcmFee()', b => b.getXcmFee()],
    ['getTransferableAmount()', b => b.getTransferableAmount()]
  ])('control: %s works today', async (_name, call) => {
    await expect(call(route())).resolves.toBeDefined()
  })

  it("build() with amount 'ALL' should work", async () => {
    await expect(route('ALL').build()).resolves.toMatchObject({ module: 'PolkadotXcm' })
  })

  it('verifyEdOnDestination() should work', async () => {
    await expect(route().verifyEdOnDestination()).resolves.toBe(true)
  })
})

describe('custom origin: MyChain -> AssetHubPolkadot (DOT)', () => {
  const route = (amount?: 'ALL') => builder('MyChain', 'AssetHubPolkadot', 'DOT', amount)

  it.each<Call>([
    ['build()', b => b.build()],
    ['getXcmFee()', b => b.getXcmFee()]
  ])('control: %s works today', async (_name, call) => {
    await expect(call(route())).resolves.toBeDefined()
  })

  it.each<Call>([
    ['getTransferableAmount()', b => b.getTransferableAmount()],
    ['getMinTransferableAmount()', b => b.getMinTransferableAmount()],
    ['verifyEdOnDestination()', b => b.verifyEdOnDestination()],
    ['getTransferInfo()', b => b.getTransferInfo()],
    ['getReceivableAmount()', b => b.getReceivableAmount()],
    ["build() with amount 'ALL'", b => b.currency({ symbol: 'DOT', amount: 'ALL' }).build()]
  ])('%s should work', async (_name, call) => {
    await expect(call(route())).resolves.toBeDefined()
  })
})
