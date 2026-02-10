const ACTION_TYPES = ['WRONG_ENTRY', 'DENY_ENTRY', 'DELETE_PRE_APPROVAL'];

const ACTION_REASONS = {
  WRONG_ENTRY: [
    'Entered wrong flat',
    'Unauthorized person',
    'Duplicate entry',
    'Other',
  ],
  DENY_ENTRY: [
    'Not expecting visitor',
    'Unknown person',
    'Not available at home',
    'Other',
  ],
  DELETE_PRE_APPROVAL: [
    'Plans changed',
    'Created by mistake',
    'Visitor already arrived',
    'Other',
  ],
};

module.exports = {
  ACTION_TYPES,
  ACTION_REASONS,
};
