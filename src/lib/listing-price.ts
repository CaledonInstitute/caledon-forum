export const formatPrice = (price: number) =>
  price === 0 ? "Free" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(price);
