import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider } from '@ethersproject/providers';
import DEFAULT_TOKEN_LIST from '@uniswap/default-token-list';
import { Protocol, SwapRouter } from '@uniswap/router-sdk';
import { Fraction, TradeType } from '@uniswap/sdk-core';
import { Pool, Position, SqrtPriceMath, TickMath, } from '@uniswap/v3-sdk';
import retry from 'async-retry';
import JSBI from 'jsbi';
import _ from 'lodash';
import NodeCache from 'node-cache';
import { CachingGasStationProvider, CachingTokenProviderWithFallback, CachingV2SubgraphProvider, CachingV3PoolProvider, CachingV3SubgraphProvider, EIP1559GasPriceProvider, ETHGasStationInfoProvider, LegacyGasPriceProvider, NodeJSCache, OnChainGasPriceProvider, StaticV2SubgraphProvider, StaticV3SubgraphProvider, SwapRouterProvider, UniswapMulticallProvider, URISubgraphProvider, V2QuoteProvider, V2SubgraphProviderWithFallBacks, V3SubgraphProviderWithFallBacks, } from '../../providers';
import { CachingTokenListProvider, } from '../../providers/caching-token-list-provider';
import { TokenProvider } from '../../providers/token-provider';
import { TokenValidationResult, TokenValidatorProvider, } from '../../providers/token-validator-provider';
import { V2PoolProvider, } from '../../providers/v2/pool-provider';
import { ArbitrumGasDataProvider, OptimismGasDataProvider, } from '../../providers/v3/gas-data-provider';
import { V3PoolProvider, } from '../../providers/v3/pool-provider';
import { V3QuoteProvider, } from '../../providers/v3/quote-provider';
import { ChainId, ID_TO_CHAIN_ID, ID_TO_NETWORK_NAME, V2_SUPPORTED, } from '../../util/chains';
import { log } from '../../util/log';
import { buildSwapMethodParameters, buildTrade, } from '../../util/methodParameters';
import { metric, MetricLoggerUnit } from '../../util/metric';
import { poolToString, routeToString } from '../../util/routes';
import { UNSUPPORTED_TOKENS } from '../../util/unsupported-tokens';
import { SwapToRatioStatus, } from '../router';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN, ETH_GAS_STATION_API_URL, } from './config';
import { V2RouteWithValidQuote, V3RouteWithValidQuote, } from './entities/route-with-valid-quote';
import { getBestSwapRoute } from './functions/best-swap-route';
import { calculateRatioAmountIn } from './functions/calculate-ratio-amount-in';
import { computeAllV2Routes, computeAllV3Routes, } from './functions/compute-all-routes';
import { getV2CandidatePools, getV3CandidatePools, } from './functions/get-candidate-pools';
import { V2HeuristicGasModelFactory } from './gas-models/v2/v2-heuristic-gas-model';
import { V3HeuristicGasModelFactory } from '.';
export class AlphaRouter {
    constructor({ chainId, provider, multicallAddress, multicall2Provider, v3PoolProvider, v3QuoteProvider, v2PoolProvider, v2QuoteProvider, v2SubgraphProvider, tokenProvider, blockedTokenListProvider, v3SubgraphProvider, gasPriceProvider, v3GasModelFactory, v2GasModelFactory, swapRouterProvider, optimismGasDataProvider, tokenValidatorProvider, arbitrumGasDataProvider, }) {
        this.chainId = chainId;
        this.provider = provider;
        this.multicallAddress = multicallAddress;
        this.multicall2Provider =
            multicall2Provider !== null && multicall2Provider !== void 0 ? multicall2Provider : new UniswapMulticallProvider(chainId, provider, 375000, multicallAddress);
        this.v3PoolProvider =
            v3PoolProvider !== null && v3PoolProvider !== void 0 ? v3PoolProvider : new CachingV3PoolProvider(this.chainId, new V3PoolProvider(ID_TO_CHAIN_ID(chainId), this.multicall2Provider), new NodeJSCache(new NodeCache({ stdTTL: 360, useClones: false })));
        if (v3QuoteProvider) {
            this.v3QuoteProvider = v3QuoteProvider;
        }
        else {
            switch (chainId) {
                case ChainId.OPTIMISM:
                case ChainId.OPTIMISTIC_KOVAN:
                    this.v3QuoteProvider = new V3QuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 110,
                        gasLimitPerCall: 1200000,
                        quoteMinSuccessRate: 0.1,
                    }, {
                        gasLimitOverride: 3000000,
                        multicallChunk: 45,
                    }, {
                        gasLimitOverride: 3000000,
                        multicallChunk: 45,
                    }, {
                        baseBlockOffset: -10,
                        rollback: {
                            enabled: true,
                            attemptsBeforeRollback: 1,
                            rollbackBlockOffset: -10,
                        },
                    });
                    break;
                case ChainId.ARBITRUM_ONE:
                case ChainId.ARBITRUM_RINKEBY:
                    this.v3QuoteProvider = new V3QuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 10,
                        gasLimitPerCall: 12000000,
                        quoteMinSuccessRate: 0.1,
                    }, {
                        gasLimitOverride: 30000000,
                        multicallChunk: 6,
                    }, {
                        gasLimitOverride: 30000000,
                        multicallChunk: 6,
                    });
                    break;
                case ChainId.CELO:
                case ChainId.CELO_ALFAJORES:
                    this.v3QuoteProvider = new V3QuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 10,
                        gasLimitPerCall: 5000000,
                        quoteMinSuccessRate: 0.1,
                    }, {
                        gasLimitOverride: 5000000,
                        multicallChunk: 5,
                    }, {
                        gasLimitOverride: 6250000,
                        multicallChunk: 4,
                    });
                    break;
                default:
                    this.v3QuoteProvider = new V3QuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 210,
                        gasLimitPerCall: 705000,
                        quoteMinSuccessRate: 0.15,
                    }, {
                        gasLimitOverride: 2000000,
                        multicallChunk: 70,
                    });
                    break;
            }
        }
        this.v2PoolProvider =
            v2PoolProvider !== null && v2PoolProvider !== void 0 ? v2PoolProvider : new V2PoolProvider(chainId, this.multicall2Provider);
        this.v2QuoteProvider = v2QuoteProvider !== null && v2QuoteProvider !== void 0 ? v2QuoteProvider : new V2QuoteProvider();
        this.blockedTokenListProvider =
            blockedTokenListProvider !== null && blockedTokenListProvider !== void 0 ? blockedTokenListProvider : new CachingTokenListProvider(chainId, UNSUPPORTED_TOKENS, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false })));
        this.tokenProvider =
            tokenProvider !== null && tokenProvider !== void 0 ? tokenProvider : new CachingTokenProviderWithFallback(chainId, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false })), new CachingTokenListProvider(chainId, DEFAULT_TOKEN_LIST, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false }))), new TokenProvider(chainId, this.multicall2Provider));
        const chainName = ID_TO_NETWORK_NAME(chainId);
        // ipfs urls in the following format: `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/${protocol}/${chainName}.json`;
        if (v2SubgraphProvider) {
            this.v2SubgraphProvider = v2SubgraphProvider;
        }
        else {
            this.v2SubgraphProvider = new V2SubgraphProviderWithFallBacks([
                new CachingV2SubgraphProvider(chainId, new URISubgraphProvider(chainId, `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/v2/${chainName}.json`, undefined, 0), new NodeJSCache(new NodeCache({ stdTTL: 300, useClones: false }))),
                new StaticV2SubgraphProvider(chainId),
            ]);
        }
        if (v3SubgraphProvider) {
            this.v3SubgraphProvider = v3SubgraphProvider;
        }
        else {
            this.v3SubgraphProvider = new V3SubgraphProviderWithFallBacks([
                new CachingV3SubgraphProvider(chainId, new URISubgraphProvider(chainId, `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/v3/${chainName}.json`, undefined, 0), new NodeJSCache(new NodeCache({ stdTTL: 300, useClones: false }))),
                new StaticV3SubgraphProvider(chainId, this.v3PoolProvider),
            ]);
        }
        this.gasPriceProvider =
            gasPriceProvider !== null && gasPriceProvider !== void 0 ? gasPriceProvider : new CachingGasStationProvider(chainId, this.provider instanceof JsonRpcProvider
                ? new OnChainGasPriceProvider(chainId, new EIP1559GasPriceProvider(this.provider), new LegacyGasPriceProvider(this.provider))
                : new ETHGasStationInfoProvider(ETH_GAS_STATION_API_URL), new NodeJSCache(new NodeCache({ stdTTL: 15, useClones: false })));
        this.v3GasModelFactory =
            v3GasModelFactory !== null && v3GasModelFactory !== void 0 ? v3GasModelFactory : new V3HeuristicGasModelFactory();
        this.v2GasModelFactory =
            v2GasModelFactory !== null && v2GasModelFactory !== void 0 ? v2GasModelFactory : new V2HeuristicGasModelFactory();
        this.swapRouterProvider =
            swapRouterProvider !== null && swapRouterProvider !== void 0 ? swapRouterProvider : new SwapRouterProvider(this.multicall2Provider);
        if (chainId == ChainId.OPTIMISM || chainId == ChainId.OPTIMISTIC_KOVAN) {
            this.l2GasDataProvider =
                optimismGasDataProvider !== null && optimismGasDataProvider !== void 0 ? optimismGasDataProvider : new OptimismGasDataProvider(chainId, this.multicall2Provider);
        }
        if (chainId == ChainId.ARBITRUM_ONE ||
            chainId == ChainId.ARBITRUM_RINKEBY) {
            this.l2GasDataProvider =
                arbitrumGasDataProvider !== null && arbitrumGasDataProvider !== void 0 ? arbitrumGasDataProvider : new ArbitrumGasDataProvider(chainId, this.provider);
        }
        if (tokenValidatorProvider) {
            this.tokenValidatorProvider = tokenValidatorProvider;
        }
        else if (this.chainId == ChainId.MAINNET) {
            this.tokenValidatorProvider = new TokenValidatorProvider(this.chainId, this.multicall2Provider, new NodeJSCache(new NodeCache({ stdTTL: 30000, useClones: false })));
        }
    }
    async routeToRatio(token0Balance, token1Balance, position, factoryAddress, initCodeHash, swapAndAddConfig, swapAndAddOptions, routingConfig = DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId)) {
        if (token1Balance.currency.wrapped.sortsBefore(token0Balance.currency.wrapped)) {
            [token0Balance, token1Balance] = [token1Balance, token0Balance];
        }
        let preSwapOptimalRatio = this.calculateOptimalRatio(position, position.pool.sqrtRatioX96, true);
        // set up parameters according to which token will be swapped
        let zeroForOne;
        if (position.pool.tickCurrent > position.tickUpper) {
            zeroForOne = true;
        }
        else if (position.pool.tickCurrent < position.tickLower) {
            zeroForOne = false;
        }
        else {
            zeroForOne = new Fraction(token0Balance.quotient, token1Balance.quotient).greaterThan(preSwapOptimalRatio);
            if (!zeroForOne)
                preSwapOptimalRatio = preSwapOptimalRatio.invert();
        }
        const [inputBalance, outputBalance] = zeroForOne
            ? [token0Balance, token1Balance]
            : [token1Balance, token0Balance];
        let optimalRatio = preSwapOptimalRatio;
        let postSwapTargetPool = position.pool;
        let exchangeRate = zeroForOne
            ? position.pool.token0Price
            : position.pool.token1Price;
        let swap = null;
        let ratioAchieved = false;
        let n = 0;
        // iterate until we find a swap with a sufficient ratio or return null
        while (!ratioAchieved) {
            n++;
            if (n > swapAndAddConfig.maxIterations) {
                log.info('max iterations exceeded');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'max iterations exceeded',
                };
            }
            const amountToSwap = calculateRatioAmountIn(optimalRatio, exchangeRate, inputBalance, outputBalance);
            if (amountToSwap.equalTo(0)) {
                log.info(`no swap needed: amountToSwap = 0`);
                return {
                    status: SwapToRatioStatus.NO_SWAP_NEEDED,
                };
            }
            swap = await this.route(amountToSwap, outputBalance.currency, TradeType.EXACT_INPUT, factoryAddress, initCodeHash, undefined, {
                ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId),
                ...routingConfig,
                protocols: [Protocol.V3, Protocol.V2],
            });
            if (!swap) {
                log.info('no route found from this.route()');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'no route found',
                };
            }
            const inputBalanceUpdated = inputBalance.subtract(swap.trade.inputAmount);
            const outputBalanceUpdated = outputBalance.add(swap.trade.outputAmount);
            const newRatio = inputBalanceUpdated.divide(outputBalanceUpdated);
            let targetPoolPriceUpdate;
            swap.route.forEach((route) => {
                if (route.protocol == Protocol.V3) {
                    const v3Route = route;
                    v3Route.route.pools.forEach((pool, i) => {
                        if (pool.token0.equals(position.pool.token0) &&
                            pool.token1.equals(position.pool.token1) &&
                            pool.fee == position.pool.fee) {
                            targetPoolPriceUpdate = JSBI.BigInt(v3Route.sqrtPriceX96AfterList[i].toString());
                            optimalRatio = this.calculateOptimalRatio(position, JSBI.BigInt(targetPoolPriceUpdate.toString()), zeroForOne);
                        }
                    });
                }
            });
            if (!targetPoolPriceUpdate) {
                optimalRatio = preSwapOptimalRatio;
            }
            ratioAchieved =
                newRatio.equalTo(optimalRatio) ||
                    this.absoluteValue(newRatio.asFraction.divide(optimalRatio).subtract(1)).lessThan(swapAndAddConfig.ratioErrorTolerance);
            if (ratioAchieved && targetPoolPriceUpdate) {
                postSwapTargetPool = new Pool(position.pool.token0, position.pool.token1, position.pool.fee, targetPoolPriceUpdate, position.pool.liquidity, TickMath.getTickAtSqrtRatio(targetPoolPriceUpdate), position.pool.tickDataProvider);
            }
            exchangeRate = swap.trade.outputAmount.divide(swap.trade.inputAmount);
            log.info({
                exchangeRate: exchangeRate.asFraction.toFixed(18),
                optimalRatio: optimalRatio.asFraction.toFixed(18),
                newRatio: newRatio.asFraction.toFixed(18),
                inputBalanceUpdated: inputBalanceUpdated.asFraction.toFixed(18),
                outputBalanceUpdated: outputBalanceUpdated.asFraction.toFixed(18),
                ratioErrorTolerance: swapAndAddConfig.ratioErrorTolerance.toFixed(18),
                iterationN: n.toString(),
            }, 'QuoteToRatio Iteration Parameters');
            if (exchangeRate.equalTo(0)) {
                log.info('exchangeRate to 0');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'insufficient liquidity to swap to optimal ratio',
                };
            }
        }
        if (!swap) {
            return {
                status: SwapToRatioStatus.NO_ROUTE_FOUND,
                error: 'no route found',
            };
        }
        let methodParameters;
        if (swapAndAddOptions) {
            methodParameters = await this.buildSwapAndAddMethodParameters(swap.trade, swapAndAddOptions, {
                initialBalanceTokenIn: inputBalance,
                initialBalanceTokenOut: outputBalance,
                preLiquidityPosition: position,
            });
        }
        return {
            status: SwapToRatioStatus.SUCCESS,
            result: { ...swap, methodParameters, optimalRatio, postSwapTargetPool },
        };
    }
    /**
     * @inheritdoc IRouter
     */
    async route(amount, quoteCurrency, tradeType, factoryAddress, initCodeHash, swapConfig, partialRoutingConfig = {}) {
        var _a;
        metric.putMetric(`QuoteRequestedForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        // Get a block number to specify in all our calls. Ensures data we fetch from chain is
        // from the same block.
        const blockNumber = (_a = partialRoutingConfig.blockNumber) !== null && _a !== void 0 ? _a : this.getBlockNumberPromise();
        const routingConfig = _.merge({}, DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId), partialRoutingConfig, { blockNumber });
        const { protocols } = routingConfig;
        const currencyIn = tradeType == TradeType.EXACT_INPUT ? amount.currency : quoteCurrency;
        const currencyOut = tradeType == TradeType.EXACT_INPUT ? quoteCurrency : amount.currency;
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        // Generate our distribution of amounts, i.e. fractions of the input amount.
        // We will get quotes for fractions of the input amount for different routes, then
        // combine to generate split routes.
        const [percents, amounts] = this.getAmountDistribution(amount, routingConfig);
        // Get an estimate of the gas price to use when estimating gas cost of different routes.
        const beforeGas = Date.now();
        const { gasPriceWei } = await this.gasPriceProvider.getGasPrice();
        metric.putMetric('GasPriceLoad', Date.now() - beforeGas, MetricLoggerUnit.Milliseconds);
        const quoteToken = quoteCurrency.wrapped;
        const quotePromises = [];
        const protocolsSet = new Set(protocols !== null && protocols !== void 0 ? protocols : []);
        if ((protocolsSet.size == 0 ||
            (protocolsSet.has(Protocol.V2) && protocolsSet.has(Protocol.V3))) &&
            V2_SUPPORTED.includes(this.chainId)) {
            log.info({ protocols, tradeType }, 'Routing across all protocols');
            quotePromises.push(this.getV3Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, tradeType, routingConfig));
            quotePromises.push(this.getV2Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, tradeType, routingConfig, factoryAddress, initCodeHash));
        }
        else {
            if (protocolsSet.has(Protocol.V3) ||
                (protocolsSet.size == 0 && !V2_SUPPORTED.includes(this.chainId))) {
                log.info({ protocols, swapType: tradeType }, 'Routing across V3');
                quotePromises.push(this.getV3Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, tradeType, routingConfig));
            }
            if (protocolsSet.has(Protocol.V2)) {
                log.info({ protocols, swapType: tradeType }, 'Routing across V2');
                quotePromises.push(this.getV2Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, tradeType, routingConfig, factoryAddress, initCodeHash));
            }
        }
        const routesWithValidQuotesByProtocol = await Promise.all(quotePromises);
        let allRoutesWithValidQuotes = [];
        let allCandidatePools = [];
        for (const { routesWithValidQuotes, candidatePools, } of routesWithValidQuotesByProtocol) {
            allRoutesWithValidQuotes = [
                ...allRoutesWithValidQuotes,
                ...routesWithValidQuotes,
            ];
            allCandidatePools = [...allCandidatePools, candidatePools];
        }
        if (allRoutesWithValidQuotes.length == 0) {
            log.info({ allRoutesWithValidQuotes }, 'Received no valid quotes');
            return null;
        }
        // Given all the quotes for all the amounts for all the routes, find the best combination.
        const beforeBestSwap = Date.now();
        const swapRouteRaw = await getBestSwapRoute(amount, percents, allRoutesWithValidQuotes, tradeType, this.chainId, routingConfig, factoryAddress, initCodeHash);
        if (!swapRouteRaw) {
            return null;
        }
        const { quote, quoteGasAdjusted, estimatedGasUsed, routes: routeAmounts, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, } = swapRouteRaw;
        // Build Trade object that represents the optimal swap.
        const trade = buildTrade(currencyIn, currencyOut, tradeType, routeAmounts, factoryAddress, initCodeHash);
        let methodParameters;
        // If user provided recipient, deadline etc. we also generate the calldata required to execute
        // the swap and return it too.
        if (swapConfig) {
            methodParameters = buildSwapMethodParameters(trade, swapConfig);
        }
        metric.putMetric('FindBestSwapRoute', Date.now() - beforeBestSwap, MetricLoggerUnit.Milliseconds);
        metric.putMetric(`QuoteFoundForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        this.emitPoolSelectionMetrics(swapRouteRaw, allCandidatePools);
        return {
            quote,
            quoteGasAdjusted,
            estimatedGasUsed,
            estimatedGasUsedQuoteToken,
            estimatedGasUsedUSD,
            gasPriceWei,
            route: routeAmounts,
            trade,
            methodParameters,
            blockNumber: BigNumber.from(await blockNumber),
        };
    }
    async applyTokenValidatorToPools(pools, isInvalidFn) {
        if (!this.tokenValidatorProvider) {
            return pools;
        }
        log.info(`Running token validator on ${pools.length} pools`);
        const tokens = _.flatMap(pools, (pool) => [pool.token0, pool.token1]);
        const tokenValidationResults = await this.tokenValidatorProvider.validateTokens(tokens);
        const poolsFiltered = _.filter(pools, (pool) => {
            const token0Validation = tokenValidationResults.getValidationByToken(pool.token0);
            const token1Validation = tokenValidationResults.getValidationByToken(pool.token1);
            const token0Invalid = isInvalidFn(pool.token0, token0Validation);
            const token1Invalid = isInvalidFn(pool.token1, token1Validation);
            if (token0Invalid || token1Invalid) {
                log.info(`Dropping pool ${poolToString(pool)} because token is invalid. ${pool.token0.symbol}: ${token0Validation}, ${pool.token1.symbol}: ${token1Validation}`);
            }
            return !token0Invalid && !token1Invalid;
        });
        return poolsFiltered;
    }
    async getV3Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, swapType, routingConfig) {
        log.info('Starting to get V3 quotes');
        // Fetch all the pools that we will consider routing via. There are thousands
        // of pools, so we filter them to a set of candidate pools that we expect will
        // result in good prices.
        const { poolAccessor, candidatePools } = await getV3CandidatePools({
            tokenIn,
            tokenOut,
            tokenProvider: this.tokenProvider,
            blockedTokenListProvider: this.blockedTokenListProvider,
            poolProvider: this.v3PoolProvider,
            routeType: swapType,
            subgraphProvider: this.v3SubgraphProvider,
            routingConfig,
            chainId: this.chainId,
        });
        const poolsRaw = poolAccessor.getAllPools();
        // Drop any pools that contain fee on transfer tokens (not supported by v3) or have issues with being transferred.
        const pools = await this.applyTokenValidatorToPools(poolsRaw, (token, tokenValidation) => {
            // If there is no available validation result we assume the token is fine.
            if (!tokenValidation) {
                return false;
            }
            // Only filters out *intermediate* pools that involve tokens that we detect
            // cant be transferred. This prevents us trying to route through tokens that may
            // not be transferrable, but allows users to still swap those tokens if they
            // specify.
            //
            if (tokenValidation == TokenValidationResult.STF &&
                (token.equals(tokenIn) || token.equals(tokenOut))) {
                return false;
            }
            return (tokenValidation == TokenValidationResult.FOT ||
                tokenValidation == TokenValidationResult.STF);
        });
        // Given all our candidate pools, compute all the possible ways to route from tokenIn to tokenOut.
        const { maxSwapsPerPath } = routingConfig;
        const routes = computeAllV3Routes(tokenIn, tokenOut, pools, maxSwapsPerPath);
        if (routes.length == 0) {
            return { routesWithValidQuotes: [], candidatePools };
        }
        // For all our routes, and all the fractional amounts, fetch quotes on-chain.
        const quoteFn = swapType == TradeType.EXACT_INPUT
            ? this.v3QuoteProvider.getQuotesManyExactIn.bind(this.v3QuoteProvider)
            : this.v3QuoteProvider.getQuotesManyExactOut.bind(this.v3QuoteProvider);
        const beforeQuotes = Date.now();
        log.info(`Getting quotes for V3 for ${routes.length} routes with ${amounts.length} amounts per route.`);
        const { routesWithQuotes } = await quoteFn(amounts, routes, {
            blockNumber: routingConfig.blockNumber,
        });
        const gasModel = await this.v3GasModelFactory.buildGasModel(this.chainId, gasPriceWei, this.v3PoolProvider, quoteToken, this.l2GasDataProvider);
        metric.putMetric('V3QuotesLoad', Date.now() - beforeQuotes, MetricLoggerUnit.Milliseconds);
        metric.putMetric('V3QuotesFetched', _(routesWithQuotes)
            .map(([, quotes]) => quotes.length)
            .sum(), MetricLoggerUnit.Count);
        const routesWithValidQuotes = [];
        for (const routeWithQuote of routesWithQuotes) {
            const [route, quotes] = routeWithQuote;
            for (let i = 0; i < quotes.length; i++) {
                const percent = percents[i];
                const amountQuote = quotes[i];
                const { quote, amount, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate, } = amountQuote;
                if (!quote ||
                    !sqrtPriceX96AfterList ||
                    !initializedTicksCrossedList ||
                    !gasEstimate) {
                    log.debug({
                        route: routeToString(route),
                        amountQuote,
                    }, 'Dropping a null V3 quote for route.');
                    continue;
                }
                const routeWithValidQuote = new V3RouteWithValidQuote({
                    route,
                    rawQuote: quote,
                    amount,
                    percent,
                    sqrtPriceX96AfterList,
                    initializedTicksCrossedList,
                    quoterGasEstimate: gasEstimate,
                    gasModel,
                    quoteToken,
                    tradeType: swapType,
                    v3PoolProvider: this.v3PoolProvider,
                });
                routesWithValidQuotes.push(routeWithValidQuote);
            }
        }
        return { routesWithValidQuotes, candidatePools };
    }
    async getV2Quotes(tokenIn, tokenOut, amounts, percents, quoteToken, gasPriceWei, swapType, routingConfig, factoryAddress, initCodeHash) {
        log.info('Starting to get V2 quotes');
        // Fetch all the pools that we will consider routing via. There are thousands
        // of pools, so we filter them to a set of candidate pools that we expect will
        // result in good prices.
        const { poolAccessor, candidatePools } = await getV2CandidatePools({
            tokenIn,
            tokenOut,
            tokenProvider: this.tokenProvider,
            blockedTokenListProvider: this.blockedTokenListProvider,
            poolProvider: this.v2PoolProvider,
            routeType: swapType,
            subgraphProvider: this.v2SubgraphProvider,
            routingConfig,
            chainId: this.chainId,
            factoryAddress,
            initCodeHash,
        });
        const poolsRaw = poolAccessor.getAllPools();
        // Drop any pools that contain tokens that can not be transferred according to the token validator.
        const pools = await this.applyTokenValidatorToPools(poolsRaw, (token, tokenValidation) => {
            // If there is no available validation result we assume the token is fine.
            if (!tokenValidation) {
                return false;
            }
            // Only filters out *intermediate* pools that involve tokens that we detect
            // cant be transferred. This prevents us trying to route through tokens that may
            // not be transferrable, but allows users to still swap those tokens if they
            // specify.
            if (tokenValidation == TokenValidationResult.STF &&
                (token.equals(tokenIn) || token.equals(tokenOut))) {
                return false;
            }
            return tokenValidation == TokenValidationResult.STF;
        });
        // Given all our candidate pools, compute all the possible ways to route from tokenIn to tokenOut.
        const { maxSwapsPerPath } = routingConfig;
        const routes = computeAllV2Routes(tokenIn, tokenOut, pools, maxSwapsPerPath, factoryAddress, initCodeHash);
        if (routes.length == 0) {
            return { routesWithValidQuotes: [], candidatePools };
        }
        // For all our routes, and all the fractional amounts, fetch quotes on-chain.
        const quoteFn = swapType == TradeType.EXACT_INPUT
            ? this.v2QuoteProvider.getQuotesManyExactIn.bind(this.v2QuoteProvider)
            : this.v2QuoteProvider.getQuotesManyExactOut.bind(this.v2QuoteProvider);
        const beforeQuotes = Date.now();
        log.info(`Getting quotes for V2 for ${routes.length} routes with ${amounts.length} amounts per route.`);
        const { routesWithQuotes } = await quoteFn(amounts, routes, factoryAddress, initCodeHash);
        const gasModel = await this.v2GasModelFactory.buildGasModel(this.chainId, gasPriceWei, this.v2PoolProvider, quoteToken, factoryAddress, initCodeHash);
        metric.putMetric('V2QuotesLoad', Date.now() - beforeQuotes, MetricLoggerUnit.Milliseconds);
        metric.putMetric('V2QuotesFetched', _(routesWithQuotes)
            .map(([, quotes]) => quotes.length)
            .sum(), MetricLoggerUnit.Count);
        const routesWithValidQuotes = [];
        for (const routeWithQuote of routesWithQuotes) {
            const [route, quotes] = routeWithQuote;
            for (let i = 0; i < quotes.length; i++) {
                const percent = percents[i];
                const amountQuote = quotes[i];
                const { quote, amount } = amountQuote;
                if (!quote) {
                    log.debug({
                        route: routeToString(route, factoryAddress, initCodeHash),
                        amountQuote,
                    }, 'Dropping a null V2 quote for route.');
                    continue;
                }
                const routeWithValidQuote = new V2RouteWithValidQuote({
                    route,
                    rawQuote: quote,
                    amount,
                    percent,
                    gasModel,
                    quoteToken,
                    tradeType: swapType,
                    v2PoolProvider: this.v2PoolProvider,
                    factoryAddress,
                    initCodeHash
                });
                routesWithValidQuotes.push(routeWithValidQuote);
            }
        }
        return { routesWithValidQuotes, candidatePools };
    }
    // Note multiplications here can result in a loss of precision in the amounts (e.g. taking 50% of 101)
    // This is reconcilled at the end of the algorithm by adding any lost precision to one of
    // the splits in the route.
    getAmountDistribution(amount, routingConfig) {
        const { distributionPercent } = routingConfig;
        const percents = [];
        const amounts = [];
        for (let i = 1; i <= 100 / distributionPercent; i++) {
            percents.push(i * distributionPercent);
            amounts.push(amount.multiply(new Fraction(i * distributionPercent, 100)));
        }
        return [percents, amounts];
    }
    async buildSwapAndAddMethodParameters(trade, swapAndAddOptions, swapAndAddParameters) {
        const { swapOptions: { recipient, slippageTolerance, deadline, inputTokenPermit }, addLiquidityOptions: addLiquidityConfig, } = swapAndAddOptions;
        const preLiquidityPosition = swapAndAddParameters.preLiquidityPosition;
        const finalBalanceTokenIn = swapAndAddParameters.initialBalanceTokenIn.subtract(trade.inputAmount);
        const finalBalanceTokenOut = swapAndAddParameters.initialBalanceTokenOut.add(trade.outputAmount);
        const approvalTypes = await this.swapRouterProvider.getApprovalType(finalBalanceTokenIn, finalBalanceTokenOut);
        const zeroForOne = finalBalanceTokenIn.currency.wrapped.sortsBefore(finalBalanceTokenOut.currency.wrapped);
        return SwapRouter.swapAndAddCallParameters(trade, {
            recipient,
            slippageTolerance,
            deadlineOrPreviousBlockhash: deadline,
            inputTokenPermit,
        }, Position.fromAmounts({
            pool: preLiquidityPosition.pool,
            tickLower: preLiquidityPosition.tickLower,
            tickUpper: preLiquidityPosition.tickUpper,
            amount0: zeroForOne
                ? finalBalanceTokenIn.quotient.toString()
                : finalBalanceTokenOut.quotient.toString(),
            amount1: zeroForOne
                ? finalBalanceTokenOut.quotient.toString()
                : finalBalanceTokenIn.quotient.toString(),
            useFullPrecision: false,
        }), addLiquidityConfig, approvalTypes.approvalTokenIn, approvalTypes.approvalTokenOut);
    }
    emitPoolSelectionMetrics(swapRouteRaw, allPoolsBySelection) {
        const poolAddressesUsed = new Set();
        const { routes: routeAmounts } = swapRouteRaw;
        _(routeAmounts)
            .flatMap((routeAmount) => {
            const { poolAddresses } = routeAmount;
            return poolAddresses;
        })
            .forEach((address) => {
            poolAddressesUsed.add(address.toLowerCase());
        });
        for (const poolsBySelection of allPoolsBySelection) {
            const { protocol } = poolsBySelection;
            _.forIn(poolsBySelection.selections, (pools, topNSelection) => {
                const topNUsed = _.findLastIndex(pools, (pool) => poolAddressesUsed.has(pool.id.toLowerCase())) + 1;
                metric.putMetric(_.capitalize(`${protocol}${topNSelection}`), topNUsed, MetricLoggerUnit.Count);
            });
        }
        let hasV3Route = false;
        let hasV2Route = false;
        for (const routeAmount of routeAmounts) {
            if (routeAmount.protocol == Protocol.V3) {
                hasV3Route = true;
            }
            if (routeAmount.protocol == Protocol.V2) {
                hasV2Route = true;
            }
        }
        if (hasV3Route && hasV2Route) {
            metric.putMetric(`V3AndV2SplitRoute`, 1, MetricLoggerUnit.Count);
            metric.putMetric(`V3AndV2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        }
        else if (hasV3Route) {
            if (routeAmounts.length > 1) {
                metric.putMetric(`V3SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V3SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else {
                metric.putMetric(`V3Route`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V3RouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
        else if (hasV2Route) {
            if (routeAmounts.length > 1) {
                metric.putMetric(`V2SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else {
                metric.putMetric(`V2Route`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V2RouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
    }
    calculateOptimalRatio(position, sqrtRatioX96, zeroForOne) {
        const upperSqrtRatioX96 = TickMath.getSqrtRatioAtTick(position.tickUpper);
        const lowerSqrtRatioX96 = TickMath.getSqrtRatioAtTick(position.tickLower);
        // returns Fraction(0, 1) for any out of range position regardless of zeroForOne. Implication: function
        // cannot be used to determine the trading direction of out of range positions.
        if (JSBI.greaterThan(sqrtRatioX96, upperSqrtRatioX96) ||
            JSBI.lessThan(sqrtRatioX96, lowerSqrtRatioX96)) {
            return new Fraction(0, 1);
        }
        const precision = JSBI.BigInt('1' + '0'.repeat(18));
        let optimalRatio = new Fraction(SqrtPriceMath.getAmount0Delta(sqrtRatioX96, upperSqrtRatioX96, precision, true), SqrtPriceMath.getAmount1Delta(sqrtRatioX96, lowerSqrtRatioX96, precision, true));
        if (!zeroForOne)
            optimalRatio = optimalRatio.invert();
        return optimalRatio;
    }
    absoluteValue(fraction) {
        const numeratorAbs = JSBI.lessThan(fraction.numerator, JSBI.BigInt(0))
            ? JSBI.unaryMinus(fraction.numerator)
            : fraction.numerator;
        const denominatorAbs = JSBI.lessThan(fraction.denominator, JSBI.BigInt(0))
            ? JSBI.unaryMinus(fraction.denominator)
            : fraction.denominator;
        return new Fraction(numeratorAbs, denominatorAbs);
    }
    getBlockNumberPromise() {
        return retry(async (_b, attempt) => {
            if (attempt > 1) {
                log.info(`Get block number attempt ${attempt}`);
            }
            return this.provider.getBlockNumber();
        }, {
            retries: 2,
            minTimeout: 100,
            maxTimeout: 1000,
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWxwaGEtcm91dGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2FscGhhLXJvdXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sMEJBQTBCLENBQUM7QUFDckQsT0FBTyxFQUFnQixlQUFlLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUN6RSxPQUFPLGtCQUFrQixNQUFNLDZCQUE2QixDQUFDO0FBQzdELE9BQU8sRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFTLE1BQU0scUJBQXFCLENBQUM7QUFDbEUsT0FBTyxFQUFZLFFBQVEsRUFBUyxTQUFTLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUd6RSxPQUFPLEVBRUwsSUFBSSxFQUNKLFFBQVEsRUFDUixhQUFhLEVBQ2IsUUFBUSxHQUNULE1BQU0saUJBQWlCLENBQUM7QUFDekIsT0FBTyxLQUFLLE1BQU0sYUFBYSxDQUFDO0FBQ2hDLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQztBQUN4QixPQUFPLENBQUMsTUFBTSxRQUFRLENBQUM7QUFDdkIsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBRW5DLE9BQU8sRUFDTCx5QkFBeUIsRUFDekIsZ0NBQWdDLEVBQ2hDLHlCQUF5QixFQUN6QixxQkFBcUIsRUFDckIseUJBQXlCLEVBQ3pCLHVCQUF1QixFQUN2Qix5QkFBeUIsRUFJekIsc0JBQXNCLEVBQ3RCLFdBQVcsRUFDWCx1QkFBdUIsRUFDdkIsd0JBQXdCLEVBQ3hCLHdCQUF3QixFQUN4QixrQkFBa0IsRUFDbEIsd0JBQXdCLEVBQ3hCLG1CQUFtQixFQUNuQixlQUFlLEVBQ2YsK0JBQStCLEVBQy9CLCtCQUErQixHQUNoQyxNQUFNLGlCQUFpQixDQUFDO0FBQ3pCLE9BQU8sRUFDTCx3QkFBd0IsR0FFekIsTUFBTSw2Q0FBNkMsQ0FBQztBQUtyRCxPQUFPLEVBQWtCLGFBQWEsRUFBRSxNQUFNLGdDQUFnQyxDQUFDO0FBQy9FLE9BQU8sRUFFTCxxQkFBcUIsRUFDckIsc0JBQXNCLEdBQ3ZCLE1BQU0sMENBQTBDLENBQUM7QUFDbEQsT0FBTyxFQUVMLGNBQWMsR0FDZixNQUFNLGtDQUFrQyxDQUFDO0FBQzFDLE9BQU8sRUFFTCx1QkFBdUIsRUFHdkIsdUJBQXVCLEdBQ3hCLE1BQU0sc0NBQXNDLENBQUM7QUFDOUMsT0FBTyxFQUVMLGNBQWMsR0FDZixNQUFNLGtDQUFrQyxDQUFDO0FBQzFDLE9BQU8sRUFFTCxlQUFlLEdBQ2hCLE1BQU0sbUNBQW1DLENBQUM7QUFHM0MsT0FBTyxFQUNMLE9BQU8sRUFDUCxjQUFjLEVBQ2Qsa0JBQWtCLEVBQ2xCLFlBQVksR0FDYixNQUFNLG1CQUFtQixDQUFDO0FBQzNCLE9BQU8sRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQUNyQyxPQUFPLEVBQ0wseUJBQXlCLEVBQ3pCLFVBQVUsR0FDWCxNQUFNLDZCQUE2QixDQUFDO0FBQ3JDLE9BQU8sRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUM3RCxPQUFPLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxNQUFNLG1CQUFtQixDQUFDO0FBQ2hFLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLCtCQUErQixDQUFDO0FBQ25FLE9BQU8sRUFTTCxpQkFBaUIsR0FDbEIsTUFBTSxXQUFXLENBQUM7QUFFbkIsT0FBTyxFQUNMLCtCQUErQixFQUMvQix1QkFBdUIsR0FDeEIsTUFBTSxVQUFVLENBQUM7QUFDbEIsT0FBTyxFQUVMLHFCQUFxQixFQUNyQixxQkFBcUIsR0FDdEIsTUFBTSxtQ0FBbUMsQ0FBQztBQUMzQyxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSw2QkFBNkIsQ0FBQztBQUMvRCxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSx1Q0FBdUMsQ0FBQztBQUMvRSxPQUFPLEVBQ0wsa0JBQWtCLEVBQ2xCLGtCQUFrQixHQUNuQixNQUFNLGdDQUFnQyxDQUFDO0FBQ3hDLE9BQU8sRUFFTCxtQkFBbUIsRUFDbkIsbUJBQW1CLEdBRXBCLE1BQU0saUNBQWlDLENBQUM7QUFLekMsT0FBTyxFQUFFLDBCQUEwQixFQUFFLE1BQU0sd0NBQXdDLENBQUM7QUFFcEYsT0FBTyxFQUFFLDBCQUEwQixFQUFFLE1BQU0sR0FBRyxDQUFDO0FBd0wvQyxNQUFNLE9BQU8sV0FBVztJQTBCdEIsWUFBWSxFQUNWLE9BQU8sRUFDUCxRQUFRLEVBQ1IsZ0JBQWdCLEVBQ2hCLGtCQUFrQixFQUNsQixjQUFjLEVBQ2QsZUFBZSxFQUNmLGNBQWMsRUFDZCxlQUFlLEVBQ2Ysa0JBQWtCLEVBQ2xCLGFBQWEsRUFDYix3QkFBd0IsRUFDeEIsa0JBQWtCLEVBQ2xCLGdCQUFnQixFQUNoQixpQkFBaUIsRUFDakIsaUJBQWlCLEVBQ2pCLGtCQUFrQixFQUNsQix1QkFBdUIsRUFDdkIsc0JBQXNCLEVBQ3RCLHVCQUF1QixHQUNMO1FBQ2xCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQztRQUN6QyxJQUFJLENBQUMsa0JBQWtCO1lBQ3JCLGtCQUFrQixhQUFsQixrQkFBa0IsY0FBbEIsa0JBQWtCLEdBQ2xCLElBQUksd0JBQXdCLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFPLEVBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUM1RSxJQUFJLENBQUMsY0FBYztZQUNqQixjQUFjLGFBQWQsY0FBYyxjQUFkLGNBQWMsR0FDZCxJQUFJLHFCQUFxQixDQUN2QixJQUFJLENBQUMsT0FBTyxFQUNaLElBQUksY0FBYyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFDcEUsSUFBSSxXQUFXLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQ2xFLENBQUM7UUFFSixJQUFJLGVBQWUsRUFBRTtZQUNuQixJQUFJLENBQUMsZUFBZSxHQUFHLGVBQWUsQ0FBQztTQUN4QzthQUFNO1lBQ0wsUUFBUSxPQUFPLEVBQUU7Z0JBQ2YsS0FBSyxPQUFPLENBQUMsUUFBUSxDQUFDO2dCQUN0QixLQUFLLE9BQU8sQ0FBQyxnQkFBZ0I7b0JBQzNCLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxlQUFlLENBQ3hDLE9BQU8sRUFDUCxRQUFRLEVBQ1IsSUFBSSxDQUFDLGtCQUFrQixFQUN2Qjt3QkFDRSxPQUFPLEVBQUUsQ0FBQzt3QkFDVixVQUFVLEVBQUUsR0FBRzt3QkFDZixVQUFVLEVBQUUsSUFBSTtxQkFDakIsRUFDRDt3QkFDRSxjQUFjLEVBQUUsR0FBRzt3QkFDbkIsZUFBZSxFQUFFLE9BQVM7d0JBQzFCLG1CQUFtQixFQUFFLEdBQUc7cUJBQ3pCLEVBQ0Q7d0JBQ0UsZ0JBQWdCLEVBQUUsT0FBUzt3QkFDM0IsY0FBYyxFQUFFLEVBQUU7cUJBQ25CLEVBQ0Q7d0JBQ0UsZ0JBQWdCLEVBQUUsT0FBUzt3QkFDM0IsY0FBYyxFQUFFLEVBQUU7cUJBQ25CLEVBQ0Q7d0JBQ0UsZUFBZSxFQUFFLENBQUMsRUFBRTt3QkFDcEIsUUFBUSxFQUFFOzRCQUNSLE9BQU8sRUFBRSxJQUFJOzRCQUNiLHNCQUFzQixFQUFFLENBQUM7NEJBQ3pCLG1CQUFtQixFQUFFLENBQUMsRUFBRTt5QkFDekI7cUJBQ0YsQ0FDRixDQUFDO29CQUNGLE1BQU07Z0JBQ1IsS0FBSyxPQUFPLENBQUMsWUFBWSxDQUFDO2dCQUMxQixLQUFLLE9BQU8sQ0FBQyxnQkFBZ0I7b0JBQzNCLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxlQUFlLENBQ3hDLE9BQU8sRUFDUCxRQUFRLEVBQ1IsSUFBSSxDQUFDLGtCQUFrQixFQUN2Qjt3QkFDRSxPQUFPLEVBQUUsQ0FBQzt3QkFDVixVQUFVLEVBQUUsR0FBRzt3QkFDZixVQUFVLEVBQUUsSUFBSTtxQkFDakIsRUFDRDt3QkFDRSxjQUFjLEVBQUUsRUFBRTt3QkFDbEIsZUFBZSxFQUFFLFFBQVU7d0JBQzNCLG1CQUFtQixFQUFFLEdBQUc7cUJBQ3pCLEVBQ0Q7d0JBQ0UsZ0JBQWdCLEVBQUUsUUFBVTt3QkFDNUIsY0FBYyxFQUFFLENBQUM7cUJBQ2xCLEVBQ0Q7d0JBQ0UsZ0JBQWdCLEVBQUUsUUFBVTt3QkFDNUIsY0FBYyxFQUFFLENBQUM7cUJBQ2xCLENBQ0YsQ0FBQztvQkFDRixNQUFNO2dCQUVSLEtBQUssT0FBTyxDQUFDLElBQUksQ0FBQztnQkFDbEIsS0FBSyxPQUFPLENBQUMsY0FBYztvQkFDekIsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLGVBQWUsQ0FDeEMsT0FBTyxFQUNQLFFBQVEsRUFDUixJQUFJLENBQUMsa0JBQWtCLEVBQ3ZCO3dCQUNFLE9BQU8sRUFBRSxDQUFDO3dCQUNWLFVBQVUsRUFBRSxHQUFHO3dCQUNmLFVBQVUsRUFBRSxJQUFJO3FCQUNqQixFQUNEO3dCQUNFLGNBQWMsRUFBRSxFQUFFO3dCQUNsQixlQUFlLEVBQUUsT0FBUzt3QkFDMUIsbUJBQW1CLEVBQUUsR0FBRztxQkFDekIsRUFDRDt3QkFDRSxnQkFBZ0IsRUFBRSxPQUFTO3dCQUMzQixjQUFjLEVBQUUsQ0FBQztxQkFDbEIsRUFDRDt3QkFDRSxnQkFBZ0IsRUFBRSxPQUFTO3dCQUMzQixjQUFjLEVBQUUsQ0FBQztxQkFDbEIsQ0FDRixDQUFDO29CQUNGLE1BQU07Z0JBQ1I7b0JBQ0UsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLGVBQWUsQ0FDeEMsT0FBTyxFQUNQLFFBQVEsRUFDUixJQUFJLENBQUMsa0JBQWtCLEVBQ3ZCO3dCQUNFLE9BQU8sRUFBRSxDQUFDO3dCQUNWLFVBQVUsRUFBRSxHQUFHO3dCQUNmLFVBQVUsRUFBRSxJQUFJO3FCQUNqQixFQUNEO3dCQUNFLGNBQWMsRUFBRSxHQUFHO3dCQUNuQixlQUFlLEVBQUUsTUFBTzt3QkFDeEIsbUJBQW1CLEVBQUUsSUFBSTtxQkFDMUIsRUFDRDt3QkFDRSxnQkFBZ0IsRUFBRSxPQUFTO3dCQUMzQixjQUFjLEVBQUUsRUFBRTtxQkFDbkIsQ0FDRixDQUFDO29CQUNGLE1BQU07YUFDVDtTQUNGO1FBRUQsSUFBSSxDQUFDLGNBQWM7WUFDakIsY0FBYyxhQUFkLGNBQWMsY0FBZCxjQUFjLEdBQUksSUFBSSxjQUFjLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQ3pFLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxhQUFmLGVBQWUsY0FBZixlQUFlLEdBQUksSUFBSSxlQUFlLEVBQUUsQ0FBQztRQUVoRSxJQUFJLENBQUMsd0JBQXdCO1lBQzNCLHdCQUF3QixhQUF4Qix3QkFBd0IsY0FBeEIsd0JBQXdCLEdBQ3hCLElBQUksd0JBQXdCLENBQzFCLE9BQU8sRUFDUCxrQkFBK0IsRUFDL0IsSUFBSSxXQUFXLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQ25FLENBQUM7UUFDSixJQUFJLENBQUMsYUFBYTtZQUNoQixhQUFhLGFBQWIsYUFBYSxjQUFiLGFBQWEsR0FDYixJQUFJLGdDQUFnQyxDQUNsQyxPQUFPLEVBQ1AsSUFBSSxXQUFXLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQ2xFLElBQUksd0JBQXdCLENBQzFCLE9BQU8sRUFDUCxrQkFBa0IsRUFDbEIsSUFBSSxXQUFXLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQ25FLEVBQ0QsSUFBSSxhQUFhLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUNwRCxDQUFDO1FBRUosTUFBTSxTQUFTLEdBQUcsa0JBQWtCLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFOUMsZ0lBQWdJO1FBQ2hJLElBQUksa0JBQWtCLEVBQUU7WUFDdEIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFDO1NBQzlDO2FBQU07WUFDTCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSwrQkFBK0IsQ0FBQztnQkFDNUQsSUFBSSx5QkFBeUIsQ0FDM0IsT0FBTyxFQUNQLElBQUksbUJBQW1CLENBQ3JCLE9BQU8sRUFDUCxnRUFBZ0UsU0FBUyxPQUFPLEVBQ2hGLFNBQVMsRUFDVCxDQUFDLENBQ0YsRUFDRCxJQUFJLFdBQVcsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FDbEU7Z0JBQ0QsSUFBSSx3QkFBd0IsQ0FBQyxPQUFPLENBQUM7YUFDdEMsQ0FBQyxDQUFDO1NBQ0o7UUFFRCxJQUFJLGtCQUFrQixFQUFFO1lBQ3RCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxrQkFBa0IsQ0FBQztTQUM5QzthQUFNO1lBQ0wsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksK0JBQStCLENBQUM7Z0JBQzVELElBQUkseUJBQXlCLENBQzNCLE9BQU8sRUFDUCxJQUFJLG1CQUFtQixDQUNyQixPQUFPLEVBQ1AsZ0VBQWdFLFNBQVMsT0FBTyxFQUNoRixTQUFTLEVBQ1QsQ0FBQyxDQUNGLEVBQ0QsSUFBSSxXQUFXLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQ2xFO2dCQUNELElBQUksd0JBQXdCLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUM7YUFDM0QsQ0FBQyxDQUFDO1NBQ0o7UUFFRCxJQUFJLENBQUMsZ0JBQWdCO1lBQ25CLGdCQUFnQixhQUFoQixnQkFBZ0IsY0FBaEIsZ0JBQWdCLEdBQ2hCLElBQUkseUJBQXlCLENBQzNCLE9BQU8sRUFDUCxJQUFJLENBQUMsUUFBUSxZQUFZLGVBQWU7Z0JBQ3RDLENBQUMsQ0FBQyxJQUFJLHVCQUF1QixDQUN6QixPQUFPLEVBQ1AsSUFBSSx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQzFDLElBQUksc0JBQXNCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUMxQztnQkFDSCxDQUFDLENBQUMsSUFBSSx5QkFBeUIsQ0FBQyx1QkFBdUIsQ0FBQyxFQUMxRCxJQUFJLFdBQVcsQ0FDYixJQUFJLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQ2hELENBQ0YsQ0FBQztRQUNKLElBQUksQ0FBQyxpQkFBaUI7WUFDcEIsaUJBQWlCLGFBQWpCLGlCQUFpQixjQUFqQixpQkFBaUIsR0FBSSxJQUFJLDBCQUEwQixFQUFFLENBQUM7UUFDeEQsSUFBSSxDQUFDLGlCQUFpQjtZQUNwQixpQkFBaUIsYUFBakIsaUJBQWlCLGNBQWpCLGlCQUFpQixHQUFJLElBQUksMEJBQTBCLEVBQUUsQ0FBQztRQUV4RCxJQUFJLENBQUMsa0JBQWtCO1lBQ3JCLGtCQUFrQixhQUFsQixrQkFBa0IsY0FBbEIsa0JBQWtCLEdBQUksSUFBSSxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQztRQUV4RSxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsUUFBUSxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUU7WUFDdEUsSUFBSSxDQUFDLGlCQUFpQjtnQkFDcEIsdUJBQXVCLGFBQXZCLHVCQUF1QixjQUF2Qix1QkFBdUIsR0FDdkIsSUFBSSx1QkFBdUIsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUM7U0FDakU7UUFDRCxJQUNFLE9BQU8sSUFBSSxPQUFPLENBQUMsWUFBWTtZQUMvQixPQUFPLElBQUksT0FBTyxDQUFDLGdCQUFnQixFQUNuQztZQUNBLElBQUksQ0FBQyxpQkFBaUI7Z0JBQ3BCLHVCQUF1QixhQUF2Qix1QkFBdUIsY0FBdkIsdUJBQXVCLEdBQ3ZCLElBQUksdUJBQXVCLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztTQUN2RDtRQUNELElBQUksc0JBQXNCLEVBQUU7WUFDMUIsSUFBSSxDQUFDLHNCQUFzQixHQUFHLHNCQUFzQixDQUFDO1NBQ3REO2FBQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUU7WUFDMUMsSUFBSSxDQUFDLHNCQUFzQixHQUFHLElBQUksc0JBQXNCLENBQ3RELElBQUksQ0FBQyxPQUFPLEVBQ1osSUFBSSxDQUFDLGtCQUFrQixFQUN2QixJQUFJLFdBQVcsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FDcEUsQ0FBQztTQUNIO0lBQ0gsQ0FBQztJQUVNLEtBQUssQ0FBQyxZQUFZLENBQ3ZCLGFBQTZCLEVBQzdCLGFBQTZCLEVBQzdCLFFBQWtCLEVBQ2xCLGNBQXNCLEVBQ3RCLFlBQW9CLEVBQ3BCLGdCQUFrQyxFQUNsQyxpQkFBcUMsRUFDckMsZ0JBQTRDLCtCQUErQixDQUN6RSxJQUFJLENBQUMsT0FBTyxDQUNiO1FBRUQsSUFDRSxhQUFhLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFDMUU7WUFDQSxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQztTQUNqRTtRQUVELElBQUksbUJBQW1CLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUNsRCxRQUFRLEVBQ1IsUUFBUSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQzFCLElBQUksQ0FDTCxDQUFDO1FBQ0YsNkRBQTZEO1FBQzdELElBQUksVUFBbUIsQ0FBQztRQUN4QixJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxHQUFHLFFBQVEsQ0FBQyxTQUFTLEVBQUU7WUFDbEQsVUFBVSxHQUFHLElBQUksQ0FBQztTQUNuQjthQUFNLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLEdBQUcsUUFBUSxDQUFDLFNBQVMsRUFBRTtZQUN6RCxVQUFVLEdBQUcsS0FBSyxDQUFDO1NBQ3BCO2FBQU07WUFDTCxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQ3ZCLGFBQWEsQ0FBQyxRQUFRLEVBQ3RCLGFBQWEsQ0FBQyxRQUFRLENBQ3ZCLENBQUMsV0FBVyxDQUFDLG1CQUFtQixDQUFDLENBQUM7WUFDbkMsSUFBSSxDQUFDLFVBQVU7Z0JBQUUsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUM7U0FDckU7UUFFRCxNQUFNLENBQUMsWUFBWSxFQUFFLGFBQWEsQ0FBQyxHQUFHLFVBQVU7WUFDOUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQztZQUNoQyxDQUFDLENBQUMsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFFbkMsSUFBSSxZQUFZLEdBQUcsbUJBQW1CLENBQUM7UUFDdkMsSUFBSSxrQkFBa0IsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ3ZDLElBQUksWUFBWSxHQUFhLFVBQVU7WUFDckMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVztZQUMzQixDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7UUFDOUIsSUFBSSxJQUFJLEdBQXFCLElBQUksQ0FBQztRQUNsQyxJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUM7UUFDMUIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ1Ysc0VBQXNFO1FBQ3RFLE9BQU8sQ0FBQyxhQUFhLEVBQUU7WUFDckIsQ0FBQyxFQUFFLENBQUM7WUFDSixJQUFJLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxhQUFhLEVBQUU7Z0JBQ3RDLEdBQUcsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQztnQkFDcEMsT0FBTztvQkFDTCxNQUFNLEVBQUUsaUJBQWlCLENBQUMsY0FBYztvQkFDeEMsS0FBSyxFQUFFLHlCQUF5QjtpQkFDakMsQ0FBQzthQUNIO1lBRUQsTUFBTSxZQUFZLEdBQUcsc0JBQXNCLENBQ3pDLFlBQVksRUFDWixZQUFZLEVBQ1osWUFBWSxFQUNaLGFBQWEsQ0FDZCxDQUFDO1lBQ0YsSUFBSSxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFO2dCQUMzQixHQUFHLENBQUMsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLENBQUM7Z0JBQzdDLE9BQU87b0JBQ0wsTUFBTSxFQUFFLGlCQUFpQixDQUFDLGNBQWM7aUJBQ3pDLENBQUM7YUFDSDtZQUNELElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQ3JCLFlBQVksRUFDWixhQUFhLENBQUMsUUFBUSxFQUN0QixTQUFTLENBQUMsV0FBVyxFQUNyQixjQUFjLEVBQ2QsWUFBWSxFQUNaLFNBQVMsRUFDVDtnQkFDRSxHQUFHLCtCQUErQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUM7Z0JBQ2hELEdBQUcsYUFBYTtnQkFDaEIsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxRQUFRLENBQUMsRUFBRSxDQUFDO2FBQ3RDLENBQ0YsQ0FBQztZQUNGLElBQUksQ0FBQyxJQUFJLEVBQUU7Z0JBQ1QsR0FBRyxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO2dCQUM3QyxPQUFPO29CQUNMLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxjQUFjO29CQUN4QyxLQUFLLEVBQUUsZ0JBQWdCO2lCQUN4QixDQUFDO2FBQ0g7WUFFRCxNQUFNLG1CQUFtQixHQUFHLFlBQVksQ0FBQyxRQUFRLENBQy9DLElBQUksQ0FBQyxLQUFNLENBQUMsV0FBVyxDQUN4QixDQUFDO1lBQ0YsTUFBTSxvQkFBb0IsR0FBRyxhQUFhLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDekUsTUFBTSxRQUFRLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLENBQUM7WUFFbEUsSUFBSSxxQkFBcUIsQ0FBQztZQUMxQixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUMzQixJQUFJLEtBQUssQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLEVBQUUsRUFBRTtvQkFDakMsTUFBTSxPQUFPLEdBQUcsS0FBOEIsQ0FBQztvQkFDL0MsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFO3dCQUN0QyxJQUNFLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDOzRCQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQzs0QkFDeEMsSUFBSSxDQUFDLEdBQUcsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFDN0I7NEJBQ0EscUJBQXFCLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FDakMsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBRSxDQUFDLFFBQVEsRUFBRSxDQUM3QyxDQUFDOzRCQUNGLFlBQVksR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQ3ZDLFFBQVEsRUFDUixJQUFJLENBQUMsTUFBTSxDQUFDLHFCQUFzQixDQUFDLFFBQVEsRUFBRSxDQUFDLEVBQzlDLFVBQVUsQ0FDWCxDQUFDO3lCQUNIO29CQUNILENBQUMsQ0FBQyxDQUFDO2lCQUNKO1lBQ0gsQ0FBQyxDQUFDLENBQUM7WUFDSCxJQUFJLENBQUMscUJBQXFCLEVBQUU7Z0JBQzFCLFlBQVksR0FBRyxtQkFBbUIsQ0FBQzthQUNwQztZQUNELGFBQWE7Z0JBQ1gsUUFBUSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUM7b0JBQzlCLElBQUksQ0FBQyxhQUFhLENBQ2hCLFFBQVEsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FDckQsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUMsQ0FBQztZQUVuRCxJQUFJLGFBQWEsSUFBSSxxQkFBcUIsRUFBRTtnQkFDMUMsa0JBQWtCLEdBQUcsSUFBSSxJQUFJLENBQzNCLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUNwQixRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFDcEIsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQ2pCLHFCQUFxQixFQUNyQixRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFDdkIsUUFBUSxDQUFDLGtCQUFrQixDQUFDLHFCQUFxQixDQUFDLEVBQ2xELFFBQVEsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQy9CLENBQUM7YUFDSDtZQUNELFlBQVksR0FBRyxJQUFJLENBQUMsS0FBTSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUV4RSxHQUFHLENBQUMsSUFBSSxDQUNOO2dCQUNFLFlBQVksRUFBRSxZQUFZLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ2pELFlBQVksRUFBRSxZQUFZLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ2pELFFBQVEsRUFBRSxRQUFRLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ3pDLG1CQUFtQixFQUFFLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUMvRCxvQkFBb0IsRUFBRSxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDakUsbUJBQW1CLEVBQUUsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDckUsVUFBVSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUU7YUFDekIsRUFDRCxtQ0FBbUMsQ0FDcEMsQ0FBQztZQUVGLElBQUksWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtnQkFDM0IsR0FBRyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO2dCQUM5QixPQUFPO29CQUNMLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxjQUFjO29CQUN4QyxLQUFLLEVBQUUsaURBQWlEO2lCQUN6RCxDQUFDO2FBQ0g7U0FDRjtRQUVELElBQUksQ0FBQyxJQUFJLEVBQUU7WUFDVCxPQUFPO2dCQUNMLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxjQUFjO2dCQUN4QyxLQUFLLEVBQUUsZ0JBQWdCO2FBQ3hCLENBQUM7U0FDSDtRQUNELElBQUksZ0JBQThDLENBQUM7UUFDbkQsSUFBSSxpQkFBaUIsRUFBRTtZQUNyQixnQkFBZ0IsR0FBRyxNQUFNLElBQUksQ0FBQywrQkFBK0IsQ0FDM0QsSUFBSSxDQUFDLEtBQUssRUFDVixpQkFBaUIsRUFDakI7Z0JBQ0UscUJBQXFCLEVBQUUsWUFBWTtnQkFDbkMsc0JBQXNCLEVBQUUsYUFBYTtnQkFDckMsb0JBQW9CLEVBQUUsUUFBUTthQUMvQixDQUNGLENBQUM7U0FDSDtRQUVELE9BQU87WUFDTCxNQUFNLEVBQUUsaUJBQWlCLENBQUMsT0FBTztZQUNqQyxNQUFNLEVBQUUsRUFBRSxHQUFHLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxZQUFZLEVBQUUsa0JBQWtCLEVBQUU7U0FDeEUsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNJLEtBQUssQ0FBQyxLQUFLLENBQ2hCLE1BQXNCLEVBQ3RCLGFBQXVCLEVBQ3ZCLFNBQW9CLEVBQ3BCLGNBQXNCLEVBQ3RCLFlBQW9CLEVBQ3BCLFVBQXdCLEVBQ3hCLHVCQUFtRCxFQUFFOztRQUVyRCxNQUFNLENBQUMsU0FBUyxDQUNkLHlCQUF5QixJQUFJLENBQUMsT0FBTyxFQUFFLEVBQ3ZDLENBQUMsRUFDRCxnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7UUFFRixzRkFBc0Y7UUFDdEYsdUJBQXVCO1FBQ3ZCLE1BQU0sV0FBVyxHQUNmLE1BQUEsb0JBQW9CLENBQUMsV0FBVyxtQ0FBSSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUVuRSxNQUFNLGFBQWEsR0FBc0IsQ0FBQyxDQUFDLEtBQUssQ0FDOUMsRUFBRSxFQUNGLCtCQUErQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFDN0Msb0JBQW9CLEVBQ3BCLEVBQUUsV0FBVyxFQUFFLENBQ2hCLENBQUM7UUFFRixNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsYUFBYSxDQUFDO1FBRXBDLE1BQU0sVUFBVSxHQUNkLFNBQVMsSUFBSSxTQUFTLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7UUFDdkUsTUFBTSxXQUFXLEdBQ2YsU0FBUyxJQUFJLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQztRQUN2RSxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDO1FBQ25DLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUM7UUFFckMsNEVBQTRFO1FBQzVFLGtGQUFrRjtRQUNsRixvQ0FBb0M7UUFDcEMsTUFBTSxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQ3BELE1BQU0sRUFDTixhQUFhLENBQ2QsQ0FBQztRQUVGLHdGQUF3RjtRQUN4RixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDN0IsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRWxFLE1BQU0sQ0FBQyxTQUFTLENBQ2QsY0FBYyxFQUNkLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxTQUFTLEVBQ3RCLGdCQUFnQixDQUFDLFlBQVksQ0FDOUIsQ0FBQztRQUVGLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxPQUFPLENBQUM7UUFFekMsTUFBTSxhQUFhLEdBR1osRUFBRSxDQUFDO1FBRVYsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLENBQUMsU0FBUyxhQUFULFNBQVMsY0FBVCxTQUFTLEdBQUksRUFBRSxDQUFDLENBQUM7UUFFOUMsSUFDRSxDQUFDLFlBQVksQ0FBQyxJQUFJLElBQUksQ0FBQztZQUNyQixDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxJQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDbkUsWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQ25DO1lBQ0EsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsRUFBRSw4QkFBOEIsQ0FBQyxDQUFDO1lBQ25FLGFBQWEsQ0FBQyxJQUFJLENBQ2hCLElBQUksQ0FBQyxXQUFXLENBQ2QsT0FBTyxFQUNQLFFBQVEsRUFDUixPQUFPLEVBQ1AsUUFBUSxFQUNSLFVBQVUsRUFDVixXQUFXLEVBQ1gsU0FBUyxFQUNULGFBQWEsQ0FDZCxDQUNGLENBQUM7WUFDRixhQUFhLENBQUMsSUFBSSxDQUNoQixJQUFJLENBQUMsV0FBVyxDQUNkLE9BQU8sRUFDUCxRQUFRLEVBQ1IsT0FBTyxFQUNQLFFBQVEsRUFDUixVQUFVLEVBQ1YsV0FBVyxFQUNYLFNBQVMsRUFDVCxhQUFhLEVBQ2IsY0FBYyxFQUNkLFlBQVksQ0FDYixDQUNGLENBQUM7U0FDSDthQUFNO1lBQ0wsSUFDRSxZQUFZLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQzdCLENBQUMsWUFBWSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUNoRTtnQkFDQSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO2dCQUNsRSxhQUFhLENBQUMsSUFBSSxDQUNoQixJQUFJLENBQUMsV0FBVyxDQUNkLE9BQU8sRUFDUCxRQUFRLEVBQ1IsT0FBTyxFQUNQLFFBQVEsRUFDUixVQUFVLEVBQ1YsV0FBVyxFQUNYLFNBQVMsRUFDVCxhQUFhLENBQ2QsQ0FDRixDQUFDO2FBQ0g7WUFDRCxJQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxFQUFFO2dCQUNqQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO2dCQUNsRSxhQUFhLENBQUMsSUFBSSxDQUNoQixJQUFJLENBQUMsV0FBVyxDQUNkLE9BQU8sRUFDUCxRQUFRLEVBQ1IsT0FBTyxFQUNQLFFBQVEsRUFDUixVQUFVLEVBQ1YsV0FBVyxFQUNYLFNBQVMsRUFDVCxhQUFhLEVBQ2IsY0FBYyxFQUNkLFlBQVksQ0FDYixDQUNGLENBQUM7YUFDSDtTQUNGO1FBRUQsTUFBTSwrQkFBK0IsR0FBRyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFekUsSUFBSSx3QkFBd0IsR0FBMEIsRUFBRSxDQUFDO1FBQ3pELElBQUksaUJBQWlCLEdBQXdDLEVBQUUsQ0FBQztRQUNoRSxLQUFLLE1BQU0sRUFDVCxxQkFBcUIsRUFDckIsY0FBYyxHQUNmLElBQUksK0JBQStCLEVBQUU7WUFDcEMsd0JBQXdCLEdBQUc7Z0JBQ3pCLEdBQUcsd0JBQXdCO2dCQUMzQixHQUFHLHFCQUFxQjthQUN6QixDQUFDO1lBQ0YsaUJBQWlCLEdBQUcsQ0FBQyxHQUFHLGlCQUFpQixFQUFFLGNBQWMsQ0FBQyxDQUFDO1NBQzVEO1FBRUQsSUFBSSx3QkFBd0IsQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFFO1lBQ3hDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSx3QkFBd0IsRUFBRSxFQUFFLDBCQUEwQixDQUFDLENBQUM7WUFDbkUsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUVELDBGQUEwRjtRQUMxRixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDbEMsTUFBTSxZQUFZLEdBQUcsTUFBTSxnQkFBZ0IsQ0FDekMsTUFBTSxFQUNOLFFBQVEsRUFDUix3QkFBd0IsRUFDeEIsU0FBUyxFQUNULElBQUksQ0FBQyxPQUFPLEVBQ1osYUFBYSxFQUNiLGNBQWMsRUFDZCxZQUFZLENBQ2IsQ0FBQztRQUVGLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDakIsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUVELE1BQU0sRUFDSixLQUFLLEVBQ0wsZ0JBQWdCLEVBQ2hCLGdCQUFnQixFQUNoQixNQUFNLEVBQUUsWUFBWSxFQUNwQiwwQkFBMEIsRUFDMUIsbUJBQW1CLEdBQ3BCLEdBQUcsWUFBWSxDQUFDO1FBRWpCLHVEQUF1RDtRQUN2RCxNQUFNLEtBQUssR0FBRyxVQUFVLENBQ3RCLFVBQVUsRUFDVixXQUFXLEVBQ1gsU0FBUyxFQUNULFlBQVksRUFDWixjQUFjLEVBQ2QsWUFBWSxDQUNiLENBQUM7UUFFRixJQUFJLGdCQUE4QyxDQUFDO1FBRW5ELDhGQUE4RjtRQUM5Riw4QkFBOEI7UUFDOUIsSUFBSSxVQUFVLEVBQUU7WUFDZCxnQkFBZ0IsR0FBRyx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDakU7UUFFRCxNQUFNLENBQUMsU0FBUyxDQUNkLG1CQUFtQixFQUNuQixJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsY0FBYyxFQUMzQixnQkFBZ0IsQ0FBQyxZQUFZLENBQzlCLENBQUM7UUFFRixNQUFNLENBQUMsU0FBUyxDQUNkLHFCQUFxQixJQUFJLENBQUMsT0FBTyxFQUFFLEVBQ25DLENBQUMsRUFDRCxnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7UUFFRixJQUFJLENBQUMsd0JBQXdCLENBQUMsWUFBWSxFQUFFLGlCQUFpQixDQUFDLENBQUM7UUFFL0QsT0FBTztZQUNMLEtBQUs7WUFDTCxnQkFBZ0I7WUFDaEIsZ0JBQWdCO1lBQ2hCLDBCQUEwQjtZQUMxQixtQkFBbUI7WUFDbkIsV0FBVztZQUNYLEtBQUssRUFBRSxZQUFZO1lBQ25CLEtBQUs7WUFDTCxnQkFBZ0I7WUFDaEIsV0FBVyxFQUFFLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxXQUFXLENBQUM7U0FDL0MsQ0FBQztJQUNKLENBQUM7SUFFTyxLQUFLLENBQUMsMEJBQTBCLENBQ3RDLEtBQVUsRUFDVixXQUdZO1FBRVosSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsRUFBRTtZQUNoQyxPQUFPLEtBQUssQ0FBQztTQUNkO1FBRUQsR0FBRyxDQUFDLElBQUksQ0FBQyw4QkFBOEIsS0FBSyxDQUFDLE1BQU0sUUFBUSxDQUFDLENBQUM7UUFFN0QsTUFBTSxNQUFNLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUV0RSxNQUFNLHNCQUFzQixHQUMxQixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxJQUFPLEVBQUUsRUFBRTtZQUNoRCxNQUFNLGdCQUFnQixHQUFHLHNCQUFzQixDQUFDLG9CQUFvQixDQUNsRSxJQUFJLENBQUMsTUFBTSxDQUNaLENBQUM7WUFDRixNQUFNLGdCQUFnQixHQUFHLHNCQUFzQixDQUFDLG9CQUFvQixDQUNsRSxJQUFJLENBQUMsTUFBTSxDQUNaLENBQUM7WUFFRixNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1lBQ2pFLE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLGdCQUFnQixDQUFDLENBQUM7WUFFakUsSUFBSSxhQUFhLElBQUksYUFBYSxFQUFFO2dCQUNsQyxHQUFHLENBQUMsSUFBSSxDQUNOLGlCQUFpQixZQUFZLENBQUMsSUFBSSxDQUFDLDhCQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQ2QsS0FBSyxnQkFBZ0IsS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sS0FBSyxnQkFBZ0IsRUFBRSxDQUNwRSxDQUFDO2FBQ0g7WUFFRCxPQUFPLENBQUMsYUFBYSxJQUFJLENBQUMsYUFBYSxDQUFDO1FBQzFDLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxhQUFhLENBQUM7SUFDdkIsQ0FBQztJQUVPLEtBQUssQ0FBQyxXQUFXLENBQ3ZCLE9BQWMsRUFDZCxRQUFlLEVBQ2YsT0FBeUIsRUFDekIsUUFBa0IsRUFDbEIsVUFBaUIsRUFDakIsV0FBc0IsRUFDdEIsUUFBbUIsRUFDbkIsYUFBZ0M7UUFLaEMsR0FBRyxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO1FBQ3RDLDZFQUE2RTtRQUM3RSw4RUFBOEU7UUFDOUUseUJBQXlCO1FBQ3pCLE1BQU0sRUFBRSxZQUFZLEVBQUUsY0FBYyxFQUFFLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQztZQUNqRSxPQUFPO1lBQ1AsUUFBUTtZQUNSLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyx3QkFBd0IsRUFBRSxJQUFJLENBQUMsd0JBQXdCO1lBQ3ZELFlBQVksRUFBRSxJQUFJLENBQUMsY0FBYztZQUNqQyxTQUFTLEVBQUUsUUFBUTtZQUNuQixnQkFBZ0IsRUFBRSxJQUFJLENBQUMsa0JBQWtCO1lBQ3pDLGFBQWE7WUFDYixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87U0FDdEIsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsWUFBWSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRTVDLGtIQUFrSDtRQUNsSCxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FDakQsUUFBUSxFQUNSLENBQ0UsS0FBZSxFQUNmLGVBQWtELEVBQ3pDLEVBQUU7WUFDWCwwRUFBMEU7WUFDMUUsSUFBSSxDQUFDLGVBQWUsRUFBRTtnQkFDcEIsT0FBTyxLQUFLLENBQUM7YUFDZDtZQUVELDJFQUEyRTtZQUMzRSxnRkFBZ0Y7WUFDaEYsNEVBQTRFO1lBQzVFLFdBQVc7WUFDWCxFQUFFO1lBQ0YsSUFDRSxlQUFlLElBQUkscUJBQXFCLENBQUMsR0FBRztnQkFDNUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsRUFDakQ7Z0JBQ0EsT0FBTyxLQUFLLENBQUM7YUFDZDtZQUVELE9BQU8sQ0FDTCxlQUFlLElBQUkscUJBQXFCLENBQUMsR0FBRztnQkFDNUMsZUFBZSxJQUFJLHFCQUFxQixDQUFDLEdBQUcsQ0FDN0MsQ0FBQztRQUNKLENBQUMsQ0FDRixDQUFDO1FBRUYsa0dBQWtHO1FBQ2xHLE1BQU0sRUFBRSxlQUFlLEVBQUUsR0FBRyxhQUFhLENBQUM7UUFDMUMsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQy9CLE9BQU8sRUFDUCxRQUFRLEVBQ1IsS0FBSyxFQUNMLGVBQWUsQ0FDaEIsQ0FBQztRQUVGLElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUU7WUFDdEIsT0FBTyxFQUFFLHFCQUFxQixFQUFFLEVBQUUsRUFBRSxjQUFjLEVBQUUsQ0FBQztTQUN0RDtRQUVELDZFQUE2RTtRQUM3RSxNQUFNLE9BQU8sR0FDWCxRQUFRLElBQUksU0FBUyxDQUFDLFdBQVc7WUFDL0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUM7WUFDdEUsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUU1RSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDaEMsR0FBRyxDQUFDLElBQUksQ0FDTiw2QkFBNkIsTUFBTSxDQUFDLE1BQU0sZ0JBQWdCLE9BQU8sQ0FBQyxNQUFNLHFCQUFxQixDQUM5RixDQUFDO1FBRUYsTUFBTSxFQUFFLGdCQUFnQixFQUFFLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRTtZQUMxRCxXQUFXLEVBQUUsYUFBYSxDQUFDLFdBQVc7U0FDdkMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUN6RCxJQUFJLENBQUMsT0FBTyxFQUNaLFdBQVcsRUFDWCxJQUFJLENBQUMsY0FBYyxFQUNuQixVQUFVLEVBQ1YsSUFBSSxDQUFDLGlCQUFpQixDQUN2QixDQUFDO1FBQ0YsTUFBTSxDQUFDLFNBQVMsQ0FDZCxjQUFjLEVBQ2QsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFlBQVksRUFDekIsZ0JBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO1FBRUYsTUFBTSxDQUFDLFNBQVMsQ0FDZCxpQkFBaUIsRUFDakIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDO2FBQ2hCLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQzthQUNsQyxHQUFHLEVBQUUsRUFDUixnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7UUFFRixNQUFNLHFCQUFxQixHQUFHLEVBQUUsQ0FBQztRQUVqQyxLQUFLLE1BQU0sY0FBYyxJQUFJLGdCQUFnQixFQUFFO1lBQzdDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEdBQUcsY0FBYyxDQUFDO1lBRXZDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUN0QyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFFLENBQUM7Z0JBQzdCLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUUsQ0FBQztnQkFDL0IsTUFBTSxFQUNKLEtBQUssRUFDTCxNQUFNLEVBQ04scUJBQXFCLEVBQ3JCLDJCQUEyQixFQUMzQixXQUFXLEdBQ1osR0FBRyxXQUFXLENBQUM7Z0JBRWhCLElBQ0UsQ0FBQyxLQUFLO29CQUNOLENBQUMscUJBQXFCO29CQUN0QixDQUFDLDJCQUEyQjtvQkFDNUIsQ0FBQyxXQUFXLEVBQ1o7b0JBQ0EsR0FBRyxDQUFDLEtBQUssQ0FDUDt3QkFDRSxLQUFLLEVBQUUsYUFBYSxDQUFDLEtBQUssQ0FBQzt3QkFDM0IsV0FBVztxQkFDWixFQUNELHFDQUFxQyxDQUN0QyxDQUFDO29CQUNGLFNBQVM7aUJBQ1Y7Z0JBRUQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLHFCQUFxQixDQUFDO29CQUNwRCxLQUFLO29CQUNMLFFBQVEsRUFBRSxLQUFLO29CQUNmLE1BQU07b0JBQ04sT0FBTztvQkFDUCxxQkFBcUI7b0JBQ3JCLDJCQUEyQjtvQkFDM0IsaUJBQWlCLEVBQUUsV0FBVztvQkFDOUIsUUFBUTtvQkFDUixVQUFVO29CQUNWLFNBQVMsRUFBRSxRQUFRO29CQUNuQixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7aUJBQ3BDLENBQUMsQ0FBQztnQkFFSCxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQzthQUNqRDtTQUNGO1FBRUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLGNBQWMsRUFBRSxDQUFDO0lBQ25ELENBQUM7SUFFTyxLQUFLLENBQUMsV0FBVyxDQUN2QixPQUFjLEVBQ2QsUUFBZSxFQUNmLE9BQXlCLEVBQ3pCLFFBQWtCLEVBQ2xCLFVBQWlCLEVBQ2pCLFdBQXNCLEVBQ3RCLFFBQW1CLEVBQ25CLGFBQWdDLEVBQ2hDLGNBQXNCLEVBQ3RCLFlBQW9CO1FBS3BCLEdBQUcsQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUMsQ0FBQztRQUN0Qyw2RUFBNkU7UUFDN0UsOEVBQThFO1FBQzlFLHlCQUF5QjtRQUN6QixNQUFNLEVBQUUsWUFBWSxFQUFFLGNBQWMsRUFBRSxHQUFHLE1BQU0sbUJBQW1CLENBQUM7WUFDakUsT0FBTztZQUNQLFFBQVE7WUFDUixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLHdCQUF3QjtZQUN2RCxZQUFZLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDakMsU0FBUyxFQUFFLFFBQVE7WUFDbkIsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtZQUN6QyxhQUFhO1lBQ2IsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLGNBQWM7WUFDZCxZQUFZO1NBQ2IsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsWUFBWSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRTVDLG1HQUFtRztRQUNuRyxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FDakQsUUFBUSxFQUNSLENBQ0UsS0FBZSxFQUNmLGVBQWtELEVBQ3pDLEVBQUU7WUFDWCwwRUFBMEU7WUFDMUUsSUFBSSxDQUFDLGVBQWUsRUFBRTtnQkFDcEIsT0FBTyxLQUFLLENBQUM7YUFDZDtZQUVELDJFQUEyRTtZQUMzRSxnRkFBZ0Y7WUFDaEYsNEVBQTRFO1lBQzVFLFdBQVc7WUFDWCxJQUNFLGVBQWUsSUFBSSxxQkFBcUIsQ0FBQyxHQUFHO2dCQUM1QyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUNqRDtnQkFDQSxPQUFPLEtBQUssQ0FBQzthQUNkO1lBRUQsT0FBTyxlQUFlLElBQUkscUJBQXFCLENBQUMsR0FBRyxDQUFDO1FBQ3RELENBQUMsQ0FDRixDQUFDO1FBRUYsa0dBQWtHO1FBQ2xHLE1BQU0sRUFBRSxlQUFlLEVBQUUsR0FBRyxhQUFhLENBQUM7UUFDMUMsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQy9CLE9BQU8sRUFDUCxRQUFRLEVBQ1IsS0FBSyxFQUNMLGVBQWUsRUFDZixjQUFjLEVBQ2QsWUFBWSxDQUNiLENBQUM7UUFFRixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFFO1lBQ3RCLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxFQUFFLEVBQUUsY0FBYyxFQUFFLENBQUM7U0FDdEQ7UUFFRCw2RUFBNkU7UUFDN0UsTUFBTSxPQUFPLEdBQ1gsUUFBUSxJQUFJLFNBQVMsQ0FBQyxXQUFXO1lBQy9CLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO1lBQ3RFLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7UUFFNUUsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRWhDLEdBQUcsQ0FBQyxJQUFJLENBQ04sNkJBQTZCLE1BQU0sQ0FBQyxNQUFNLGdCQUFnQixPQUFPLENBQUMsTUFBTSxxQkFBcUIsQ0FDOUYsQ0FBQztRQUNGLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxHQUFHLE1BQU0sT0FBTyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLFlBQVksQ0FBRSxDQUFDO1FBRTNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLGFBQWEsQ0FDekQsSUFBSSxDQUFDLE9BQU8sRUFDWixXQUFXLEVBQ1gsSUFBSSxDQUFDLGNBQWMsRUFDbkIsVUFBVSxFQUNWLGNBQWMsRUFDZCxZQUFZLENBQ2IsQ0FBQztRQUVGLE1BQU0sQ0FBQyxTQUFTLENBQ2QsY0FBYyxFQUNkLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxZQUFZLEVBQ3pCLGdCQUFnQixDQUFDLFlBQVksQ0FDOUIsQ0FBQztRQUVGLE1BQU0sQ0FBQyxTQUFTLENBQ2QsaUJBQWlCLEVBQ2pCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQzthQUNoQixHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7YUFDbEMsR0FBRyxFQUFFLEVBQ1IsZ0JBQWdCLENBQUMsS0FBSyxDQUN2QixDQUFDO1FBRUYsTUFBTSxxQkFBcUIsR0FBRyxFQUFFLENBQUM7UUFFakMsS0FBSyxNQUFNLGNBQWMsSUFBSSxnQkFBZ0IsRUFBRTtZQUM3QyxNQUFNLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxHQUFHLGNBQWMsQ0FBQztZQUV2QyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDdEMsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBRSxDQUFDO2dCQUM3QixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFFLENBQUM7Z0JBQy9CLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsV0FBVyxDQUFDO2dCQUV0QyxJQUFJLENBQUMsS0FBSyxFQUFFO29CQUNWLEdBQUcsQ0FBQyxLQUFLLENBQ1A7d0JBQ0UsS0FBSyxFQUFFLGFBQWEsQ0FBQyxLQUFLLEVBQUUsY0FBYyxFQUFFLFlBQVksQ0FBQzt3QkFDekQsV0FBVztxQkFDWixFQUNELHFDQUFxQyxDQUN0QyxDQUFDO29CQUNGLFNBQVM7aUJBQ1Y7Z0JBRUQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLHFCQUFxQixDQUFDO29CQUNwRCxLQUFLO29CQUNMLFFBQVEsRUFBRSxLQUFLO29CQUNmLE1BQU07b0JBQ04sT0FBTztvQkFDUCxRQUFRO29CQUNSLFVBQVU7b0JBQ1YsU0FBUyxFQUFFLFFBQVE7b0JBQ25CLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYztvQkFDbkMsY0FBYztvQkFDZCxZQUFZO2lCQUNiLENBQUMsQ0FBQztnQkFFSCxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQzthQUNqRDtTQUNGO1FBRUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLGNBQWMsRUFBRSxDQUFDO0lBQ25ELENBQUM7SUFFRCxzR0FBc0c7SUFDdEcseUZBQXlGO0lBQ3pGLDJCQUEyQjtJQUNuQixxQkFBcUIsQ0FDM0IsTUFBc0IsRUFDdEIsYUFBZ0M7UUFFaEMsTUFBTSxFQUFFLG1CQUFtQixFQUFFLEdBQUcsYUFBYSxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQztRQUNwQixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUM7UUFFbkIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEdBQUcsR0FBRyxtQkFBbUIsRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUNuRCxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxtQkFBbUIsQ0FBQyxDQUFDO1lBQ3ZDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxDQUFDLEdBQUcsbUJBQW1CLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQzNFO1FBRUQsT0FBTyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUM3QixDQUFDO0lBRU8sS0FBSyxDQUFDLCtCQUErQixDQUMzQyxLQUEyQyxFQUMzQyxpQkFBb0MsRUFDcEMsb0JBQTBDO1FBRTFDLE1BQU0sRUFDSixXQUFXLEVBQUUsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsUUFBUSxFQUFFLGdCQUFnQixFQUFFLEVBQ3pFLG1CQUFtQixFQUFFLGtCQUFrQixHQUN4QyxHQUFHLGlCQUFpQixDQUFDO1FBRXRCLE1BQU0sb0JBQW9CLEdBQUcsb0JBQW9CLENBQUMsb0JBQW9CLENBQUM7UUFDdkUsTUFBTSxtQkFBbUIsR0FDdkIsb0JBQW9CLENBQUMscUJBQXFCLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN6RSxNQUFNLG9CQUFvQixHQUN4QixvQkFBb0IsQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3RFLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLGVBQWUsQ0FDakUsbUJBQW1CLEVBQ25CLG9CQUFvQixDQUNyQixDQUFDO1FBQ0YsTUFBTSxVQUFVLEdBQUcsbUJBQW1CLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQ2pFLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQ3RDLENBQUM7UUFDRixPQUFPLFVBQVUsQ0FBQyx3QkFBd0IsQ0FDeEMsS0FBSyxFQUNMO1lBQ0UsU0FBUztZQUNULGlCQUFpQjtZQUNqQiwyQkFBMkIsRUFBRSxRQUFRO1lBQ3JDLGdCQUFnQjtTQUNqQixFQUNELFFBQVEsQ0FBQyxXQUFXLENBQUM7WUFDbkIsSUFBSSxFQUFFLG9CQUFvQixDQUFDLElBQUk7WUFDL0IsU0FBUyxFQUFFLG9CQUFvQixDQUFDLFNBQVM7WUFDekMsU0FBUyxFQUFFLG9CQUFvQixDQUFDLFNBQVM7WUFDekMsT0FBTyxFQUFFLFVBQVU7Z0JBQ2pCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFO2dCQUN6QyxDQUFDLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRTtZQUM1QyxPQUFPLEVBQUUsVUFBVTtnQkFDakIsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUU7Z0JBQzFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFO1lBQzNDLGdCQUFnQixFQUFFLEtBQUs7U0FDeEIsQ0FBQyxFQUNGLGtCQUFrQixFQUNsQixhQUFhLENBQUMsZUFBZSxFQUM3QixhQUFhLENBQUMsZ0JBQWdCLENBQy9CLENBQUM7SUFDSixDQUFDO0lBRU8sd0JBQXdCLENBQzlCLFlBS0MsRUFDRCxtQkFBd0Q7UUFFeEQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1FBQzVDLE1BQU0sRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEdBQUcsWUFBWSxDQUFDO1FBQzlDLENBQUMsQ0FBQyxZQUFZLENBQUM7YUFDWixPQUFPLENBQUMsQ0FBQyxXQUFXLEVBQUUsRUFBRTtZQUN2QixNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsV0FBVyxDQUFDO1lBQ3RDLE9BQU8sYUFBYSxDQUFDO1FBQ3ZCLENBQUMsQ0FBQzthQUNELE9BQU8sQ0FBQyxDQUFDLE9BQWUsRUFBRSxFQUFFO1lBQzNCLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUMvQyxDQUFDLENBQUMsQ0FBQztRQUVMLEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxtQkFBbUIsRUFBRTtZQUNsRCxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsZ0JBQWdCLENBQUM7WUFDdEMsQ0FBQyxDQUFDLEtBQUssQ0FDTCxnQkFBZ0IsQ0FBQyxVQUFVLEVBQzNCLENBQUMsS0FBZSxFQUFFLGFBQXFCLEVBQUUsRUFBRTtnQkFDekMsTUFBTSxRQUFRLEdBQ1osQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUM5QixpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUM3QyxHQUFHLENBQUMsQ0FBQztnQkFDUixNQUFNLENBQUMsU0FBUyxDQUNkLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxRQUFRLEdBQUcsYUFBYSxFQUFFLENBQUMsRUFDM0MsUUFBUSxFQUNSLGdCQUFnQixDQUFDLEtBQUssQ0FDdkIsQ0FBQztZQUNKLENBQUMsQ0FDRixDQUFDO1NBQ0g7UUFFRCxJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDdkIsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQ3ZCLEtBQUssTUFBTSxXQUFXLElBQUksWUFBWSxFQUFFO1lBQ3RDLElBQUksV0FBVyxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsRUFBRSxFQUFFO2dCQUN2QyxVQUFVLEdBQUcsSUFBSSxDQUFDO2FBQ25CO1lBQ0QsSUFBSSxXQUFXLENBQUMsUUFBUSxJQUFJLFFBQVEsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3ZDLFVBQVUsR0FBRyxJQUFJLENBQUM7YUFDbkI7U0FDRjtRQUVELElBQUksVUFBVSxJQUFJLFVBQVUsRUFBRTtZQUM1QixNQUFNLENBQUMsU0FBUyxDQUFDLG1CQUFtQixFQUFFLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNqRSxNQUFNLENBQUMsU0FBUyxDQUNkLDRCQUE0QixJQUFJLENBQUMsT0FBTyxFQUFFLEVBQzFDLENBQUMsRUFDRCxnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7U0FDSDthQUFNLElBQUksVUFBVSxFQUFFO1lBQ3JCLElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQzNCLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxFQUFFLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDNUQsTUFBTSxDQUFDLFNBQVMsQ0FDZCx1QkFBdUIsSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUNyQyxDQUFDLEVBQ0QsZ0JBQWdCLENBQUMsS0FBSyxDQUN2QixDQUFDO2FBQ0g7aUJBQU07Z0JBQ0wsTUFBTSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxFQUFFLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUN2RCxNQUFNLENBQUMsU0FBUyxDQUNkLGtCQUFrQixJQUFJLENBQUMsT0FBTyxFQUFFLEVBQ2hDLENBQUMsRUFDRCxnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7YUFDSDtTQUNGO2FBQU0sSUFBSSxVQUFVLEVBQUU7WUFDckIsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDM0IsTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxFQUFFLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUM1RCxNQUFNLENBQUMsU0FBUyxDQUNkLHVCQUF1QixJQUFJLENBQUMsT0FBTyxFQUFFLEVBQ3JDLENBQUMsRUFDRCxnQkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7YUFDSDtpQkFBTTtnQkFDTCxNQUFNLENBQUMsU0FBUyxDQUFDLFNBQVMsRUFBRSxDQUFDLEVBQUUsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ3ZELE1BQU0sQ0FBQyxTQUFTLENBQ2Qsa0JBQWtCLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFDaEMsQ0FBQyxFQUNELGdCQUFnQixDQUFDLEtBQUssQ0FDdkIsQ0FBQzthQUNIO1NBQ0Y7SUFDSCxDQUFDO0lBRU8scUJBQXFCLENBQzNCLFFBQWtCLEVBQ2xCLFlBQWtCLEVBQ2xCLFVBQW1CO1FBRW5CLE1BQU0saUJBQWlCLEdBQUcsUUFBUSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUMxRSxNQUFNLGlCQUFpQixHQUFHLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFMUUsdUdBQXVHO1FBQ3ZHLCtFQUErRTtRQUMvRSxJQUNFLElBQUksQ0FBQyxXQUFXLENBQUMsWUFBWSxFQUFFLGlCQUFpQixDQUFDO1lBQ2pELElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLGlCQUFpQixDQUFDLEVBQzlDO1lBQ0EsT0FBTyxJQUFJLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7U0FDM0I7UUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDcEQsSUFBSSxZQUFZLEdBQUcsSUFBSSxRQUFRLENBQzdCLGFBQWEsQ0FBQyxlQUFlLENBQzNCLFlBQVksRUFDWixpQkFBaUIsRUFDakIsU0FBUyxFQUNULElBQUksQ0FDTCxFQUNELGFBQWEsQ0FBQyxlQUFlLENBQzNCLFlBQVksRUFDWixpQkFBaUIsRUFDakIsU0FBUyxFQUNULElBQUksQ0FDTCxDQUNGLENBQUM7UUFDRixJQUFJLENBQUMsVUFBVTtZQUFFLFlBQVksR0FBRyxZQUFZLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDdEQsT0FBTyxZQUFZLENBQUM7SUFDdEIsQ0FBQztJQUVPLGFBQWEsQ0FBQyxRQUFrQjtRQUN0QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNwRSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO1lBQ3JDLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO1FBQ3ZCLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3hFLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUM7WUFDdkMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUM7UUFDekIsT0FBTyxJQUFJLFFBQVEsQ0FBQyxZQUFZLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVPLHFCQUFxQjtRQUMzQixPQUFPLEtBQUssQ0FDVixLQUFLLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFO1lBQ3BCLElBQUksT0FBTyxHQUFHLENBQUMsRUFBRTtnQkFDZixHQUFHLENBQUMsSUFBSSxDQUFDLDRCQUE0QixPQUFPLEVBQUUsQ0FBQyxDQUFDO2FBQ2pEO1lBQ0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3hDLENBQUMsRUFDRDtZQUNFLE9BQU8sRUFBRSxDQUFDO1lBQ1YsVUFBVSxFQUFFLEdBQUc7WUFDZixVQUFVLEVBQUUsSUFBSTtTQUNqQixDQUNGLENBQUM7SUFDSixDQUFDO0NBQ0YifQ==