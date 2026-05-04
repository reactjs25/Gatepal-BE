/**
 * Seed script to insert delivery companies into MongoDB
 * and remove any companies not present in this list.
 *
 * Usage:
 *   node scripts/seedDeliveryCompanies.js
 *
 * Make sure your .env file has MONGO_URI set before running.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const DeliveryCompany = require('../model/deliveryCompanySchema');

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

const seed = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const docs = DELIVERY_COMPANIES.map((name) => ({
      id: toId(name),
      name,
      imageUrl: '/assets/Default.png',
    }));

    const allowedIds = docs.map((doc) => doc.id);

    // 🔴 Remove companies not in script
    const deleted = await DeliveryCompany.deleteMany({
      id: { $nin: allowedIds },
    });

    console.log(`Removed ${deleted.deletedCount} companies not in seed list`);

    let inserted = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        await DeliveryCompany.create(doc);
        inserted++;
        console.log(`Inserted: ${doc.name}`);
      } catch (err) {
        if (err.code === 11000) {
          skipped++;
          console.log(`Skipped (already exists): ${doc.name}`);
        } else {
          console.error(`Error inserting ${doc.name}:`, err.message);
        }
      }
    }

    console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('Failed to seed delivery companies:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seed();
