import { AppError } from '../errors/app-error.js';
import { assertIndustryIdsInScope, isGlobalRole, resolveIndustryTypeId, type IndustryScope } from '../lib/industry-scope.js';
import { applyLiveVehicleStock, createInitialUnits, syncProductModel } from '../lib/vehicle-links.js';
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
  async list(org: string, search: string | undefined, status: string | undefined, industryTypeId: string | undefined, scope: IndustryScope) {
    const effective = resolveIndustryTypeId(scope, industryTypeId);
    const rows = await repository.listProducts(org, search, status, effective ?? undefined);
    return applyLiveVehicleStock(org, rows); // Vehicle products show the real Available-unit count
  },
  async create(org: string, input: Record<string, unknown>, scope: IndustryScope) {
    const requestedIds = input.industryTypeIds as string[] | undefined;
    assertIndustryIdsInScope(scope, requestedIds);
    const industryTypeIds = isGlobalRole(scope.role) ? requestedIds : (requestedIds ?? (scope.lockedIndustryTypeId ? [scope.lockedIndustryTypeId] : undefined));
    const product = await repository.createProduct(org, { ...input, industryTypeIds });
    await syncProductModel(org, product); // Vehicle products only; never blocks the save
    await createInitialUnits(org, product, input.stockQuantity); // Vehicle products only; creates the opening units
    return product;
  },
  async update(org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
    await assertProductInScope(org, id, scope);
    assertIndustryIdsInScope(scope, input.industryTypeIds as string[] | undefined);
    const product = await repository.updateProduct(org, id, input);
    await syncProductModel(org, product); // Vehicle products only
    return product;
  },
  async changeStock(org: string, id: string, input: { delta: number; allowNegative?: boolean }, scope: IndustryScope) {
    await assertProductInScope(org, id, scope);
    return repository.changeProductStock(org, id, input.delta, Boolean(input.allowNegative));
  },
  async remove(org: string, id: string, scope: IndustryScope) {
    await assertProductInScope(org, id, scope);
    return repository.deleteProduct(org, id);
  }
};