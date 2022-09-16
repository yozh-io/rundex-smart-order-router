import { BigNumber } from '@ethersproject/bignumber';
import { Logger } from '@ethersproject/logger';
import { SwapRouter, Trade } from '@uniswap/router-sdk';
import { TradeType } from '@uniswap/sdk-core';
import { FeeAmount, Route } from '@uniswap/v3-sdk';
import _ from 'lodash';
import { DAI_MAINNET, USDC_MAINNET, } from '../../providers/token-provider';
import { CurrencyAmount } from '../../util/amounts';
import { log } from '../../util/log';
import { routeToString } from '../../util/routes';
import { V3RouteWithValidQuote } from '../alpha-router';
import { V3Route } from '../router';
import { ADDITIONAL_BASES, BASES_TO_CHECK_TRADES_AGAINST, CUSTOM_BASES, } from './bases';
// Interface defaults to 2.
const MAX_HOPS = 2;
/**
 * Replicates the router implemented in the V3 interface.
 * Code is mostly a copy from https://github.com/Uniswap/uniswap-interface/blob/0190b5a408c13016c87e1030ffc59326c085f389/src/hooks/useBestV3Trade.ts#L22-L23
 * with React/Redux hooks removed, and refactoring to allow re-use in other routers.
 */
export class LegacyRouter {
    constructor({ chainId, multicall2Provider, poolProvider, quoteProvider, tokenProvider, }) {
        this.chainId = chainId;
        this.multicall2Provider = multicall2Provider;
        this.poolProvider = poolProvider;
        this.quoteProvider = quoteProvider;
        this.tokenProvider = tokenProvider;
    }
    async route(amount, quoteCurrency, swapType, factoryAddress, initCodeHash, swapConfig, partialRoutingConfig) {
        if (swapType == TradeType.EXACT_INPUT) {
            return this.routeExactIn(amount.currency, quoteCurrency, amount, factoryAddress, initCodeHash, swapConfig, partialRoutingConfig);
        }
        return this.routeExactOut(quoteCurrency, amount.currency, amount, factoryAddress, initCodeHash, swapConfig, partialRoutingConfig);
    }
    async routeExactIn(currencyIn, currencyOut, amountIn, factoryAddress, initCodeHash, swapConfig, routingConfig) {
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
        const routeQuote = await this.findBestRouteExactIn(amountIn, tokenOut, routes, factoryAddress, initCodeHash, routingConfig);
        if (!routeQuote) {
            return null;
        }
        const trade = this.buildTrade(currencyIn, currencyOut, TradeType.EXACT_INPUT, routeQuote, factoryAddress, initCodeHash);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: BigNumber.from(0),
            estimatedGasUsedQuoteToken: CurrencyAmount.fromFractionalAmount(tokenOut, 0, 1),
            estimatedGasUsedUSD: CurrencyAmount.fromFractionalAmount(DAI_MAINNET, 0, 1),
            gasPriceWei: BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? this.buildMethodParameters(trade, swapConfig)
                : undefined,
            blockNumber: BigNumber.from(0),
        };
    }
    async routeExactOut(currencyIn, currencyOut, amountOut, factoryAddress, initCodeHash, swapConfig, routingConfig) {
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
        const routeQuote = await this.findBestRouteExactOut(amountOut, tokenIn, routes, factoryAddress, initCodeHash, routingConfig);
        if (!routeQuote) {
            return null;
        }
        const trade = this.buildTrade(currencyIn, currencyOut, TradeType.EXACT_OUTPUT, routeQuote, factoryAddress, initCodeHash);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: BigNumber.from(0),
            estimatedGasUsedQuoteToken: CurrencyAmount.fromFractionalAmount(tokenIn, 0, 1),
            estimatedGasUsedUSD: CurrencyAmount.fromFractionalAmount(DAI_MAINNET, 0, 1),
            gasPriceWei: BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? this.buildMethodParameters(trade, swapConfig)
                : undefined,
            blockNumber: BigNumber.from(0),
        };
    }
    async findBestRouteExactIn(amountIn, tokenOut, routes, factoryAddress, initCodeHash, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactIn([amountIn], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const quotes100Percent = _.map(quotesRaw, ([route, quotes]) => { var _a, _b; return `${routeToString(route, factoryAddress, initCodeHash)} : ${(_b = (_a = quotes[0]) === null || _a === void 0 ? void 0 : _a.quote) === null || _b === void 0 ? void 0 : _b.toString()}`; });
        log.info({ quotes100Percent }, '100% Quotes');
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenOut, TradeType.EXACT_INPUT, factoryAddress, initCodeHash);
        return bestQuote;
    }
    async findBestRouteExactOut(amountOut, tokenIn, routes, factoryAddress, initCodeHash, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactOut([amountOut], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenIn, TradeType.EXACT_OUTPUT, factoryAddress, initCodeHash);
        return bestQuote;
    }
    async getBestQuote(routes, quotesRaw, quoteToken, routeType, factoryAddress, initCodeHash) {
        log.debug(`Got ${_.filter(quotesRaw, ([_, quotes]) => !!quotes[0]).length} valid quotes from ${routes.length} possible routes.`);
        const routeQuotesRaw = [];
        for (let i = 0; i < quotesRaw.length; i++) {
            const [route, quotes] = quotesRaw[i];
            const { quote, amount } = quotes[0];
            if (!quote) {
                Logger.globalLogger().debug(`No quote for ${routeToString(route, factoryAddress, initCodeHash)}`);
                continue;
            }
            routeQuotesRaw.push({ route, quote, amount });
        }
        if (routeQuotesRaw.length == 0) {
            return null;
        }
        routeQuotesRaw.sort((routeQuoteA, routeQuoteB) => {
            if (routeType == TradeType.EXACT_INPUT) {
                return routeQuoteA.quote.gt(routeQuoteB.quote) ? -1 : 1;
            }
            else {
                return routeQuoteA.quote.lt(routeQuoteB.quote) ? -1 : 1;
            }
        });
        const routeQuotes = _.map(routeQuotesRaw, ({ route, quote, amount }) => {
            return new V3RouteWithValidQuote({
                route,
                rawQuote: quote,
                amount,
                percent: 100,
                gasModel: {
                    estimateGasCost: () => ({
                        gasCostInToken: CurrencyAmount.fromRawAmount(quoteToken, 0),
                        gasCostInUSD: CurrencyAmount.fromRawAmount(USDC_MAINNET, 0),
                        gasEstimate: BigNumber.from(0),
                    }),
                },
                sqrtPriceX96AfterList: [],
                initializedTicksCrossedList: [],
                quoterGasEstimate: BigNumber.from(0),
                tradeType: routeType,
                quoteToken,
                v3PoolProvider: this.poolProvider,
            });
        });
        for (const rq of routeQuotes) {
            log.debug(`Quote: ${rq.amount.toFixed(Math.min(rq.amount.currency.decimals, 2))} Route: ${routeToString(rq.route, factoryAddress, initCodeHash)}`);
        }
        return routeQuotes[0];
    }
    async getAllRoutes(tokenIn, tokenOut, routingConfig) {
        const tokenPairs = await this.getAllPossiblePairings(tokenIn, tokenOut);
        const poolAccessor = await this.poolProvider.getPools(tokenPairs, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const pools = poolAccessor.getAllPools();
        const routes = this.computeAllRoutes(tokenIn, tokenOut, pools, this.chainId, [], [], tokenIn, MAX_HOPS);
        log.info({ routes: _.map(routes, routeToString) }, `Computed ${routes.length} possible routes.`);
        return routes;
    }
    async getAllPossiblePairings(tokenIn, tokenOut) {
        var _a, _b, _c, _d, _e;
        const common = (_a = BASES_TO_CHECK_TRADES_AGAINST(this.tokenProvider)[this.chainId]) !== null && _a !== void 0 ? _a : [];
        const additionalA = (_c = (_b = (await ADDITIONAL_BASES(this.tokenProvider))[this.chainId]) === null || _b === void 0 ? void 0 : _b[tokenIn.address]) !== null && _c !== void 0 ? _c : [];
        const additionalB = (_e = (_d = (await ADDITIONAL_BASES(this.tokenProvider))[this.chainId]) === null || _d === void 0 ? void 0 : _d[tokenOut.address]) !== null && _e !== void 0 ? _e : [];
        const bases = [...common, ...additionalA, ...additionalB];
        const basePairs = _.flatMap(bases, (base) => bases.map((otherBase) => [base, otherBase]));
        const customBases = (await CUSTOM_BASES(this.tokenProvider))[this.chainId];
        const allPairs = _([
            // the direct pair
            [tokenIn, tokenOut],
            // token A against all bases
            ...bases.map((base) => [tokenIn, base]),
            // token B against all bases
            ...bases.map((base) => [tokenOut, base]),
            // each base against all bases
            ...basePairs,
        ])
            .filter((tokens) => Boolean(tokens[0] && tokens[1]))
            .filter(([tokenA, tokenB]) => tokenA.address !== tokenB.address && !tokenA.equals(tokenB))
            .filter(([tokenA, tokenB]) => {
            const customBasesA = customBases === null || customBases === void 0 ? void 0 : customBases[tokenA.address];
            const customBasesB = customBases === null || customBases === void 0 ? void 0 : customBases[tokenB.address];
            if (!customBasesA && !customBasesB)
                return true;
            if (customBasesA && !customBasesA.find((base) => tokenB.equals(base)))
                return false;
            if (customBasesB && !customBasesB.find((base) => tokenA.equals(base)))
                return false;
            return true;
        })
            .flatMap(([tokenA, tokenB]) => {
            return [
                [tokenA, tokenB, FeeAmount.LOW],
                [tokenA, tokenB, FeeAmount.MEDIUM],
                [tokenA, tokenB, FeeAmount.HIGH],
            ];
        })
            .value();
        return allPairs;
    }
    computeAllRoutes(tokenIn, tokenOut, pools, chainId, currentPath = [], allPaths = [], startTokenIn = tokenIn, maxHops = 2) {
        for (const pool of pools) {
            if (currentPath.indexOf(pool) !== -1 || !pool.involvesToken(tokenIn))
                continue;
            const outputToken = pool.token0.equals(tokenIn)
                ? pool.token1
                : pool.token0;
            if (outputToken.equals(tokenOut)) {
                allPaths.push(new V3Route([...currentPath, pool], startTokenIn, tokenOut));
            }
            else if (maxHops > 1) {
                this.computeAllRoutes(outputToken, tokenOut, pools, chainId, [...currentPath, pool], allPaths, startTokenIn, maxHops - 1);
            }
        }
        return allPaths;
    }
    buildTrade(tokenInCurrency, tokenOutCurrency, tradeType, routeAmount, factoryAddress, initCodeHash) {
        const { route, amount, quote } = routeAmount;
        // The route, amount and quote are all in terms of wrapped tokens.
        // When constructing the Trade object the inputAmount/outputAmount must
        // use native currencies if necessary. This is so that the Trade knows to wrap/unwrap.
        if (tradeType == TradeType.EXACT_INPUT) {
            const amountCurrency = CurrencyAmount.fromFractionalAmount(tokenInCurrency, amount.numerator, amount.denominator);
            const quoteCurrency = CurrencyAmount.fromFractionalAmount(tokenOutCurrency, quote.numerator, quote.denominator);
            const routeCurrency = new Route(route.pools, amountCurrency.currency, quoteCurrency.currency);
            return new Trade({
                v3Routes: [
                    {
                        routev3: routeCurrency,
                        inputAmount: amountCurrency,
                        outputAmount: quoteCurrency,
                    },
                ],
                v2Routes: [],
                tradeType: tradeType,
                factoryAddress,
                initCodeHash
            });
        }
        else {
            const quoteCurrency = CurrencyAmount.fromFractionalAmount(tokenInCurrency, quote.numerator, quote.denominator);
            const amountCurrency = CurrencyAmount.fromFractionalAmount(tokenOutCurrency, amount.numerator, amount.denominator);
            const routeCurrency = new Route(route.pools, quoteCurrency.currency, amountCurrency.currency);
            return new Trade({
                v3Routes: [
                    {
                        routev3: routeCurrency,
                        inputAmount: quoteCurrency,
                        outputAmount: amountCurrency,
                    },
                ],
                v2Routes: [],
                tradeType: tradeType,
                factoryAddress,
                initCodeHash
            });
        }
    }
    buildMethodParameters(trade, swapConfig) {
        const { recipient, slippageTolerance, deadline } = swapConfig;
        const methodParameters = SwapRouter.swapCallParameters(trade, {
            recipient,
            slippageTolerance,
            deadlineOrPreviousBlockhash: deadline,
            // ...(signatureData
            //   ? {
            //       inputTokenPermit:
            //         'allowed' in signatureData
            //           ? {
            //               expiry: signatureData.deadline,
            //               nonce: signatureData.nonce,
            //               s: signatureData.s,
            //               r: signatureData.r,
            //               v: signatureData.v as any,
            //             }
            //           : {
            //               deadline: signatureData.deadline,
            //               amount: signatureData.amount,
            //               s: signatureData.s,
            //               r: signatureData.r,
            //               v: signatureData.v as any,
            //             },
            //     }
            //   : {}),
        });
        return methodParameters;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGVnYWN5LXJvdXRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2xlZ2FjeS1yb3V0ZXIvbGVnYWN5LXJvdXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sMEJBQTBCLENBQUM7QUFDckQsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBQy9DLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0scUJBQXFCLENBQUM7QUFDeEQsT0FBTyxFQUFtQixTQUFTLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUMvRCxPQUFPLEVBQUUsU0FBUyxFQUEwQixLQUFLLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUMzRSxPQUFPLENBQUMsTUFBTSxRQUFRLENBQUM7QUFHdkIsT0FBTyxFQUNMLFdBQVcsRUFFWCxZQUFZLEdBQ2IsTUFBTSxnQ0FBZ0MsQ0FBQztBQU14QyxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sb0JBQW9CLENBQUM7QUFFcEQsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNLGdCQUFnQixDQUFDO0FBQ3JDLE9BQU8sRUFBRSxhQUFhLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUNsRCxPQUFPLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUN4RCxPQUFPLEVBQW1DLE9BQU8sRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUVyRSxPQUFPLEVBQ0wsZ0JBQWdCLEVBQ2hCLDZCQUE2QixFQUM3QixZQUFZLEdBQ2IsTUFBTSxTQUFTLENBQUM7QUFVakIsMkJBQTJCO0FBQzNCLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBQztBQU1uQjs7OztHQUlHO0FBQ0gsTUFBTSxPQUFPLFlBQVk7SUFPdkIsWUFBWSxFQUNWLE9BQU8sRUFDUCxrQkFBa0IsRUFDbEIsWUFBWSxFQUNaLGFBQWEsRUFDYixhQUFhLEdBQ007UUFD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