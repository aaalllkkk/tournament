// file: js/firebase-config.js
async function getFirebaseConfig() {
    const response = await fetch('/api/config');
    return await response.json();
}

export { getFirebaseConfig };
