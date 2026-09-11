import type { IndustryConfig } from './types';

// ---------------------------------------------------------------------------
// FMCG
// ---------------------------------------------------------------------------
const fmcg: IndustryConfig = {
  key: 'fmcg',
  label: 'FMCG',
  tagline: 'Fast Moving Consumer Goods · Retail & Distribution',
  colorVar: '--ind-fmcg',
  terms: {
    repLabel: 'Sales Rep',
    beatLabel: 'Beat / Route',
    beatLabelPlural: 'Beats / Routes',
    partyLabel: 'Customer',
    partyLabelPlural: 'Customers',
    visitLabel: 'Visit',
    itemLabel: 'Product',
    itemLabelPlural: 'Products',
    orderLabel: 'Order',
    scanLabel: 'Barcode Scan',
    schemeLabel: 'Scheme / Discount',
    stockLabel: 'Stock / Batch / Expiry',
  },
  workflow: ['Sales Rep', 'Beat / Route', "Today's Visits", 'GPS Check-in', 'Customer History', 'Product / Scan', 'Batch & Expiry', 'Scheme / Discount', 'Create Order', 'Collection', 'Follow-up', 'Target'],
  kpis: [
    { label: "Today's Visits", value: '5 / 8', sub: '3 pending on Beat 2', tone: 'default' },
    { label: 'Orders Booked', value: '₹58,400', sub: '12 orders today', tone: 'good' },
    { label: 'Collections', value: '₹21,300', sub: '4 payments received', tone: 'good' },
    { label: 'Target Achievement', value: '68%', sub: '₹1,02,000 of ₹1,50,000 MTD', tone: 'warn' },
  ],
  beats: [
    { id: 'b1', name: 'Beat 1 — Anna Nagar Main', repName: 'Karthik R.', area: 'Anna Nagar, Chennai', stopsPlanned: 8, stopsDone: 5 },
    { id: 'b2', name: 'Beat 2 — Velachery Corridor', repName: 'Karthik R.', area: 'Velachery, Chennai', stopsPlanned: 6, stopsDone: 1 },
    { id: 'b3', name: 'Beat 3 — Tambaram Market', repName: 'Karthik R.', area: 'Tambaram, Chennai', stopsPlanned: 5, stopsDone: 0 },
  ],
  parties: [
    { id: 'p1', code: 'RET-1042', name: 'Sri Lakshmi General Store', type: 'Retailer', location: 'Anna Nagar 2nd Ave', contactPerson: 'Murugan S.', phone: '98400 11234', email: 'srilakshmistore@gmail.com', whatsappNumber: '98400 11234', outstanding: 4200, creditLimit: 25000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '27 Aug 2026', lastOrderValue: 6800, nextFollowUpDate: '05 Sep 2026', tags: ['Regular', 'Priority'], fields: [{ label: 'Channel', value: 'Modern Retail' }, { label: 'GST No.', value: '33AACFS1234K1Z1' }, { label: 'Visit Frequency', value: 'Weekly' }], history: [{ date: '27 Aug', text: 'Order booked', value: '₹6,800' }, { date: '20 Aug', text: 'Collection received', value: '₹5,000' }, { date: '13 Aug', text: 'Visit — no order (stock sufficient)' }] },
    { id: 'p2', code: 'RET-1043', name: 'New Balaji Provision Stores', type: 'Retailer', location: 'Anna Nagar West', contactPerson: 'Balaji K.', phone: '98410 22456', email: 'newbalajiprovision@gmail.com', whatsappNumber: '98410 22456', outstanding: 0, creditLimit: 15000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '24 Aug 2026', lastOrderValue: 3200, tags: ['Regular'], fields: [{ label: 'Channel', value: 'General Trade' }, { label: 'GST No.', value: '33AAGFB5567L1Z4' }, { label: 'Visit Frequency', value: 'Weekly' }], history: [{ date: '24 Aug', text: 'Order booked', value: '₹3,200' }, { date: '17 Aug', text: 'Order booked', value: '₹2,900' }] },
    { id: 'p3', code: 'WHL-2091', name: 'Chennai Wholesale Traders', type: 'Wholesaler', location: 'Anna Nagar Bypass', contactPerson: 'Ravichandran P.', phone: '98450 33678', email: 'chennaiwholesale@gmail.com', whatsappNumber: '98450 33678', outstanding: 18500, creditLimit: 100000, paymentTermsDays: 30, riskLevel: 'medium', lastOrderDate: '22 Aug 2026', lastOrderValue: 34500, nextFollowUpDate: '03 Sep 2026', tags: ['High Value'], fields: [{ label: 'Channel', value: 'Wholesale' }, { label: 'GST No.', value: '33AAWFC9098M1Z9' }, { label: 'Visit Frequency', value: 'Bi-weekly' }], history: [{ date: '22 Aug', text: 'Order booked', value: '₹34,500' }, { date: '10 Aug', text: 'Collection received', value: '₹20,000' }] },
    { id: 'p4', code: 'RET-1077', name: 'Velachery Super Mart', type: 'Retailer', location: 'Velachery Main Rd', contactPerson: 'Anitha V.', phone: '98650 88123', email: 'velacherysupermart@gmail.com', whatsappNumber: '98650 88123', outstanding: 1200, creditLimit: 20000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '25 Aug 2026', lastOrderValue: 5100, tags: ['Regular'], fields: [{ label: 'Channel', value: 'Modern Retail' }, { label: 'GST No.', value: '33AAVFM4432P1Z2' }, { label: 'Visit Frequency', value: 'Weekly' }], history: [{ date: '25 Aug', text: 'Order booked', value: '₹5,100' }] },
    { id: 'p5', code: 'RET-1091', name: 'Tambaram Fresh Mart', type: 'Retailer', location: 'Tambaram East', contactPerson: 'Suresh Kumar', phone: '98760 44987', email: 'tambaramfreshmart@gmail.com', whatsappNumber: '98760 44987', outstanding: 6600, creditLimit: 18000, paymentTermsDays: 15, riskLevel: 'high', lastOrderDate: '19 Aug 2026', lastOrderValue: 4400, nextFollowUpDate: '02 Sep 2026', tags: ['Payment Due'], fields: [{ label: 'Channel', value: 'General Trade' }, { label: 'GST No.', value: '33AATFM7789Q1Z6' }, { label: 'Visit Frequency', value: 'Weekly' }], history: [{ date: '19 Aug', text: 'Order booked', value: '₹4,400' }, { date: '05 Aug', text: 'Payment overdue reminder sent' }] },
  ],
  catalog: [
    { id: 'i1', code: 'FMC-SNK-001', name: 'Tasty Crunch Chips 52g', category: 'Snacks', unit: 'Case (48 pcs)', price: 960, stock: 340, reorderLevel: 80, barcode: '8901234500011', attributes: [{ label: 'Batch', value: 'B24H12' }, { label: 'Expiry', value: '15 Jan 2027' }, { label: 'MRP', value: '₹20/pc' }] },
    { id: 'i2', code: 'FMC-BEV-014', name: 'Fizzy Cola 250ml', category: 'Beverages', unit: 'Case (24 pcs)', price: 480, stock: 210, reorderLevel: 60, barcode: '8901234500028', attributes: [{ label: 'Batch', value: 'B24J03' }, { label: 'Expiry', value: '02 Mar 2027' }, { label: 'MRP', value: '₹20/pc' }] },
    { id: 'i3', code: 'FMC-BIS-007', name: 'Golden Cream Biscuits 100g', category: 'Biscuits', unit: 'Case (60 pcs)', price: 720, stock: 26, reorderLevel: 40, expiryDate: '2026-09-30', expiryAlertDays: 30, barcode: '8901234500035', attributes: [{ label: 'Batch', value: 'B24G21' }, { label: 'Expiry', value: '30 Sep 2026' }, { label: 'MRP', value: '₹12/pc' }] },
    { id: 'i4', code: 'FMC-PER-022', name: 'Shine Soap Bar 100g (Pack of 4)', category: 'Personal Care', unit: 'Case (36 packs)', price: 1440, stock: 88, reorderLevel: 30, barcode: '8901234500042', attributes: [{ label: 'Batch', value: 'B24I09' }, { label: 'Expiry', value: '18 Dec 2027' }, { label: 'MRP', value: '₹40/pack' }] },
    { id: 'i5', code: 'FMC-DAI-031', name: 'Pure Ghee 200ml Pouch', category: 'Dairy', unit: 'Case (20 pcs)', price: 1900, stock: 12, reorderLevel: 25, expiryDate: '2026-09-10', expiryAlertDays: 30, barcode: '8901234500059', attributes: [{ label: 'Batch', value: 'B24K02' }, { label: 'Expiry', value: '10 Sep 2026' }, { label: 'MRP', value: '₹95/pc' }] },
    { id: 'i6', code: 'FMC-SNK-009', name: 'Masala Peanuts 150g', category: 'Snacks', unit: 'Case (40 pcs)', price: 800, stock: 150, reorderLevel: 50, barcode: '8901234500066', attributes: [{ label: 'Batch', value: 'B24H30' }, { label: 'Expiry', value: '22 Feb 2027' }, { label: 'MRP', value: '₹20/pc' }] },
  ],
  catalogColumns: [{ key: 'Batch', label: 'Batch' }, { key: 'Expiry', label: 'Expiry' }, { key: 'MRP', label: 'MRP' }],
  schemes: [
    { id: 's1', label: 'Buy 10+ cases', minQty: 10, discountPercent: 5, note: 'Standard volume slab' },
    { id: 's2', label: 'Buy 25+ cases', minQty: 25, discountPercent: 8, note: 'Bulk order slab' },
    { id: 's3', label: 'Buy 50+ cases', minQty: 50, discountPercent: 12, note: 'Distributor-level slab' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p1', beatId: 'b1', scheduledTime: '09:00 AM', status: 'completed', purpose: 'Order booking', checkinTime: '09:04 AM', checkinLocation: '13.0850° N, 80.2101° E' },
    { id: 'v2', partyId: 'p2', beatId: 'b1', scheduledTime: '09:45 AM', status: 'completed', purpose: 'Order booking', checkinTime: '09:50 AM', checkinLocation: '13.0862° N, 80.2117° E' },
    { id: 'v3', partyId: 'p3', beatId: 'b1', scheduledTime: '10:30 AM', status: 'completed', purpose: 'Collection + Order', checkinTime: '10:33 AM', checkinLocation: '13.0879° N, 80.2098° E' },
    { id: 'v4', partyId: 'p4', beatId: 'b1', scheduledTime: '11:15 AM', status: 'checked_in', purpose: 'Order booking', checkinTime: '11:18 AM', checkinLocation: '12.9757° N, 80.2201° E' },
    { id: 'v5', partyId: 'p5', beatId: 'b1', scheduledTime: '12:00 PM', status: 'completed', purpose: 'Collection', checkinTime: '12:05 PM', checkinLocation: '12.9247° N, 80.1000° E' },
    { id: 'v6', partyId: 'p1', beatId: 'b2', scheduledTime: '02:00 PM', status: 'pending', purpose: 'Order booking' },
    { id: 'v7', partyId: 'p3', beatId: 'b2', scheduledTime: '02:45 PM', status: 'pending', purpose: 'New scheme pitch' },
    { id: 'v8', partyId: 'p5', beatId: 'b2', scheduledTime: '03:30 PM', status: 'pending', purpose: 'Payment follow-up' },
  ],
  targets: [
    { label: 'Monthly Sales Value', achieved: 102000, target: 150000, unit: '₹' },
    { label: 'New Outlets Added', achieved: 6, target: 10, unit: '' },
    { label: 'Collection Efficiency', achieved: 78, target: 90, unit: '%' },
  ],
  activity: [
    { id: 'a1', time: '12:05 PM', text: 'Collection of ₹4,400 recorded at Tambaram Fresh Mart', kind: 'collection' },
    { id: 'a2', time: '10:36 AM', text: 'Order SO-3312 (₹34,500) created for Chennai Wholesale Traders', kind: 'order' },
    { id: 'a3', time: '10:33 AM', text: 'Checked in at Chennai Wholesale Traders', kind: 'checkin' },
    { id: 'a4', time: '09:50 AM', text: 'Order SO-3310 (₹3,200) created for New Balaji Provision Stores', kind: 'order' },
    { id: 'a5', time: '09:04 AM', text: 'Checked in at Sri Lakshmi General Store', kind: 'checkin' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p5', title: 'Confirm cheque clearance for ₹6,600 outstanding', dueDate: '02 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p3', title: 'Share festival scheme catalogue', dueDate: '03 Sep 2026', status: 'pending' },
    { id: 'f3', partyId: 'p1', title: 'Revisit for reorder after stock depletion', dueDate: '05 Sep 2026', status: 'pending' },
  ],
  automationRules: [
    { id: 'ar1', label: 'Low Stock Reorder', trigger: 'low_stock', thresholdValue: 40, action: 'auto-flag for distributor reorder' },
    { id: 'ar2', label: 'Batch Expiry Clearance', trigger: 'expiry_window', thresholdValue: 30, action: 'push batch-clearance scheme to reps before it expires' },
    { id: 'ar3', label: 'Overdue Payment Escalation', trigger: 'overdue_payment', thresholdValue: 10, action: 'escalate to Collections queue and notify manager' },
    { id: 'ar4', label: 'Reorder Reminder', trigger: 'no_visit_days', thresholdValue: 14, action: 'auto-create a follow-up for reorder check' },
  ],
};

// ---------------------------------------------------------------------------
// SCHOOL
// ---------------------------------------------------------------------------
const school: IndustryConfig = {
  key: 'school',
  label: 'School',
  tagline: 'Educational Institutions · Book & Uniform Supply',
  colorVar: '--ind-school',
  terms: {
    repLabel: 'School Relationship Executive',
    beatLabel: 'Zone',
    beatLabelPlural: 'Zones',
    partyLabel: 'School',
    partyLabelPlural: 'Schools',
    visitLabel: 'School Visit',
    itemLabel: 'Kit / Title',
    itemLabelPlural: 'Kits / Titles',
    orderLabel: 'Supply Order',
    scanLabel: 'ISBN / Kit Scan',
    schemeLabel: 'Bulk Concession',
    stockLabel: 'Print Run / Availability',
  },
  workflow: ['Executive', 'Zone', "Today's School Visits", 'Check-in at Campus', 'School Profile & History', 'Kit / Title Selection', 'Print Run Availability', 'Bulk Concession', 'Create Supply Order', 'Collection', 'Follow-up', 'Term Target'],
  kpis: [
    { label: "Today's School Visits", value: '3 / 6', sub: '2 in North Zone remaining', tone: 'default' },
    { label: 'Orders Booked', value: '₹4,82,000', sub: '3 supply orders today', tone: 'good' },
    { label: 'Collections', value: '₹1,10,000', sub: '2 fee-linked payments', tone: 'good' },
    { label: 'Term Target Achievement', value: '54%', sub: '₹16.2L of ₹30L this term', tone: 'warn' },
  ],
  beats: [
    { id: 'z1', name: 'North Zone — City Schools', repName: 'Priya Menon', area: 'Kilpauk / Egmore', stopsPlanned: 4, stopsDone: 2 },
    { id: 'z2', name: 'South Zone — Suburban Schools', repName: 'Priya Menon', area: 'Adyar / Velachery', stopsPlanned: 2, stopsDone: 1 },
  ],
  parties: [
    { id: 'p1', code: 'SCH-0210', name: "St. Xavier's Matriculation School", type: 'CBSE School', location: 'Kilpauk', contactPerson: 'Sr. Agnes (Principal)', phone: '95000 12233', email: 'admin@stxaviersmatric.edu.in', whatsappNumber: '95000 12233', outstanding: 45000, creditLimit: 500000, paymentTermsDays: 30, riskLevel: 'medium', lastOrderDate: '20 Aug 2026', lastOrderValue: 210000, termEndDate: '2026-09-18', tags: ['Anchor Account'], fields: [{ label: 'Board', value: 'CBSE' }, { label: 'Strength', value: '1,240 students' }, { label: 'Academic Year', value: '2026-27' }, { label: 'Term', value: 'Term 2' }], history: [{ date: '20 Aug', text: 'Supply order — Grade 6-8 kits', value: '₹2,10,000' }, { date: '02 Aug', text: 'Sample kits shared for approval' }] },
    { id: 'p2', code: 'SCH-0245', name: 'Little Angels Matric Hr. Sec. School', type: 'State Board', location: 'Egmore', contactPerson: 'Mr. Ganesh (Admin)', phone: '95100 22344', email: 'admin@littleangelsschool.edu.in', whatsappNumber: '95100 22344', outstanding: 0, creditLimit: 250000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '18 Aug 2026', lastOrderValue: 98000, termEndDate: '2026-09-25', tags: ['Regular'], fields: [{ label: 'Board', value: 'State Board' }, { label: 'Strength', value: '680 students' }, { label: 'Academic Year', value: '2026-27' }, { label: 'Term', value: 'Term 2' }], history: [{ date: '18 Aug', text: 'Supply order — Grade 3-5 kits', value: '₹98,000' }] },
    { id: 'p3', code: 'SCH-0301', name: 'Greenwood International School', type: 'ICSE School', location: 'Adyar', contactPerson: 'Mrs. Fathima (Coordinator)', phone: '95200 33455', email: 'admin@greenwoodintl.edu.in', whatsappNumber: '95200 33455', outstanding: 62000, creditLimit: 600000, paymentTermsDays: 30, riskLevel: 'high', lastOrderDate: '15 Aug 2026', lastOrderValue: 174000, termEndDate: '2026-09-10', tags: ['High Value', 'Payment Due'], fields: [{ label: 'Board', value: 'ICSE' }, { label: 'Strength', value: '1,560 students' }, { label: 'Academic Year', value: '2026-27' }, { label: 'Term', value: 'Term 2' }], history: [{ date: '15 Aug', text: 'Supply order — full uniform + kit set', value: '₹1,74,000' }] },
    { id: 'p4', code: 'SCH-0356', name: 'Velachery Public School', type: 'State Board', location: 'Velachery', contactPerson: 'Mr. Rajan (Admin)', phone: '95300 44566', email: 'admin@velacherypublic.edu.in', whatsappNumber: '95300 44566', outstanding: 8000, creditLimit: 150000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '10 Aug 2026', lastOrderValue: 56000, termEndDate: '2026-10-05', tags: ['Regular'], fields: [{ label: 'Board', value: 'State Board' }, { label: 'Strength', value: '410 students' }, { label: 'Academic Year', value: '2026-27' }, { label: 'Term', value: 'Term 2' }], history: [{ date: '10 Aug', text: 'Supply order — Grade 1-2 kits', value: '₹56,000' }] },
  ],
  catalog: [
    { id: 'i1', code: 'KIT-G6', name: 'Grade 6 Full Subject Kit', category: 'Book Kit', unit: 'Set', price: 1450, stock: 620, reorderLevel: 100, barcode: '9781234500011', attributes: [{ label: 'Print Run', value: 'Run 4 · 2026-27' }, { label: 'Edition', value: 'Rev. 3' }] },
    { id: 'i2', code: 'KIT-G8', name: 'Grade 8 Full Subject Kit', category: 'Book Kit', unit: 'Set', price: 1680, stock: 410, reorderLevel: 80, barcode: '9781234500028', attributes: [{ label: 'Print Run', value: 'Run 4 · 2026-27' }, { label: 'Edition', value: 'Rev. 2' }] },
    { id: 'i3', code: 'UNI-SET-M', name: 'Uniform Set — Medium', category: 'Uniform', unit: 'Set', price: 850, stock: 55, reorderLevel: 40, barcode: '9781234500035', attributes: [{ label: 'Print Run', value: 'Batch 26-M' }, { label: 'Edition', value: 'Std. Fit' }] },
    { id: 'i4', code: 'KIT-G3', name: 'Grade 3 Full Subject Kit', category: 'Book Kit', unit: 'Set', price: 1120, stock: 300, reorderLevel: 60, barcode: '9781234500042', attributes: [{ label: 'Print Run', value: 'Run 5 · 2026-27' }, { label: 'Edition', value: 'Rev. 1' }] },
    { id: 'i5', code: 'STY-KIT', name: 'Stationery Combo Kit', category: 'Stationery', unit: 'Set', price: 340, stock: 18, reorderLevel: 25, barcode: '9781234500059', attributes: [{ label: 'Print Run', value: 'Batch 26-S' }, { label: 'Edition', value: 'Standard' }] },
  ],
  catalogColumns: [{ key: 'Print Run', label: 'Print Run' }, { key: 'Edition', label: 'Edition' }],
  schemes: [
    { id: 's1', label: '50+ sets', minQty: 50, discountPercent: 6, note: 'Standard school slab' },
    { id: 's2', label: '200+ sets', minQty: 200, discountPercent: 10, note: 'Anchor account slab' },
    { id: 's3', label: '500+ sets', minQty: 500, discountPercent: 15, note: 'Full-strength order slab' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p1', beatId: 'z1', scheduledTime: '09:30 AM', status: 'completed', purpose: 'Term 2 order booking', checkinTime: '09:35 AM', checkinLocation: '13.0827° N, 80.2380° E' },
    { id: 'v2', partyId: 'p2', beatId: 'z1', scheduledTime: '11:00 AM', status: 'completed', purpose: 'Kit delivery confirmation', checkinTime: '11:06 AM', checkinLocation: '13.0732° N, 80.2609° E' },
    { id: 'v3', partyId: 'p3', beatId: 'z2', scheduledTime: '01:30 PM', status: 'checked_in', purpose: 'Payment follow-up + reorder', checkinTime: '01:34 PM', checkinLocation: '13.0067° N, 80.2570° E' },
    { id: 'v4', partyId: 'p4', beatId: 'z2', scheduledTime: '03:00 PM', status: 'pending', purpose: 'New session catalogue pitch' },
    { id: 'v5', partyId: 'p1', beatId: 'z1', scheduledTime: '04:00 PM', status: 'pending', purpose: 'Uniform sizing session' },
  ],
  targets: [
    { label: 'Term Sales Value', achieved: 1620000, target: 3000000, unit: '₹' },
    { label: 'Schools Onboarded', achieved: 9, target: 15, unit: '' },
    { label: 'Collection Efficiency', achieved: 71, target: 85, unit: '%' },
  ],
  activity: [
    { id: 'a1', time: '01:34 PM', text: 'Checked in at Greenwood International School', kind: 'checkin' },
    { id: 'a2', time: '11:08 AM', text: 'Delivery of Grade 3-5 kits confirmed with Little Angels School', kind: 'order' },
    { id: 'a3', time: '09:38 AM', text: "Supply order SUP-1042 (₹2,10,000) created for St. Xavier's", kind: 'order' },
    { id: 'a4', time: '09:35 AM', text: "Checked in at St. Xavier's Matriculation School", kind: 'checkin' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p3', title: 'Collect pending balance of ₹62,000', dueDate: '03 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p4', title: 'Send new academic year catalogue', dueDate: '04 Sep 2026', status: 'pending' },
  ],
  automationRules: [
    { id: 'ar1', label: 'Low Print-Run Stock', trigger: 'low_stock', thresholdValue: 25, action: 'auto-flag for reprint/restock before next batch of orders' },
    { id: 'ar2', label: 'Fee-linked Payment Escalation', trigger: 'overdue_payment', thresholdValue: 20, action: 'escalate to Collections and notify manager' },
    { id: 'ar3', label: 'School Visit Follow-up', trigger: 'no_visit_days', thresholdValue: 20, action: 'auto-create a school visit follow-up' },
    { id: 'ar4', label: 'Term Rollover', trigger: 'term_rollover', thresholdValue: 21, action: 'auto-create next-term catalogue pitch and roll pricing cycle forward' },
  ],
};

// ---------------------------------------------------------------------------
// TEXTILE
// ---------------------------------------------------------------------------
const textile: IndustryConfig = {
  key: 'textile',
  label: 'Textile',
  tagline: 'Fabric & Apparel · Wholesale Distribution',
  colorVar: '--ind-textile',
  terms: {
    repLabel: 'Sales Executive',
    beatLabel: 'Market Route',
    beatLabelPlural: 'Market Routes',
    partyLabel: 'Buyer',
    partyLabelPlural: 'Buyers',
    visitLabel: 'Showroom Visit',
    itemLabel: 'Fabric / Design',
    itemLabelPlural: 'Fabrics / Designs',
    orderLabel: 'Booking',
    scanLabel: 'Roll / Lot Scan',
    schemeLabel: 'Trade Discount',
    stockLabel: 'Roll / Lot Stock',
  },
  workflow: ['Sales Executive', 'Market Route', "Today's Buyer Visits", 'Check-in at Showroom', 'Buyer History', 'Design / Colour / Size Selection', 'Roll & Lot Stock', 'Trade Discount', 'Create Booking', 'Collection', 'Follow-up', 'Season Target'],
  kpis: [
    { label: "Today's Buyer Visits", value: '4 / 7', sub: '3 pending on T. Nagar route', tone: 'default' },
    { label: 'Bookings Value', value: '₹2,14,600', sub: '5 bookings today', tone: 'good' },
    { label: 'Collections', value: '₹85,000', sub: '3 payments received', tone: 'good' },
    { label: 'Season Target Achievement', value: '61%', sub: '₹18.3L of ₹30L this season', tone: 'warn' },
  ],
  beats: [
    { id: 'r1', name: 'T. Nagar Wholesale Route', repName: 'Divya S.', area: 'T. Nagar Textile Market', stopsPlanned: 5, stopsDone: 3 },
    { id: 'r2', name: 'Ranganathan St. Route', repName: 'Divya S.', area: 'Ranganathan Street', stopsPlanned: 2, stopsDone: 1 },
  ],
  parties: [
    { id: 'p1', code: 'BYR-3301', name: 'Sri Kumaran Silks Wholesale', type: 'Wholesaler', location: 'T. Nagar', contactPerson: 'Kumaran M.', phone: '94430 11223', email: 'kumaran@srikumaransilks.in', whatsappNumber: '94430 11223', outstanding: 32000, creditLimit: 300000, paymentTermsDays: 20, riskLevel: 'low', lastOrderDate: '26 Aug 2026', lastOrderValue: 78000, tags: ['Anchor Account'], fields: [{ label: 'Segment', value: 'Sarees & Sets' }, { label: 'Preferred Colours', value: 'Maroon, Mustard, Teal' }, { label: 'Season', value: 'Festive 2026' }], history: [{ date: '26 Aug', text: 'Booking placed — festive collection', value: '₹78,000' }, { date: '12 Aug', text: 'Sample rolls shared' }] },
    { id: 'p2', code: 'BYR-3345', name: 'Chennai Fabric House', type: 'Retail Chain', location: 'Ranganathan St.', contactPerson: 'Meena R.', phone: '94440 22334', email: 'meena@chennaifabrichouse.in', whatsappNumber: '94440 22334', outstanding: 0, creditLimit: 200000, paymentTermsDays: 15, riskLevel: 'low', lastOrderDate: '22 Aug 2026', lastOrderValue: 46000, tags: ['Regular'], fields: [{ label: 'Segment', value: 'Shirting & Suiting' }, { label: 'Preferred Colours', value: 'Navy, Grey, White' }, { label: 'Season', value: 'Festive 2026' }], history: [{ date: '22 Aug', text: 'Booking placed', value: '₹46,000' }] },
    { id: 'p3', code: 'BYR-3390', name: 'Anand Textiles Export', type: 'Exporter', location: 'T. Nagar', contactPerson: 'Anand P.', phone: '94450 33445', email: 'anand@anandtextilesexport.in', whatsappNumber: '94450 33445', outstanding: 54000, creditLimit: 500000, paymentTermsDays: 30, riskLevel: 'high', lastOrderDate: '19 Aug 2026', lastOrderValue: 132000, tags: ['High Value', 'Payment Due'], fields: [{ label: 'Segment', value: 'Cotton Export Grade' }, { label: 'Preferred Colours', value: 'Assorted' }, { label: 'Season', value: 'Export Order — Q4' }], history: [{ date: '19 Aug', text: 'Booking placed — export lot', value: '₹1,32,000' }] },
  ],
  catalog: [
    { id: 'i1', code: 'TEX-COT-101', name: 'Premium Cotton Print — Design 101', category: 'Cotton', unit: 'Roll (45m)', price: 5400, stock: 62, reorderLevel: 20, qcStatus: 'passed', barcode: '7701234500011', attributes: [{ label: 'Colour', value: 'Maroon' }, { label: 'Size/Width', value: '44 inch' }, { label: 'Roll No.', value: 'RL-2291' }] },
    { id: 'i2', code: 'TEX-SLK-045', name: 'Kanchipuram Silk — Design 45', category: 'Silk', unit: 'Roll (24m)', price: 18600, stock: 9, reorderLevel: 10, qcStatus: 'passed', barcode: '7701234500028', attributes: [{ label: 'Colour', value: 'Teal' }, { label: 'Size/Width', value: '48 inch' }, { label: 'Roll No.', value: 'RL-2305' }] },
    { id: 'i3', code: 'TEX-SHT-078', name: 'Cotton Shirting — Design 78', category: 'Shirting', unit: 'Roll (50m)', price: 6200, stock: 40, reorderLevel: 15, qcStatus: 'failed', barcode: '7701234500035', attributes: [{ label: 'Colour', value: 'Navy' }, { label: 'Size/Width', value: '58 inch' }, { label: 'Roll No.', value: 'RL-2318' }] },
    { id: 'i4', code: 'TEX-EXP-210', name: 'Export Grade Cotton — Lot 210', category: 'Export Cotton', unit: 'Lot (200m)', price: 42000, stock: 4, reorderLevel: 8, qcStatus: 'pending', barcode: '7701234500042', attributes: [{ label: 'Colour', value: 'Assorted' }, { label: 'Size/Width', value: '60 inch' }, { label: 'Roll No.', value: 'LOT-210' }] },
  ],
  catalogColumns: [{ key: 'Colour', label: 'Colour' }, { key: 'Size/Width', label: 'Size / Width' }, { key: 'Roll No.', label: 'Roll No.' }],
  schemes: [
    { id: 's1', label: '10+ rolls', minQty: 10, discountPercent: 4, note: 'Standard trade slab' },
    { id: 's2', label: '25+ rolls', minQty: 25, discountPercent: 7, note: 'Bulk buyer slab' },
    { id: 's3', label: '50+ rolls', minQty: 50, discountPercent: 11, note: 'Export / anchor slab' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p1', beatId: 'r1', scheduledTime: '10:00 AM', status: 'completed', purpose: 'Festive collection booking', checkinTime: '10:05 AM', checkinLocation: '13.0418° N, 80.2341° E' },
    { id: 'v2', partyId: 'p2', beatId: 'r2', scheduledTime: '11:30 AM', status: 'completed', purpose: 'Booking + sample drop', checkinTime: '11:34 AM', checkinLocation: '13.0435° N, 80.2378° E' },
    { id: 'v3', partyId: 'p3', beatId: 'r1', scheduledTime: '01:00 PM', status: 'checked_in', purpose: 'Export lot booking + collection', checkinTime: '01:03 PM', checkinLocation: '13.0402° N, 80.2355° E' },
    { id: 'v4', partyId: 'p1', beatId: 'r1', scheduledTime: '03:00 PM', status: 'pending', purpose: 'Quality feedback visit' },
  ],
  targets: [
    { label: 'Season Bookings Value', achieved: 1830000, target: 3000000, unit: '₹' },
    { label: 'New Buyers Onboarded', achieved: 4, target: 8, unit: '' },
    { label: 'Collection Efficiency', achieved: 74, target: 88, unit: '%' },
  ],
  activity: [
    { id: 'a1', time: '01:03 PM', text: 'Checked in at Anand Textiles Export', kind: 'checkin' },
    { id: 'a2', time: '11:36 AM', text: 'Booking BKG-2207 (₹46,000) created for Chennai Fabric House', kind: 'order' },
    { id: 'a3', time: '10:08 AM', text: 'Booking BKG-2205 (₹78,000) created for Sri Kumaran Silks', kind: 'order' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p3', title: 'Collect balance ₹54,000 before export dispatch', dueDate: '02 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p1', title: 'Share new festive design catalogue', dueDate: '04 Sep 2026', status: 'pending' },
  ],
  automationRules: [
    { id: 'ar1', label: 'Low Roll/Lot Stock', trigger: 'low_stock', thresholdValue: 15, action: 'auto-flag for fresh roll production/procurement' },
    { id: 'ar2', label: 'Buyer Payment Escalation', trigger: 'overdue_payment', thresholdValue: 15, action: 'escalate to Collections and notify manager' },
    { id: 'ar3', label: 'Buyer Follow-up', trigger: 'no_visit_days', thresholdValue: 20, action: 'auto-create a showroom follow-up visit' },
    { id: 'ar4', label: 'Quality Hold Before Dispatch', trigger: 'quality_hold', thresholdValue: 0, action: 'block dispatch/booking confirmation until QC clears' },
  ],
};

// ---------------------------------------------------------------------------
// PHARMA
// ---------------------------------------------------------------------------
const pharma: IndustryConfig = {
  key: 'pharma',
  label: 'Pharma',
  tagline: 'Pharmaceutical · Medical Representative Field Ops',
  colorVar: '--ind-pharma',
  terms: {
    repLabel: 'Medical Representative',
    beatLabel: 'Territory',
    beatLabelPlural: 'Territories',
    partyLabel: 'Doctor / Chemist',
    partyLabelPlural: 'Doctors / Chemists',
    visitLabel: 'Call',
    itemLabel: 'Medicine',
    itemLabelPlural: 'Medicines',
    orderLabel: 'Indent',
    scanLabel: 'Batch Scan',
    schemeLabel: 'Trade Scheme',
    stockLabel: 'Batch / Expiry',
  },
  workflow: ['Medical Rep', 'Territory', "Today's Calls", 'Check-in', 'Doctor / Chemist History', 'Sample / Detailing', 'Batch & Expiry', 'Trade Scheme', 'Create Indent', 'Collection', 'Follow-up', 'Call Average Target'],
  kpis: [
    { label: "Today's Calls", value: '6 / 10', sub: '4 remaining in Territory 2', tone: 'default' },
    { label: 'Indent Value', value: '₹1,36,000', sub: '4 chemist indents today', tone: 'good' },
    { label: 'Samples Distributed', value: '38 units', sub: '5 doctors detailed', tone: 'default' },
    { label: 'Call Average Target', value: '72%', sub: '144 of 200 calls this month', tone: 'warn' },
  ],
  beats: [
    { id: 't1', name: 'Territory 1 — Hospital Belt', repName: 'Dr. Karthika S. (MR)', area: 'Anna Nagar Hospital Cluster', stopsPlanned: 6, stopsDone: 4 },
    { id: 't2', name: 'Territory 2 — Retail Chemists', repName: 'Dr. Karthika S. (MR)', area: 'Kilpauk Chemist Belt', stopsPlanned: 4, stopsDone: 2 },
  ],
  parties: [
    { id: 'p1', code: 'DOC-5510', name: 'Dr. Ashwin Kumar, MD (Cardiology)', type: 'Doctor', location: 'Apollo Speciality, Anna Nagar', contactPerson: 'Dr. Ashwin Kumar', phone: '90000 55110', email: 'ashwinkumar.cardio@gmail.com', whatsappNumber: '90000 55110', outstanding: 0, creditLimit: 0, paymentTermsDays: 0, riskLevel: 'low', lastOrderDate: '25 Aug 2026', lastOrderValue: 0, tags: ['Key Opinion Leader'], fields: [{ label: 'Specialty', value: 'Cardiology' }, { label: 'Prescription Trend', value: 'Rising' }, { label: 'Monthly Patient Volume', value: '~420' }], history: [{ date: '25 Aug', text: 'Detailing — new cardiac range' }, { date: '11 Aug', text: 'Samples given — 10 units' }] },
    { id: 'p2', code: 'CHM-6621', name: 'City Care Pharmacy', type: 'Chemist', location: 'Anna Nagar 2nd Ave', contactPerson: 'Ramesh (Pharmacist)', phone: '90100 66221', email: 'citycarepharmacy@gmail.com', whatsappNumber: '90100 66221', outstanding: 12400, creditLimit: 80000, paymentTermsDays: 15, riskLevel: 'medium', lastOrderDate: '24 Aug 2026', lastOrderValue: 28500, tags: ['Regular'], fields: [{ label: 'Specialty', value: 'Retail Chemist' }, { label: 'Prescription Trend', value: 'Stable' }, { label: 'Monthly Patient Volume', value: 'N/A' }], history: [{ date: '24 Aug', text: 'Indent placed', value: '₹28,500' }] },
    { id: 'p3', code: 'DOC-5544', name: 'Dr. Meena Iyer, MBBS (General Physician)', type: 'Doctor', location: 'Kilpauk Medical Centre', contactPerson: 'Dr. Meena Iyer', phone: '90200 77332', email: 'meenaiyer.gp@gmail.com', whatsappNumber: '90200 77332', outstanding: 0, creditLimit: 0, paymentTermsDays: 0, riskLevel: 'low', lastOrderDate: '20 Aug 2026', lastOrderValue: 0, tags: ['Regular'], fields: [{ label: 'Specialty', value: 'General Medicine' }, { label: 'Prescription Trend', value: 'Stable' }, { label: 'Monthly Patient Volume', value: '~600' }], history: [{ date: '20 Aug', text: 'Detailing — antibiotic range' }] },
    { id: 'p4', code: 'CHM-6688', name: 'Kilpauk Medical Stores', type: 'Chemist', location: 'Kilpauk Garden Rd', contactPerson: 'Suresh (Owner)', phone: '90300 88443', email: 'kilpaukmedical@gmail.com', whatsappNumber: '90300 88443', outstanding: 5200, creditLimit: 60000, paymentTermsDays: 15, riskLevel: 'high', lastOrderDate: '18 Aug 2026', lastOrderValue: 15800, tags: ['Payment Due'], fields: [{ label: 'Specialty', value: 'Retail Chemist' }, { label: 'Prescription Trend', value: 'Rising' }, { label: 'Monthly Patient Volume', value: 'N/A' }], history: [{ date: '18 Aug', text: 'Indent placed', value: '₹15,800' }] },
  ],
  catalog: [
    { id: 'i1', code: 'PHM-CAR-011', name: 'Cardivast 10mg Tablets', category: 'Cardiology', unit: 'Box (100 strips)', price: 4200, stock: 180, reorderLevel: 50, barcode: '8501234500011', attributes: [{ label: 'Batch', value: 'CV24L08' }, { label: 'Expiry', value: '11 Nov 2027' }] },
    { id: 'i2', code: 'PHM-ANT-034', name: 'Amoxiclav 625mg Tablets', category: 'Antibiotic', unit: 'Box (100 strips)', price: 3100, stock: 22, reorderLevel: 30, expiryDate: '2026-09-30', expiryAlertDays: 30, isRecalled: true, recallReason: 'QA hold — potency test failure on batch AX24K19', barcode: '8501234500028', attributes: [{ label: 'Batch', value: 'AX24K19' }, { label: 'Expiry', value: '30 Sep 2026' }] },
    { id: 'i3', code: 'PHM-GEN-052', name: 'Painazol 500mg Tablets', category: 'Analgesic', unit: 'Box (150 strips)', price: 2250, stock: 260, reorderLevel: 60, barcode: '8501234500035', attributes: [{ label: 'Batch', value: 'PZ24J27' }, { label: 'Expiry', value: '05 Jul 2027' }] },
    { id: 'i4', code: 'PHM-VIT-071', name: 'Vitaboost Multivitamin Syrup', category: 'Vitamins', unit: 'Box (50 bottles)', price: 1800, stock: 8, reorderLevel: 15, expiryDate: '2026-08-20', expiryAlertDays: 30, barcode: '8501234500042', attributes: [{ label: 'Batch', value: 'VB24I14' }, { label: 'Expiry', value: '20 Aug 2026' }] },
  ],
  catalogColumns: [{ key: 'Batch', label: 'Batch' }, { key: 'Expiry', label: 'Expiry' }],
  schemes: [
    { id: 's1', label: '10+ boxes', minQty: 10, discountPercent: 5, note: 'Standard chemist slab' },
    { id: 's2', label: '20+ boxes', minQty: 20, discountPercent: 8, note: 'Bulk indent slab' },
    { id: 's3', label: '40+ boxes', minQty: 40, discountPercent: 12, note: 'Distributor slab' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p1', beatId: 't1', scheduledTime: '09:00 AM', status: 'completed', purpose: 'Detailing call', checkinTime: '09:02 AM', checkinLocation: '13.0850° N, 80.2101° E' },
    { id: 'v2', partyId: 'p2', beatId: 't1', scheduledTime: '10:00 AM', status: 'completed', purpose: 'Indent + collection', checkinTime: '10:04 AM', checkinLocation: '13.0862° N, 80.2117° E' },
    { id: 'v3', partyId: 'p3', beatId: 't1', scheduledTime: '11:00 AM', status: 'completed', purpose: 'Detailing call', checkinTime: '11:03 AM', checkinLocation: '13.0793° N, 80.2412° E' },
    { id: 'v4', partyId: 'p4', beatId: 't2', scheduledTime: '02:00 PM', status: 'checked_in', purpose: 'Indent + payment follow-up', checkinTime: '02:05 PM', checkinLocation: '13.0801° N, 80.2430° E' },
    { id: 'v5', partyId: 'p1', beatId: 't1', scheduledTime: '04:00 PM', status: 'pending', purpose: 'Sample drop' },
  ],
  targets: [
    { label: 'Monthly Call Average', achieved: 144, target: 200, unit: 'calls' },
    { label: 'Monthly Indent Value', achieved: 486000, target: 800000, unit: '₹' },
    { label: 'New Doctors Onboarded', achieved: 3, target: 6, unit: '' },
  ],
  activity: [
    { id: 'a1', time: '02:05 PM', text: 'Checked in at Kilpauk Medical Stores', kind: 'checkin' },
    { id: 'a2', time: '11:05 AM', text: 'Detailing call completed with Dr. Meena Iyer', kind: 'order' },
    { id: 'a3', time: '10:06 AM', text: 'Indent IND-771 (₹28,500) created for City Care Pharmacy', kind: 'order' },
    { id: 'a4', time: '09:02 AM', text: 'Checked in at Apollo Speciality — Dr. Ashwin Kumar', kind: 'checkin' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p4', title: 'Follow up on ₹5,200 pending payment', dueDate: '02 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p1', title: 'Share cardiology trial data on next visit', dueDate: '05 Sep 2026', status: 'pending' },
  ],
  automationRules: [
    { id: 'ar1', label: 'Low Stock Reorder', trigger: 'low_stock', thresholdValue: 20, action: 'auto-flag for stockist reorder' },
    { id: 'ar2', label: 'Batch Expiry Clearance', trigger: 'expiry_window', thresholdValue: 30, action: 'push batch return/clearance to stockist before expiry' },
    { id: 'ar3', label: 'Chemist Payment Escalation', trigger: 'overdue_payment', thresholdValue: 10, action: 'escalate to Collections queue and notify manager' },
    { id: 'ar4', label: 'Doctor / Chemist Engagement Reminder', trigger: 'no_visit_days', thresholdValue: 20, action: 'auto-create a hospital/chemist engagement follow-up' },
    { id: 'ar5', label: 'Batch Recall Broadcast', trigger: 'recall', thresholdValue: 0, action: 'broadcast recall notice to every MR carrying this batch and block further indenting' },
  ],
};

// ---------------------------------------------------------------------------
// TRADING
// ---------------------------------------------------------------------------
const trading: IndustryConfig = {
  key: 'trading',
  label: 'Trading',
  tagline: 'Import / Export Trade · Deal & Commodity Desk',
  colorVar: '--ind-trading',
  terms: {
    repLabel: 'Trade Executive',
    beatLabel: 'Market Segment',
    beatLabelPlural: 'Market Segments',
    partyLabel: 'Buyer / Supplier',
    partyLabelPlural: 'Buyers / Suppliers',
    visitLabel: 'Trade Meeting',
    itemLabel: 'Commodity',
    itemLabelPlural: 'Commodities',
    orderLabel: 'Deal',
    scanLabel: 'Lot / Container Scan',
    schemeLabel: 'Trade Terms',
    stockLabel: 'Shipment / Lot Stock',
  },
  workflow: ['Trade Executive', 'Market Segment', "Today's Meetings", 'Check-in', 'Party Trade History', 'Commodity Selection', 'Lot / Shipment Stock', 'Trade Terms', 'Create Deal', 'Collection', 'Follow-up', 'Quarter Target'],
  kpis: [
    { label: "Today's Meetings", value: '2 / 4', sub: '2 pending with export buyers', tone: 'default' },
    { label: 'Deals Closed', value: '₹18.6L', sub: '2 deals confirmed today', tone: 'good' },
    { label: 'Collections', value: '₹4.2L', sub: '1 LC settlement received', tone: 'good' },
    { label: 'Quarter Target Achievement', value: '58%', sub: '₹1.16Cr of ₹2Cr this quarter', tone: 'warn' },
  ],
  beats: [
    { id: 'm1', name: 'Agri Commodities Desk', repName: 'Vikram Iyer', area: 'Domestic + Export Buyers', stopsPlanned: 3, stopsDone: 1 },
    { id: 'm2', name: 'Industrial Raw Materials Desk', repName: 'Vikram Iyer', area: 'Manufacturer Buyers', stopsPlanned: 1, stopsDone: 1 },
  ],
  parties: [
    { id: 'p1', code: 'TRD-7701', name: 'Global Harvest Exports Pte Ltd', type: 'Overseas Buyer', location: 'Singapore (via Chennai Port)', contactPerson: 'Mr. Tan Wei Liang', phone: '+65 8123 4455', email: 'tan.weiliang@globalharvest.sg', whatsappNumber: '+65 8123 4455', outstanding: 420000, creditLimit: 2000000, paymentTermsDays: 45, riskLevel: 'medium', lastOrderDate: '25 Aug 2026', lastOrderValue: 1240000, lcExpiryDate: '2026-09-15', tags: ['Export', 'High Value'], fields: [{ label: 'Currency', value: 'USD' }, { label: 'Incoterm', value: 'FOB Chennai' }, { label: 'LC Ref', value: 'LC-88213/SG' }], history: [{ date: '25 Aug', text: 'Deal closed — Basmati rice, 40ft container', value: '₹12,40,000' }, { date: '10 Aug', text: 'Price negotiation call' }] },
    { id: 'p2', code: 'TRD-7742', name: 'Southern Steel Traders', type: 'Domestic Buyer', location: 'Chennai', contactPerson: 'Mr. Rajendran K.', phone: '94900 11223', email: 'rajendran@southernsteel.in', whatsappNumber: '94900 11223', outstanding: 0, creditLimit: 1500000, paymentTermsDays: 30, riskLevel: 'low', lastOrderDate: '21 Aug 2026', lastOrderValue: 620000, tags: ['Regular'], fields: [{ label: 'Currency', value: 'INR' }, { label: 'Incoterm', value: 'Ex-Works' }, { label: 'LC Ref', value: '—' }], history: [{ date: '21 Aug', text: 'Deal closed — MS billets, 200 MT', value: '₹6,20,000' }] },
    { id: 'p3', code: 'TRD-7788', name: 'Coastal Spice Suppliers', type: 'Supplier', location: 'Tuticorin', contactPerson: 'Mrs. Lakshmi N.', phone: '94800 22334', email: 'lakshmi@coastalspice.in', whatsappNumber: '94800 22334', outstanding: 0, creditLimit: 0, paymentTermsDays: 0, riskLevel: 'low', lastOrderDate: '17 Aug 2026', lastOrderValue: 380000, tags: ['Supplier'], fields: [{ label: 'Currency', value: 'INR' }, { label: 'Incoterm', value: 'FOB Tuticorin' }, { label: 'LC Ref', value: '—' }], history: [{ date: '17 Aug', text: 'Purchase deal — turmeric lot', value: '₹3,80,000' }] },
  ],
  catalog: [
    { id: 'i1', code: 'COM-RIC-01', name: 'Basmati Rice — Grade A', category: 'Agri Commodity', unit: 'MT', price: 68000, stock: 340, reorderLevel: 100, barcode: '9101234500011', attributes: [{ label: 'Shipment Lot', value: 'SHP-2291' }, { label: 'Origin', value: 'Punjab' }] },
    { id: 'i2', code: 'COM-STL-02', name: 'MS Billets — Standard', category: 'Industrial', unit: 'MT', price: 3100, stock: 900, reorderLevel: 200, barcode: '9101234500028', attributes: [{ label: 'Shipment Lot', value: 'SHP-2305' }, { label: 'Origin', value: 'Chennai Mill' }] },
    { id: 'i3', code: 'COM-SPC-03', name: 'Turmeric Finger — Export Grade', category: 'Spice', unit: 'MT', price: 92000, stock: 40, reorderLevel: 50, barcode: '9101234500035', attributes: [{ label: 'Shipment Lot', value: 'SHP-2318' }, { label: 'Origin', value: 'Erode' }] },
  ],
  catalogColumns: [{ key: 'Shipment Lot', label: 'Shipment Lot' }, { key: 'Origin', label: 'Origin' }],
  schemes: [
    { id: 's1', label: '50+ MT', minQty: 50, discountPercent: 3, note: 'Standard bulk terms' },
    { id: 's2', label: '150+ MT', minQty: 150, discountPercent: 6, note: 'Container-load terms' },
    { id: 's3', label: '300+ MT', minQty: 300, discountPercent: 9, note: 'Long-term contract terms' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p2', beatId: 'm2', scheduledTime: '10:00 AM', status: 'completed', purpose: 'Deal negotiation', checkinTime: '10:05 AM', checkinLocation: '13.0475° N, 80.2081° E' },
    { id: 'v2', partyId: 'p1', beatId: 'm1', scheduledTime: '03:00 PM (video)', status: 'checked_in', purpose: 'LC & shipment review', checkinTime: '03:02 PM', checkinLocation: 'Remote — video call' },
    { id: 'v3', partyId: 'p3', beatId: 'm1', scheduledTime: '05:00 PM', status: 'pending', purpose: 'Purchase rate discussion' },
  ],
  targets: [
    { label: 'Quarter Deal Value', achieved: 11600000, target: 20000000, unit: '₹' },
    { label: 'New Buyers Onboarded', achieved: 2, target: 5, unit: '' },
    { label: 'Collection Efficiency', achieved: 66, target: 85, unit: '%' },
  ],
  activity: [
    { id: 'a1', time: '03:02 PM', text: 'Checked in — video call with Global Harvest Exports', kind: 'checkin' },
    { id: 'a2', time: '10:12 AM', text: 'Deal DL-1183 (₹6,20,000) closed with Southern Steel Traders', kind: 'order' },
    { id: 'a3', time: '09:40 AM', text: 'LC settlement of ₹4,20,000 recorded', kind: 'collection' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p1', title: 'Confirm container booking with shipping line', dueDate: '02 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p3', title: 'Finalise turmeric purchase rate', dueDate: '03 Sep 2026', status: 'pending' },
  ],
  automationRules: [
    { id: 'ar1', label: 'Low Stock / Lot Reorder', trigger: 'low_stock', thresholdValue: 50, action: 'auto-flag lot for replenishment sourcing' },
    { id: 'ar2', label: 'Overdue Buyer Payment', trigger: 'overdue_payment', thresholdValue: 15, action: 'escalate to Collections desk and notify manager' },
    { id: 'ar3', label: 'Buyer/Supplier Follow-up', trigger: 'no_visit_days', thresholdValue: 20, action: 'auto-create a trade meeting follow-up' },
    { id: 'ar4', label: 'LC Expiry Tracker', trigger: 'lc_expiry', thresholdValue: 30, action: 'auto-remind Trade Finance team to renew or settle the LC' },
  ],
};

// ---------------------------------------------------------------------------
// VEHICLE
// ---------------------------------------------------------------------------
const vehicle: IndustryConfig = {
  key: 'vehicle',
  label: 'Vehicle',
  tagline: 'Automobile Dealership · Showroom & Field Sales',
  colorVar: '--ind-vehicle',
  terms: {
    repLabel: 'Sales Executive',
    beatLabel: 'Catchment Area',
    beatLabelPlural: 'Catchment Areas',
    partyLabel: 'Customer',
    partyLabelPlural: 'Customers',
    visitLabel: 'Customer Meeting',
    itemLabel: 'Vehicle',
    itemLabelPlural: 'Vehicles',
    orderLabel: 'Booking',
    scanLabel: 'Chassis Scan',
    schemeLabel: 'Exchange / Finance Offer',
    stockLabel: 'Variant / Colour Stock',
  },
  workflow: ['Sales Executive', 'Catchment Area', "Today's Customer Meetings", 'Check-in', 'Customer History', 'Model / Variant Selection', 'Variant & Colour Stock', 'Exchange / Finance Offer', 'Create Booking', 'Collection', 'Follow-up', 'Monthly Target'],
  kpis: [
    { label: "Today's Meetings", value: '3 / 5', sub: '2 test drives remaining', tone: 'default' },
    { label: 'Bookings Value', value: '₹9,85,000', sub: '2 bookings today', tone: 'good' },
    { label: 'Collections', value: '₹1,50,000', sub: '1 booking advance received', tone: 'good' },
    { label: 'Monthly Target Achievement', value: '63%', sub: '19 of 30 units this month', tone: 'warn' },
  ],
  beats: [
    { id: 'c1', name: 'Anna Nagar Catchment', repName: 'Suresh Babu', area: 'Anna Nagar & Kilpauk', stopsPlanned: 3, stopsDone: 2 },
    { id: 'c2', name: 'OMR Catchment', repName: 'Suresh Babu', area: 'OMR IT Corridor', stopsPlanned: 2, stopsDone: 1 },
  ],
  parties: [
    { id: 'p1', code: 'CUS-9001', name: 'Arvind Selvam', type: 'Retail Buyer', location: 'Anna Nagar', contactPerson: 'Arvind Selvam', phone: '99400 11220', outstanding: 0, creditLimit: 0, lastOrderDate: '26 Aug 2026', lastOrderValue: 685000, tags: ['Booking Confirmed'], fields: [{ label: 'Interested Model', value: 'Cruiser X200' }, { label: 'Finance Required', value: 'Yes — 80% loan' }, { label: 'Exchange Vehicle', value: 'Old sedan, 2016 model' }], history: [{ date: '26 Aug', text: 'Booking confirmed — Cruiser X200', value: '₹6,85,000' }, { date: '18 Aug', text: 'Test drive completed' }] },
    { id: 'p2', code: 'CUS-9034', name: 'Priyanka Menon', type: 'Retail Buyer', location: 'Kilpauk', contactPerson: 'Priyanka Menon', phone: '99500 22331', outstanding: 0, creditLimit: 0, lastOrderDate: '—', lastOrderValue: 0, tags: ['Hot Lead'], fields: [{ label: 'Interested Model', value: 'Urban Hatch S' }, { label: 'Finance Required', value: 'Yes — 90% loan' }, { label: 'Exchange Vehicle', value: 'None' }], history: [{ date: '20 Aug', text: 'Showroom visit — variant comparison' }] },
    { id: 'p3', code: 'CUS-9067', name: 'Techsoft Pvt Ltd (Fleet)', type: 'Corporate / Fleet', location: 'OMR', contactPerson: 'Mr. Bala (Admin)', phone: '99600 33442', outstanding: 300000, creditLimit: 2000000, lastOrderDate: '15 Aug 2026', lastOrderValue: 3000000, tags: ['Fleet Deal', 'Payment Due'], fields: [{ label: 'Interested Model', value: 'Cargo Van C400 x5' }, { label: 'Finance Required', value: 'No — direct purchase' }, { label: 'Exchange Vehicle', value: 'None' }], history: [{ date: '15 Aug', text: 'Fleet booking — 5 units Cargo Van', value: '₹30,00,000' }] },
  ],
  catalog: [
    { id: 'i1', code: 'VEH-CRZ-X200', name: 'Cruiser X200 — Sedan', category: 'Sedan', unit: 'Unit', price: 685000, stock: 6, barcode: 'CH-X200-88213', attributes: [{ label: 'Variant', value: 'VXi Top' }, { label: 'Colour', value: 'Pearl White' }, { label: 'Chassis No.', value: 'MA3ERLF1S00214421' }] },
    { id: 'i2', code: 'VEH-UHS-S', name: 'Urban Hatch S', category: 'Hatchback', unit: 'Unit', price: 612000, stock: 11, barcode: 'CH-UHS-88214', attributes: [{ label: 'Variant', value: 'S Plus' }, { label: 'Colour', value: 'Fire Red' }, { label: 'Chassis No.', value: 'MA3ERLF1S00214590' }] },
    { id: 'i3', code: 'VEH-CGV-C400', name: 'Cargo Van C400', category: 'Commercial', unit: 'Unit', price: 600000, stock: 3, barcode: 'CH-C400-88215', attributes: [{ label: 'Variant', value: 'Base' }, { label: 'Colour', value: 'Steel Grey' }, { label: 'Chassis No.', value: 'MA3ERLF1S00214812' }] },
  ],
  catalogColumns: [{ key: 'Variant', label: 'Variant' }, { key: 'Colour', label: 'Colour' }, { key: 'Chassis No.', label: 'Chassis No.' }],
  schemes: [
    { id: 's1', label: 'Single unit — cash', minQty: 1, discountPercent: 2, note: 'Standard cash discount' },
    { id: 's2', label: 'With exchange', minQty: 1, discountPercent: 4, note: 'Exchange bonus offer' },
    { id: 's3', label: 'Fleet — 5+ units', minQty: 5, discountPercent: 8, note: 'Corporate fleet slab' },
  ],
  visitsToday: [
    { id: 'v1', partyId: 'p1', beatId: 'c1', scheduledTime: '10:00 AM', status: 'completed', purpose: 'Booking confirmation', checkinTime: '10:03 AM', checkinLocation: '13.0850° N, 80.2101° E' },
    { id: 'v2', partyId: 'p2', beatId: 'c1', scheduledTime: '12:00 PM', status: 'checked_in', purpose: 'Test drive + variant discussion', checkinTime: '12:04 PM', checkinLocation: '13.0793° N, 80.2412° E' },
    { id: 'v3', partyId: 'p3', beatId: 'c2', scheduledTime: '03:00 PM', status: 'pending', purpose: 'Fleet payment follow-up' },
  ],
  targets: [
    { label: 'Monthly Units Sold', achieved: 19, target: 30, unit: 'units' },
    { label: 'Monthly Sales Value', achieved: 985000 * 12, target: 20000000, unit: '₹' },
    { label: 'Test Drives Converted', achieved: 6, target: 12, unit: '' },
  ],
  activity: [
    { id: 'a1', time: '12:04 PM', text: 'Checked in with Priyanka Menon for test drive', kind: 'checkin' },
    { id: 'a2', time: '10:15 AM', text: 'Booking BK-4471 (₹6,85,000) confirmed for Arvind Selvam', kind: 'order' },
    { id: 'a3', time: '10:03 AM', text: 'Checked in with Arvind Selvam', kind: 'checkin' },
  ],
  followUps: [
    { id: 'f1', partyId: 'p3', title: 'Follow up on ₹3,00,000 pending fleet payment', dueDate: '02 Sep 2026', status: 'pending' },
    { id: 'f2', partyId: 'p2', title: 'Send finance quote for Urban Hatch S', dueDate: '03 Sep 2026', status: 'pending' },
  ],
  automationRules: [],
};

export const INDUSTRY_CONFIGS = { fmcg, school, textile, pharma, trading, vehicle };