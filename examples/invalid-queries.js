/**
 * Example file with INVALID Firestore queries that are missing indexes
 * These should trigger ESLint errors when the rule is enabled
 */

const firestore = require('firebase-admin').firestore();

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
  getProductsByBrandAndStock,
};
