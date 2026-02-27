const TAXI_DRIVER_COMPANIES = [
  { id: 'ola', name: 'Ola', imageUrl: '/assets/Ola.png' },
  { id: 'uber', name: 'Uber', imageUrl: '/assets/Uber.jpg' },
  { id: 'meru', name: 'Meru', imageUrl: '/assets/Meru.jpg' },
  { id: 'rapido', name: 'Rapido', imageUrl: '/assets/Rapido.jpg' },
];

const TAXI_COMPANY_BY_LOWER = new Map(
  TAXI_DRIVER_COMPANIES.map((company) => [company.name.toLowerCase(), company])
);

const normalizeCompanyName = (value) => (value || '').toString().trim();

const getTaxiCompanyDisplayName = (value) => {
  const normalized = normalizeCompanyName(value).toLowerCase();
  return TAXI_COMPANY_BY_LOWER.get(normalized)?.name || null;
};

const isAllowedTaxiCompanyName = (value) => Boolean(getTaxiCompanyDisplayName(value));

const getTaxiCompanyInfo = (value) => {
  const normalized = normalizeCompanyName(value).toLowerCase();
  return TAXI_COMPANY_BY_LOWER.get(normalized) || null;
};

module.exports = {
  TAXI_DRIVER_COMPANIES,
  normalizeCompanyName,
  getTaxiCompanyDisplayName,
  isAllowedTaxiCompanyName,
  getTaxiCompanyInfo,
};
