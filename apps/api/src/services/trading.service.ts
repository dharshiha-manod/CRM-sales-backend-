// NEW
import * as repository from '../repositories/trading.repository.js';

export const tradingService = {
  list: repository.listTradingRecords,
  get: repository.getTradingRecord,
  create: repository.createTradingRecord,
  update: repository.updateTradingRecord,
  remove: repository.deleteTradingRecord,
};