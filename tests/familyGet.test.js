const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../model/userSchema');
const MemberUnit = require('../model/memberUnitSchema');
const FamilyMember = require('../model/familyMemberSchema');
const { getFamilyMembersByUnit } = require('../controller/member/familyController');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gatepal_test_family_get';

const mockRes = () => {
  const store = { status: 0, body: null };
  return {
    status(code) { store.status = code; return this; },
    json(payload) { store.body = payload; },
    get data() { return store; },
  };
};

const run = async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
  } catch (e) {
    console.log('SKIP: MongoDB not available, get test skipped');
    return;
  }

  await mongoose.connection.db.dropDatabase();

  const user = await User.create({ countryCode: '+91', phoneNumber: '9222222222', password: 'Pass12345!', role: 'member' });
  const unit = await MemberUnit.create({ memberId: user._id, societyId: new mongoose.Types.ObjectId(), wingName: 'A', wingNameLower: 'a', unitNumber: '101', unitNumberLower: '101', occupantType: 'unit_owner', occupancyStatus: 'currently_residing' });
  await FamilyMember.create({ unitId: unit._id, createdByUserId: user._id, category: 'child', name: 'Kid', status: 'Inactive on GatePal' });

  const req = { appUser: user, params: { id: String(unit._id) } };
  const res = mockRes();
  await getFamilyMembersByUnit(req, res, (err) => { if (err) throw err; });
  assert.strictEqual(res.data.status, 200);
  assert.ok(Array.isArray(res.data.body.data));
  console.log('Get family by unit test passed');

  await mongoose.disconnect();
};

run().catch((e) => { console.error('Get family test failed', e); process.exitCode = 1; });

