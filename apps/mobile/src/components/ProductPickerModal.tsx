import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../lib/api';
import { AppButton } from './AppButton';
import { QtyStepper } from './QtyStepper';

export type CatalogCartItem = { productId: string; name: string; quantity: number };
export type PendingProductRequest = { freeTextItem: string; quantity: number; notes?: string };
type Product = { id: string; product_code: string; product_name: string; selling_price: number; stock_quantity: number; status: string };

type ProductPickerModalProps = {
  visible: boolean;
  cart: CatalogCartItem[];
  onClose: () => void;
  onAddProduct: (product: Product) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onAddRequest: (request: PendingProductRequest) => void;
};

export function ProductPickerModal({ visible, cart, onClose, onAddProduct, onQuantityChange, onAddRequest }: ProductPickerModalProps) {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestQuantity, setRequestQuantity] = useState(1);
  const [requestNotes, setRequestNotes] = useState('');
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setProducts([]);
      setSearching(false);
      setSearchComplete(false);
      setSearchError('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchComplete(false);
    setSearchError('');
    const timer = setTimeout(() => {
      void api<{ data: Product[] }>(`/products?search=${encodeURIComponent(query)}`)
        .then((result) => { if (!cancelled) setProducts(result.data ?? []); })
        .catch((cause: Error) => { if (!cancelled) { setProducts([]); setSearchError(cause.message); } })
        .finally(() => { if (!cancelled) { setSearching(false); setSearchComplete(true); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  function openRequestForm() {
    setRequestName(search.trim());
    setRequestQuantity(1);
    setRequestNotes('');
    setShowRequestForm(true);
  }

  function submitRequest() {
    const freeTextItem = requestName.trim();
    if (!freeTextItem) return;
    onAddRequest({ freeTextItem, quantity: requestQuantity, notes: requestNotes.trim() || undefined });
    setShowRequestForm(false);
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{showRequestForm ? 'Request unlisted product' : 'Add product'}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close product picker" onPress={onClose} style={styles.close}><Text style={styles.closeText}>X</Text></TouchableOpacity>
          </View>
          {showRequestForm ? (
            <View style={styles.form}>
              <Text style={styles.helper}>This will be sent for review after check-out.</Text>
              <Text style={styles.label}>Product name</Text>
              <TextInput style={styles.input} value={requestName} onChangeText={setRequestName} placeholder="Product name" autoFocus />
              <Text style={styles.label}>Quantity</Text>
              <QtyStepper value={requestQuantity} onChange={setRequestQuantity} />
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput style={[styles.input, styles.notes]} value={requestNotes} onChangeText={setRequestNotes} placeholder="Size, specification, or other detail" multiline />
              <View style={styles.formActions}><AppButton title="Back to search" variant="secondary" onPress={() => setShowRequestForm(false)} /><AppButton title="Add request" onPress={submitRequest} disabled={!requestName.trim()} /></View>
            </View>
          ) : (
            <>
              <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search products by name or code" autoCorrect={false} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
                {searching ? <ActivityIndicator color="#0f172a" /> : null}
                {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
                {products.map((product) => {
                  const inCart = cart.find((item) => item.productId === product.id);
                  return <View key={product.id} style={styles.productRow}><View style={styles.productInfo}><Text style={styles.productName}>{product.product_name}</Text><Text style={styles.productMeta}>{product.product_code} · {product.selling_price}</Text></View>{inCart ? <QtyStepper value={inCart.quantity} onChange={(quantity) => onQuantityChange(product.id, quantity)} /> : <AppButton title="Add" variant="secondary" onPress={() => onAddProduct(product)} />}</View>;
                })}
                {searchComplete && products.length === 0 ? <View style={styles.noResults}><Text style={styles.helper}>No catalog products found.</Text><AppButton title={`Can't find "${search.trim()}"? Request this product`} variant="secondary" onPress={openRequestForm} /></View> : null}
              </ScrollView>
            </>
          )}
          <AppButton title="Done" onPress={onClose} style={styles.done} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  sheet: { maxHeight: '88%', minHeight: 390, backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#0f172a', fontSize: 20, fontWeight: '700' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f1f5f9' },
  closeText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  searchInput: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  results: { gap: 10, paddingBottom: 8 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc' },
  productInfo: { flex: 1, gap: 3 },
  productName: { color: '#0f172a', fontWeight: '700' },
  productMeta: { color: '#64748b', fontSize: 13 },
  noResults: { gap: 10, paddingVertical: 12 },
  form: { gap: 8 },
  label: { color: '#334155', fontWeight: '600', marginTop: 4 },
  helper: { color: '#64748b', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  notes: { minHeight: 76, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  done: { marginTop: 'auto' },
  error: { color: '#b91c1c' },
});
