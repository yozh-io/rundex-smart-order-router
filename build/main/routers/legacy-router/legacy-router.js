"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegacyRouter = void 0;
const bignumber_1 = require("@ethersproject/bignumber");
const logger_1 = require("@ethersproject/logger");
const router_sdk_1 = require("@uniswap/router-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const v3_sdk_1 = require("@uniswap/v3-sdk");
const lodash_1 = __importDefault(require("lodash"));
const token_provider_1 = require("../../providers/token-provider");
const amounts_1 = require("../../util/amounts");
const log_1 = require("../../util/log");
const routes_1 = require("../../util/routes");
const alpha_router_1 = require("../alpha-router");
const router_1 = require("../router");
const bases_1 = require("./bases");
// Interface defaults to 2.
const MAX_HOPS = 2;
/**
 * Replicates the router implemented in the V3 interface.
 * Code is mostly a copy from https://github.com/Uniswap/uniswap-interface/blob/0190b5a408c13016c87e1030ffc59326c085f389/src/hooks/useBestV3Trade.ts#L22-L23
 * with React/Redux hooks removed, and refactoring to allow re-use in other routers.
 */
class LegacyRouter {
    constructor({ chainId, multicall2Provider, poolProvider, quoteProvider, tokenProvider, }) {
        this.chainId = chainId;
        this.multicall2Provider = multicall2Provider;
        this.poolProvider = poolProvider;
        this.quoteProvider = quoteProvider;
        this.tokenProvider = tokenProvider;
    }
    async route(amount, quoteCurrency, swapType, factoryAddress, initCodeHash, swapConfig, partialRoutingConfig) {
        if (swapType == sdk_core_1.TradeType.EXACT_INPUT) {
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
        const trade = this.buildTrade(currencyIn, currencyOut, sdk_core_1.TradeType.EXACT_INPUT, routeQuote, factoryAddress, initCodeHash);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: bignumber_1.BigNumber.from(0),
            estimatedGasUsedQuoteToken: amounts_1.CurrencyAmount.fromFractionalAmount(tokenOut, 0, 1),
            estimatedGasUsedUSD: amounts_1.CurrencyAmount.fromFractionalAmount(token_provider_1.DAI_MAINNET, 0, 1),
            gasPriceWei: bignumber_1.BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? this.buildMethodParameters(trade, swapConfig)
                : undefined,
            blockNumber: bignumber_1.BigNumber.from(0),
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
        const trade = this.buildTrade(currencyIn, currencyOut, sdk_core_1.TradeType.EXACT_OUTPUT, routeQuote, factoryAddress, initCodeHash);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: bignumber_1.BigNumber.from(0),
            estimatedGasUsedQuoteToken: amounts_1.CurrencyAmount.fromFractionalAmount(tokenIn, 0, 1),
            estimatedGasUsedUSD: amounts_1.CurrencyAmount.fromFractionalAmount(token_provider_1.DAI_MAINNET, 0, 1),
            gasPriceWei: bignumber_1.BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? this.buildMethodParameters(trade, swapConfig)
                : undefined,
            blockNumber: bignumber_1.BigNumber.from(0),
        };
    }
    async findBestRouteExactIn(amountIn, tokenOut, routes, factoryAddress, initCodeHash, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactIn([amountIn], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const quotes100Percent = lodash_1.default.map(quotesRaw, ([route, quotes]) => { var _a, _b; return `${(0, routes_1.routeToString)(route, factoryAddress, initCodeHash)} : ${(_b = (_a = quotes[0]) === null || _a === void 0 ? void 0 : _a.quote) === null || _b === void 0 ? void 0 : _b.toString()}`; });
        log_1.log.info({ quotes100Percent }, '100% Quotes');
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenOut, sdk_core_1.TradeType.EXACT_INPUT, factoryAddress, initCodeHash);
        return bestQuote;
    }
    async findBestRouteExactOut(amountOut, tokenIn, routes, factoryAddress, initCodeHash, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactOut([amountOut], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenIn, sdk_core_1.TradeType.EXACT_OUTPUT, factoryAddress, initCodeHash);
        return bestQuote;
    }
    async getBestQuote(routes, quotesRaw, quoteToken, routeType, factoryAddress, initCodeHash) {
        log_1.log.debug(`Got ${lodash_1.default.filter(quotesRaw, ([_, quotes]) => !!quotes[0]).length} valid quotes from ${routes.length} possible routes.`);
        const routeQuotesRaw = [];
        for (let i = 0; i < quotesRaw.length; i++) {
            const [route, quotes] = quotesRaw[i];
            const { quote, amount } = quotes[0];
            if (!quote) {
                logger_1.Logger.globalLogger().debug(`No quote for ${(0, routes_1.routeToString)(route, factoryAddress, initCodeHash)}`);
                continue;
            }
            routeQuotesRaw.push({ route, quote, amount });
        }
        if (routeQuotesRaw.length == 0) {
            return null;
        }
        routeQuotesRaw.sort((routeQuoteA, routeQuoteB) => {
            if (routeType == sdk_core_1.TradeType.EXACT_INPUT) {
                return routeQuoteA.quote.gt(routeQuoteB.quote) ? -1 : 1;
            }
            else {
                return routeQuoteA.quote.lt(routeQuoteB.quote) ? -1 : 1;
            }
        });
        const routeQuotes = lodash_1.default.map(routeQuotesRaw, ({ route, quote, amount }) => {
            return new alpha_router_1.V3RouteWithValidQuote({
                route,
                rawQuote: quote,
                amount,
                percent: 100,
                gasModel: {
                    estimateGasCost: () => ({
                        gasCostInToken: amounts_1.CurrencyAmount.fromRawAmount(quoteToken, 0),
                        gasCostInUSD: amounts_1.CurrencyAmount.fromRawAmount(token_provider_1.USDC_MAINNET, 0),
                        gasEstimate: bignumber_1.BigNumber.from(0),
                    }),
                },
                sqrtPriceX96AfterList: [],
                initializedTicksCrossedList: [],
                quoterGasEstimate: bignumber_1.BigNumber.from(0),
                tradeType: routeType,
                quoteToken,
                v3PoolProvider: this.poolProvider,
            });
        });
        for (const rq of routeQuotes) {
            log_1.log.debug(`Quote: ${rq.amount.toFixed(Math.min(rq.amount.currency.decimals, 2))} Route: ${(0, routes_1.routeToString)(rq.route, factoryAddress, initCodeHash)}`);
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
        log_1.log.info({ routes: lodash_1.default.map(routes, routes_1.routeToString) }, `Computed ${routes.length} possible routes.`);
        return routes;
    }
    async getAllPossiblePairings(tokenIn, tokenOut) {
        var _a, _b, _c, _d, _e;
        const common = (_a = (0, bases_1.BASES_TO_CHECK_TRADES_AGAINST)(this.tokenProvider)[this.chainId]) !== null && _a !== void 0 ? _a : [];
        const additionalA = (_c = (_b = (await (0, bases_1.ADDITIONAL_BASES)(this.tokenProvider))[this.chainId]) === null || _b === void 0 ? void 0 : _b[tokenIn.address]) !== null && _c !== void 0 ? _c : [];
        const additionalB = (_e = (_d = (await (0, bases_1.ADDITIONAL_BASES)(this.tokenProvider))[this.chainId]) === null || _d === void 0 ? void 0 : _d[tokenOut.address]) !== null && _e !== void 0 ? _e : [];
        const bases = [...common, ...additionalA, ...additionalB];
        const basePairs = lodash_1.default.flatMap(bases, (base) => bases.map((otherBase) => [base, otherBase]));
        const customBases = (await (0, bases_1.CUSTOM_BASES)(this.tokenProvider))[this.chainId];
        const allPairs = (0, lodash_1.default)([
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
                [tokenA, tokenB, v3_sdk_1.FeeAmount.LOW],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.MEDIUM],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.HIGH],
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
                allPaths.push(new router_1.V3Route([...currentPath, pool], startTokenIn, tokenOut));
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
        if (tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const amountCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenInCurrency, amount.numerator, amount.denominator);
            const quoteCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenOutCurrency, quote.numerator, quote.denominator);
            const routeCurrency = new v3_sdk_1.Route(route.pools, amountCurrency.currency, quoteCurrency.currency);
            return new router_sdk_1.Trade({
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
            const quoteCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenInCurrency, quote.numerator, quote.denominator);
            const amountCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenOutCurrency, amount.numerator, amount.denominator);
            const routeCurrency = new v3_sdk_1.Route(route.pools, quoteCurrency.currency, amountCurrency.currency);
            return new router_sdk_1.Trade({
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
        const methodParameters = router_sdk_1.SwapRouter.swapCallParameters(trade, {
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
exports.LegacyRouter = LegacyRouter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGVnYWN5LXJvdXRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2xlZ2FjeS1yb3V0ZXIvbGVnYWN5LXJvdXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSx3REFBcUQ7QUFDckQsa0RBQStDO0FBQy9DLG9EQUF3RDtBQUN4RCxnREFBK0Q7QUFDL0QsNENBQTJFO0FBQzNFLG9EQUF1QjtBQUd2QixtRUFJd0M7QUFNeEMsZ0RBQW9EO0FBRXBELHdDQUFxQztBQUNyQyw4Q0FBa0Q7QUFDbEQsa0RBQXdEO0FBQ3hELHNDQUFxRTtBQUVyRSxtQ0FJaUI7QUFVakIsMkJBQTJCO0FBQzNCLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBQztBQU1uQjs7OztHQUlHO0FBQ0gsTUFBYSxZQUFZO0lBT3ZCLFlBQVksRUFDVixPQUFPLEVBQ1Asa0JBQWtCLEVBQ2xCLFlBQVksRUFDWixhQUFhLEVBQ2IsYUFBYSxHQUNNO1FBQ25CLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxrQkFBa0IsQ0FBQztRQUM3QyxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQztRQUNqQyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztRQUNuQyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztJQUNyQyxDQUFDO0lBQ00sS0FBSyxDQUFDLEtBQUssQ0FDaEIsTUFBc0IsRUFDdEIsYUFBdUIsRUFDdkIsUUFBbUIsRUFDbkIsY0FBc0IsRUFDdEIsWUFBb0IsRUFDcEIsVUFBd0IsRUFDeEIsb0JBQW1EO1FBRW5ELElBQUksUUFBUSxJQUFJLG9CQUFTLENBQUMsV0FBVyxFQUFFO1lBQ3JDLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FDdEIsTUFBTSxDQUFDLFFBQVEsRUFDZixhQUFhLEVBQ2IsTUFBTSxFQUNOLGNBQWMsRUFDZCxZQUFZLEVBQ1osVUFB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