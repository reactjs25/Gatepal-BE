const OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);

const OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);

const toCanonicalOccupantType = (value) => {
  const normalized = (value || '').toString().trim();
  if (!normalized) return '';
  const title = normalized
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
    .replace(/^o(wner)?$/, 'owner')
    .replace(/^unitowner$/, 'unitowner')
    .replace(/^(ownerfamily|ownerfamilymember|unitownerfamilymember)$/, 'ownerfamilymember')
    .replace(/^t(enant)?$/, 'tenant')
    .replace(/^(tenantfamily|tenantfamilymember)$/, 'tenantfamilymember');

  const mapping = {
    owner: 'unit_owner',
    unitowner: 'unit_owner',
    ownerfamilymember: 'unit_owner_family_member',
    tenant: 'tenant',
    tenantfamilymember: 'tenant_family_member',
  };

  const canonical = mapping[title] || value;
  return OCCUPANT_TYPES.has(canonical) ? canonical : '';
};

const toCanonicalOccupancyStatus = (value) => {
  const normalized = (value || '').toString().trim();
  if (!normalized) return '';
  const title = normalized
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
    .replace(/^(currentlyresiding)$/, 'currentlyresiding')
    .replace(/^(unitrented|rented)$/, 'unitrented')
    .replace(/^(unitvacant|vacant)$/, 'unitvacant')
    .replace(/^occupied$/, 'currentlyresiding');

  const mapping = {
    currentlyresiding: 'currently_residing',
    unitrented: 'unit_rented',
    unitvacant: 'unit_vacant',
  };

  const canonical = mapping[title] || value;
  return OCCUPANCY_STATUSES.has(canonical) ? canonical : '';
};

const mapUiToCanonicalOccupancy = (value) => {
  const v = (value || '').toString().trim().toLowerCase();
  if (v === 'owner_is_residing') return 'currently_residing';
  if (v === 'unit_is_empty') return 'unit_vacant';
  if (v === 'unit_is_rented_out') return 'unit_rented';
  return '';
};

module.exports = {
  OCCUPANT_TYPES,
  OCCUPANCY_STATUSES,
  toCanonicalOccupantType,
  toCanonicalOccupancyStatus,
  mapUiToCanonicalOccupancy,
};

