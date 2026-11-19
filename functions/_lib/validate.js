// Server-side validation. The browser is never trusted: only product IDs and
// quantities are accepted for items — prices are always read from the database.

export const DISTRICTS = [
  'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur',
  'Chapainawabganj', 'Chattogram', 'Chuadanga', "Cox's Bazar", 'Cumilla', 'Dhaka', 'Dinajpur',
  'Faridpur', 'Feni', 'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore',
  'Jhalokati', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna', 'Kishoreganj', 'Kurigram',
  'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura', 'Manikganj', 'Meherpur',
  'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi',
  'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali',
  'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira', 'Shariatpur', 'Sherpur',
  'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon',
];

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toAsciiDigits(s) {
  return String(s ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Returns a normalized 11-digit Bangladesh mobile number (01XXXXXXXXX) or null. */
export function normalizePhone(input) {
  let s = toAsciiDigits(input).replace(/[\s\-().]/g, '');
  if (s.startsWith('+88')) s = s.slice(3);
  else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // control chars (keep \t \n \r)
    .trim()
    .slice(0, max);

/**
 * @returns {{ ok: boolean, errors?: Record<string,string>, data?: object }}
 */
export function validateOrder(body) {
  const errors = {};

  const name = clean(body.customer?.name, 80);
  if (name.length < 2) errors.name = 'NAME_REQUIRED';

  const phone = normalizePhone(body.customer?.phone);
  if (!phone) errors.phone = 'PHONE_INVALID';

  const address = clean(body.customer?.address, 300);
  if (address.length < 10) errors.address = 'ADDRESS_TOO_SHORT';

  const district = DISTRICTS.find((d) => d.toLowerCase() === String(body.customer?.district ?? '').trim().toLowerCase());
  if (!district) errors.district = 'DISTRICT_INVALID';

  const notes = clean(body.customer?.notes, 500);

  const payment = String(body.paymentMethod ?? '');
  if (!['bkash', 'nagad', 'cod'].includes(payment)) errors.paymentMethod = 'PAYMENT_INVALID';

  let trx = '';
  if (payment === 'bkash' || payment === 'nagad') {
    trx = clean(body.transactionReference, 40).toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(trx)) errors.transactionReference = 'TRX_INVALID';
  }

  const key = String(body.idempotencyKey ?? '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) errors.idempotencyKey = 'KEY_INVALID';

  // Items: merge duplicate IDs, cap quantities, sort by id (stable lock order → no deadlocks).
  const merged = new Map();
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > 30) errors.items = 'ITEMS_INVALID';
  for (const it of rawItems) {
    const id = String(it?.id ?? '');
    const qty = Number(it?.qty);
    if (!UUID_RE.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      errors.items = 'ITEMS_INVALID';
      break;
    }
    merged.set(id.toLowerCase(), (merged.get(id.toLowerCase()) || 0) + qty);
  }
  const items = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, qty]) => ({ id, qty }));
  if (items.some((i) => i.qty > 20)) errors.items = 'ITEMS_INVALID';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      customer: {
        name,
        phone,
        address,
        district,
        notes,
        payment_method: payment,
        transaction_reference: trx,
        language: body.lang === 'bn' ? 'bn' : 'en',
      },
      items,
      key,
    },
  };
}
