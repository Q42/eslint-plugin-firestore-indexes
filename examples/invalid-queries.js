/**
 * Example file with INVALID Firestore queries that are missing indexes
 * These should trigger ESLint errors when the rule is enabled
 */

const firestore = require('firebase-admin').firestore();

// Invalid: Multiple orderBy clauses require composite index
async function getUsersByLastAndFirstName() {
  const snapshot = await firestore
    .collection('users')
    .orderBy('lastName', 'asc')
    .orderBy('firstName', 'asc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Invalid: Inequality + orderBy on different fields require composite index  
async function getProductsByPriceOrderByRating() {
  const snapshot = await firestore
    .collection('items')
    .where('price', '>', 100)
    .orderBy('rating', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

module.exports = {
  getUsersByLastAndFirstName,
  getProductsByPriceOrderByRating,
};
