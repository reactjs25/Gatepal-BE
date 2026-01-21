const OTHER_VISITOR_COMPANIES = [
  { id: 'urban_company', name: 'Urban Company', imageUrl: '/assets/Urban_Company.png' },
  { id: 'jio', name: 'Jio', imageUrl: '/assets/Jio.jpg' },
  { id: 'tata_sky', name: 'Tata Sky', imageUrl: '/assets/Tata_sky.png' },
  { id: 'airtel', name: 'Airtel', imageUrl: '/assets/Airtel.jpg' },
];

const OTHER_VISITOR_COMPANY_BY_LOWER = new Map(
  OTHER_VISITOR_COMPANIES.map((company) => [company.name.toLowerCase(), company])
);

const normalizeCompanyName = (value) => (value || '').toString().trim();

const getOtherVisitorCompanyInfo = (value) => {
  const normalized = normalizeCompanyName(value).toLowerCase();
  return OTHER_VISITOR_COMPANY_BY_LOWER.get(normalized) || null;
};

module.exports = {
  OTHER_VISITOR_COMPANIES,
  normalizeCompanyName,
  getOtherVisitorCompanyInfo,
};
