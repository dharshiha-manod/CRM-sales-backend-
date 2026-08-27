import * as repository from '../repositories/products.repository.js';
export const productService = { list: repository.listProducts, create: repository.createProduct, update: repository.updateProduct };
