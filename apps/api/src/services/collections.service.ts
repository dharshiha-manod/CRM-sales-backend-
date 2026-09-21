import * as repository from '../repositories/collections.repository.js';
export const collectionsService = { createFromVisit: repository.createFromVisit, createForOrder: repository.createForOrder, list: repository.listCollections };
