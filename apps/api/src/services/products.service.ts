import { AppError } from '../errors/app-error.js';
import { assertIndustryIdsInScope, isGlobalRole, resolveIndustryTypeId, type IndustryScope } from '../lib/industry-scope.js';
import { listProductIndustryTypes } from '../repositories/industry-types.repository.js';
import * as repository from '../repositories/products.repository.js';

const productNotFound = () => new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');

async function assertProductInScope(org: string, id: string, scope: IndustryScope) {
  if (isGlobalRole(scope.role)) return;
  const tags = await listProductIndustryTypes(org, id);
  const inScope = tags.some((tag: { id?: string }) => tag?.id === scope.lockedIndustryTypeId);
  if (!inScope) throw productNotFound();
}

export const productService = {
  list(org: string, search: string | undefined, status: string | undefined, industryTypeId: string | undefined, scope: IndustryScope) {
    const effective = resolveIndustryTypeId(scope, industryTypeId);
    return repository.listProducts(org, search, status, effective ?? undefined);
  },
  async create(org: string, input: Record<string, unknown>, scope: IndustryScope) {
    const requestedIds = input.industryTypeIds as string[] | undefined;
    assertIndustryIdsInScope(scope, requestedIds);
    const industryTypeIds = isGlobalRole(scope.role) ? requestedIds : (requestedIds ?? (scope.lockedIndustryTypeId ? [scope.lockedIndustryTypeId] : undefined));
    return repository.createProduct(org, { ...input, industryTypeIds });
  },
  async update(org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
    await assertProductInScope(org, id, scope);
    assertIndustryIdsInScope(scope, input.industryTypeIds as string[] | undefined);
    return repository.updateProduct(org, id, input);
  },
  async remove(org: string, id: string, scope: IndustryScope) {
    await assertProductInScope(org, id, scope);
    return repository.deleteProduct(org, id);
  }
};