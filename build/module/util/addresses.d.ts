import { Token } from '@uniswap/sdk-core';
import { ChainId } from './chains';
export declare const V3_CORE_FACTORY_ADDRESSES: AddressMap;
export declare const QUOTER_V2_ADDRESSES: AddressMap;
export declare const UNISWAP_MULTICALL_ADDRESSES: AddressMap;
export declare const OVM_GASPRICE_ADDRESS = "0x420000000000000000000000000000000000000F";
export declare const ARB_GASINFO_ADDRESS = "0x000000000000000000000000000000000000006C";
export declare const TICK_LENS_ADDRESS = "0xbfd8137f7d1516D3ea5cA83523914859ec47F573";
export declare const NONFUNGIBLE_POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
export declare const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export declare const V3_MIGRATOR_ADDRESS = "0xA5644E29708357803b5A882D272c41cC0dF92B34";
export declare const MULTICALL2_ADDRESS = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
declare type AddressMap = {
    [chainId: number]: string;
};
export declare function constructSameAddressMap<T extends string>(address: T, additionalNetworks?: ChainId[]): {
    [chainId: number]: T;
};
export declare const WETH9: {
    [chainId in Exclude<ChainId, ChainId.POLYGON | ChainId.POLYGON_MUMBAI | ChainId.CELO | ChainId.CELO_ALFAJORES | ChainId.GNOSIS | ChainId.MOONBEAM | ChainId.SMART_CHAIN | ChainId.AVALANCHE | ChainId.FANTOM | ChainId.HARMONY | ChainId.HARMONY_TESTNET | ChainId.AURORA | ChainId.KLAYTN>]: Token;
};
export {};
