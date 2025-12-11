/**
 * Example file with INVALID Firestore queries that are missing indexes
 * These should trigger ESLint errors when the rule is enabled
 */

const firestore = require('firebase-admin').firestore();

// Invalid: No index exists for users collection with email and status fields
async function getUsersByEmailAndStatus() {
  const snapshot = await firestore
    .collection('users')
    .where('email', '==', 'test@example.com')
    .where('status', '==', 'active')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Invalid: No index exists for orders collection
async function getOrdersByCustomerAndDate() {
  const snapshot = await firestore
    .collection('orders')
    .where('customerId', '==', '123')
    .orderBy('orderDate', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Invalid: No index for this specific combination
async function getProductsByBrandAndStock() {
  const snapshot = await firestore
    .collection('products')
    .where('brand', '==', 'Apple')
    .where('inStock', '==', true)
    .orderBy('updatedAt', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

module.exports = {
  getUsersByEmailAndStatus,
  getOrdersByCustomerAndDate,
  getProductsByBrandAndStock,
};
