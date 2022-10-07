import { BigNumber } from '@ethersproject/bignumber';
import { Percent, TradeType } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import _ from 'lodash';
import { WRAPPED_NATIVE_CURRENCY } from '../../../..';
import { ChainId } from '../../../../util';
import { CurrencyAmount } from '../../../../util/amounts';
import { log } from '../../../../util/log';
import { buildSwapMethodParameters, buildTrade, } from '../../../../util/methodParameters';
import { IV3GasModelFactory, usdGasTokensByChain, } from '../gas-model';
import { BASE_SWAP_COST, COST_PER_HOP, COST_PER_INIT_TICK } from './gas-costs';
// Cost for crossing an uninitialized tick.
const COST_PER_UNINIT_TICK = BigNumber.from(0);
/**
 * Computes a gas estimate for a V3 swap using heuristics.
 * Considers number of hops in the route, number of ticks crossed
 * and the typical base cost for a swap.
 *
 * We get the number of ticks crossed in a swap from the QuoterV2
 * contract.
 *
 * We compute gas estimates off-chain because
 *  1/ Calling eth_estimateGas for a swaps requires the caller to have
 *     the full balance token being swapped, and approvals.
 *  2/ Tracking gas used using a wrapper contract is not accurate with Multicall
 *     due to EIP-2929. We would have to make a request for every swap we wanted to estimate.
 *  3/ For V2 we simulate all our swaps off-chain so have no way to track gas used.
 *
 * @export
 * @class V3HeuristicGasModelFactory
 */
