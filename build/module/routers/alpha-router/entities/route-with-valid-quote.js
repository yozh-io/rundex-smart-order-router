import { Protocol } from '@uniswap/router-sdk';
import { TradeType } from '@uniswap/sdk-core';
import _ from 'lodash';
import { CurrencyAmount } from '../../../util/amounts';
import { routeToString } from '../../../util/routes';
/**
 * Represents a quote for swapping on a V2 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V2RouteWithValidQuote
 */
export class V2RouteWithValidQuote {
    constructor({ amount, rawQuote, percent, route, gasModel, quoteToken, tradeType, v2PoolProvider, factoryAddress, initCodeHash }) {
        this.protocol = Protocol.V2;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
        this.percent = percent;
        this.route = route;
        this.gasModel = gasModel;
        this.quoteToken = quoteToken;
        this.tradeType = tradeType;
        this.factoryAddress = factoryAddress;
        this.initCodeHash = initCodeHash;
        const { gasEstimate, gasCostInToken, gasCostInUSD } = this.gasModel.estimateGasCost(this);
        this.gasCostInToken = gasCostInToken;
        this.gasCostInUSD = gasCostInUSD;
        this.gasEstimate = gasEstimate;
        // If its exact out, we need to request *more* of the input token to account for the gas.
        if (this.tradeType == TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = _.map(route.pairs, (p) => v2PoolProvider.getPoolAddress(p.token0, p.token1, factoryAddress, initCodeHash).poolAddress);
        this.tokenPath = this.route.path;
    }
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(this.route, this.factoryAddress, this.initCodeHash)}`;
    }
}
/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
export class V3RouteWithValidQuote {
    constructor({ amount, rawQuote, sqrtPriceX96AfterList, initializedTicksCrossedList, quoterGasEstimate, percent, route, gasModel, quoteToken, tradeType, v3PoolProvider, }) {
        this.protocol = Protocol.V3;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
        this.initializedTicksCrossedList = initializedTicksCrossedList;
        this.quoterGasEstimate = quoterGasEstimate;
        this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
        this.percent = percent;
        this.route = route;
        this.gasModel = gasModel;
        this.quoteToken = quoteToken;
        this.tradeType = tradeType;
        const { gasEstimate, gasCostInToken, gasCostInUSD } = this.gasModel.estimateGasCost(this);
        this.gasCostInToken = gasCostInToken;
        this.gasCostInUSD = gasCostInUSD;
        this.gasEstimate = gasEstimate;
        // If its exact out, we need to request *more* of the input token to account for the gas.
        if (this.tradeType == TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = _.map(route.pools, (p) => v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee).poolAddress);
        this.tokenPath = this.route.tokenPath;
    }
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(this.route)}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGUtd2l0aC12YWxpZC1xdW90ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9lbnRpdGllcy9yb3V0ZS13aXRoLXZhbGlkLXF1b3RlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUMvQyxPQUFPLEVBQVMsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDckQsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFDO0FBSXZCLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSx1QkFBdUIsQ0FBQztBQUN2RCxPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFtRHJEOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLE9BQU8scUJBQXFCO0lBOEJoQyxZQUFZLEVBQ0UsTUFBTSxFQUNOLFFBQVEsRUFDUixPQUFPLEVBQ1AsS0FBSyxFQUNMLFFBQVEsRUFDUixVQUFVLEVBQ1YsU0FBUyxFQUNULGNBQWMsRUFDZCxjQUFjLEVBQ2QsWUFBWSxFQUNnQjtRQXhDMUIsYUFBUSxHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUF5Q3JDLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxLQUFLLEdBQUcsY0FBYyxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDM0UsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFDN0IsSUFBSSxDQUFDLFNBQVMsR0FB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