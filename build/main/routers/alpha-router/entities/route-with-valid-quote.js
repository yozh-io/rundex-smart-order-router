"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3RouteWithValidQuote = exports.V2RouteWithValidQuote = void 0;
const router_sdk_1 = require("@uniswap/router-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const lodash_1 = __importDefault(require("lodash"));
const amounts_1 = require("../../../util/amounts");
const routes_1 = require("../../../util/routes");
/**
 * Represents a quote for swapping on a V2 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V2RouteWithValidQuote
 */
class V2RouteWithValidQuote {
    constructor({ amount, rawQuote, percent, route, gasModel, quoteToken, tradeType, v2PoolProvider, factoryAddress, initCodeHash }) {
        this.protocol = router_sdk_1.Protocol.V2;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.quote = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
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
        if (this.tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = lodash_1.default.map(route.pairs, (p) => v2PoolProvider.getPoolAddress(p.token0, p.token1, factoryAddress, initCodeHash).poolAddress);
        this.tokenPath = this.route.path;
    }
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${(0, routes_1.routeToString)(this.route, this.factoryAddress, this.initCodeHash)}`;
    }
}
exports.V2RouteWithValidQuote = V2RouteWithValidQuote;
/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
class V3RouteWithValidQuote {
    constructor({ amount, rawQuote, sqrtPriceX96AfterList, initializedTicksCrossedList, quoterGasEstimate, percent, route, gasModel, quoteToken, tradeType, v3PoolProvider, }) {
        this.protocol = router_sdk_1.Protocol.V3;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
        this.initializedTicksCrossedList = initializedTicksCrossedList;
        this.quoterGasEstimate = quoterGasEstimate;
        this.quote = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
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
        if (this.tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = lodash_1.default.map(route.pools, (p) => v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee).poolAddress);
        this.tokenPath = this.route.tokenPath;
    }
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${(0, routes_1.routeToString)(this.route)}`;
    }
}
exports.V3RouteWithValidQuote = V3RouteWithValidQuote;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGUtd2l0aC12YWxpZC1xdW90ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9lbnRpdGllcy9yb3V0ZS13aXRoLXZhbGlkLXF1b3RlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLG9EQUErQztBQUMvQyxnREFBcUQ7QUFDckQsb0RBQXVCO0FBSXZCLG1EQUF1RDtBQUN2RCxpREFBcUQ7QUFtRHJEOzs7Ozs7O0dBT0c7QUFDSCxNQUFhLHFCQUFxQjtJQThCaEMsWUFBWSxFQUNFLE1BQU0sRUFDTixRQUFRLEVBQ1IsT0FBTyxFQUNQLEtBQUssRUFDTCxRQUFRLEVBQ1IsVUFBVSxFQUNWLFNBQVMsRUFDVCxjQUFjLEVBQ2QsY0FBYyxFQUNkLFlBQVksRUFDZ0I7UUF4QzFCLGFBQVEsR0FBRyxxQkFBUSxDQUFDLEVBQUUsQ0FBQztRQXlDckMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLEtBQUssR0FBRyx3QkFBYyxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDM0UsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFDN0IsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDM0IsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUM7UUFDckMsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUM7UUFFakMsTUFBTSxFQUFFLFdBQVcsRUFBRSxjQUFjLEVBQUUsWUFBWSxFQUFFLEdBQ2pE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