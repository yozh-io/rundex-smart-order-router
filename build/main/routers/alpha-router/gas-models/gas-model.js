"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IV2GasModelFactory = exports.IV3GasModelFactory = exports.usdGasTokensByChain = void 0;
const token_provider_1 = require("../../../providers/token-provider");
const chains_1 = require("../../../util/chains");
exports.usdGasTokensByChain = {
    [chains_1.ChainId.MAINNET]: [token_provider_1.DAI_MAINNET, token_provider_1.USDC_MAINNET, token_provider_1.USDT_MAINNET],
    [chains_1.ChainId.RINKEBY]: [token_provider_1.DAI_RINKEBY_1, token_provider_1.DAI_RINKEBY_2],
    [chains_1.ChainId.ARBITRUM_ONE]: [token_provider_1.DAI_ARBITRUM, token_provider_1.USDC_ARBITRUM, token_provider_1.USDT_ARBITRUM],
    [chains_1.ChainId.OPTIMISM]: [token_provider_1.DAI_OPTIMISM, token_provider_1.USDC_OPTIMISM, token_provider_1.USDT_OPTIMISM],
    [chains_1.ChainId.OPTIMISTIC_KOVAN]: [
        token_provider_1.DAI_OPTIMISTIC_KOVAN,
        token_provider_1.USDC_OPTIMISTIC_KOVAN,
        token_provider_1.USDT_OPTIMISTIC_KOVAN,
    ],
    [chains_1.ChainId.ARBITRUM_RINKEBY]: [token_provider_1.DAI_ARBITRUM_RINKEBY, token_provider_1.USDT_ARBITRUM_RINKEBY],
    [chains_1.ChainId.KOVAN]: [token_provider_1.DAI_KOVAN, token_provider_1.USDC_KOVAN, token_provider_1.USDT_KOVAN],
    [chains_1.ChainId.GÖRLI]: [token_provider_1.DAI_GÖRLI, token_provider_1.USDC_GÖRLI, token_provider_1.USDT_GÖRLI, token_provider_1.WBTC_GÖRLI],
    [chains_1.ChainId.ROPSTEN]: [token_provider_1.DAI_ROPSTEN, token_provider_1.USDC_ROPSTEN, token_provider_1.USDT_ROPSTEN],
    [chains_1.ChainId.POLYGON]: [token_provider_1.USDC_POLYGON],
    [chains_1.ChainId.POLYGON_MUMBAI]: [token_provider_1.DAI_POLYGON_MUMBAI],
    [chains_1.ChainId.CELO]: [token_provider_1.CUSD_CELO],
    [chains_1.ChainId.CELO_ALFAJORES]: [token_provider_1.CUSD_CELO_ALFAJORES],
    [chains_1.ChainId.GNOSIS]: [token_provider_1.USDC_ETHEREUM_GNOSIS],
    [chains_1.ChainId.MOONBEAM]: [token_provider_1.USDC_MOONBEAM],
    [chains_1.ChainId.SMART_CHAIN]: [token_provider_1.USDC_BSC, token_provider_1.USDT_BSC],
    [chains_1.ChainId.AVALANCHE]: [token_provider_1.USDC_AVALANCHE, token_provider_1.USDCE_AVALANCHE, token_provider_1.USDTE_AVALANCHE],
    [chains_1.ChainId.FANTOM]: [token_provider_1.FUSD_FANTOM, token_provider_1.fUSDT_FANTOM, token_provider_1.USDC_FANTOM],
    [chains_1.ChainId.HARMONY]: [token_provider_1.USDT_HARMONY, token_provider_1.USDC_HARMONY],
    [chains_1.ChainId.AURORA]: [token_provider_1.USDT_AURORA, token_provider_1.USDC_AURORA, token_provider_1.DAI_AURORA]
};
/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IV3GasModelFactory
 */
class IV3GasModelFactory {
}
exports.IV3GasModelFactory = IV3GasModelFactory;
/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IV2GasModelFactory
 */
class IV2GasModelFactory {
}
exports.IV2GasModelFactory = IV2GasModelFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLW1vZGVsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2dhcy1tb2RlbHMvZ2FzLW1vZGVsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLHNFQWlDMkM7QUFTM0MsaURBQStDO0FBT2xDLFFBQUEsbUJBQW1CLEdBQXVDO0lBQ3JFLENBQUMsZ0JBQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLDRCQUFXLEVBQUUsNkJBQVksRUFBRSw2QkFBWSxDQUFDO0lBQzVELENBQUMsZ0JBQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLDhCQUFhLEVBQUUsOEJBQWEsQ0FBQztJQUNqRCxDQUFDLGdCQUFPLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyw2QkFBWSxFQUFFLDhCQUFhLEVBQUUsOEJBQWEsQ0FBQztJQUNwRSxDQUFDLGdCQUFPLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyw2QkFBWSxFQUFFLDhCQUFhLEVBQUUsOEJBQWEsQ0FBQztJQUNoRSxDQUFDLGdCQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtRQUMxQixxQ0FBb0I7UUFDcEIsc0NBQXFCO1FBQ3JCLHNDQUFxQjtLQUN0QjtJQUNELENBQUMsZ0JBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMscUNBQW9CLEVBQUUsc0NBQXFCLENBQUM7SUFDekUsQ0FBQyxnQkFBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsMEJBQVMsRUFBRSwyQkFBVSxFQUFFLDJCQUFVLENBQUM7SUFDcEQsQ0FBQyxnQkFBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsMEJBQVMsRUFBRSwyQkFBVSxFQUFFLDJCQUFVLEVBQUUsMkJBQVUsQ0FBQztJQUNoRSxDQUFDLGdCQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyw0QkFBVyxFQUFFLDZCQUFZLEVBQUUsNkJBQVksQ0FBQztJQUM1RCxDQUFDLGdCQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyw2QkFBWSxDQUFDO0lBQ2pDLENBQUMsZ0JBQU8sQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDLG1DQUFrQixDQUFDO0lBQzlDLENBQUMsZ0JBQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLDBCQUFTLENBQUM7SUFDM0IsQ0FBQyxnQkFBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUMsb0NBQW1CLENBQUM7SUFDL0MsQ0FBQyxnQkFBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMscUNBQW9CLENBQUM7SUFDeEMsQ0FBQyxnQkFBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsOEJBQWEsQ0FBQztJQUNuQyxDQUFDLGdCQUFPLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyx5QkFBUSxFQUFDLHlCQUFRLENBQUM7SUFDMUMsQ0FBQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQyxFQUFHLENBQUMsK0JBQWMsRUFBRSxnQ0FBZSxFQUFDLGdDQUFlLENBQUM7SUFDdkUsQ0FBQyxnQkFBTyxDQUFDLE1BQU0sQ0FBQyxFQUFHLENBQUMsNEJBQVcsRUFBQyw2QkFBWSxFQUFDLDRCQUFXLENBQUM7SUFDekQsQ0FBQyxnQkFBTyxDQUFDLE9BQU8sQ0FBQyxFQUFHLENBQUMsNkJBQVksRUFBQyw2QkFBWSxDQUFDO0lBQy9DLENBQUMsZ0JBQU8sQ0FBQyxNQUFNLENBQUMsRUFBRyxDQUFDLDRCQUFXLEVBQUMsNEJBQVcsRUFBQywyQkFBVSxDQUFDO0NBQ3hELENBQUM7QUFpQ0Y7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQXNCLGtCQUFrQjtDQVV2QztBQVZELGdEQVVDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQXNCLGtCQUFrQjtDQVN2QztBQVRELGdEQVNDIn0=