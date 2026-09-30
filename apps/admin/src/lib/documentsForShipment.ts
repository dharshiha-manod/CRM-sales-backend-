// Which Trade Documents may be linked to a record: only those raised for the record's own shipment, or for its deal
// when the document has no shipment yet. With neither picked, every document is offered so the field stays usable.
export function documentsForShipment(doc: Record<string, unknown>, form: Record<string, string>): boolean {
  const shipment = String(form.shipment_number ?? '').trim();
  const deal = String(form.deal_number ?? '').trim();
  if (!shipment && !deal) return true;
  const docShipment = String(doc.shipment_number ?? '').trim();
  const docDeal = String(doc.deal_number ?? '').trim();
  if (shipment && docShipment) return docShipment === shipment;
  if (deal && docDeal) return docDeal === deal;
  return false; // a document with no shipment or deal of its own belongs to nothing here
}