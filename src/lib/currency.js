// Central currency formatter — Indonesian Rupiah, no decimals (Rupiah is
// conventionally shown as whole numbers in everyday use).
export function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0)
}

// Plain thousand-separated number, no "Rp" prefix — used inside the
// WhatsApp-style rent reminder text where "Rp" is added manually.
export function formatNumberID(amount) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount || 0)
}

// Round up to the nearest whole rupiah (used for "Biaya Per Kwh").
export function ceilRupiah(n) {
  return Math.ceil(n || 0)
}
