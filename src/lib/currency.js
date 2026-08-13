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

// US Dollar formatter — used by the Saham (stocks) menu for USD prices.
export function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(amount || 0)
}

// Round up to the nearest whole rupiah (used for "Biaya Per Kwh").
export function ceilRupiah(n) {
  return Math.ceil(n || 0)
}

// "Rp 20,000,000" / "$ 265.46" — space-separated style used specifically by
// the Saham (stocks) and dividend tables. Kept separate from formatIDR/
// formatUSD above so the existing look of Expenses/Dashboard/Kontrakan is
// untouched.
export function formatRpSpaced(amount) {
  return `Rp ${Math.round(amount || 0).toLocaleString('en-US')}`
}

export function formatUsdSpaced(amount) {
  return `$ ${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