export class V3HeuristicGasModelFactory extends IV3GasModelFactory {
    constructor() {
        super();
    }
    async buildGasModel(chainId, gasPriceWei, poolProvider, token, l2GasDataProvider
    // this is the quoteToken
    ) {
        const l2GasData = l2GasDataProvider
            ? await l2GasDataProvider.getGasData()
            : undefined;
        const usdPool = await this.getHighestLiquidityUSDPool(chainId, poolProvider);
        const calculateL1GasFees = async (route) => {
            const swapOptions = {
                recipient: '0x0000000000000000000000000000000000000001',
                deadline: 100,
                slippageTolerance: new Percent(5, 10000),
            };
            let l1Used = BigNumber.from(0);
            let l1FeeInWei = BigNumber.from(0);
            if (chainId == ChainId.OPTIMISM || chainId == ChainId.OPTIMISTIC_KOVAN) {
                [l1Used, l1FeeInWei] = this.calculateOptimismToL1SecurityFee(route, swapOptions, l2GasData);
            }
            else if (chainId == ChainId.ARBITRUM_ONE ||
                chainId == ChainId.ARBITRUM_RINKEBY) {
                [l1Used, l1FeeInWei] = this.calculateArbitrumToL1SecurityFee(route, swapOptions, l2GasData);
            }
            // wrap fee to native currency
            const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
            const costNativeCurrency = CurrencyAmount.fromRawAmount(nativeCurrency, l1FeeInWei.toString());
            // convert fee into usd
            const nativeTokenPrice = usdPool.token0.address == nativeCurrency.address
                ? usdPool.token0Price
                : usdPool.token1Price;
            const gasCostL1USD = nativeTokenPrice.quote(costNativeCurrency);
            let gasCostL1QuoteToken = costNativeCurrency;
            // if the inputted token is not in the native currency, quote a native/quote token pool to get the gas cost in terms of the quote token
            if (!token.equals(nativeCurrency)) {
                const nativePool = await this.getHighestLiquidityNativePool(chainId, token, poolProvider);
                if (!nativePool) {
                    log.info('Could not find a pool to convert the cost into the quote token');
                    gasCostL1QuoteToken = CurrencyAmount.fromRawAmount(token, 0);
                }
                else {
                    const nativeTokenPrice = nativePool.token0.address == nativeCurrency.address
                        ? nativePool.token0Price
                        : nativePool.token1Price;
                    gasCostL1QuoteToken = nativeTokenPrice.quote(costNativeCurrency);
                }
            }
            // gasUsedL1 is the gas units used calculated from the bytes of the calldata
            // gasCostL1USD and gasCostL1QuoteToken is the cost of gas in each of those tokens
            return {
                gasUsedL1: l1Used,
                gasCostL1USD,
                gasCostL1QuoteToken,
            };
        };
        // If our quote token is WETH, we don't need to convert our gas use to be in terms
        // of the quote token in order to produce a gas adjusted amount.
        // We do return a gas use in USD however, so we still convert to usd.
        const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
        if (token.equals(nativeCurrency)) {
            const estimateGasCost = (routeWithValidQuote) => {
                const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(routeWithValidQuote, gasPriceWei, chainId);
                const token0 = usdPool.token0.address == nativeCurrency.address;
                const nativeTokenPrice = token0
                    ? usdPool.token0Price
                    : usdPool.token1Price;
                const gasCostInTermsOfUSD = nativeTokenPrice.quote(totalGasCostNativeCurrency);
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: totalGasCostNativeCurrency,
                    gasCostInUSD: gasCostInTermsOfUSD,
                };
            };
            return {
                estimateGasCost,
                calculateL1GasFees,
            };
        }
        // If the quote token is not in the native currency, we convert the gas cost to be in terms of the quote token.
        // We do this by getting the highest liquidity <quoteToken>/<nativeCurrency> pool. eg. <quoteToken>/ETH pool.
        const nativePool = await this.getHighestLiquidityNativePool(chainId, token, poolProvider);
        const usdToken = usdPool.token0.address == nativeCurrency.address
            ? usdPool.token1
            : usdPool.token0;
        const estimateGasCost = (routeWithValidQuote) => {
            const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(routeWithValidQuote, gasPriceWei, chainId);
            if (!nativePool) {
                log.info(`Unable to find ${nativeCurrency.symbol} pool with the quote token, ${token.symbol} to produce gas adjusted costs. Route will not account for gas.`);
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: CurrencyAmount.fromRawAmount(token, 0),
                    gasCostInUSD: CurrencyAmount.fromRawAmount(usdToken, 0),
                };
            }
            const token0 = nativePool.token0.address == nativeCurrency.address;
            // returns mid price in terms of the native currency (the ratio of quoteToken/nativeToken)
            const nativeTokenPrice = token0
                ? nativePool.token0Price
                : nativePool.token1Price;
            let gasCostInTermsOfQuoteToken;
            try {
                // native token is base currency
                gasCostInTermsOfQuoteToken = nativeTokenPrice.quote(totalGasCostNativeCurrency);
            }
            catch (err) {
                log.info({
                    nativeTokenPriceBase: nativeTokenPrice.baseCurrency,
                    nativeTokenPriceQuote: nativeTokenPrice.quoteCurrency,
                    gasCostInEth: totalGasCostNativeCurrency.currency,
                }, 'Debug eth price token issue');
                throw err;
            }
            // true if token0 is the native currency
            const token0USDPool = usdPool.token0.address == nativeCurrency.address;
            // gets the mid price of the pool in terms of the native token
            const nativeTokenPriceUSDPool = token0USDPool
                ? usdPool.token0Price
                : usdPool.token1Price;
            let gasCostInTermsOfUSD;
            try {
                gasCostInTermsOfUSD = nativeTokenPriceUSDPool.quote(totalGasCostNativeCurrency);
            }
            catch (err) {
                log.info({
                    usdT1: usdPool.token0.symbol,
                    usdT2: usdPool.token1.symbol,
                    gasCostInNativeToken: totalGasCostNativeCurrency.currency.symbol,
                }, 'Failed to compute USD gas price');
                throw err;
            }
            return {
                gasEstimate: baseGasUse,
                gasCostInToken: gasCostInTermsOfQuoteToken,
                gasCostInUSD: gasCostInTermsOfUSD,
            };
        };
        return {
            estimateGasCost: estimateGasCost.bind(this),
            calculateL1GasFees,
        };
    }
    estimateGas(routeWithValidQuote, gasPriceWei, chainId) {
        const totalInitializedTicksCrossed = BigNumber.from(Math.max(1, _.sum(routeWithValidQuote.initializedTicksCrossedList)));
        const totalHops = BigNumber.from(routeWithValidQuote.route.pools.length);
        const hopsGasUse = COST_PER_HOP(chainId).mul(totalHops);
        const tickGasUse = COST_PER_INIT_TICK(chainId).mul(totalInitializedTicksCrossed);
        const uninitializedTickGasUse = COST_PER_UNINIT_TICK.mul(0);
        // base estimate gas used based on chainId estimates for hops and ticks gas useage
        const baseGasUse = BASE_SWAP_COST(chainId)
            .add(hopsGasUse)
            .add(tickGasUse)
            .add(uninitializedTickGasUse);
        const baseGasCostWei = gasPriceWei.mul(baseGasUse);
        const wrappedCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
        const totalGasCostNativeCurrency = CurrencyAmount.fromRawAmount(wrappedCurrency, baseGasCostWei.toString());
        return {
            totalGasCostNativeCurrency,
            totalInitializedTicksCrossed,
            baseGasUse,
        };
    }
    async getHighestLiquidityNativePool(chainId, token, poolProvider) {
        const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
        const nativePools = _([FeeAmount.HIGH, FeeAmount.MEDIUM, FeeAmount.LOW])
            .map((feeAmount) => {
            return [nativeCurrency, token, feeAmount];
        })
            .value();
        const poolAccessor = await poolProvider.getPools(nativePools);
        const pools = _([FeeAmount.HIGH, FeeAmount.MEDIUM, FeeAmount.LOW])
            .map((feeAmount) => {
            return poolAccessor.getPool(nativeCurrency, token, feeAmount);
        })
            .compact()
            .value();
        if (pools.length == 0) {
            log.error({ pools }, `Could not find a ${nativeCurrency.symbol} pool with ${token.symbol} for computing gas costs.`);
            return null;
        }
        const maxPool = _.maxBy(pools, (pool) => pool.liquidity);
        return maxPool;
    }
    async getHighestLiquidityUSDPool(chainId, poolProvider) {
        const usdTokens = usdGasTokensByChain[chainId];
        const wrappedCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
        console.log('wrappedCurrency', wrappedCurrency);
        if (!usdTokens) {
            throw new Error(`Could not find a USD token for computing gas costs on ${chainId}`);
        }
        const usdPools = _([
            FeeAmount.HIGH,
            FeeAmount.MEDIUM,
            FeeAmount.LOW,
            FeeAmount.LOWEST,
        ])
            .flatMap((feeAmount) => {
            return _.map(usdTokens, (usdToken) => [wrappedCurrency, usdToken, feeAmount]);
        })
            .value();
        const poolAccessor = await poolProvider.getPools(usdPools);
        console.log('poolAccessor', poolAccessor);
        const pools = _([
            FeeAmount.HIGH,
            FeeAmount.MEDIUM,
            FeeAmount.LOW,
            FeeAmount.LOWEST,
        ])
            .flatMap((feeAmount) => {
            const pools = [];
            console.log('usdTokens', usdTokens);
            for (const usdToken of usdTokens) {
                console.log('wrappedCurrency in for', wrappedCurrency);
                const pool = poolAccessor.getPool(wrappedCurrency, usdToken, feeAmount);
                console.log('pool', pool);
                if (pool) {
                    pools.push(pool);
                }
            }
            return pools;
        })
            .compact()
            .value();
        console.log('pools', pools);
        if (pools.length == 0) {
            const message = `Could not find a USD/${wrappedCurrency.symbol} pool for computing gas costs.`;
            log.error({ pools }, message);
            throw new Error(message);
        }
        const maxPool = _.maxBy(pools, (pool) => pool.liquidity);
        return maxPool;
    }
    /**
     * To avoid having a call to optimism's L1 security fee contract for every route and amount combination,
     * we replicate the gas cost accounting here.
     */
    calculateOptimismToL1SecurityFee(routes, swapConfig, gasData) {
        const { l1BaseFee, scalar, decimals, overhead } = gasData;
        const route = routes[0];
        const inputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.amount.currency
            : route.quote.currency;
        const outputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.quote.currency
            : route.amount.currency;
        // build trade for swap calldata
        const trade = buildTrade(inputToken, outputToken, route.tradeType, routes, '', '');
        const data = buildSwapMethodParameters(trade, swapConfig).calldata;
        const l1GasUsed = this.getL2ToL1GasUsed(data, overhead);
        // l1BaseFee is L1 Gas Price on etherscan
        const l1Fee = l1GasUsed.mul(l1BaseFee);
        const unscaled = l1Fee.mul(scalar);
        // scaled = unscaled / (10 ** decimals)
        const scaledConversion = BigNumber.from(10).pow(decimals);
        const scaled = unscaled.div(scaledConversion);
        return [l1GasUsed, scaled];
    }
    calculateArbitrumToL1SecurityFee(routes, swapConfig, gasData) {
        const { perL2TxFee, perL1CalldataFee } = gasData;
        const route = routes[0];
        const inputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.amount.currency
            : route.quote.currency;
        const outputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.quote.currency
            : route.amount.currency;
        // build trade for swap calldata
        const trade = buildTrade(inputToken, outputToken, route.tradeType, routes, '', '');
        const data = buildSwapMethodParameters(trade, swapConfig).calldata;
        // calculates gas amounts based on bytes of calldata, use 0 as overhead.
        const l1GasUsed = this.getL2ToL1GasUsed(data, BigNumber.from(0));
        // multiply by the fee per calldata and add the flat l2 fee
        let l1Fee = l1GasUsed.mul(perL1CalldataFee);
        l1Fee = l1Fee.add(perL2TxFee);
        return [l1GasUsed, l1Fee];
    }
    // based on the code from the optimism OVM_GasPriceOracle contract
    getL2ToL1GasUsed(data, overhead) {
        // data is hex encoded
        const dataArr = data.slice(2).match(/.{1,2}/g);
        const numBytes = dataArr.length;
        let count = 0;
        for (let i = 0; i < numBytes; i += 1) {
            const byte = parseInt(dataArr[i], 16);
            if (byte == 0) {
                count += 4;
            }
            else {
                count += 16;
            }
        }
        const unsigned = overhead.add(count);
        const signedConversion = 68 * 16;
        return unsigned.add(signedConversion);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidjMtaGV1cmlzdGljLWdhcy1tb2RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9nYXMtbW9kZWxzL3YzL3YzLWhldXJpc3RpYy1nYXMtbW9kZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLDBCQUEwQixDQUFDO0FBQ3JELE9BQU8sRUFBRSxPQUFPLEVBQVMsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDOUQsT0FBTyxFQUFFLFNBQVMsRUFBUSxNQUFNLGlCQUFpQixDQUFDO0FBQ2xELE9BQU8sQ0FBQyxNQUFNLFFBQVEsQ0FBQztBQUV2QixPQUFPLEVBQWUsdUJBQXVCLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFPbkUsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBQzNDLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUMxRCxPQUFPLEVBQUUsR0FBRyxFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDM0MsT0FBTyxFQUNMLHlCQUF5QixFQUN6QixVQUFVLEdBQ1gsTUFBTSxtQ0FBbUMsQ0FBQztBQUUzQyxPQUFPLEVBRUwsa0JBQWtCLEVBQ2xCLG1CQUFtQixHQUNwQixNQUFNLGNBQWMsQ0FBQztBQUV0QixPQUFPLEVBQUUsY0FBYyxFQUFFLFlBQVksRUFBRSxrQkFBa0IsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUUvRSwyQ0FBMkM7QUFDM0MsTUFBTSxvQkFBb0IsR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBRS9DOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUNILE1BQU0sT0FBTywwQkFBMkIsU0FBUSxrQkFBa0I7SUFDaEU7UUFDRSxLQUFLLEVBQUUsQ0FBQztJQUNWLENBQUM7SUFFTSxLQUFLLENBQUMsYUFBYSxDQUN4QixPQUFn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