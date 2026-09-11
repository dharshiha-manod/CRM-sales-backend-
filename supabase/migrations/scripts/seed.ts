/**
 * Seeds a realistic, internally-consistent demo dataset for the Field Sales
 * CRM (organizations -> industry_types -> clients/products -> field_visits ->
 * orders/collections/follow-ups, plus leads and requirements/quotations).
 *
 * Auth users can't be created with plain SQL (managed by Supabase Auth), so
 * this runs through supabase-js with the service-role key -- the same client
 * the API itself uses (src/lib/supabase.ts) and the same pattern
 * user-management.repository.ts already uses for createUser().
 *
 * Usage:
 *   1. Run all migrations in supabase/migrations first (via `supabase db
 *      push` or pasting them into the SQL editor, in filename order).
 *   2. Ensure .env has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set.
 *   3. npx tsx scripts/seed.ts
 *
 * Safe to re-run: it creates one new organization each run (slug includes a
 * timestamp) rather than mutating existing data.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.');
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Deterministic PRNG so re-reading this script's output stays legible.
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function int(min: number, max: number) { return Math.floor(rand() * (max - min + 1)) + min; }
function daysAgo(n: number, hour = 10) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, int(0, 59), 0, 0); return d; }
function must<T>(row: T | null | undefined, label: string): T { if (!row) throw new Error(`Seed step failed: ${label}`); return row; }

async function insert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], select = '*'): Promise<T[]> {
  const { data, error } = await db.from(table).insert(rows).select(select);
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  return data as T[];
}

async function upsert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], onConflict: string, select = '*'): Promise<T[]> {
  const { data, error } = await db.from(table).upsert(rows, { onConflict }).select(select);
  if (error) throw new Error(`upsert into ${table} failed: ${error.message}`);
  return data as T[];
}

const INDUSTRIES = [
  { code: 'fmcg', name: 'FMCG' },
  { code: 'pharma', name: 'Pharma' },
  { code: 'textile', name: 'Textile' },
  { code: 'trading', name: 'Trading' },
  { code: 'school', name: 'School' },
];

const CITIES = [
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lng: 76.9558 },
  { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { city: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lng: 78.1198 },
  { city: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
];

const CLIENT_NAMES: Record<string, string[]> = {
  fmcg: ['Sri Lakshmi General Stores', 'Annapurna Super Market', 'Kaveri Distributors', 'Vijay Wholesale Traders', 'Sree Ganesh Provisions', 'Coastal FreshMart'],
  pharma: ['Apollo Care Pharmacy', 'MedPlus Junction Branch', 'Sri Ramana Medicals', 'Wellness Forte Pharmacy', 'City Care Chemists', 'Sundaram Health Store'],
  textile: ['Kanchi Silks Emporium', 'Sundaram Textiles', 'Radhika Fabrics', 'Chennai Cotton House', 'Meenakshi Weavers Co-op', 'Nalli Fashion Fabrics'],
  trading: ['Bharat Steel Traders', 'Om Sakthi Hardware Trading', 'Sri Balaji Enterprises', 'Coromandel Trading Co', 'Vishnu Industrial Supplies', 'Anand Impex'],
  school: ['St. Xavier Matriculation School', 'Vidya Mandir School', 'Chinmaya Vidyalaya', 'Kendriya Vidyalaya Branch', 'Bharath Public School', 'Little Flower Convent School'],
};

const PRODUCTS: Record<string, { code: string; name: string; category: string; price: number; cost: number }[]> = {
  fmcg: [
    { code: 'FM-001', name: 'Sunrise Refined Sunflower Oil 1L', category: 'Edible Oil', price: 165, cost: 138 },
    { code: 'FM-002', name: 'GoldenGrain Basmati Rice 5kg', category: 'Staples', price: 620, cost: 540 },
    { code: 'FM-003', name: 'DailyFresh Toor Dal 1kg', category: 'Pulses', price: 148, cost: 122 },
    { code: 'FM-004', name: 'SoapWorks Sandal Bathing Bar 100g', category: 'Personal Care', price: 42, cost: 31 },
    { code: 'FM-005', name: 'MorningCup Instant Coffee 200g', category: 'Beverages', price: 285, cost: 232 },
    { code: 'FM-006', name: 'CrispyBite Banana Chips 200g', category: 'Snacks', price: 60, cost: 44 },
  ],
  pharma: [
    { code: 'PH-001', name: 'Paracetamol 500mg Strip of 15', category: 'Analgesic', price: 22, cost: 14 },
    { code: 'PH-002', name: 'Cetirizine 10mg Strip of 10', category: 'Antihistamine', price: 18, cost: 11 },
    { code: 'PH-003', name: 'ORS Rehydration Sachet', category: 'Rehydration', price: 12, cost: 7 },
    { code: 'PH-004', name: 'Amoxicillin 500mg Strip of 10', category: 'Antibiotic', price: 65, cost: 47 },
    { code: 'PH-005', name: 'Multivitamin Syrup 200ml', category: 'Supplement', price: 145, cost: 108 },
    { code: 'PH-006', name: 'Digital Thermometer', category: 'Devices', price: 210, cost: 150 },
  ],
  textile: [
    { code: 'TX-001', name: 'Cotton Voile Fabric per Metre', category: 'Fabric', price: 145, cost: 98 },
    { code: 'TX-002', name: 'Kanjivaram Silk Saree', category: 'Saree', price: 8500, cost: 6200 },
    { code: 'TX-003', name: 'Khadi Kurta Fabric per Metre', category: 'Fabric', price: 210, cost: 155 },
    { code: 'TX-004', name: 'Cotton Bedsheet Double', category: 'Home Textile', price: 950, cost: 690 },
    { code: 'TX-005', name: 'Poly-Cotton Shirting per Metre', category: 'Fabric', price: 165, cost: 118 },
  ],
  trading: [
    { code: 'TR-001', name: 'MS Steel Rod 12mm per Tonne', category: 'Steel', price: 62000, cost: 55500 },
    { code: 'TR-002', name: 'GI Pipe 1 inch per Metre', category: 'Pipes', price: 185, cost: 148 },
    { code: 'TR-003', name: 'Industrial Cable 2.5sqmm per Metre', category: 'Electrical', price: 42, cost: 31 },
    { code: 'TR-004', name: 'PVC Sheet 8x4 per Piece', category: 'Sheets', price: 1450, cost: 1120 },
    { code: 'TR-005', name: 'Cement OPC 43 Grade 50kg Bag', category: 'Cement', price: 415, cost: 372 },
  ],
  school: [
    { code: 'SC-001', name: 'Interactive Smart Board 65-inch', category: 'EdTech', price: 118000, cost: 96000 },
    { code: 'SC-002', name: 'Science Lab Kit - Grade 9', category: 'Lab Equipment', price: 24500, cost: 19800 },
    { code: 'SC-003', name: 'School Uniform Set (per student)', category: 'Uniform', price: 850, cost: 640 },
    { code: 'SC-004', name: 'Library Books Bundle (50 titles)', category: 'Library', price: 12500, cost: 9800 },
    { code: 'SC-005', name: 'Student Notebook Pack of 6', category: 'Stationery', price: 210, cost: 158 },
  ],
};

const FIRST_NAMES = ['Arjun', 'Priya', 'Karthik', 'Divya', 'Suresh', 'Meena', 'Ramesh', 'Lakshmi', 'Vignesh', 'Anitha', 'Senthil', 'Deepa', 'Mohan', 'Kavya', 'Balaji'];
const LAST_NAMES = ['Kumar', 'Raman', 'Iyer', 'Nair', 'Pillai', 'Reddy', 'Sharma', 'Krishnan', 'Rajan', 'Murthy'];
function fullName() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }
function phone() { return `9${int(400000000, 899999999)}`; }

async function main() {
  const runTag = Date.now().toString(36);
  console.log(`Seeding organization "Manod Field Sales Demo" (${runTag})...`);

  // 1. Organization
  const [org] = await insert('organizations', [{ name: 'Manod Field Sales Demo', slug: `manod-field-sales-demo-${runTag}` }]);
  const orgId = org.id as string;
  console.log(`organization_id = ${orgId}  <-- put this in VITE_ORGANIZATION_ID`);

  // 2. Roles (seeded by migration 1 already; fetch ids)
  const { data: roles } = await db.from('roles').select('id, code');
  const roleId = (code: string) => must(roles!.find((r) => r.code === code), `role ${code}`).id as string;

  // 3. Industry types
  const industryRows = await insert<{ id: string; code: string }>('industry_types', INDUSTRIES.map((i) => ({ organization_id: orgId, code: i.code, name: i.name, status: 'active' })));
  const industryIdByCode = Object.fromEntries(industryRows.map((r) => [r.code, r.id]));

  // 4. Users: 1 super admin, 1 admin, 1 sales manager, 2 reps per industry (10 reps)
  async function createOrgUser(displayName: string, email: string, roleCode: string) {
    const { data: created, error } = await db.auth.admin.createUser({ email, password: 'Demo12345!', email_confirm: true, user_metadata: { display_name: displayName } });
    if (error) throw new Error(`createUser ${email} failed: ${error.message}`);
    const userId = must(created.user, `auth user ${email}`).id;
    await upsert('user_profiles', [{ id: userId, display_name: displayName }], 'id');
    await insert('organization_memberships', [{ organization_id: orgId, user_id: userId, role_id: roleId(roleCode), status: 'active' }]);
    return userId;
  }

  await createOrgUser('Admin - Manod', `admin+${runTag}@manodtech.demo`, 'super_admin');
  await createOrgUser('Sales Manager - Priya Ramesh', `manager+${runTag}@manodtech.demo`, 'sales_manager');

  const reps: { id: string; userId: string; name: string; industryCode: string }[] = [];
  let repSeq = 1;
  for (const industry of INDUSTRIES) {
    for (let i = 0; i < 2; i += 1) {
      const name = fullName();
      const email = `rep${repSeq}+${runTag}@manodtech.demo`;
      const userId = await createOrgUser(name, email, 'sales_representative');
      const [repRow] = await insert<{ id: string }>('sales_representatives', [{
        organization_id: orgId, user_id: userId, employee_code: `EMP-${String(repSeq).padStart(3, '0')}`,
        phone: phone(), email, designation: pick(['Field Sales Executive', 'Territory Sales Officer', 'Senior Sales Executive']),
        joining_date: daysAgo(int(120, 900)).toISOString().slice(0, 10), status: 'active',
      }]);
      await insert('sales_representative_industry_types', [{ organization_id: orgId, sales_representative_id: repRow.id, industry_type_id: industryIdByCode[industry.code] }]);
      reps.push({ id: repRow.id, userId, name, industryCode: industry.code });
      repSeq += 1;
    }
  }
  console.log(`Created ${reps.length} sales representatives.`);

  // 5. Products per industry, tagged
  const productsByIndustry: Record<string, { id: string; selling_price: number }[]> = {};
  for (const industry of INDUSTRIES) {
    const rows = await insert<{ id: string; selling_price: number }>('products', PRODUCTS[industry.code].map((p) => ({
      organization_id: orgId, product_code: p.code, product_name: p.name, category: p.category,
      selling_price: p.price, cost_price: p.cost, stock_quantity: int(50, 800), status: 'active',
    })));
    // Note: product_industry_types table doesn't exist in the real database
    // (the migration that defines it never actually created it there), so
    // this linking step is skipped. Products are still tagged per-industry
    // via the productsByIndustry map used later in the script.
    productsByIndustry[industry.code] = rows;
  }
  console.log(`Created products across ${INDUSTRIES.length} industries.`);

  // 6. Clients per industry
  const clients: { id: string; industryCode: string; repId: string; latitude: number; longitude: number }[] = [];
  for (const industry of INDUSTRIES) {
    const industryReps = reps.filter((r) => r.industryCode === industry.code);
    const names = CLIENT_NAMES[industry.code];
    for (let i = 0; i < names.length; i += 1) {
      const loc = pick(CITIES);
      const rep = industryReps[i % industryReps.length];
      const [client] = await insert<{ id: string; latitude: number; longitude: number }>('clients', [{
        organization_id: orgId, client_code: `${industry.code.toUpperCase()}-CL-${String(i + 1).padStart(3, '0')}`,
        client_name: names[i], client_type: industry.code === 'school' ? 'institution' : pick(['retailer', 'wholesaler', 'distributor']),
        industry_type_id: industryIdByCode[industry.code],
        outlet_type: industry.code === 'school' ? 'institution' : pick(['retailer', 'wholesaler', 'distributor']),
        credit_limit: int(10, 200) * 1000, credit_days: pick([15, 30, 45, 60]),
        phone: phone(), email: null, address: `${int(1, 200)}, ${pick(['Anna Salai', 'Gandhi Road', 'MG Road', 'Market Street', 'Bazaar Road'])}`,
        city: loc.city, state: loc.state, country: 'India', postal_code: `${int(600001, 641050)}`,
        latitude: loc.lat + (rand() - 0.5) * 0.05, longitude: loc.lng + (rand() - 0.5) * 0.05, gps_radius_meters: 150,
        priority: pick(['normal', 'normal', 'high', 'low']), status: 'active',
      }]);
      await insert('client_contacts', [{
        organization_id: orgId, client_id: client.id, name: fullName(), designation: pick(['Owner', 'Purchase Manager', 'Store Manager']),
        phone: phone(), is_primary: true,
      }]);
      await insert('sales_representative_client_assignments', [{ organization_id: orgId, sales_representative_id: rep.id, client_id: client.id, status: 'active' }]);
      clients.push({ id: client.id, industryCode: industry.code, repId: rep.id, latitude: client.latitude, longitude: client.longitude });
    }
  }
  console.log(`Created ${clients.length} clients with contacts and rep assignments.`);

  // 7. Field visits (past 14 days), mostly checked_out, a few live
  const visits: { id: string; clientId: string; repId: string; industryCode: string; status: string }[] = [];
  for (let day = 13; day >= 0; day -= 1) {
    const visitsToday = day === 0 ? int(3, 5) : int(1, 4);
    for (let v = 0; v < visitsToday; v += 1) {
      const client = pick(clients);
      const rep = must(reps.find((r) => r.id === client.repId), 'rep for client');
      const isLive = day === 0 && v === 0;
      const checkIn = daysAgo(day, int(9, 17));
      const jitter = () => (rand() - 0.5) * 0.001;
      const insertRow: Record<string, unknown> = {
        organization_id: orgId, representative_id: rep.id, client_id: client.id,
        status: isLive ? 'checked_in' : 'checked_out',
        check_in_time: checkIn.toISOString(),
        check_in_lat: client.latitude + jitter(), check_in_lng: client.longitude + jitter(),
        check_in_accuracy_meters: int(5, 25), check_in_distance_meters: int(10, 90), check_in_within_geofence: true,
        notes: pick(['Discussed new stock requirements.', 'Routine order collection visit.', 'Introduced new product line.', 'Follow-up on pending payment.', null]),
      };
      if (!isLive) {
        const checkOut = new Date(checkIn.getTime() + int(20, 70) * 60000);
        Object.assign(insertRow, {
          check_out_time: checkOut.toISOString(), check_out_lat: client.latitude + jitter(), check_out_lng: client.longitude + jitter(),
          check_out_accuracy_meters: int(5, 25), check_out_distance_meters: int(10, 90), check_out_within_geofence: true,
          outcome: pick(['sale_made', 'sale_made', 'follow_up_needed', 'no_interest']),
        });
      }
            const checkedInRow = { ...insertRow };
      delete (checkedInRow as Record<string, unknown>).check_out_time;
      delete (checkedInRow as Record<string, unknown>).check_out_lat;
      delete (checkedInRow as Record<string, unknown>).check_out_lng;
      delete (checkedInRow as Record<string, unknown>).check_out_accuracy_meters;
      delete (checkedInRow as Record<string, unknown>).check_out_distance_meters;
      delete (checkedInRow as Record<string, unknown>).check_out_within_geofence;
      delete (checkedInRow as Record<string, unknown>).outcome;
      checkedInRow.status = 'checked_in';

      const [visit] = await insert<{ id: string }>('field_visits', [checkedInRow]);
      await insert('visit_activities', [{
        organization_id: orgId, visit_id: visit.id, representative_id: rep.id,
        person_met: fullName(), designation: pick(['Owner', 'Purchase Manager', 'Store Manager']),
        purpose: pick(['Order booking', 'Relationship visit', 'Payment collection', 'New product pitch']),
        expected_value: int(2, 40) * 1000,
      }]);

      if (!isLive) {
        await db.from('field_visits').update({
          status: insertRow.status,
          check_out_time: (insertRow as Record<string, unknown>).check_out_time,
          check_out_lat: (insertRow as Record<string, unknown>).check_out_lat,
          check_out_lng: (insertRow as Record<string, unknown>).check_out_lng,
          check_out_accuracy_meters: (insertRow as Record<string, unknown>).check_out_accuracy_meters,
          check_out_distance_meters: (insertRow as Record<string, unknown>).check_out_distance_meters,
          check_out_within_geofence: (insertRow as Record<string, unknown>).check_out_within_geofence,
          outcome: (insertRow as Record<string, unknown>).outcome,
        }).eq('id', visit.id);
      }
      visits.push({ id: visit.id, clientId: client.id, repId: rep.id, industryCode: client.industryCode, status: insertRow.status as string });
    }
  }
  console.log(`Created ${visits.length} field visits (with visit activities).`);

  // 8. Orders + items from ~60% of visits whose outcome implies a sale
  const orders: { id: string; clientId: string; repId: string; totalAmount: number }[] = [];
  for (const visit of visits) {
    if (rand() > 0.55) continue;
    const products = productsByIndustry[visit.industryCode];
    const itemCount = int(1, 3);
    const chosen = Array.from({ length: itemCount }, () => pick(products));
    const lines = chosen.map((p) => {
      const quantity = int(1, 10);
      const unitPrice = Number(p.selling_price);
      const discountAmount = Math.round(unitPrice * quantity * pick([0, 0, 0.02, 0.05])) ;
      return { product_id: p.id, quantity, unit_price: unitPrice, discount_amount: discountAmount, subtotal: unitPrice * quantity - discountAmount };
    });
    const totalAmount = lines.reduce((s, l) => s + l.subtotal, 0);
    const discountAmount = lines.reduce((s, l) => s + l.discount_amount, 0);
    const orderNumber = `FS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${visit.id.slice(0, 8).toUpperCase()}`;
    const [order] = await insert<{ id: string }>('sale_orders', [{
      organization_id: orgId, order_number: orderNumber, visit_id: visit.id, client_id: visit.clientId, representative_id: visit.repId,
      discount_amount: discountAmount, total_amount: totalAmount, status: 'confirmed',
      created_at: (await db.from('field_visits').select('check_in_time').eq('id', visit.id).single()).data?.check_in_time,
    }]);
    await insert('sale_order_items', lines.map((l) => ({ ...l, order_id: order.id })));
    orders.push({ id: order.id, clientId: visit.clientId, repId: visit.repId, totalAmount });
  }
  console.log(`Created ${orders.length} orders with line items.`);

  // 9. Collections against ~70% of orders (partial or full)
  let collectionCount = 0;
  for (const order of orders) {
    if (rand() > 0.7) continue;
    const full = rand() > 0.4;
    const amount = full ? order.totalAmount : Math.round(order.totalAmount * pick([0.3, 0.5, 0.6]));
    await insert('sales_collections', [{
      organization_id: orgId, client_id: order.clientId, representative_id: order.repId, sale_order_id: order.id,
      amount, mode: pick(['cash', 'upi', 'bank_transfer', 'cheque']), reference_no: pick([null, `REF${int(100000, 999999)}`]),
    }]);
    collectionCount += 1;
  }
  console.log(`Created ${collectionCount} collections.`);

  // 10. Follow-ups from checked_out visits (~50%)
  let followUpCount = 0;
  for (const visit of visits) {
    if (visit.status !== 'checked_out' || rand() > 0.5) continue;
    const dueAt = new Date(Date.now() + int(-2, 10) * 86400000);
    await insert('follow_ups', [{
      organization_id: orgId, representative_id: visit.repId, client_id: visit.clientId, visit_id: visit.id,
      title: pick(['Confirm reorder quantity', 'Collect pending payment', 'Share new catalogue', 'Discuss scheme discount', 'Site revisit for demo']),
      due_at: dueAt.toISOString(), priority: pick(['low', 'normal', 'normal', 'high']),
      status: dueAt.getTime() < Date.now() - 86400000 ? pick(['pending', 'completed']) : 'pending',
    }]);
    followUpCount += 1;
  }
  console.log(`Created ${followUpCount} follow-ups.`);

  // 11. Leads (not yet converted to clients) across industries
  // lead_code is required (not null) and no migration we have defines an
  // auto-generation trigger for it, so we generate it here to be safe.
  const leadYYMM = new Date().toISOString().slice(2, 7).replace('-', '');
  let leadCount = 0;
  for (const industry of INDUSTRIES) {
    const industryReps = reps.filter((r) => r.industryCode === industry.code);
    for (let i = 0; i < 4; i += 1) {
      const rep = pick(industryReps);
      leadCount += 1;
      const leadCode = `LD-${leadYYMM}-${String(leadCount).padStart(5, '0')}`;
      await insert('leads', [{
        organization_id: orgId, industry_type_id: industryIdByCode[industry.code], representative_id: rand() > 0.2 ? rep.id : null,
        lead_code: leadCode,
        company_name: `${pick(['New', 'Sri', 'Modern', 'City'])} ${pick(CLIENT_NAMES[industry.code]).split(' ')[0]} ${pick(['Traders', 'Enterprises', 'Associates'])}`,
        contact_name: fullName(), phone: phone(), city: pick(CITIES).city, state: pick(CITIES).state,
        source: pick(['referral', 'cold_call', 'walk_in', 'website', 'exhibition']),
        priority: pick(['low', 'normal', 'normal', 'high']),
        status: pick(['new', 'new', 'contacted', 'qualified', 'unqualified', 'lost']),
        notes: pick([null, 'Interested, needs pricing follow-up.', 'Requested product catalogue.']),
      }]);
    }
  }
  console.log(`Created ${leadCount} leads.`);

  // 12. Requirements -> quotations (some converted to orders)
  let requirementCount = 0;
  let quotationCount = 0;
  for (let i = 0; i < 15; i += 1) {
    const client = pick(clients);
    const rep = must(reps.find((r) => r.id === client.repId), 'rep for requirement client');
    const products = productsByIndustry[client.industryCode];
    const [requirement] = await insert<{ id: string }>('requirements', [{
      organization_id: orgId, representative_id: rep.id, client_id: client.id,
      title: pick(['Bulk stock requirement', 'New season order plan', 'Festival season restock', 'Institutional supply requirement']),
      urgency: pick(['low', 'normal', 'high']), target_date: daysAgo(-int(5, 30)).toISOString().slice(0, 10),
    }]);
    const itemProducts = Array.from({ length: int(1, 3) }, () => pick(products));
    await insert('requirement_items', itemProducts.map((p) => ({ requirement_id: requirement.id, product_id: p.id, quantity: int(5, 50) })));
    requirementCount += 1;

    if (rand() > 0.4) {
      const lines = itemProducts.map((p) => {
        const quantity = int(5, 50);
        const unitPrice = Number(p.selling_price);
        const discountPercent = pick([0, 5, 10]);
        const discountAmount = Math.round((unitPrice * quantity * discountPercent) / 100);
        return { product_id: p.id, quantity, unit_price: unitPrice, discount_percent: discountPercent, discount_amount: discountAmount, subtotal: unitPrice * quantity - discountAmount };
      });
      const totalAmount = lines.reduce((s, l) => s + l.subtotal, 0);
      const discountAmount = lines.reduce((s, l) => s + l.discount_amount, 0);
      const quotationNumber = `QT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${requirement.id.slice(0, 8).toUpperCase()}`;
      const status = pick(['sent', 'accepted', 'rejected', 'sent']);
      const [quotation] = await insert('quotations', [{
        organization_id: orgId, quotation_number: quotationNumber, client_id: client.id, representative_id: rep.id, requirement_id: requirement.id,
        valid_until: daysAgo(-14).toISOString().slice(0, 10), discount_amount: discountAmount, total_amount: totalAmount, status,
      }]);
      await insert('quotation_items', lines.map((l) => ({ ...l, quotation_id: quotation.id })));
      await db.from('requirements').update({ status: 'quoted' }).eq('id', requirement.id);
      quotationCount += 1;
    }
  }
  console.log(`Created ${requirementCount} requirements and ${quotationCount} quotations.`);

  // 13. Telephony calls (mostly recent, for "calls today" dashboard panel)
  let callCount = 0;
  for (let i = 0; i < 25; i += 1) {
    const client = pick(clients);
    const rep = must(reps.find((r) => r.id === client.repId), 'rep for call client');
    const day = i < 10 ? 0 : int(0, 6);
       await insert('telephony_calls', [{
      organization_id: orgId, client_id: client.id, representative_id: rep.id,
      direction: pick(['inbound', 'outbound']), phone_number: phone(),
         status: pick(['completed', 'completed', 'missed', 'missed']),
      started_at: daysAgo(day, int(9, 19)).toISOString(), duration_seconds: int(30, 600),
      provider: 'demo',
    }]);
    callCount += 1;
  }
  console.log(`Created ${callCount} telephony calls.`);

  console.log('\nSeed complete.');
  console.log(`Set VITE_ORGANIZATION_ID=${orgId} in admin/.env and sign in as one of the seeded users (password: Demo12345!).`);
}

main().catch((error) => { console.error(error); process.exit(1); });