import { Percent } from '@uniswap/sdk-core';
import { Pair } from '@uniswap/v2-sdk';
import { Pool } from '@uniswap/v3-sdk';
import _ from 'lodash';

import { RouteWithValidQuote } from '../routers/alpha-router';
import { V2Route, V3Route } from '../routers/router';

import { CurrencyAmount } from '.';

export const routeToString = (route: V3Route | V2Route, factoryAddress?: string, initCodeHash?: string): string => {
  const isV3Route = (route: V3Route | V2Route): route is V3Route =>
    (route as V3Route).pools != undefined;
  const routeStr = [];
  const tokens = isV3Route(route) ? route.tokenPath : route.path;
  const tokenPath = _.map(tokens, (token) => `${token.symbol}`);
  const pools = isV3Route(route) ? route.pools : route.pairs;
  const poolFeePath = _.map(
    pools,
    (pool) =>
      `${
        pool instanceof Pool
          ? ` -- ${pool.fee / 10000}% [${Pool.getAddress(
              pool.token0,
              pool.token1,
              pool.fee
            )}]`
          : ` -- [${Pair.getAddress(
              (pool as Pair).token0,
              (pool as Pair).token1,
              factoryAddress ? factoryAddress : '',
              initCodeHash ? initCodeHash : ''
            )}]`
      } --> `
  );

  for (let i = 0; i < tokenPath.length; i++) {
    routeStr.push(tokenPath[i]);
    if (i < poolFeePath.length) {
      routeStr.push(poolFeePath[i]);
    }
  }

  return routeStr.join('');
};

export const routeAmountsToString = (
  routeAmounts: RouteWithValidQuote[],
  factoryAddress: string,
  initCodeHash: string
): string => {
  const total = _.reduce(
    routeAmounts,
    (total: CurrencyAmount, cur: RouteWithValidQuote) => {
      return total.add(cur.amount);
    },
    CurrencyAmount.fromRawAmount(routeAmounts[0]!.amount.currency, 0)
  );

  const routeStrings = _.map(routeAmounts, ({ protocol, route, amount }) => {
    const portion = amount.divide(total);
    const percent = new Percent(portion.numerator, portion.denominator);
    return `[${protocol}] ${percent.toFixed(2)}% = ${routeToString(route, factoryAddress, initCodeHash)}`;
  });

  return _.join(routeStrings, ', ');
};

export const routeAmountToString = (
  routeAmount: RouteWithValidQuote,
  factoryAddress: string,
  initCodeHash: string
): string => {
  const { route, amount } = routeAmount;
  return `${amount.toExact()} = ${routeToString(route, factoryAddress, initCodeHash)}`;
};

export const poolToString = (p: Pool | Pair): string => {
  return `${p.token0.symbol}/${p.token1.symbol}${
    p instanceof Pool ? `/${p.fee / 10000}%` : ``
  }`;
};
