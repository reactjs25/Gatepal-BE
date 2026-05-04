
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

const DeliveryCompany = require('../model/deliveryCompanySchema');

const DEFAULT_LOGO_URL = '/assets/Default.png';
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const DELIVERY_COMPANIES = [
  'Airtel',
  'Akshayakalpa',
  'Amazon',
  'Amazon Now',
  'Apollo 24/7',
  'Bharat Gas',
  'Bigbasket',
  'Bistro',
  'Blinkit',
  'Blue Dart',
  'Box8',
  'Delhivery',
  'DHL',
  'DMart',
  'Dominos Pizza',
  'DTDC',
  'Eatclub',
  'Eatfit',
  'Ecom Express',
  'Faasos',
  'FedEx',
  'Firstcry',
  'Flipkart',
  'Food Panda',
  'Freshmenu',
  'Freshtohome',
  'Gati',
  'Handpickd',
  'HDFC Bank',
  'HP Gas',
  'Indane',
  'India Post',
  'Instamaid By Urban Company',
  'Instamart',
  'Jio',
  'Jio Mart',
  'Lenskart',
  'Licious',
  'Milkbasket',
  'Myntra',
  'Ozi',
  'Paytm',
  'PharmEasy',
  'Pickily',
  'Pizza Hut',
  'Porter',
  'Pronto',
  'Pync.',
  'Shadowfax',
  'Snabbit',
  'Snacc',
  'Snapdeal',
  'Supr',
  'Swiggy',
  'Tata 1mg',
  'Tata Play',
  'Uber Courier',
  'Urban Company',
  'Xpressbees',
  'Zepto',
  'Zomato',
];

const toId = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const buildLogoLookup = () => {
  const lookup = new Map();

  try {
    const files = fs.readdirSync(ASSETS_DIR, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile()) continue;

      const extension = path.extname(file.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;

      const imageId = toId(path.basename(file.name, extension));
      if (!imageId || imageId === 'default') continue;

      lookup.set(imageId, `/assets/${file.name}`);
    }
  } catch (err) {
    console.warn(`Could not read assets directory. Falling back to default logos: ${err.message}`);
  }

  return lookup;
};

const seed = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const logoLookup = buildLogoLookup();
    const docs = DELIVERY_COMPANIES.map((name) => {
      const id = toId(name);

      return {
        id,
        name,
        imageUrl: logoLookup.get(id) || DEFAULT_LOGO_URL,
      };
    });

    const allowedIds = docs.map((doc) => doc.id);

    // 🔴 Remove companies not in script
    const deleted = await DeliveryCompany.deleteMany({
      id: { $nin: allowedIds },
    });

    console.log(`Removed ${deleted.deletedCount} companies not in seed list`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        await DeliveryCompany.create(doc);
        inserted++;
        console.log(`Inserted: ${doc.name}`);
      } catch (err) {
        if (err.code === 11000) {
          const update = await DeliveryCompany.updateOne(
            { $or: [{ id: doc.id }, { name: doc.name }] },
            { $set: doc }
          );

          if (update.modifiedCount > 0) {
            updated++;
            console.log(`Updated: ${doc.name}`);
          } else {
            skipped++;
            console.log(`Skipped (already current): ${doc.name}`);
          }
        } else {
          console.error(`Error inserting ${doc.name}:`, err.message);
        }
      }
    }

    console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('Failed to seed delivery companies:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seed();
