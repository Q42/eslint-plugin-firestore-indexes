/**
 * Example file with VALID Firestore queries that have corresponding indexes
 */

const firestore = require('firebase-admin').firestore();

// Valid: Index exists for users collection with age and name fields
async function getUsersByAgeAndName() {
  const snapshot = await firestore
    .collection('users')
    .where('age', '>', 18)
    .where('name', '==', 'John')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Valid: Index exists for posts collection with status and createdAt fields
async function getPublishedPosts() {
  const snapshot = await firestore
    .collection('posts')
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Valid: Single field queries don't need indexes
async function getUsersByAge() {
  const snapshot = await firestore
    .collection('users')
    .where('age', '>', 21)
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

// Valid: Index exists for products with category, price, and rating
async function getProductsByCategoryAndPrice() {
  const snapshot = await firestore
    .collection('products')
    .where('category', '==', 'electronics')
    .where('price', '<', 1000)
    .orderBy('rating', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

module.exports = {
  getUsersByAgeAndName,
  getPublishedPosts,
  getUsersByAge,
  getProductsByCategoryAndPrice,
};
