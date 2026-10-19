import type { TXcmFeeDetailWithForwardedXcm } from '@paraspell/sdk-core';

import type ExchangeChain from '../exchanges/ExchangeChain';
import type { TBuildTransactionsOptions, TTransformedOptions } from '../types';
import { getSwapFee } from './fees';
import {
  canUseExecuteTransfer,
  getFromExchangeOriginFee,
  getSwapExecuteOriginXcmFee,
  getToExchangeOriginFee,
  isFilteredError,
  validateRoutedFeeAsset,
} from './utils';

export const getSwapOriginFee = async <
  TApi,
  TRes,
  TSigner,
  TDisableFallback extends boolean,
  TCustomChain extends string = never,
>(
  dex: ExchangeChain,
  options: TTransformedOptions<
    TBuildTransactionsOptions<TApi, TRes, TSigner, TCustomChain>,
    TApi,
    TRes,
    TSigner,
    TCustomChain
  >,
  disableFallback: TDisableFallback,
): Promise<TXcmFeeDetailWithForwardedXcm<TDisableFallback>> => {
  const { api, origin, exchange, destination, sender } = options;

  if (canUseExecuteTransfer(dex, options)) {
    try {
      return await getSwapExecuteOriginXcmFee(dex, options, disableFallback);
    } catch (error) {
      if (!isFilteredError(error)) throw error;
      // Fall through to routed path
    }
  }

  validateRoutedFeeAsset(options);

  // Origin chain is upstream from the exchange — fee is the cost of origin -> exchange
  if (origin && origin.chain !== exchange.chain) {
    return getToExchangeOriginFee({ ...options, origin }, disableFallback);
  }

  // Origin chain is the exchange itself — fee is the swap fee
  const { result, amountOut } = await getSwapFee(dex, options, disableFallback);

  if (!destination || destination.chain === exchange.chain || result.fee === undefined) {
    return result as TXcmFeeDetailWithForwardedXcm<TDisableFallback>;
  }

  // The swap is batched with the exchange -> destination transfer, so the origin pays both fees
  const toDestOriginFee = await getFromExchangeOriginFee(
    { exchange, destination, amount: amountOut, sender, api },
    disableFallback,
  );

  return {
    ...result,
    fee: result.fee + (toDestOriginFee.fee ?? 0n),
  } as TXcmFeeDetailWithForwardedXcm<TDisableFallback>;
};
